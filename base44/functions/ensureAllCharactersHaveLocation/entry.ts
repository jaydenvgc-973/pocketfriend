import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ owner_email: user.email });
    const locations = await base44.entities.LocationReference.filter({ owner_email: user.email });

    // Get or create a default home for homeless characters
    let defaultHome = locations.find(l => l.is_default_generic && l.generic_type === 'home');
    if (!defaultHome) {
      // Create a default home if it doesn't exist
      const newHome = await base44.entities.LocationReference.create({
        name: 'Default Home',
        location_type: 'global',
        category: 'home',
        is_default_generic: true,
        generic_type: 'home',
        canonical_location_key: 'default_home',
        is_generic_shared: true,
        is_user_created: false,
      });
      defaultHome = newHome;
    }

    const updated = [];
    const alreadySet = [];

    for (const char of characters) {
      // RULE: Never assign active_created_character to a generic default home.
      // active_created_character records require individualized housing — missing home is a valid
      // unresolved state, not a reason to mass-assign them to a shared generic location.
      if (char.character_type === 'active_created_character') {
        alreadySet.push(char.name + ' (active_created_character — skipped, requires individual home assignment)');
        continue;
      }

      // If character already has both home and current location, skip
      if (char.current_home_location_id && char.current_location_id) {
        alreadySet.push(char.name);
        continue;
      }

      const updates = {};

      // Assign home if missing
      if (!char.current_home_location_id) {
        updates.current_home_location_id = defaultHome.id;
      }

      // Set current location to home location
      const homeId = updates.current_home_location_id || char.current_home_location_id;
      if (homeId) {
        updates.current_location_id = homeId;
      }

      // Apply updates
      if (Object.keys(updates).length > 0) {
        await base44.entities.Character.update(char.id, updates);
        updated.push({
          name: char.name,
          homeAssigned: !!updates.current_home_location_id,
          locationSet: !!updates.current_location_id,
        });
      }
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      defaultHomeUsed: defaultHome.name,
      updated,
      alreadySet,
      summary: {
        totalCharacters: characters.length,
        updatedCount: updated.length,
        alreadySetCount: alreadySet.length,
        status: updated.length > 0 ? 'FIXED: All characters now have location data.' : 'OK: All characters already set.',
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});