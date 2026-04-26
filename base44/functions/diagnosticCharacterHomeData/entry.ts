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

    // REQUIRED VALIDATION SET
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

    // ==================================================
    // STEP 1: FETCH CHARACTERS (STRICT OWNER_EMAIL ONLY)
    // ==================================================
    const allCharacters = await base44.asServiceRole.entities.Character.filter(
      { owner_email: userEmail },
      null,
      TRUNCATION_LIMIT
    );

    if (allCharacters.length === TRUNCATION_LIMIT) {
      return Response.json({
        success: false,
        TRUNCATION_RISK: true,
        message: 'Character fetch hit limit. Diagnostic invalid.'
      });
    }

    const activeCharacters = allCharacters.filter(c =>
      c.character_type === "active_created_character" &&
      c.is_test_character !== true &&
      c.diagnostic_only !== true &&
      c.exclude_from_homepage !== true
    );

    // ==================================================
    // STEP 2: VALIDATE EXPECTED CHARACTERS
    // ==================================================
    const returnedNames = activeCharacters.map(c => c.name);
    const missing = EXPECTED_CHARACTERS.filter(name => !returnedNames.includes(name));

    if (missing.length > 0) {
      return Response.json({
        success: false,
        OWNER_EMAIL_SCOPE_FAILURE: true,
        total_characters_returned: activeCharacters.length,
        returned_character_names: returnedNames,
        expected_character_names: EXPECTED_CHARACTERS,
        missing_characters: missing
      });
    }

    // ==================================================
    // STEP 3: FETCH LOCATIONS (OWNER_EMAIL ONLY)
    // ==================================================
    const locations = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: userEmail },
      null,
      TRUNCATION_LIMIT
    );

    if (locations.length === TRUNCATION_LIMIT) {
      return Response.json({
        success: false,
        TRUNCATION_RISK: true,
        message: 'Location fetch hit limit. Diagnostic invalid.'
      });
    }

    const locationMap = new Map();
    locations.forEach(loc => locationMap.set(loc.id, loc));

    // ==================================================
    // STEP 4: PURE FACT REPORT (NO INTERPRETATION)
    // ==================================================
    const report = activeCharacters.map(character => {
      const charId = character.id;

      const currentHomeId = character.current_home_location_id || null;
      const legacyHomeId = character.home_location_id || null;

      const resolvedId = character.resolved_current_location_id || null;
      const resolvedName = locationMap.get(resolvedId)?.name || null;

      const locationMatches = [];

      for (const loc of locationMap.values()) {
        const inLegacy = loc.resident_character_ids?.includes(charId);
        const inResidents = loc.residents?.some(r => r.character_id === charId);

        if (inLegacy || inResidents) {
          locationMatches.push({
            location_id: loc.id,
            location_name: loc.name,
            match_source: inResidents ? 'residents' : 'resident_character_ids'
          });
        }
      }

      return {
        character_name: character.name,
        character_id: charId,

        current_home_location_id: currentHomeId,
        home_location_id: legacyHomeId,

        resolved_current_location_id: resolvedId,
        resolved_current_location_name: resolvedName,
        resolved_presence_status: character.resolved_presence_status || null,

        location_reference_matches: locationMatches
      };
    });

    // ==================================================
    // FINAL OUTPUT
    // ==================================================
    return Response.json({
      success: true,
      total_characters: report.length,
      characters: report
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});