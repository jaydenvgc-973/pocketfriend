import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Audit: Find characters whose resolved_current_location doesn't match their actual home/work/school
 * This identifies characters showing up at wrong locations
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      "-updated_date"
    );

    const locationsRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const locations = locationsRes?.data?.locations || [];
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const mismatches = [];

    for (const char of characters) {
      const resolved = char.resolved_current_location_id;
      const home = char.current_home_location_id;
      const work = char.occupation_location_id;
      const school = char.education_location_id;

      // Check if resolved location matches any expected location
      const isValidLocation = 
        resolved === home || 
        resolved === work || 
        resolved === school || 
        !resolved; // Null is ok

      if (!isValidLocation) {
        mismatches.push({
          character_id: char.id,
          character_name: char.name,
          resolved_location_id: resolved,
          resolved_location_name: char.resolved_current_location_name,
          expected_locations: {
            home: home ? `${home} (${locationMap[home]?.name})` : null,
            work: work ? `${work} (${locationMap[work]?.name})` : null,
            school: school ? `${school} (${locationMap[school]?.name})` : null
          },
          reason: 'Resolved location does not match any assigned location'
        });
      }
    }

    return Response.json({
      status: 'LOCATION_MISMATCH_AUDIT',
      total_characters: characters.length,
      mismatches_found: mismatches.length,
      mismatches
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});