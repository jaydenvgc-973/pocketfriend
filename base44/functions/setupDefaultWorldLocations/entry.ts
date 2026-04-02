import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * setupDefaultWorldLocations
 * 
 * Creates the three core default world locations (Generic Park, Generic Hospital,
 * Generic Grocery Store) for a user if they don't already exist.
 * Also upgrades the NPC Hub to have apartment-building structure with unit logic.
 * 
 * Safe to call repeatedly — idempotent.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Consolidate duplicates first — each generic category should have exactly ONE location
    const defaultCategories = [
      { category: 'outdoor', names: ['generic park', 'park'], canonicalName: 'Generic Park' },
      { category: 'medical', names: ['generic hospital', 'hospital'], canonicalName: 'Generic Hospital' },
      { category: 'grocery', names: ['generic grocery', 'grocery'], canonicalName: 'Generic Grocery Store' },
      { category: 'religion', names: ['generic place of worship', 'generic church'], canonicalName: 'Generic Place of Worship' },
    ];

    const results = {};
    const created = [];

    // For each generic category, find/consolidate to ONE location
    // Use a broader filter to catch duplicates by category alone (not just is_default_generic)
    for (const catDef of defaultCategories) {
      let categoryLocs = await base44.asServiceRole.entities.LocationReference.filter(
        { category: catDef.category, is_default_generic: true }
      );

      // If we found duplicates, consolidate first
      if (categoryLocs.length > 1) {
        console.log(`[setupDefaultWorldLocations] Found ${categoryLocs.length} generic ${catDef.category} locations. Consolidating...`);
        const keeper = categoryLocs[0];
        for (let i = 1; i < categoryLocs.length; i++) {
          console.log(`[setupDefaultWorldLocations] Deleting duplicate: ${categoryLocs[i].id}`);
          await base44.asServiceRole.entities.LocationReference.delete(categoryLocs[i].id);
        }
        results[catDef.category] = { id: keeper.id, created: false, consolidated: true, deleted: categoryLocs.length - 1 };
      } else if (categoryLocs.length === 1) {
        // Exactly one exists — all good
        results[catDef.category] = { id: categoryLocs[0].id, created: false, consolidated: false };
      } else {
        // None exist — create one
        let newLoc;
        if (catDef.category === 'outdoor') {
          newLoc = await base44.asServiceRole.entities.LocationReference.create({
            name: 'Generic Park',
            location_type: 'global',
            category: 'outdoor',
            description: 'A public park used for walks, outdoor recreation, fresh air, socializing, and general outdoor activities.',
            keywords: ['park', 'outside', 'outdoors', 'walk', 'fresh air', 'the park', 'hanging out outside', 'sitting outside', 'recreation', 'nature'],
            is_default_generic: true,
            owner_is_npc: true,
            owner_npc_name: 'City',
            owner_role: 'operator',
            zones: [
              { zone_name: 'Main Field', image_urls: [] },
              { zone_name: 'Walking Path', image_urls: [] },
              { zone_name: 'Benches / Seating Area', image_urls: [] },
              { zone_name: 'Playground', image_urls: [] },
              { zone_name: 'Entrance', image_urls: [] },
            ],
          });
        } else if (catDef.category === 'medical') {
          newLoc = await base44.asServiceRole.entities.LocationReference.create({
            name: 'Generic Hospital',
            location_type: 'global',
            category: 'medical',
            description: 'A general hospital used for appointments, treatment, patient visits, emergency visits, and medical work.',
            keywords: ['hospital', 'emergency', 'ER', 'doctor appointment', 'appointment', 'patient', 'admitted', 'medical', 'clinic', 'checkup', 'surgery', 'treatment'],
            is_default_generic: true,
            owner_is_npc: true,
            owner_npc_name: 'City Health System',
            owner_role: 'operator',
            zones: [
              { zone_name: 'Waiting Area', image_urls: [] },
              { zone_name: 'Front Desk', image_urls: [] },
              { zone_name: 'Patient Room', image_urls: [] },
              { zone_name: 'Emergency Room', image_urls: [] },
              { zone_name: 'Hallway', image_urls: [] },
              { zone_name: 'Pharmacy', image_urls: [] },
            ],
          });
        } else if (catDef.category === 'grocery') {
          newLoc = await base44.asServiceRole.entities.LocationReference.create({
            name: 'Generic Grocery Store',
            location_type: 'global',
            category: 'grocery',
            description: 'A general grocery store used for buying food, household shopping, and everyday errands like buying milk or groceries.',
            keywords: ['grocery', 'groceries', 'store', 'supermarket', 'food shopping', 'buying food', 'market', 'milk', 'buying milk', 'shopping', 'errands', 'walmart', 'target run', 'food run'],
            is_default_generic: true,
            owner_is_npc: true,
            owner_npc_name: 'Store Management',
            owner_role: 'operator',
            zones: [
              { zone_name: 'Main Floor', image_urls: [] },
              { zone_name: 'Produce Section', image_urls: [] },
              { zone_name: 'Checkout', image_urls: [] },
              { zone_name: 'Entrance', image_urls: [] },
              { zone_name: 'Deli / Bakery', image_urls: [] },
            ],
          });
        } else if (catDef.category === 'religion') {
          newLoc = await base44.asServiceRole.entities.LocationReference.create({
            name: 'Generic Place of Worship',
            location_type: 'global',
            category: 'religion',
            description: 'A generic place of worship used as a fallback for religious attendance. Can represent a church, mosque, temple, synagogue, or any other house of worship.',
            keywords: ['church', 'mosque', 'temple', 'synagogue', 'worship', 'service', 'prayer', 'fellowship', 'bible study', 'kingdom hall', 'prayer center', 'religious'],
            is_default_generic: true,
            owner_is_npc: true,
            owner_npc_name: 'Congregation',
            owner_role: 'operator',
            zones: [
              { zone_name: 'Main Sanctuary', image_urls: [] },
              { zone_name: 'Prayer Room', image_urls: [] },
              { zone_name: 'Fellowship Hall', image_urls: [] },
              { zone_name: 'Office', image_urls: [] },
              { zone_name: 'Entrance', image_urls: [] },
            ],
            operating_hours: [
              { day_of_week: 0, open_time: '09:00', close_time: '13:00', note: 'Sunday Service' },
              { day_of_week: 3, open_time: '18:00', close_time: '20:00', note: 'Midweek Service' },
            ],
          });
        }
        created.push(catDef.canonicalName);
        results[catDef.category] = { id: newLoc.id, created: true, consolidated: false };
      }
    }

    // ── 5. Upgrade NPC Hub to apartment-building structure ─────────────────
    const npcHubs = await base44.asServiceRole.entities.LocationReference.filter(
      { name: 'NPC Hub', is_default_generic: true }
    );
    if (npcHubs.length > 0) {
      const hub = npcHubs[0];
      // Only upgrade if it still has the old minimal zone structure
      const needsUpgrade = !hub.zones || hub.zones.length <= 1;
      if (needsUpgrade) {
        await base44.asServiceRole.entities.LocationReference.update(hub.id, {
          description: 'An apartment building where NPCs and fictional characters reside. Contains separate units for family groups, with neighbors who may or may not know each other.',
          keywords: ['npc hub', 'apartment building', 'the building', 'hub'],
          zones: [
            { zone_name: 'Building Lobby', image_urls: [] },
            { zone_name: 'Unit 1A', image_urls: [] },
            { zone_name: 'Unit 1B', image_urls: [] },
            { zone_name: 'Unit 2A', image_urls: [] },
            { zone_name: 'Unit 2B', image_urls: [] },
            { zone_name: 'Unit 3A', image_urls: [] },
            { zone_name: 'Hallway', image_urls: [] },
            { zone_name: 'Shared Laundry', image_urls: [] },
            { zone_name: 'Parking / Entrance', image_urls: [] },
          ],
        });
        results.npcHub = { id: hub.id, upgraded: true };
      } else {
        results.npcHub = { id: hub.id, upgraded: false };
      }
    }

    return Response.json({
      success: true,
      created,
      results,
      message: `Default world locations ready. Created: [${created.join(', ') || 'none (all existed)'}]`,
    });
  } catch (error) {
    console.error('[setupDefaultWorldLocations]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});