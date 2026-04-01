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

    const existing = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email }
    );
    const existingNames = existing.map(l => (l.name || '').toLowerCase());

    const created = [];
    const results = {};

    // ── 1. Generic Park ────────────────────────────────────────────────────
    const parkExists = existingNames.some(n =>
      n === 'generic park' || n.includes('generic park')
    );
    if (!parkExists) {
      const park = await base44.asServiceRole.entities.LocationReference.create({
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
      created.push('Generic Park');
      results.park = { id: park.id, created: true };
    } else {
      const found = existing.find(l => (l.name || '').toLowerCase().includes('generic park'));
      results.park = { id: found?.id, created: false };
    }

    // ── 2. Generic Hospital ────────────────────────────────────────────────
    const hospitalExists = existingNames.some(n =>
      n === 'generic hospital' || n.includes('generic hospital')
    );
    if (!hospitalExists) {
      const hospital = await base44.asServiceRole.entities.LocationReference.create({
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
      created.push('Generic Hospital');
      results.hospital = { id: hospital.id, created: true };
    } else {
      const found = existing.find(l => (l.name || '').toLowerCase().includes('generic hospital'));
      results.hospital = { id: found?.id, created: false };
    }

    // ── 3. Generic Grocery Store ───────────────────────────────────────────
    const groceryExists = existingNames.some(n =>
      n === 'generic grocery store' || n.includes('generic grocery')
    );
    if (!groceryExists) {
      const grocery = await base44.asServiceRole.entities.LocationReference.create({
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
      created.push('Generic Grocery Store');
      results.grocery = { id: grocery.id, created: true };
    } else {
      const found = existing.find(l => (l.name || '').toLowerCase().includes('generic grocery'));
      results.grocery = { id: found?.id, created: false };
    }

    // ── 4. Generic Place of Worship ────────────────────────────────────────
    const worshipExists = existingNames.some(n =>
      n.includes('generic place of worship') || n.includes('generic church') || n.includes('generic mosque')
    );
    if (!worshipExists) {
      const worship = await base44.asServiceRole.entities.LocationReference.create({
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
        // Default Sunday morning service hours
        operating_hours: [
          { day_of_week: 0, open_time: '09:00', close_time: '13:00', note: 'Sunday Service' },
          { day_of_week: 3, open_time: '18:00', close_time: '20:00', note: 'Midweek Service' },
        ],
      });
      created.push('Generic Place of Worship');
      results.worship = { id: worship.id, created: true };
    } else {
      const found = existing.find(l => (l.name || '').toLowerCase().includes('generic place of worship') || (l.name || '').toLowerCase().includes('generic church'));
      results.worship = { id: found?.id, created: false };
    }

    // ── 5. Upgrade NPC Hub to apartment-building structure ─────────────────
    const npcHubs = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email, name: 'NPC Hub' }
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