import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * STRICT SITTER ENFORCEMENT ON LOCATION CHANGE
 * 
 * When ANY character's location changes, verify that minors and protected NPCs
 * are never left home alone. Auto-assign sitters if supervision is lost.
 * 
 * This is not optional. A character under 15 or protected NPC family member
 * without a supervising adult MUST have a sitter present.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { character_id } = body;
    if (!character_id) return Response.json({ error: 'Missing character_id' }, { status: 400 });

    const character = await base44.entities.Character.get(character_id);
    const allCharacters = await base44.entities.Character.filter(
      { created_by: user.email },
      "-updated_date"
    );
    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const report = {
      triggeredBy: character.name,
      timestamp: new Date().toISOString(),
      checksPerformed: [],
      sittersAssigned: [],
      sittersRemoved: []
    };

    // For every home in the world, check if dependents there are unsupervised
    for (const location of locations) {
      if (location.category !== 'home' && location.location_type !== 'character_specific') continue;

      const homeDependents = allCharacters.filter(c => {
        const isMinor = c.age && c.age < 15;
        const isProtectedNPC = (c.character_type === 'family_npc' || c.character_type === 'npc') && 
                               location.resident_family_members?.some(m => m.name.toLowerCase() === c.name.toLowerCase());
        const isAtHome = c.current_home_location_id === location.id || c.current_location_id === location.id;
        const isAlive = c.status !== 'deleted';
        
        return (isMinor || isProtectedNPC) && isAtHome && isAlive;
      });

      if (homeDependents.length === 0) continue;

      // Check for valid supervising adults
      const supervisingAdults = allCharacters.filter(c => {
        const isAdult = !c.age || c.age >= 18;
        const isAtHome = c.current_location_id === location.id || c.current_home_location_id === location.id;
        const isAlive = c.status !== 'deleted';
        const isNotDependent = !(c.age && c.age < 15);
        const isNotAsleepOrAway = c.character_type !== 'background';
        
        return isAdult && isAtHome && isAlive && isNotDependent && isNotAsleepOrAway && !c.is_sitter;
      });

      report.checksPerformed.push({
        homeId: location.id,
        homeName: location.name,
        dependentCount: homeDependents.length,
        dependentNames: homeDependents.map(d => d.name),
        adultSupervisionCount: supervisingAdults.length
      });

      // If no supervising adults, assign/create sitter
      if (supervisingAdults.length === 0) {
        const sitterResult = await assignSitterToHome(base44, location, homeDependents, user.email);
        report.sittersAssigned.push(sitterResult);
      }
    }

    // Also check if any currently-assigned sitters should be removed
    // (i.e., a supervising adult returned home)
    const activeSitters = allCharacters.filter(c => c.is_sitter && c.sitter_assigned_to_location_id);
    for (const sitter of activeSitters) {
      const homeLocation = locationMap[sitter.sitter_assigned_to_location_id];
      if (!homeLocation) continue;

      const dependentsNeedingSitter = allCharacters.filter(c => {
        const isMinor = c.age && c.age < 15;
        const isProtectedNPC = (c.character_type === 'family_npc' || c.character_type === 'npc') && 
                               homeLocation.resident_family_members?.some(m => m.name.toLowerCase() === c.name.toLowerCase());
        const isAtHome = c.current_location_id === homeLocation.id;
        const isAlive = c.status !== 'deleted';
        
        return (isMinor || isProtectedNPC) && isAtHome && isAlive;
      });

      if (dependentsNeedingSitter.length === 0) {
        // No dependents at this home anymore — remove sitter
        await base44.entities.Character.update(sitter.id, {
          is_sitter: false,
          sitter_assigned_to_location_id: null,
          current_location_id: null,
          current_home_location_id: null
        });

        // Remove from occupancy
        const residents = new Set(homeLocation.resident_character_ids || []);
        const residentNames = new Set(homeLocation.resident_character_names || []);
        residents.delete(sitter.id);
        residentNames.delete(sitter.name);

        await base44.entities.LocationReference.update(homeLocation.id, {
          resident_character_ids: Array.from(residents),
          resident_character_names: Array.from(residentNames)
        });

        report.sittersRemoved.push({
          sitterId: sitter.id,
          sitterName: sitter.name,
          homeId: homeLocation.id,
          homeName: homeLocation.name,
          reason: 'SUPERVISION_RESTORED'
        });
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function assignSitterToHome(base44, homeLocation, dependents, userEmail) {
  // Check if a sitter is already assigned to this home
  const existingSitter = await base44.entities.Character.filter({
    created_by: userEmail,
    is_sitter: true,
    sitter_assigned_to_location_id: homeLocation.id
  });

  if (existingSitter.length > 0) {
    return {
      status: 'ALREADY_ASSIGNED',
      homeId: homeLocation.id,
      homeName: homeLocation.name,
      sitterId: existingSitter[0].id,
      sitterName: existingSitter[0].name
    };
  }

  // Create new sitter
  const sitterName = `Sitter (${homeLocation.name})`;
  const sitter = await base44.entities.Character.create({
    name: sitterName,
    character_type: 'npc',
    profile_summary: `Professional childcare provider for ${dependents.map(d => d.name).join(', ')} at ${homeLocation.name}`,
    current_location_id: homeLocation.id,
    current_home_location_id: homeLocation.id,
    age: 28,
    gender: 'female',
    is_sitter: true,
    sitter_assigned_to_location_id: homeLocation.id,
    created_by: userEmail,
    status: 'active'
  });

  // Register in home occupancy — sitter is a REAL PRESENT person
  const residents = new Set(homeLocation.resident_character_ids || []);
  const residentNames = new Set(homeLocation.resident_character_names || []);
  residents.add(sitter.id);
  residentNames.add(sitterName);

  await base44.entities.LocationReference.update(homeLocation.id, {
    resident_character_ids: Array.from(residents),
    resident_character_names: Array.from(residentNames)
  });

  return {
    status: 'SITTER_ASSIGNED',
    homeId: homeLocation.id,
    homeName: homeLocation.name,
    sitterId: sitter.id,
    sitterName: sitterName,
    dependentsProtected: dependents.map(d => ({ id: d.id, name: d.name, age: d.age }))
  };
}