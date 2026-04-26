import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = user.email;
    const TRUNCATION_LIMIT = 500;

    // Expected characters for this diagnostic
    const EXPECTED_CHARACTERS = [
      'Andre Rivera',
      'Ava Dei Park',
      'Brian Anderson',
      'Ethan Thompson',
      'James Anderson',
      'Jonathan Anthony Smith',
      'Lila Green',
      'Matt Lopez',
      'Melody Jackson Perry',
      'Nathan Parker'
    ];

    // --- 1. Fetch ALL owner_email-scoped characters ONLY ---
    const allUserCharactersRaw = await base44.asServiceRole.entities.Character.filter(
      { owner_email: userEmail },
      null,
      TRUNCATION_LIMIT
    );

    if (allUserCharactersRaw.length === TRUNCATION_LIMIT) {
      return Response.json({
        success: false,
        TRUNCATION_RISK: true,
        message: 'Character fetch hit limit. Diagnostic cannot be considered complete.'
      }, { status: 200 });
    }

    // --- 2. Filter characters in JavaScript ---
    const activeCreatedCharacters = allUserCharactersRaw.filter(char =>
      char.character_type === "active_created_character" &&
      char.is_test_character !== true &&
      char.diagnostic_only !== true &&
      char.exclude_from_homepage !== true
    );

    // --- 3. VALIDATION: Check for required characters ---
    const returnedCharacterNames = activeCreatedCharacters.map(c => c.name);
    const missingCharacters = EXPECTED_CHARACTERS.filter(
      expected => !returnedCharacterNames.includes(expected)
    );

    if (missingCharacters.length > 0) {
      return Response.json({
        success: false,
        OWNER_EMAIL_SCOPE_FAILURE: true,
        total_characters_returned: activeCreatedCharacters.length,
        returned_character_names: returnedCharacterNames,
        expected_character_names: EXPECTED_CHARACTERS,
        missing_characters: missingCharacters,
        message: `owner_email scope failed to return all expected characters. Data integrity issue.`
      }, { status: 200 });
    }

    // --- 4. Fetch ALL owner_email-scoped LocationReference records ---
    const ownedLocationsRaw = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: userEmail },
      null,
      TRUNCATION_LIMIT
    );

    if (ownedLocationsRaw.length === TRUNCATION_LIMIT) {
      return Response.json({
        success: false,
        TRUNCATION_RISK: true,
        message: 'LocationReference fetch hit limit. Diagnostic cannot be considered complete.'
      }, { status: 200 });
    }

    const locationMap = new Map();
    ownedLocationsRaw.forEach(loc => {
      locationMap.set(loc.id, loc);
    });

    // --- 5. Prepare diagnostic report for each character ---
    const diagnosticReport = [];

    for (const character of activeCreatedCharacters) {
      const charId = character.id;

      // --- Character Home Fields ---
      const currentHomeLocationId = character.current_home_location_id || null;
      const currentHomeLocationNameIfFound = currentHomeLocationId ? locationMap.get(currentHomeLocationId)?.name || null : null;

      const homeLocationId = character.home_location_id || null;
      const homeLocationNameIfFound = homeLocationId ? locationMap.get(homeLocationId)?.name || null : null;

      const hasCurrentHomeId = !!currentHomeLocationId;
      const hasHomeId = !!homeLocationId;

      // --- Character Resolved Location Fields ---
      const resolvedCurrentLocationId = character.resolved_current_location_id || null;
      const resolvedCurrentLocationName = resolvedCurrentLocationId ? locationMap.get(resolvedCurrentLocationId)?.name || null : null;
      const resolvedLocationFoundInLocations = !!resolvedCurrentLocationId && locationMap.has(resolvedCurrentLocationId);
      const hasResolvedLocationId = !!resolvedCurrentLocationId;

      // --- Scan LocationReference for Residency ---
      const locationRefHomeIdsFound = [];
      const locationRefHomeNamesFound = [];
      let characterIdFoundInResidentCharacterIds = false;
      let characterIdFoundInResidentsArray = false;

      for (const loc of locationMap.values()) {
        const isHomeCategory = loc.category === 'home' || loc.category === 'generic';

        // Check legacy resident_character_ids
        if (loc.resident_character_ids?.includes(charId)) {
          characterIdFoundInResidentCharacterIds = true;
          if (isHomeCategory) {
            locationRefHomeIdsFound.push(loc.id);
            locationRefHomeNamesFound.push(loc.name);
          }
        }

        // Check new residents array
        if (loc.residents?.some(r => r.character_id === charId)) {
          characterIdFoundInResidentsArray = true;
          if (isHomeCategory && !locationRefHomeIdsFound.includes(loc.id)) {
            locationRefHomeIdsFound.push(loc.id);
            locationRefHomeNamesFound.push(loc.name);
          }
        }
      }

      const uniqueLocationRefHomeIds = [...new Set(locationRefHomeIdsFound)];
      const uniqueLocationRefHomeNames = [...new Set(locationRefHomeNamesFound)];
      const hasLocationRefHomes = uniqueLocationRefHomeIds.length > 0;

      // --- Determine Conflict Codes ---
      const conflictCodes = [];
      let homeSourcesAgree = false;

      // Check current_home_location_id vs LocationReference residency
      if (hasCurrentHomeId && uniqueLocationRefHomeIds.includes(currentHomeLocationId)) {
        // current_home_location_id matches one of the LocationRef homes
      } else if (hasCurrentHomeId && !uniqueLocationRefHomeIds.includes(currentHomeLocationId)) {
        if (hasLocationRefHomes) {
          conflictCodes.push('CHARACTER_CURRENT_HOME_AND_LOCATION_REF_CONFLICT');
        } else {
          conflictCodes.push('CHARACTER_CURRENT_HOME_SET_LOCATION_REF_MISSING');
        }
      } else if (!hasCurrentHomeId && hasLocationRefHomes) {
        conflictCodes.push('CHARACTER_CURRENT_HOME_MISSING_LOCATION_REF_FOUND');
      }

      // Check home_location_id vs LocationReference residency (if current_home_location_id is null)
      if (!hasCurrentHomeId) {
        if (hasHomeId && uniqueLocationRefHomeIds.includes(homeLocationId)) {
          // home_location_id matches one of the LocationRef homes
        } else if (hasHomeId && !uniqueLocationRefHomeIds.includes(homeLocationId)) {
          if (hasLocationRefHomes) {
            conflictCodes.push('CHARACTER_LEGACY_HOME_AND_LOCATION_REF_CONFLICT');
          } else {
            conflictCodes.push('CHARACTER_LEGACY_HOME_SET_LOCATION_REF_MISSING');
          }
        } else if (!hasHomeId && hasLocationRefHomes && !hasCurrentHomeId) {
          conflictCodes.push('CHARACTER_LEGACY_HOME_MISSING_LOCATION_REF_FOUND');
        }
      }

      if (!hasCurrentHomeId && !hasHomeId && !hasLocationRefHomes) {
        conflictCodes.push('NO_HOME_FOUND');
      } else if (hasCurrentHomeId && !locationMap.has(currentHomeLocationId)) {
        conflictCodes.push('CHARACTER_CURRENT_HOME_POINTS_TO_NON_EXISTENT_LOCATION');
      } else if (hasHomeId && !locationMap.has(homeLocationId)) {
        conflictCodes.push('CHARACTER_LEGACY_HOME_POINTS_TO_NON_EXISTENT_LOCATION');
      }

      // Check agreement between home sources
      if (hasCurrentHomeId && hasLocationRefHomes && uniqueLocationRefHomeIds.includes(currentHomeLocationId)) {
        homeSourcesAgree = true;
      } else if (!hasCurrentHomeId && hasHomeId && hasLocationRefHomes && uniqueLocationRefHomeIds.includes(homeLocationId)) {
        homeSourcesAgree = true;
      } else {
        homeSourcesAgree = false;
      }

      // --- Comparisons with Resolved Location ---
      const resolvedMatchesCurrentHomeId = hasResolvedLocationId && hasCurrentHomeId && (resolvedCurrentLocationId === currentHomeLocationId);
      const resolvedMatchesHomeId = hasResolvedLocationId && hasHomeId && (resolvedCurrentLocationId === homeLocationId);
      const resolvedMatchesAnyLocationRefHome = hasResolvedLocationId && uniqueLocationRefHomeIds.includes(resolvedCurrentLocationId);

      if (!hasResolvedLocationId) {
        conflictCodes.push('RESOLVED_LOCATION_MISSING');
      } else if (!resolvedLocationFoundInLocations) {
        conflictCodes.push('RESOLVED_LOCATION_POINTS_TO_NON_EXISTENT');
      } else if (!resolvedMatchesCurrentHomeId && !resolvedMatchesHomeId && !resolvedMatchesAnyLocationRefHome) {
        conflictCodes.push('RESOLVED_LOCATION_DIFFERS_FROM_ALL_HOME_SOURCES');
      }

      if (conflictCodes.length === 0) {
        conflictCodes.push('NO_DATA_CONFLICT_DETECTED');
      }

      diagnosticReport.push({
        character_name: character.name,
        character_id: charId,
        owner_email: character.owner_email,
        character_type: character.character_type,

        current_home_location_id: currentHomeLocationId,
        current_home_location_name_if_found: currentHomeLocationNameIfFound,

        home_location_id: homeLocationId,
        home_location_name_if_found: homeLocationNameIfFound,

        resolved_current_location_id: resolvedCurrentLocationId,
        resolved_current_location_name: resolvedCurrentLocationName,
        resolved_presence_status: character.resolved_presence_status || null,

        resolved_location_found_in_locations: resolvedLocationFoundInLocations,

        location_ref_home_ids_found: uniqueLocationRefHomeIds,
        location_ref_home_names_found: uniqueLocationRefHomeNames,

        character_id_found_in_resident_character_ids: characterIdFoundInResidentCharacterIds,
        character_id_found_in_residents_array: characterIdFoundInResidentsArray,

        home_sources_agree: homeSourcesAgree,

        resolved_matches_current_home_location_id: resolvedMatchesCurrentHomeId,
        resolved_matches_home_location_id: resolvedMatchesHomeId,
        resolved_matches_any_location_ref_home: resolvedMatchesAnyLocationRefHome,

        conflict_codes: conflictCodes,
        map_visibility_status: "needs UI verification",
      });
    }

    return Response.json({
      success: true,
      diagnostic_report: diagnosticReport,
      total_characters_found_by_filter: activeCreatedCharacters.length,
      total_characters_scanned_raw: allUserCharactersRaw.length,
      total_locations_scanned: ownedLocationsRaw.length,
      TRUNCATION_RISK: false,
    });

  } catch (error) {
    console.error(`[diagnosticCharacterHomeData] Error: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});