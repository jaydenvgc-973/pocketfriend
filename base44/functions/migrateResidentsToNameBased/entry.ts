import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * migrateResidentsToNameBased
 *
 * Converts all LocationReference resident data from character IDs to a structured
 * residents array with names, avatars, and dates.
 * 
 * Updates both old resident_character_ids and new residents array.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all locations for this user
    const locations = await base44.entities.LocationReference.filter({ created_by: user.email });

    const results = {
      total_locations: locations.length,
      updated: 0,
      errors: [],
    };

    for (const loc of locations) {
      try {
        const residentsToMigrate = [];

        // Migrate from old resident_character_ids field
        if (loc.resident_character_ids && loc.resident_character_ids.length > 0) {
          for (const charId of loc.resident_character_ids) {
            try {
              const char = await base44.entities.Character.filter({ id: charId }).then(r => r[0] || null).catch(() => null);
              if (char) {
                residentsToMigrate.push({
                  character_id: charId,
                  character_name: char.name,
                  avatar_url: char.image_avatar_url || char.avatar_url || null,
                  moved_in_date: loc.created_date || new Date().toISOString(),
                });
              }
            } catch (err) {
              console.error(`Failed to fetch character ${charId}:`, err.message);
            }
          }
        }

        // Only update if we have something to migrate
        if (residentsToMigrate.length > 0) {
          await base44.entities.LocationReference.update(loc.id, {
            residents: residentsToMigrate,
          });
          results.updated++;
        }
      } catch (err) {
        results.errors.push({ location_id: loc.id, location_name: loc.name, error: err.message });
      }
    }

    return Response.json(results);
  } catch (error) {
    console.error('[migrateResidentsToNameBased]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});