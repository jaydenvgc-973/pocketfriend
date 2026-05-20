import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditEthanCharacterFields
 *
 * Reads known character records by ID to check their home fields.
 * Uses IDs from prior working diagnostics (diagnosticCharacterHomeData expected list).
 * Also reads the LocationReference for Ethan's Family Home directly to check
 * the resident_character_ids array for any non-Ethan IDs.
 *
 * NO WRITES. DIAGNOSTIC ONLY.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105'; // Ethan Thompson's Home
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb'; // Ethan's Family Home

    // Known characters from diagnosticCharacterHomeData expected list
    // We'll fetch by name patterns since we don't have all IDs
    const targetNames = [
      'Ethan Thompson', 'Lila Green', 'Ava Dei Park', 'Melody Jackson Perry',
      'Matt Lopez', 'Brian Anderson', 'James Anderson', 'Nathan Parker',
      'Jonathan Anthony Smith', 'Andre Rivera',
      // The family members that were reported as misassigned
      'Stephanie', 'Sarah', 'Larry', 'Linda', 'Thomas', 'Vanessa', 'Marisol'
    ];

    // Fetch the two Ethan location records fresh
    const [personalHomeArr, familyHomeArr] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ id: PERSONAL_HOME_ID }),
      base44.asServiceRole.entities.LocationReference.filter({ id: FAMILY_HOME_ID }),
    ]);

    const personalHome = personalHomeArr[0];
    const familyHome   = familyHomeArr[0];

    // Get ALL character IDs in EITHER location's resident_character_ids
    const personalResidentIds = personalHome?.resident_character_ids || [];
    const familyResidentIds   = familyHome?.resident_character_ids   || [];
    const personalResidentsArr = (personalHome?.residents || []).map(r => r.character_id).filter(Boolean);
    const familyResidentsArr   = (familyHome?.residents   || []).map(r => r.character_id).filter(Boolean);

    const allResidentIds = new Set([
      ...personalResidentIds, ...familyResidentIds,
      ...personalResidentsArr, ...familyResidentsArr
    ]);

    // Look up every resident character
    const residentCharacters = await Promise.all(
      [...allResidentIds].map(id =>
        base44.asServiceRole.entities.Character.filter({ id })
          .then(arr => arr[0] || { id, _not_found: true })
          .catch(() => ({ id, _error: true }))
      )
    );

    // Now find any characters (from any available query) that point to these locations
    // Try multiple query patterns
    const queries = await Promise.all([
      base44.asServiceRole.entities.Character.list('-updated_date', 100).catch(() => []),
      base44.entities.Character.list('-updated_date', 100).catch(() => []),
    ]);

    const allFromList = [...queries[0]];
    const seenIds = new Set(queries[0].map(c => c.id));
    for (const c of queries[1]) {
      if (!seenIds.has(c.id)) { allFromList.push(c); seenIds.add(c.id); }
    }

    // Filter for characters pointing to either Ethan location
    const pointingToPersonal = allFromList.filter(c =>
      c.current_home_location_id === PERSONAL_HOME_ID ||
      c.home_location_id === PERSONAL_HOME_ID
    );
    const resolvedAtPersonal = allFromList.filter(c =>
      c.resolved_current_location_id === PERSONAL_HOME_ID
    );
    const pointingToFamily = allFromList.filter(c =>
      c.current_home_location_id === FAMILY_HOME_ID ||
      c.home_location_id === FAMILY_HOME_ID
    );
    const resolvedAtFamily = allFromList.filter(c =>
      c.resolved_current_location_id === FAMILY_HOME_ID
    );
    const withCorruptedFlag = allFromList.filter(c =>
      c.resolved_source_reason === 'fixed_corrupted_home_id'
    );

    const fmt = (c) => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      status: c.status,
      owner_email: c.owner_email,
      created_by: c.created_by,
      current_home_location_id: c.current_home_location_id,
      home_location_id: c.home_location_id,
      resolved_current_location_id: c.resolved_current_location_id,
      resolved_current_location_name: c.resolved_current_location_name,
      resolved_presence_status: c.resolved_presence_status,
      resolved_source_reason: c.resolved_source_reason,
    });

    // Also try to get specific family characters by name
    const familyNamedChars = allFromList.filter(c =>
      ['stephanie', 'sarah', 'larry', 'linda', 'thomas', 'vanessa', 'marisol'].some(n =>
        c.name?.toLowerCase().includes(n)
      )
    );

    return Response.json({
      user: user.email,

      // Location record state (canonical)
      location_record_state: {
        personal_home: {
          id: PERSONAL_HOME_ID,
          name: personalHome?.name,
          resident_character_ids: personalResidentIds,
          residents_array_ids: personalResidentsArr,
          resident_family_members: personalHome?.resident_family_members || [],
        },
        family_home: {
          id: FAMILY_HOME_ID,
          name: familyHome?.name,
          resident_character_ids: familyResidentIds,
          residents_array_ids: familyResidentsArr,
          resident_family_members: familyHome?.resident_family_members || [],
        },
      },

      // Characters fetched by direct ID from location records
      resident_characters_by_id: residentCharacters.map(c => ({
        id: c.id,
        name: c.name,
        _not_found: c._not_found || false,
        current_home_location_id: c.current_home_location_id,
        resolved_current_location_id: c.resolved_current_location_id,
        resolved_source_reason: c.resolved_source_reason,
      })),

      // Characters from list queries
      list_query_total: allFromList.length,
      service_role_list_count: queries[0].length,
      user_scoped_list_count: queries[1].length,

      // Key findings from list
      pointing_to_personal_home: { count: pointingToPersonal.length, characters: pointingToPersonal.map(fmt) },
      resolved_at_personal_home: { count: resolvedAtPersonal.length, characters: resolvedAtPersonal.map(fmt) },
      pointing_to_family_home: { count: pointingToFamily.length, characters: pointingToFamily.map(fmt) },
      resolved_at_family_home: { count: resolvedAtFamily.length, characters: resolvedAtFamily.map(fmt) },
      corrupted_flag_chars: { count: withCorruptedFlag.length, characters: withCorruptedFlag.map(fmt) },
      family_named_chars: { count: familyNamedChars.length, characters: familyNamedChars.map(fmt) },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});