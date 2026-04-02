import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * setupDefaultWorldLocations
 * 
 * Consolidates duplicate generic locations using the generic_type field.
 * Does NOT auto-create generic locations — they must be created explicitly.
 * If a user renames a generic location, it's still identified by its generic_type.
 * 
 * Safe to call repeatedly — idempotent.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Define the generic location types that should be consolidated
    const genericTypes = ['park', 'hospital', 'grocery', 'worship'];
    const results = {};
    const consolidated = [];

    // For each generic type, consolidate duplicates to ONE location
    for (const genericType of genericTypes) {
      let typeLocs = await base44.asServiceRole.entities.LocationReference.filter(
        { generic_type: genericType }
      );

      if (typeLocs.length > 1) {
        console.log(`[setupDefaultWorldLocations] Found ${typeLocs.length} ${genericType} locations. Consolidating...`);
        const keeper = typeLocs[0];
        for (let i = 1; i < typeLocs.length; i++) {
          console.log(`[setupDefaultWorldLocations] Deleting duplicate: ${typeLocs[i].id}`);
          await base44.asServiceRole.entities.LocationReference.delete(typeLocs[i].id);
          consolidated.push(`Deleted duplicate ${genericType}: ${typeLocs[i].name}`);
        }
        results[genericType] = { id: keeper.id, consolidated: true, deleted: typeLocs.length - 1 };
      } else if (typeLocs.length === 1) {
        // Exactly one exists — all good
        results[genericType] = { id: typeLocs[0].id, consolidated: false };
      }
      // If none exist, do NOT auto-create. Generic locations should only be created explicitly.
    }

    // ── Upgrade NPC Hub to apartment-building structure (if it exists) ─────────────────
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
      consolidated,
      results,
      message: `Generic location consolidation complete. ${consolidated.length > 0 ? `Removed ${consolidated.length} duplicate(s).` : 'No duplicates found.'}`,
    });
  } catch (error) {
    console.error('[setupDefaultWorldLocations]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});