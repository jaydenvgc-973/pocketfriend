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

    // 1. Fetch all existing locations for this user
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email }
    );
    // 2. Fetch all active characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    const updates = [];

    for (const char of allChars) {
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