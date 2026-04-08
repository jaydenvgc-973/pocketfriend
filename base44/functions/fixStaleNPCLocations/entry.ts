import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all active locations
    const allLocations = await base44.entities.LocationReference.list();
    const locationIds = new Set(allLocations.map(l => l.id));

    // Build a name -> location map for quick lookup (prefer is_default_generic or app_created)
    const nameToLocation = {};
    for (const loc of allLocations) {
      const key = loc.name?.toLowerCase().trim();
      if (!key) continue;
      // Prioritize built-in/default locations
      if (!nameToLocation[key] || loc.is_default_generic || loc.source === 'app_created') {
        nameToLocation[key] = loc;
      }
    }

    // Get all characters for this user
    const characters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active',
    });

    let fixedCount = 0;
    const fixes = [];

    for (const char of characters) {
      let changed = false;
      const updatedRelationships = (char.fictional_relationships || []).map(rel => {
        if (!rel.current_location_id) return rel;

        // If the location ID still exists, no fix needed
        if (locationIds.has(rel.current_location_id)) return rel;

        // Location is stale (deleted) — try to find a built-in replacement by name
        // We don't know the old name, so clear the stale ID so NPC returns home
        fixes.push({ char: char.name, npc: rel.person_name, staleId: rel.current_location_id });
        changed = true;
        return { ...rel, current_location_id: null };
      });

      // Also fix character-level location fields if stale
      let charUpdate = {};
      if (char.current_home_location_id && !locationIds.has(char.current_home_location_id)) {
        charUpdate.current_home_location_id = null;
        changed = true;
      }
      if (char.current_work_location_id && !locationIds.has(char.current_work_location_id)) {
        charUpdate.current_work_location_id = null;
        changed = true;
      }
      if (char.resolved_current_location_id && !locationIds.has(char.resolved_current_location_id)) {
        charUpdate.resolved_current_location_id = null;
        charUpdate.resolved_current_location_name = null;
        changed = true;
      }
      if (char.traveling_to_location_id && !locationIds.has(char.traveling_to_location_id)) {
        charUpdate.traveling_to_location_id = null;
        charUpdate.traveling_to_location_name = null;
        changed = true;
      }

      if (changed) {
        await base44.entities.Character.update(char.id, {
          fictional_relationships: updatedRelationships,
          ...charUpdate,
        });
        fixedCount++;
      }
    }

    return Response.json({
      success: true,
      message: `Fixed ${fixedCount} characters with stale location references.`,
      fixes,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});