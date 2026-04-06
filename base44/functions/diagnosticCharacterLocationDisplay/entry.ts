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
      rules: {
        homeLocation: 'ALL active characters (except NPC/background) must have current_home_location_id',
        displayName: 'Home location must have a specific display_name (e.g., "VGC Gym", "Nathan and Lila\'s House") — NO generic types',
        noGenericCollapse: 'Private world locations must NEVER be collapsed into generic venue types like "gym", "bar", "home"',
        currentLocation: 'current_location_id tracks real-time position; current_home_location_id is the authoritative home'
      }
    };

    // Check each character
    for (const char of characters) {
      const charDiag = {
        characterId: char.id,
        characterName: char.name,
        characterType: char.character_type,
        status: char.status,
        checks: {},
        violations: []
      };

      // RULE 1: Active characters MUST have current_home_location_id
      charDiag.checks.has_current_home_location_id = !!char.current_home_location_id;
      if (char.status === 'active' && char.character_type !== 'npc' && char.character_type !== 'background') {
        if (!char.current_home_location_id) {
          charDiag.violations.push('CRITICAL: Active character missing current_home_location_id');
          report.issues.push(`"${char.name}" (active) missing home location assignment`);
        } else {
          const homeLocation = locationMap[char.current_home_location_id];
          if (!homeLocation) {
            charDiag.violations.push('CRITICAL: current_home_location_id references non-existent location');
            report.issues.push(`"${char.name}" home location ID "${char.current_home_location_id}" not found in database`);
          } else if (!homeLocation.name) {
            charDiag.violations.push('CRITICAL: Home location missing display_name');
            report.issues.push(`"${char.name}" home location has no display_name (location ID: ${homeLocation.id})`);
          } else {
            charDiag.checks.home_location_name = homeLocation.name;
            charDiag.checks.home_location_ok = true;
          }
        }
      }

      // Check current location (real-time position tracking)
      charDiag.checks.has_current_location_id = !!char.current_location_id;
      if (char.current_location_id) {
        const location = locationMap[char.current_location_id];
        if (location) {
          charDiag.checks.current_location_name = location.name;
          charDiag.checks.current_location_ok = true;
        } else {
          charDiag.violations.push('ERROR: current_location_id references non-existent location');
          report.issues.push(`"${char.name}" current location ID "${char.current_location_id}" not found`);
        }
      }

      // Check work location
      charDiag.checks.has_occupation_location_id = !!char.occupation_location_id;
      if (char.occupation_location_id) {
        const workLocation = locationMap[char.occupation_location_id];
        if (workLocation) {
          charDiag.checks.work_location_name = workLocation.name;
        } else {
          charDiag.violations.push('WARNING: occupation_location_id references non-existent location');
        }
      }

      charDiag.checks.current_activity = char.current_activity || "(not set)";
      report.diagnostics.push(charDiag);
    }

    // Summary
    const activeCharsWithHome = characters.filter(c => 
      c.status === 'active' && 
      (c.character_type === 'npc' || c.character_type === 'background' || !!c.current_home_location_id)
    ).length;
    const activeCharsTotal = characters.filter(c => c.status === 'active').length;
    
    report.summary = {
      totalCharacters: characters.length,
      activeCharacters: activeCharsTotal,
      activeWithValidHome: activeCharsWithHome,
      compliancePercentage: activeCharsTotal > 0 ? ((activeCharsWithHome / activeCharsTotal) * 100).toFixed(1) + '%' : '0%',
      totalLocations: locations.length,
      recommendation: activeCharsWithHome === activeCharsTotal 
        ? 'All active characters have valid home locations with display names.'
        : `${activeCharsTotal - activeCharsWithHome} active character(s) missing home location or location data.`
    };

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});