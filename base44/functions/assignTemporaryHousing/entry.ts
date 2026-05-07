import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { character_id, owner_email } = body;

    if (!character_id || !owner_email) {
      return Response.json({ success: false, reason: 'missing_input' }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 1: LOAD DATA
    // ─────────────────────────────────────────────────────────────

    const character = await base44.entities.Character.filter({ id: character_id }).then(r => r[0]);
    if (!character || character.owner_email !== owner_email) {
      return Response.json({ success: false, reason: 'character_not_found' }, { status: 404 });
    }

    const financials = await base44.entities.CharacterFinancial.filter({ character_id });
    const financial = financials[0];
    if (!financial) {
      return Response.json({ success: false, reason: 'financial_record_not_found' }, { status: 404 });
    }

    // Load all locations for owner (for housing resolver)
    const locations = await base44.entities.LocationReference.filter({ owner_email });
    const locationMap = {};
    locations.forEach(loc => {
      locationMap[loc.id] = loc;
    });

    // ─────────────────────────────────────────────────────────────
    // STEP 2: RESOLVE HOUSING (READ-ONLY) — INLINED FROM RESOLVER
    // ─────────────────────────────────────────────────────────────

    // Check SCENARIO 1: Valid permanent home ID
    const homeId = character.current_home_location_id || character.home_location_id;
    let housing_location_id = null;
    let home_resolution_failed = false;
    let may_assign_temporary_housing = false;

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
      // Check SCENARIO 3: Last-known home
      const lastLocationId = character.resolved_current_location_id;
      const lastLocationType = character.resolved_location_type;
      if (lastLocationId && lastLocationType === 'home' && locationMap[lastLocationId]) {
        housing_location_id = lastLocationId;
      } else {
        // Check SCENARIO 4: Resident scan for home associations
        const homeLocs = Object.values(locationMap).filter(
          loc => (loc.category === 'home' || loc.category === 'generic') &&
                 ((loc.resident_character_ids || []).includes(character.id) ||
                  (loc.residents || []).some(r => r.character_id === character.id))
        );

        if (homeLocs.length > 0) {
          // SCENARIO 4: Found home via resident scan
          housing_location_id = homeLocs[0].id;
        } else {
          // SCENARIOS 5-7: True null home — eligible for temporary housing assignment.
          // This function must only be invoked explicitly (user-initiated or narrative-triggered).
          // It is NOT auto-invoked for every character without a home — that is a valid state.
          may_assign_temporary_housing = true;
        }
      }
    }

    // Compute runtime placement (Phase 3B logic)
    const balance = financial.current_balance ?? 0;
    const hotelLocation = Object.values(locationMap).find(
      loc => loc.owner_email === owner_email &&
             loc.is_system_managed === true &&
             loc.system_location_role === 'temporary_hotel'
    );
    const shelterLocation = Object.values(locationMap).find(
      loc => loc.owner_email === owner_email &&
             loc.is_system_managed === true &&
             loc.system_location_role === 'emergency_shelter'
    );

    // ─────────────────────────────────────────────────────────────
    // STEP 3: HARD BLOCK CONDITIONS
    // ─────────────────────────────────────────────────────────────

    if (housing_location_id !== null) {
      return Response.json({ skipped: true, reason: 'already_has_home' }, { status: 200 });
    }

    if (home_resolution_failed === true) {
      return Response.json({ skipped: true, reason: 'home_lookup_failed' }, { status: 200 });
    }

    if (character.is_temporarily_housed === true && character.temporary_housing_location_id) {
      return Response.json({ skipped: true, reason: 'already_assigned_temporary' }, { status: 200 });
    }

    if (may_assign_temporary_housing !== true) {
      return Response.json({ skipped: true, reason: 'not_eligible_for_temporary' }, { status: 200 });
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 4: DETERMINE TYPE (MATCH PHASE 3B EXACTLY)
    // ─────────────────────────────────────────────────────────────

    let type = null;
    if (balance >= 150 && hotelLocation) {
      type = 'hotel';
    } else if (shelterLocation) {
      type = 'shelter';
    } else {
      return Response.json({ success: false, reason: 'no_temp_locations_available' }, { status: 200 });
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 5: USE EXISTING LOCATION (ALREADY SELECTED IN STEP 2)
    // ─────────────────────────────────────────────────────────────

    const tempLocation = type === 'hotel' ? hotelLocation : shelterLocation;

    if (!tempLocation?.id) {
      return Response.json({ success: false, reason: 'temp_location_not_found' }, { status: 500 });
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 6: WRITE CHARACTER (MINIMAL)
    // ─────────────────────────────────────────────────────────────

    const now = new Date().toISOString();
    await base44.entities.Character.update(character_id, {
      is_temporarily_housed: true,
      temporary_housing_location_id: tempLocation.id,
      temporary_housing_type: type,
      temporary_housing_started_at: now,
    });

    // ─────────────────────────────────────────────────────────────
    // STEP 7: FINANCIAL LOGIC
    // ─────────────────────────────────────────────────────────────

    let charged = false;

    if (type === 'hotel') {
      // 7A: Check for recent charge (prevent double-charge)
      const recentCharges = await base44.entities.FinancialTransaction.filter({
        character_id,
        reason_code: 'temp_housing_hotel',
      });
      
      const hasRecentCharge = recentCharges.some(tx => {
        if (!tx.timestamp) return false;
        return new Date(tx.timestamp).getTime() >= Date.now() - 86400000;
      });

      if (!hasRecentCharge) {
        // 7B: Apply charge
        await base44.entities.CharacterFinancial.update(financial.id, {
          current_balance: (financial.current_balance || 0) - 150,
          total_expenses: (financial.total_expenses || 0) + 150,
        });

        // 7C: Log transaction
        await base44.entities.FinancialTransaction.create({
          character_id,
          owner_email,
          amount: 150,
          direction: 'expense',
          reason_code: 'temp_housing_hotel',
          description: 'Emergency temporary hotel stay',
        });

        charged = true;
      }
    } else {
      // Shelter case: log free stay
      await base44.entities.FinancialTransaction.create({
        character_id,
        owner_email,
        amount: 0,
        direction: 'expense',
        reason_code: 'temp_housing_shelter',
        description: 'Emergency shelter stay (free)',
      });
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 8: RETURN
    // ─────────────────────────────────────────────────────────────

    return Response.json({
      success: true,
      type,
      location_id: tempLocation.id,
      location_name: tempLocation.name,
      charged,
    });

  } catch (error) {
    console.error('[assignTemporaryHousing] Error:', error.message);
    return Response.json({ success: false, reason: 'failed_assignment' }, { status: 500 });
  }
});