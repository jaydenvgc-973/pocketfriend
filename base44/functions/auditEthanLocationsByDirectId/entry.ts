import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditEthanLocationsByDirectId
 *
 * Reads the two Ethan locations directly by their known IDs,
 * then looks up each listed resident character directly.
 * Also reads the Ethan character by his known ID.
 *
 * NO WRITES. PURE DIAGNOSTIC.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105'; // Ethan Thompson's Home
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb'; // Ethan's Family Home
    const ETHAN_CHAR_ID    = '69c0d59d7e382cc866ded9c9'; // Known from location's resident_character_ids

    // Read both locations directly
    const [personalHomeArr, familyHomeArr, ethanCharArr] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ id: PERSONAL_HOME_ID }),
      base44.asServiceRole.entities.LocationReference.filter({ id: FAMILY_HOME_ID }),
      base44.asServiceRole.entities.Character.filter({ id: ETHAN_CHAR_ID }),
    ]);

    const personalHome = personalHomeArr[0] || null;
    const familyHome   = familyHomeArr[0] || null;
    const ethanChar    = ethanCharArr[0] || null;

    // Collect ALL character IDs mentioned in either location
    const allMentionedCharIds = new Set();
    [
      ...(personalHome?.resident_character_ids || []),
      ...(personalHome?.residents || []).map(r => r.character_id),
      ...(familyHome?.resident_character_ids || []),
      ...(familyHome?.residents || []).map(r => r.character_id),
    ].filter(Boolean).forEach(id => allMentionedCharIds.add(id));

    // Look up each mentioned character
    const mentionedCharDetails = await Promise.all(
      [...allMentionedCharIds].map(id =>
        base44.asServiceRole.entities.Character.filter({ id })
          .then(arr => arr[0] || { id, name: 'NOT FOUND', status: 'missing' })
      )
    );

    // Now search for the target-named characters by name scan
    // Use the user's email to scope the search
    const targetNames = ['Sarah', 'Larry', 'Linda', 'Thomas', 'Stephanie', 'Vanessa', 'Marisol'];

    // Try to get them via created_by since service role .filter({}) seems scoped
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.asServiceRole.entities.Character.filter(
        { created_by: user.email, status: 'active' }
      ).catch(() => []),
      base44.asServiceRole.entities.Character.filter(
        { owner_email: user.email, status: 'active' }
      ).catch(() => []),
    ]);

    const allFound = [...byCreatedBy];
    const seen = new Set(byCreatedBy.map(c => c.id));
    for (const c of byOwnerEmail) {
      if (!seen.has(c.id)) { allFound.push(c); seen.add(c.id); }
    }

    const targetChars = allFound.filter(c =>
      targetNames.some(n => c.name?.toLowerCase().includes(n.toLowerCase()))
    );

    // Characters whose home points to personal home
    const homeToPersonal = allFound.filter(c =>
      c.current_home_location_id === PERSONAL_HOME_ID ||
      c.home_location_id === PERSONAL_HOME_ID
    );

    // Characters resolved AT personal home
    const resolvedAtPersonal = allFound.filter(c =>
      c.resolved_current_location_id === PERSONAL_HOME_ID
    );

    // Characters whose home points to family home
    const homeToFamily = allFound.filter(c =>
      c.current_home_location_id === FAMILY_HOME_ID ||
      c.home_location_id === FAMILY_HOME_ID
    );

    const fmt = (c) => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      status: c.status,
      current_home_location_id: c.current_home_location_id,
      home_location_id: c.home_location_id,
      resolved_current_location_id: c.resolved_current_location_id,
      resolved_current_location_name: c.resolved_current_location_name,
      resolved_presence_status: c.resolved_presence_status,
      resolved_source_reason: c.resolved_source_reason,
      owner_email: c.owner_email,
    });

    return Response.json({
      user: user.email,
      total_chars_found: allFound.length,
      query_breakdown: {
        by_created_by: byCreatedBy.length,
        by_owner_email: byOwnerEmail.length,
        combined_deduped: allFound.length,
      },

      ethan_character: ethanChar ? {
        id: ethanChar.id,
        name: ethanChar.name,
        current_home_location_id: ethanChar.current_home_location_id,
        home_location_id: ethanChar.home_location_id,
        resolved_current_location_id: ethanChar.resolved_current_location_id,
        resolved_source_reason: ethanChar.resolved_source_reason,
        owner_email: ethanChar.owner_email,
        created_by: ethanChar.created_by,
      } : 'NOT FOUND',

      personal_home_location: personalHome ? {
        id: personalHome.id,
        name: personalHome.name,
        resident_character_ids: personalHome.resident_character_ids || [],
        residents_array: personalHome.residents || [],
        resident_family_members: personalHome.resident_family_members || [],
      } : 'NOT FOUND',

      family_home_location: familyHome ? {
        id: familyHome.id,
        name: familyHome.name,
        resident_character_ids: familyHome.resident_character_ids || [],
        residents_array: familyHome.residents || [],
        resident_family_members: familyHome.resident_family_members || [],
      } : 'NOT FOUND',

      characters_in_location_records: mentionedCharDetails.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        current_home_location_id: c.current_home_location_id,
        resolved_current_location_id: c.resolved_current_location_id,
        resolved_source_reason: c.resolved_source_reason,
      })),

      // Key findings
      home_field_points_to_PERSONAL_home: {
        count: homeToPersonal.length,
        characters: homeToPersonal.map(fmt),
      },
      resolved_AT_PERSONAL_home: {
        count: resolvedAtPersonal.length,
        characters: resolvedAtPersonal.map(fmt),
      },
      home_field_points_to_FAMILY_home: {
        count: homeToFamily.length,
        characters: homeToFamily.map(fmt),
      },
      target_named_chars_found: {
        count: targetChars.length,
        characters: targetChars.map(fmt),
      },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});