import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditEthanLocationsExact
 *
 * Diagnostic-only: Shows the exact current state of:
 * 1. "Ethan Thompson's Home" - who is listed as residents
 * 2. "Ethan's Family Home" - who is listed as residents
 * 3. Characters whose current_home_location_id or resolved_current_location_id
 *    points to either of these locations
 * 4. Characters with resolved_source_reason = 'fixed_corrupted_home_id'
 *
 * NO WRITES. PURE DIAGNOSTIC.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch ALL locations owned by this user (service role to avoid RLS gaps)
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: user.email }
    );

    // Find the two Ethan locations by name
    const ethanPersonalHome = allLocations.find(l =>
      l.name?.trim() === "Ethan Thompson's Home"
    );
    const ethanFamilyHome = allLocations.find(l =>
      l.name?.trim() === "Ethan's Family Home"
    );

    // Also check shared locations
    const sharedLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { scope: 'shared' }
    );
    const ethanPersonalHomeShared = !ethanPersonalHome
      ? sharedLocations.find(l => l.name?.trim() === "Ethan Thompson's Home")
      : null;
    const ethanFamilyHomeShared = !ethanFamilyHome
      ? sharedLocations.find(l => l.name?.trim() === "Ethan's Family Home")
      : null;

    const resolvedEthanPersonal = ethanPersonalHome || ethanPersonalHomeShared || null;
    const resolvedEthanFamily = ethanFamilyHome || ethanFamilyHomeShared || null;

    // Fetch ALL characters for this user
    const allCharacters = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email, status: 'active' }
    );

    // ── ANALYSIS ──────────────────────────────────────────────────────────────

    const personalHomeId = resolvedEthanPersonal?.id || null;
    const familyHomeId = resolvedEthanFamily?.id || null;

    // Who is listed IN the LocationReference resident arrays
    const personalHomeResidentIds = new Set([
      ...(resolvedEthanPersonal?.resident_character_ids || []),
      ...(resolvedEthanPersonal?.residents || []).map(r => r.character_id),
    ]);
    const familyHomeResidentIds = new Set([
      ...(resolvedEthanFamily?.resident_character_ids || []),
      ...(resolvedEthanFamily?.residents || []).map(r => r.character_id),
    ]);

    // Map character IDs to names for display
    const charMap = Object.fromEntries(allCharacters.map(c => [c.id, c]));

    // Characters whose home field points to Ethan Personal Home
    const pointingToPersonalHome = allCharacters.filter(c =>
      c.current_home_location_id === personalHomeId ||
      c.home_location_id === personalHomeId
    );

    // Characters whose RESOLVED location points to Ethan Personal Home
    const resolvedAtPersonalHome = allCharacters.filter(c =>
      c.resolved_current_location_id === personalHomeId
    );

    // Characters whose home field points to Ethan Family Home
    const pointingToFamilyHome = allCharacters.filter(c =>
      c.current_home_location_id === familyHomeId ||
      c.home_location_id === familyHomeId
    );

    // Characters with fixed_corrupted_home_id reason
    const corruptedHomeFlagChars = allCharacters.filter(c =>
      c.resolved_source_reason === 'fixed_corrupted_home_id'
    );

    // Characters with any Ethan-related resolved_source_reason
    const ethanRelatedReasonChars = allCharacters.filter(c =>
      c.resolved_source_reason?.includes('ethan') ||
      c.resolved_source_reason?.includes('Ethan') ||
      c.resolved_source_reason?.includes('corrupted_home') ||
      c.resolved_source_reason?.includes('fixed_corrupted')
    );

    const formatChar = (c) => ({
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

    return Response.json({
      diagnostic: 'ETHAN_LOCATIONS_EXACT_AUDIT',
      user: user.email,
      locations_found: {
        ethan_personal_home: resolvedEthanPersonal
          ? { id: resolvedEthanPersonal.id, name: resolvedEthanPersonal.name, scope: resolvedEthanPersonal.scope }
          : 'NOT FOUND',
        ethan_family_home: resolvedEthanFamily
          ? { id: resolvedEthanFamily.id, name: resolvedEthanFamily.name, scope: resolvedEthanFamily.scope }
          : 'NOT FOUND',
      },

      // What the LocationReference records themselves say
      location_resident_lists: {
        ethan_personal_home_residents_in_location_record: {
          resident_character_ids: resolvedEthanPersonal?.resident_character_ids || [],
          residents_array: (resolvedEthanPersonal?.residents || []).map(r => ({
            character_id: r.character_id,
            character_name: r.character_name || charMap[r.character_id]?.name || 'Unknown',
          })),
          resident_family_members: resolvedEthanPersonal?.resident_family_members || [],
        },
        ethan_family_home_residents_in_location_record: {
          resident_character_ids: resolvedEthanFamily?.resident_character_ids || [],
          residents_array: (resolvedEthanFamily?.residents || []).map(r => ({
            character_id: r.character_id,
            character_name: r.character_name || charMap[r.character_id]?.name || 'Unknown',
          })),
          resident_family_members: resolvedEthanFamily?.resident_family_members || [],
        },
      },

      // What characters say their home is
      characters_claiming_personal_home_as_home: {
        count: pointingToPersonalHome.length,
        characters: pointingToPersonalHome.map(formatChar),
      },
      characters_resolved_AT_personal_home: {
        count: resolvedAtPersonalHome.length,
        characters: resolvedAtPersonalHome.map(formatChar),
      },
      characters_claiming_family_home_as_home: {
        count: pointingToFamilyHome.length,
        characters: pointingToFamilyHome.map(formatChar),
      },

      // Corruption flags
      characters_with_fixed_corrupted_home_id_reason: {
        count: corruptedHomeFlagChars.length,
        characters: corruptedHomeFlagChars.map(formatChar),
      },
      characters_with_ethan_related_source_reason: {
        count: ethanRelatedReasonChars.length,
        characters: ethanRelatedReasonChars.map(formatChar),
      },

      total_characters_checked: allCharacters.length,
      total_locations_checked: allLocations.length + sharedLocations.length,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});