import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * VALIDATION ONLY — NO REPAIRS, NO DATA CHANGES
 * 
 * Check if VGC Towers and two character records are account-scoped correctly.
 * Return current scope values without modification.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ─────────────────────────────────────────────────────────────────
    // VALIDATE VGC TOWERS SCOPE
    // ─────────────────────────────────────────────────────────────────

    const vgcLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { name: 'VGC Towers' },
      null,
      500
    ).catch(() => []);

    const vgcValidation = {
      name: 'VGC Towers',
      found_count: vgcLocations.length,
      records: vgcLocations.map(loc => ({
        id: loc.id,
        scope: loc.scope,
        location_type: loc.location_type,
        owner_email: loc.owner_email || null,
        owner_character_id: loc.owner_character_id || null,
        is_rabbit_hole: loc.is_rabbit_hole || false,
        is_generic_shared: loc.is_generic_shared || false,
      })),
      expected_scope: 'character_specific or account_global (not "shared")',
      account_scoped_correctly: vgcLocations.length > 0 ? vgcLocations.every(loc => 
        loc.scope === 'character_specific' || loc.scope === 'account_global'
      ) : null,
    };

    // ─────────────────────────────────────────────────────────────────
    // VALIDATE TWO CHARACTER RECORDS (ADOBEVGC CREATED CHARACTERS)
    // ─────────────────────────────────────────────────────────────────
    
    const twoCharacters = [
      'Jayden Jackson',
      'Alden Spencer'
    ];

    const characterValidation = [];

    for (const name of twoCharacters) {
      const chars = await base44.asServiceRole.entities.Character.filter(
        { name },
        null,
        100
      ).catch(() => []);

      if (chars.length === 0) {
        characterValidation.push({
          name,
          found: false,
          records: []
        });
      } else {
        characterValidation.push({
          name,
          found: true,
          records: chars.map(c => ({
            id: c.id,
            owner_email: c.owner_email || null,
            owner_user_id: c.owner_user_id || null,
            created_by: c.created_by || null,
            data_scope: c.data_scope || null,
            visibility_scope: c.visibility_scope || null,
            character_type: c.character_type,
            is_active_character: c.is_active_character,
          }))
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // RETURN VALIDATION ONLY
    // ─────────────────────────────────────────────────────────────────

    return Response.json({
      task: 'VALIDATE_ACCOUNT_SCOPING_ONLY',
      timestamp: new Date().toISOString(),
      current_user: user.email,
      
      vgc_towers_validation: vgcValidation,
      
      character_validation: {
        total_expected: 2,
        records: characterValidation,
        all_found: characterValidation.every(c => c.found),
      },

      account_scope_status: {
        vgc_towers_correct: vgcValidation.account_scoped_correctly,
        characters_found: characterValidation.every(c => c.found),
        characters_ownership_fields_present: characterValidation.every(c => 
          c.found && c.records.length > 0 && (c.records[0].owner_email || c.records[0].owner_user_id)
        ),
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});