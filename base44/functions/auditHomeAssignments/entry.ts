import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * AUDIT: Check which characters have valid home locations
 * Return list of orphaned characters (no valid home)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter(
      { created_by: user.email },
      "-updated_date"
    );
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const report = {
      total_characters: characters.length,
      with_valid_home: 0,
      orphaned: [],
      home_locations: {}
    };

    for (const char of characters) {
      if (char.status === 'deleted' || char.status === 'soft_deleted') continue;

      const homeId = char.current_home_location_id;
      if (!homeId || !locationMap[homeId]) {
        report.orphaned.push({
          character_id: char.id,
          character_name: char.name,
          home_id: homeId,
          reason: homeId ? 'Home location does not exist' : 'No home assigned'
        });
      } else {
        report.with_valid_home++;
        const homeName = locationMap[homeId].name;
        if (!report.home_locations[homeName]) {
          report.home_locations[homeName] = [];
        }
        report.home_locations[homeName].push(char.name);
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});