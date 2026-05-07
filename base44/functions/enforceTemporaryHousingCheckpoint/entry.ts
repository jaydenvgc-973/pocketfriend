import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const owner_email = user.email;

    // ─────────────────────────────────────────────────────────────
    // STEP 1: LOAD DATA
    // ─────────────────────────────────────────────────────────────

    const characters = await base44.entities.Character.filter({
      owner_email,
      character_type: 'active_created_character',
    });

    const locations = await base44.entities.LocationReference.filter({
      owner_email,
    });

    const locationMap = {};
    locations.forEach(loc => {
      locationMap[loc.id] = loc;
    });

    // ─────────────────────────────────────────────────────────────
    // STEP 2: EVALUATE ELIGIBILITY FOR EACH CHARACTER
    // ─────────────────────────────────────────────────────────────

    const report = {
      checked: 0,
      eligible: 0,
      assigned: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    for (const character of characters) {
      report.checked++;

      // ─────────────────────────────────────────────────────────────
      // INLINE HOUSING RESOLVER LOGIC (PHASE 3B)
      // ─────────────────────────────────────────────────────────────

      let housing_location_id = null;
      let home_resolution_failed = false;
      let may_assign_temporary_housing = false;

      // SCENARIO 1-2: Check permanent home ID
      const homeId = character.current_home_location_id || character.home_location_id;
      if (homeId) {
        const homeLocation = locationMap[homeId];
        if (homeLocation) {
          // SCENARIO 1: Valid permanent home found
          housing_location_id = homeId;
        } else {
          // SCENARIO 2: Home ID exists but lookup failed
          home_resolution_failed = true;
          housing_location_id = null;
        }
      } else {
        // SCENARIO 3: Last-known home
        const lastLocationId = character.resolved_current_location_id;
        const lastLocationType = character.resolved_location_type;
        if (lastLocationId && lastLocationType === 'home' && locationMap[lastLocationId]) {
          housing_location_id = lastLocationId;
        } else {
          // SCENARIO 4: Resident scan for home associations
          const homeLocs = Object.values(locationMap).filter(
            loc => (loc.category === 'home' || loc.category === 'generic') &&
                   ((loc.resident_character_ids || []).includes(character.id) ||
                    (loc.residents || []).some(r => r.character_id === character.id))
          );

          if (homeLocs.length > 0) {
            // SCENARIO 4: Found home via resident scan
            housing_location_id = homeLocs[0].id;
          } else {
            // SCENARIOS 5-7: True null home — eligible for temporary housing
            may_assign_temporary_housing = true;
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // STEP 3: DESIGN RULE — no mandatory housing enforcement
      // A character with no mapped home is a VALID state.
      // This function now only REPORTS housing status; it does NOT
      // auto-assign temporary housing to characters without a home.
      // Housing assignment must be user-initiated or explicitly configured.
      // ─────────────────────────────────────────────────────────────

      if (may_assign_temporary_housing) {
        // Valid: character has no mapped home. This is intentional and supported.
        // Log for observability but do NOT auto-assign or treat as error.
        report.skipped++;
        report.details.push({
          character_id: character.id,
          character_name: character.name,
          reason: 'no_mapped_home_valid_state',
          note: 'Character may have rabbit hole, implied, or transitional housing. No action taken.',
          housing_location_id: null,
        });
        continue;
      }

      report.eligible++;
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 5: RETURN REPORT
    // ─────────────────────────────────────────────────────────────

    return Response.json({
      success: true,
      owner_email,
      report,
    });

  } catch (error) {
    console.error('[enforceTemporaryHousingCheckpoint] Error:', error.message);
    return Response.json({ success: false, reason: 'checkpoint_failed', error: error.message }, { status: 500 });
  }
});