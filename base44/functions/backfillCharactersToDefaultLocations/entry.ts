import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * backfillCharactersToDefaultLocations
 * 
 * Scans all active characters and their current_activity / current_situation
 * to assign them to Generic Park, Generic Hospital, or Generic Grocery Store
 * when their state implies they are there and no specific custom location exists.
 * 
 * Also runs inferCoworkerLocations for all characters with linked workplaces.
 * Safe to run repeatedly — only updates characters that need it.
 */

const PARK_KEYWORDS = ['park', 'outside', 'walk in the park', 'sitting outside', 'fresh air', 'jogging', 'outdoor', 'nature walk', 'playground'];
const HOSPITAL_KEYWORDS = ['hospital', 'emergency room', 'er', 'doctor appointment', 'appointment', 'admitted', 'surgery', 'checkup', 'clinic', 'patient', 'treatment', 'medical visit'];
const GROCERY_KEYWORDS = ['grocery', 'groceries', 'supermarket', 'food shopping', 'buying food', 'buying milk', 'store run', 'market', 'food run', 'errands', 'shopping for food'];

function matchesKeywords(text, keywords) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // 1. Ensure default locations exist first — inline check (can't call self via invoke)
    const existingAll = await base44.asServiceRole.entities.LocationReference.filter({ created_by: user.email });
    const existingNames = existingAll.map(l => (l.name || '').toLowerCase());
    if (!existingNames.some(n => n.includes('generic park'))) {
      await base44.asServiceRole.entities.LocationReference.create({
        name: 'Generic Park', location_type: 'global', category: 'outdoor',
        description: 'A public park used for walks, outdoor recreation, and general outdoor activities.',
        keywords: ['park', 'outside', 'walk', 'fresh air', 'the park', 'recreation', 'nature'],
        is_default_generic: true, owner_is_npc: true, owner_npc_name: 'City', owner_role: 'operator',
        zones: [{ zone_name: 'Main Field', image_urls: [] }, { zone_name: 'Walking Path', image_urls: [] }],
      });
    }
    if (!existingNames.some(n => n.includes('generic hospital'))) {
      await base44.asServiceRole.entities.LocationReference.create({
        name: 'Generic Hospital', location_type: 'global', category: 'medical',
        description: 'A general hospital used for appointments, treatment, patient visits, and emergency visits.',
        keywords: ['hospital', 'emergency', 'appointment', 'admitted', 'surgery', 'checkup', 'clinic', 'patient', 'treatment'],
        is_default_generic: true, owner_is_npc: true, owner_npc_name: 'City Health System', owner_role: 'operator',
        zones: [{ zone_name: 'Waiting Area', image_urls: [] }, { zone_name: 'Patient Room', image_urls: [] }],
      });
    }
    if (!existingNames.some(n => n.includes('generic grocery'))) {
      await base44.asServiceRole.entities.LocationReference.create({
        name: 'Generic Grocery Store', location_type: 'global', category: 'grocery',
        description: 'A general grocery store used for buying food, household shopping, and everyday errands.',
        keywords: ['grocery', 'groceries', 'store', 'supermarket', 'food shopping', 'buying food', 'market', 'milk'],
        is_default_generic: true, owner_is_npc: true, owner_npc_name: 'Store Management', owner_role: 'operator',
        zones: [{ zone_name: 'Main Floor', image_urls: [] }, { zone_name: 'Checkout', image_urls: [] }],
      });
    }

    // 2. Fetch all default locations for this user
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email }
    );
    const genericPark = allLocations.find(l => (l.name || '').toLowerCase().includes('generic park'));
    const genericHospital = allLocations.find(l => (l.name || '').toLowerCase().includes('generic hospital'));
    const genericGrocery = allLocations.find(l => (l.name || '').toLowerCase().includes('generic grocery'));

    // Check if custom locations of each type exist (non-generic)
    const hasCustomPark = allLocations.some(l => l.category === 'outdoor' && !l.is_default_generic);
    const hasCustomHospital = allLocations.some(l => l.category === 'medical' && !l.is_default_generic);
    const hasCustomGrocery = allLocations.some(l => l.category === 'grocery' && !l.is_default_generic);

    // 3. Fetch all active characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    const updates = [];

    for (const char of allChars) {
      const textToCheck = [
        char.current_activity,
        char.current_situation,
        char.current_life_event,
      ].filter(Boolean).join(' ');

      // Park backfill — only if no custom park and generic park exists
      if (!hasCustomPark && genericPark && matchesKeywords(textToCheck, PARK_KEYWORDS)) {
        // We don't write a permanent location_id for transient visits, but log the inference
        updates.push({
          characterId: char.id,
          characterName: char.name,
          action: 'noted_at_park',
          locationId: genericPark.id,
          locationName: genericPark.name,
        });
      }

      // Hospital backfill — if current state implies hospital visit and no specific hospital linked
      if (!hasCustomHospital && genericHospital && matchesKeywords(textToCheck, HOSPITAL_KEYWORDS)) {
        updates.push({
          characterId: char.id,
          characterName: char.name,
          action: 'noted_at_hospital',
          locationId: genericHospital.id,
          locationName: genericHospital.name,
        });
      }

      // Grocery backfill — similar transient awareness
      if (!hasCustomGrocery && genericGrocery && matchesKeywords(textToCheck, GROCERY_KEYWORDS)) {
        updates.push({
          characterId: char.id,
          characterName: char.name,
          action: 'noted_at_grocery',
          locationId: genericGrocery.id,
          locationName: genericGrocery.name,
        });
      }

      // Coworker inference — inline for characters with linked workplaces
      if (char.occupation_location_id) {
        try {
          const coworkerNames = new Set();
          (char.work_details?.coworker_names || []).forEach(n => coworkerNames.add(n.trim().toLowerCase()));
          (char.fictional_relationships || []).forEach(rel => {
            const rt = (rel.relationship_type || '').toLowerCase();
            if (['coworker', 'colleague', 'work friend', 'boss', 'employee'].includes(rt) && rel.person_name) {
              coworkerNames.add(rel.person_name.trim().toLowerCase());
            }
          });
          if (coworkerNames.size > 0) {
            const locArr = await base44.asServiceRole.entities.LocationReference.filter({ id: char.occupation_location_id });
            const loc = locArr[0];
            if (loc) {
              const existingWorkerIds = new Set(loc.worker_character_ids || []);
              const newWorkerIds = [...(loc.worker_character_ids || [])];
              const newWorkerTitles = { ...(loc.worker_job_titles || {}) };
              for (const otherChar of allChars) {
                if (otherChar.id === char.id) continue;
                if (existingWorkerIds.has(otherChar.id)) continue;
                const nl = (otherChar.name || '').toLowerCase();
                const isMatch = [...coworkerNames].some(cn => nl === cn || nl.startsWith(cn.split(' ')[0]) || cn.startsWith(nl.split(' ')[0]));
                if (isMatch && !newWorkerIds.includes(otherChar.id)) {
                  newWorkerIds.push(otherChar.id);
                  newWorkerTitles[otherChar.id] = char.work_details?.job_title || 'Employee';
                  updates.push({ characterId: otherChar.id, characterName: otherChar.name, action: 'inferred_coworker', locationId: loc.id, locationName: loc.name });
                }
              }
              if (newWorkerIds.length > (loc.worker_character_ids || []).length) {
                await base44.asServiceRole.entities.LocationReference.update(loc.id, {
                  worker_character_ids: newWorkerIds,
                  worker_job_titles: newWorkerTitles,
                });
              }
            }
          }
        } catch (e) {
          console.warn(`[backfill] coworker inference failed for ${char.name}:`, e.message);
        }
      }
    }

    return Response.json({
      success: true,
      charactersScanned: allChars.length,
      inferenceNotes: updates,
      message: `Backfill complete. Scanned ${allChars.length} characters, noted ${updates.length} location-activity matches.`,
    });
  } catch (error) {
    console.error('[backfillCharactersToDefaultLocations]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});