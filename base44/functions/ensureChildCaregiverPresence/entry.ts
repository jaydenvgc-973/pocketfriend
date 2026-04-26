import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CHILD CAREGIVER SPAWN SYSTEM
 * 
 * Mirrors staff-spawn logic: if a home has a child under 16 with no parent/guardian present,
 * a babysitter NPC is automatically created/activated at that home.
 * 
 * Called:
 *  - On Travel page load (check all homes this user owns)
 *  - On Scene page load if it's a home location
 *  - From a scheduled automation
 */

const SAFE_ALONE_AGE = 16; // children under this need supervision
const CAREGIVER_ROLE = 'babysitter';

function resolveAge(character) {
  if (character.age && typeof character.age === 'number' && character.age > 0) return character.age;
  if (character.age_range) {
    const r = character.age_range.toLowerCase();
    if (r.includes('early 20')) return 21;
    if (r.includes('mid 20'))   return 25;
    if (r.includes('late 20'))  return 28;
    if (r.includes('early 30')) return 31;
    if (r.includes('mid 30'))   return 35;
    if (r.includes('late 30'))  return 38;
    if (r.includes('40')) return 43;
    if (r.includes('50')) return 53;
    if (r.includes('60')) return 63;
    if (r.includes('70')) return 73;
  }
  return null;
}

function isChildAlone(child, homeId, allCharacters) {
  // All characters whose current_home_location_id === homeId (residents)
  const residents = allCharacters.filter(c => c.current_home_location_id === homeId && c.id !== child.id);

  // A guardian is someone who is adult (age >= SAFE_ALONE_AGE) AND physically at home right now
  const guardianPresent = residents.some(c => {
    const age = resolveAge(c);
    if (age !== null && age < SAFE_ALONE_AGE) return false; // also a child
    // Check resolved location
    const atHome = !c.resolved_current_location_id || c.resolved_current_location_id === homeId;
    return atHome;
  });

  // Also check family_members in fictional_relationships for a parent guardian
  // (NPCs who live here but aren't full Character entities)
  // We check resident_family_members on the location — handled by caller

  return !guardianPresent;
}

function isCaregiver(character) {
  return (
    character.character_type === 'npc_regular' &&
    (character.is_sitter === true || (character.occupation || '').toLowerCase().includes(CAREGIVER_ROLE))
  );
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const targetLocationId = body.locationId || null; // optional: only check a specific home

  // 1. Fetch all characters owned by this user
  const allChars = await base44.entities.Character.filter(
    { owner_email: user.email },
    '-created_date',
    200
  ).catch(() => []);

  // 2. Fetch all home-category locations owned by this user
  const allLocations = await base44.entities.LocationReference.filter(
    { owner_email: user.email },
    '-created_date',
    100
  ).catch(() => []);

  const homeLocations = allLocations.filter(l =>
    l.category === 'home' &&
    (!targetLocationId || l.id === targetLocationId)
  );

  const results = [];

  for (const home of homeLocations) {
    // 3. Find children (under SAFE_ALONE_AGE) whose home is this location
    const childResidents = allChars.filter(c => {
      if (c.current_home_location_id !== home.id) return false;
      const age = resolveAge(c);
      if (age === null) return false; // can't confirm they're a child
      return age < SAFE_ALONE_AGE;
    });

    if (childResidents.length === 0) {
      // No children here — despawn any lingering sitters
      const lingeringSitters = allChars.filter(c =>
        isCaregiver(c) &&
        c.sitter_assigned_to_location_id === home.id &&
        c.resolved_current_location_id === home.id
      );
      for (const sitter of lingeringSitters) {
        await base44.entities.Character.update(sitter.id, {
          resolved_current_location_id: home.id, // return home (their own home is the home)
          resolved_presence_status: 'home',
          resolved_source_reason: 'no_child_to_supervise',
          resolved_last_updated_at: new Date().toISOString(),
          is_sitter: false,
          sitter_assigned_to_location_id: null,
        }).catch(() => {});
      }
      continue;
    }

    // 4. Check each child — is any alone?
    let needsCaregiver = false;
    for (const child of childResidents) {
      // Is child currently at home?
      const childAtHome =
        !child.resolved_current_location_id ||
        child.resolved_current_location_id === home.id;
      if (!childAtHome) continue;

      if (isChildAlone(child, home.id, allChars)) {
        needsCaregiver = true;
        break;
      }
    }

    if (!needsCaregiver) {
      // All children have a guardian — despawn sitters no longer needed
      const unneededSitters = allChars.filter(c =>
        isCaregiver(c) &&
        c.sitter_assigned_to_location_id === home.id &&
        c.resolved_current_location_id === home.id
      );
      for (const sitter of unneededSitters) {
        await base44.entities.Character.update(sitter.id, {
          resolved_presence_status: 'home',
          resolved_source_reason: 'guardian_returned',
          resolved_last_updated_at: new Date().toISOString(),
          is_sitter: false,
          sitter_assigned_to_location_id: null,
        }).catch(() => {});
      }
      results.push({ home: home.name, status: 'guardian_present', childCount: childResidents.length });
      continue;
    }

    // 5. Check if a caregiver is ALREADY present at this home
    const existingSitter = allChars.find(c =>
      isCaregiver(c) &&
      c.resolved_current_location_id === home.id &&
      c.sitter_assigned_to_location_id === home.id
    );

    if (existingSitter) {
      results.push({ home: home.name, status: 'caregiver_already_present', caregiver: existingSitter.name });
      continue;
    }

    // 6. Try to reuse an existing sitter NPC owned by this user
    const availableSitter = allChars.find(c =>
      isCaregiver(c) &&
      c.owner_email === user.email &&
      c.sitter_assigned_to_location_id !== home.id
    );

    if (availableSitter) {
      await base44.entities.Character.update(availableSitter.id, {
        resolved_current_location_id: home.id,
        resolved_current_location_name: home.name,
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'child_supervision',
        resolved_last_updated_at: new Date().toISOString(),
        is_sitter: true,
        sitter_assigned_to_location_id: home.id,
      }).catch(() => {});
      results.push({ home: home.name, status: 'existing_sitter_assigned', caregiver: availableSitter.name });
      continue;
    }

    // 7. Spawn a new babysitter NPC
    const childNames = childResidents.map(c => c.name).join(', ');
    const sitterName = `${home.name} Babysitter`;

    const newSitter = await base44.entities.Character.create({
      name: sitterName,
      character_type: 'npc_regular',
      owner_email: user.email,
      owner_user_id: user.id,
      status: 'active',
      occupation: 'Babysitter',
      is_sitter: true,
      sitter_assigned_to_location_id: home.id,
      current_home_location_id: home.id,
      resolved_current_location_id: home.id,
      resolved_current_location_name: home.name,
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'child_supervision_spawn',
      resolved_last_updated_at: new Date().toISOString(),
      personality_summary: `A reliable babysitter caring for ${childNames} at ${home.name}. Attentive, calm, and responsible.`,
      data_scope: 'private_user',
      visibility_scope: 'account_private',
      exclude_from_homepage: true,
      exclude_from_roster: true,
    }).catch(err => {
      console.error('[ensureChildCaregiverPresence] Failed to create sitter:', err.message);
      return null;
    });

    if (newSitter) {
      results.push({ home: home.name, status: 'spawned_new_caregiver', caregiver: sitterName, childrenSupervised: childNames });
    } else {
      results.push({ home: home.name, status: 'spawn_failed' });
    }
  }

  return Response.json({ success: true, results });
});