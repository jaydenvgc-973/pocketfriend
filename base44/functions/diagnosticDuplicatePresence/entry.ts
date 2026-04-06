import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters and locations
    const [characters, locations] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }),
      base44.entities.LocationReference.filter({ created_by: user.email })
    ]);

    // Build location map
    const locationMap = {};
    locations.forEach(loc => {
      locationMap[loc.id] = {
        name: loc.name,
        resident_ids: loc.resident_character_ids || [],
        worker_ids: loc.worker_character_ids || []
      };
    });

    const issues = [];
    const characterPresence = {}; // Track which locations each character is registered in

    // Scan all location occupancy lists
    locations.forEach(loc => {
      // Check residents
      (loc.resident_character_ids || []).forEach(charId => {
        if (!characterPresence[charId]) characterPresence[charId] = [];
        characterPresence[charId].push({ locId: loc.id, locName: loc.name, type: 'resident' });
      });

      // Check workers
      (loc.worker_character_ids || []).forEach(charId => {
        if (!characterPresence[charId]) characterPresence[charId] = [];
        characterPresence[charId].push({ locId: loc.id, locName: loc.name, type: 'worker' });
      });
    });

    // Identify duplicates
    const duplicates = {};
    Object.entries(characterPresence).forEach(([charId, presences]) => {
      if (presences.length > 1) {
        const char = characters.find(c => c.id === charId);
        duplicates[charId] = {
          name: char?.name || 'Unknown',
          current_location_id: char?.current_location_id,
          home_location_id: char?.current_home_location_id,
          work_location_id: char?.occupation_location_id,
          registered_in: presences.map(p => `${p.locName} (${p.type})`),
          presence_count: presences.length
        };
      }
    });

    // Also check for characters showing Home but current_location points elsewhere
    const homeForced = {};
    characters.forEach(char => {
      if (!char.current_location_id) return;
      
      // Find home location
      const homeLoc = locationMap[char.current_home_location_id];
      if (!homeLoc) return;

      // Check if they're in home resident list but current_location is NOT home
      if (homeLoc.resident_ids?.includes(char.id) && char.current_location_id !== char.current_home_location_id) {
        homeForced[char.id] = {
          name: char.name,
          false_home_location: char.current_home_location_id,
          true_current_location: char.current_location_id,
          work_location: char.occupation_location_id,
          reason: 'Character in home resident list despite non-home current_location'
        };
      }
    });

    const summary = {
      total_characters: characters.length,
      characters_with_duplicate_presence: Object.keys(duplicates).length,
      characters_with_false_home: Object.keys(homeForced).length,
      duplicates,
      home_forced_issues: homeForced,
      diagnostic_status: Object.keys(duplicates).length > 0 ? 'CRITICAL: Duplicate presence detected' : 'No duplicates found'
    };

    return Response.json(summary);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});