import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * returnNPCsToVGCTowers
 *
 * RULE: Only return NPCs whose current_home_location_id is explicitly VGC Towers.
 * NPCs with their own home location are NEVER sent to VGC Towers.
 * NPCs missing a home are NOT assigned VGC Towers — they are flagged for repair.
 *
 * VGC Towers is NOT a universal fallback. Missing home ≠ lives at VGC Towers.
 *
 * NOTE: This function only updates fictional_relationship location pointers for
 * NPC records stored inside character.fictional_relationships (legacy inline NPCs).
 * It does NOT modify Character entity records with their own home fields.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all user-owned locations
    const allLocations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    const vgcTowers = allLocations.find(loc => loc.name === 'VGC Towers');

    if (!vgcTowers) {
      return Response.json({ error: 'VGC Towers not found for this account' }, { status: 400 });
    }
    const VGC_ID = vgcTowers.id;

    // Get all active characters (user-scoped)
    const characters = await base44.entities.Character.filter({
      owner_email: user.email,
      status: 'active'
    });

    // Build a set of Character entity IDs that are explicitly homed at VGC Towers
    // These are standalone Character records (npc_fictitious) with a home assignment.
    const vgcResidentIds = new Set(
      characters
        .filter(c => c.current_home_location_id === VGC_ID)
        .map(c => c.id)
    );

    // Only process fictional_relationship inline NPC entries that are:
    // a) not linked to a standalone Character (no related_character_id), AND
    // b) have their current_location_id explicitly set to VGC Towers already
    //    OR were explicitly placed there by a prior system move.
    // We do NOT use VGC Towers as a catch-all for inline NPCs with no location.
    const npcUpdateMap = {};
    let returnedCount = 0;
    const skipped = [];

    characters.forEach(char => {
      if (!char.fictional_relationships) return;

      char.fictional_relationships.forEach((rel, idx) => {
        // Skip linked character entities — those have their own home logic
        if (rel.related_character_id) return;
        if (!rel.person_name) return;

        // Only return if the NPC's source_home is explicitly VGC Towers
        // (i.e. rel.home_location_id points to VGC Towers).
        // If no home_location_id is set, do NOT assume VGC Towers.
        const npcHomeId = rel.home_location_id || null;

        if (npcHomeId === VGC_ID) {
          if (!npcUpdateMap[char.id]) npcUpdateMap[char.id] = [];
          npcUpdateMap[char.id].push({ idx, newLocationId: VGC_ID });
          returnedCount++;
        } else if (!npcHomeId) {
          // Missing home — do NOT send to VGC Towers. Flag as needing repair.
          skipped.push({ name: rel.person_name, reason: 'no_home_assigned_not_relocating_to_vgc' });
        } else {
          // Has their own non-VGC home — do not touch
          skipped.push({ name: rel.person_name, reason: 'has_own_home', home_id: npcHomeId });
        }
      });
    });

    if (returnedCount === 0) {
      return Response.json({
        message: 'No VGC-assigned inline NPCs to return',
        skipped,
        rule: 'VGC_TOWERS_IS_NOT_A_FALLBACK — only NPCs explicitly homed at VGC Towers are moved there.',
      });
    }

    let updatedCount = 0;
    for (const [charId, updates] of Object.entries(npcUpdateMap)) {
      const char = characters.find(c => c.id === charId);
      if (!char || !char.fictional_relationships) continue;

      updates.forEach(upd => {
        if (char.fictional_relationships[upd.idx]) {
          char.fictional_relationships[upd.idx].current_location_id = upd.newLocationId;
        }
      });

      await base44.entities.Character.update(charId, {
        fictional_relationships: char.fictional_relationships,
      });
      updatedCount++;
    }

    return Response.json({
      success: true,
      message: `Returned ${returnedCount} VGC-assigned inline NPCs to VGC Towers`,
      charactersUpdated: updatedCount,
      skipped,
      rule: 'VGC_TOWERS_IS_NOT_A_FALLBACK — only NPCs explicitly homed at VGC Towers are moved there.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});