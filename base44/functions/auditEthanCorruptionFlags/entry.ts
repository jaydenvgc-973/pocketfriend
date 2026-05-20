import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditEthanCorruptionFlags
 * Gets characters with fixed_corrupted_home_id or Ethan-related source reasons
 * Also gets characters whose home points to either Ethan location
 * NO WRITES.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105'; // Ethan Thompson's Home
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb'; // Ethan's Family Home

    const allCharacters = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email, status: 'active' }
    );

    const fmt = (c) => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      current_home_location_id: c.current_home_location_id,
      home_location_id: c.home_location_id,
      resolved_current_location_id: c.resolved_current_location_id,
      resolved_current_location_name: c.resolved_current_location_name,
      resolved_presence_status: c.resolved_presence_status,
      resolved_source_reason: c.resolved_source_reason,
    });

    // Characters with the specific corruption flag
    const corrupted = allCharacters.filter(c =>
      c.resolved_source_reason === 'fixed_corrupted_home_id'
    );

    // Characters pointing to personal home
    const homeIsPersonal = allCharacters.filter(c =>
      c.current_home_location_id === PERSONAL_HOME_ID ||
      c.home_location_id === PERSONAL_HOME_ID
    );

    // Characters resolved AT personal home
    const resolvedAtPersonal = allCharacters.filter(c =>
      c.resolved_current_location_id === PERSONAL_HOME_ID
    );

    // Characters pointing to family home
    const homeIsFamily = allCharacters.filter(c =>
      c.current_home_location_id === FAMILY_HOME_ID ||
      c.home_location_id === FAMILY_HOME_ID
    );

    // Characters resolved AT family home
    const resolvedAtFamily = allCharacters.filter(c =>
      c.resolved_current_location_id === FAMILY_HOME_ID
    );

    // Characters with any ethan/corrupted reason
    const ethanRelated = allCharacters.filter(c =>
      c.resolved_source_reason?.toLowerCase().includes('ethan') ||
      c.resolved_source_reason?.toLowerCase().includes('corrupted_home') ||
      c.resolved_source_reason?.toLowerCase().includes('fixed_corrupted')
    );

    // Specifically look for Sarah, Larry, Linda, Thomas, Stephanie, Vanessa, Marisol
    const targetNames = ['sarah', 'larry', 'linda', 'thomas', 'stephanie', 'vanessa', 'marisol'];
    const targetChars = allCharacters.filter(c =>
      targetNames.some(n => c.name?.toLowerCase().includes(n))
    );

    return Response.json({
      ids: {
        personal_home: PERSONAL_HOME_ID,
        family_home: FAMILY_HOME_ID,
      },
      corrupted_home_id_flag: {
        count: corrupted.length,
        characters: corrupted.map(fmt),
      },
      home_field_points_to_personal_home: {
        count: homeIsPersonal.length,
        characters: homeIsPersonal.map(fmt),
      },
      resolved_AT_personal_home: {
        count: resolvedAtPersonal.length,
        characters: resolvedAtPersonal.map(fmt),
      },
      home_field_points_to_family_home: {
        count: homeIsFamily.length,
        characters: homeIsFamily.map(fmt),
      },
      resolved_AT_family_home: {
        count: resolvedAtFamily.length,
        characters: resolvedAtFamily.map(fmt),
      },
      ethan_related_source_reason: {
        count: ethanRelated.length,
        characters: ethanRelated.map(fmt),
      },
      target_named_characters: {
        count: targetChars.length,
        characters: targetChars.map(fmt),
      },
      total_checked: allCharacters.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});