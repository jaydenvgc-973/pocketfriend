import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * VALIDATE: All 10 characters have homes that resolve in the system
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all 10 active_created_character
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }, "-created_date"),
      base44.entities.Character.filter({ owner_email: user.email }, "-created_date"),
    ]);

    const activeCreated = [];
    const seen = new Set();
    for (const c of [...byCreatedBy, ...byOwnerEmail]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.character_type !== 'active_created_character') continue;
      if (c.is_test_character === true) continue;
      activeCreated.push(c);
    }

    // Get all locations
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: user.email }, null, 500);
    const locById = {};
    for (const loc of allLocations) {
      locById[loc.id] = loc;
    }

    // Check each character's home
    const homeStatus = activeCreated.map(char => {
      const homeId = char.current_home_location_id;
      const resolveName = char.resolved_current_location_name;
      const homeLoc = homeId ? locById[homeId] : null;

      // Also check if resolved_current_location_name matches any location
      const resolvedByName = allLocations.find(l => l.name === resolveName);

      return {
        character_id: char.id,
        character_name: char.name,
        current_home_location_id: homeId || null,
        home_id_resolved_in_db: homeLoc ? homeLoc.name : (homeId ? '❌ ID_NOT_FOUND' : 'NULL'),
        resolved_current_location_name: resolveName || null,
        resolved_name_found_in_db: resolvedByName ? resolvedByName.id : (resolveName ? '❌ NAME_NOT_FOUND' : 'NULL'),
        home_exists_via_id: homeLoc ? '✓ YES' : (homeId ? '✗ NO' : 'NO_ID_SET'),
        home_exists_via_name: resolvedByName ? '✓ YES' : (resolveName ? '✗ NO' : 'NO_NAME_SET'),
        home_status: (homeLoc || resolvedByName) ? '✓ HOME_FOUND' : '❌ HOME_NOT_RESOLVABLE',
      };
    });

    const homesFoundCount = homeStatus.filter(s => s.home_status === '✓ HOME_FOUND').length;

    return Response.json({
      user_email: user.email,
      total_active_created: activeCreated.length,
      total_locations_in_account: allLocations.length,
      homes_resolvable: homesFoundCount,
      homes_not_resolvable: activeCreated.length - homesFoundCount,
      per_character_home_status: homeStatus,
      verdict: homesFoundCount === 10 ? "✓ ALL 10 CHARACTERS HAVE RESOLVABLE HOMES" : `❌ ${10 - homesFoundCount} characters have unresolvable homes`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});