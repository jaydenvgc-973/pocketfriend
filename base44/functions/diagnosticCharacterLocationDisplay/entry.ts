import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all characters
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    // Fetch all locations for reference
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const report = {
      timestamp: new Date().toISOString(),
      totalCharacters: characters.length,
      diagnostics: [],
      issues: [],
      summary: {},
    };

    // Check each character
    for (const char of characters) {
      const charDiag = {
        characterId: char.id,
        characterName: char.name,
        checks: {},
      };

      // Check 1: Does character have current_location_id set?
      charDiag.checks.has_current_location_id = !!char.current_location_id;
      if (!char.current_location_id) {
        charDiag.checks.current_location_id_value = null;
        charDiag.checks.status = "MISSING: current_location_id not set";
      } else {
        charDiag.checks.current_location_id_value = char.current_location_id;
        
        // Check 2: Does that location exist?
        const location = locationMap[char.current_location_id];
        charDiag.checks.location_exists = !!location;
        
        if (location) {
          charDiag.checks.location_name = location.name;
          charDiag.checks.location_category = location.category;
          charDiag.checks.status = "OK: Location found and accessible";
        } else {
          charDiag.checks.location_name = "NOT FOUND";
          charDiag.checks.status = "ERROR: location_id references non-existent location";
          report.issues.push(`Character "${char.name}" has current_location_id "${char.current_location_id}" but location doesn't exist`);
        }
      }

      // Check 3: Does character have home location set?
      charDiag.checks.has_current_home_location_id = !!char.current_home_location_id;
      if (char.current_home_location_id) {
        const homeExists = locationMap[char.current_home_location_id];
        charDiag.checks.home_location_exists = !!homeExists;
        if (homeExists) {
          charDiag.checks.home_location_name = homeExists.name;
        }
      }

      // Check 4: Does character have work location set?
      charDiag.checks.has_occupation_location_id = !!char.occupation_location_id;
      if (char.occupation_location_id) {
        const workExists = locationMap[char.occupation_location_id];
        charDiag.checks.work_location_exists = !!workExists;
        if (workExists) {
          charDiag.checks.work_location_name = workExists.name;
        }
      }

      // Check 5: Stale activity string
      charDiag.checks.current_activity = char.current_activity || "(not set)";
      charDiag.checks.activity_last_updated = char.life_last_updated || "(never)";

      report.diagnostics.push(charDiag);
    }

    // Summary
    const withLocation = characters.filter(c => !!c.current_location_id).length;
    const missingLocation = characters.filter(c => !c.current_location_id).length;
    
    report.summary = {
      charactersWithCurrentLocation: withLocation,
      charactersWithoutCurrentLocation: missingLocation,
      percentageWithLocation: characters.length > 0 ? ((withLocation / characters.length) * 100).toFixed(1) + '%' : '0%',
      totalLocations: locations.length,
      recommendation: missingLocation > 0 
        ? `${missingLocation} characters missing current_location_id. Call updateCharacterLocation() after travel.`
        : 'All characters have current_location_id set. Location tracking is working.',
    };

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});