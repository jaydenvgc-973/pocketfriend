import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters and locations
    const characters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active'
    });

    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    let updated = 0;

    // For each character, populate NPC locations
    for (const char of characters) {
      if (!char.fictional_relationships || char.fictional_relationships.length === 0) continue;

      const updatedRelationships = char.fictional_relationships.map(rel => {
        if (rel.related_character_id || !rel.person_name) {
          return rel; // Skip actual character relationships
        }

        // If already has a location, keep it
        if (rel.current_location_id) {
          return rel;
        }

        // Assign a default location based on character's home
        let defaultLocationId = char.current_home_location_id || char.resolved_current_location_id;

        if (!defaultLocationId) {
          // Fallback: find first home location for this character
          const homeLocations = locations.filter(l => 
            (l.resident_character_ids || []).includes(char.id) ||
            (l.resident_character_names || []).includes(char.name)
          );
          if (homeLocations.length > 0) {
            defaultLocationId = homeLocations[0].id;
          }
        }

        // Return relationship with populated current_location_id
        return {
          ...rel,
          current_location_id: defaultLocationId || null
        };
      });

      // Update character if any NPCs were assigned locations
      if (updatedRelationships.some(rel => rel.current_location_id && !char.fictional_relationships.find(r => r.person_name === rel.person_name && r.current_location_id))) {
        await base44.entities.Character.update(char.id, {
          fictional_relationships: updatedRelationships
        });
        updated++;
      }
    }

    return Response.json({
      success: true,
      message: `Updated ${updated} characters with NPC locations`
    });
  } catch (error) {
    console.error('Error populating NPC locations:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});