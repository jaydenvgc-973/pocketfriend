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
    // STEP 2: RESOLVE HOUSING (READ-ONLY)
    // ─────────────────────────────────────────────────────────────

    // Call housing resolver via backend function
    const housingRes = await base44.asServiceRole.functions.invoke('resolveHousingLocationForCharacter', {
      character,
      locationMap,
    });
    const housing = housingRes?.data || {};

    // Also compute runtime placement (Phase 3B logic)
    const balance = character.current_balance ?? 6000;
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

    if (housing.housing_location_id !== null) {
      return Response.json({ skipped: true, reason: 'already_has_home' }, { status: 200 });
    }
    if (housing.home_resolution_failed === true) {
      return Response.json({ skipped: true, reason: 'home_lookup_failed' }, { status: 200 });
    }
    if (character.current_home_location_id) {
      return Response.json({ skipped: true, reason: 'has_home_field' }, { status: 200 });
    }
    if (character.is_temporarily_housed === true) {
      return Response.json({ skipped: true, reason: 'already_assigned_temporary' }, { status: 200 });
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 4: DETERMINE TYPE
    // ─────────────────────────────────────────────────────────────

    let type, cost;
    if (balance >= 150) {
      type = 'hotel';
      cost = 150;
    } else {
      type = 'shelter';
      cost = 0;
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 5: GET LOCATION (SAFE — backend context allows creation)
    // ─────────────────────────────────────────────────────────────

    let tempLocation;
    if (type === 'hotel') {
      const hotelRes = await base44.asServiceRole.functions.invoke('getOrCreateTemporaryHotelLocation', {
        owner_email,
      });
      const hotelLocationId = hotelRes?.data?.location_id;
      tempLocation = locationMap[hotelLocationId] || { id: hotelLocationId, name: 'Temporary Hotel' };
    } else {
      const shelterRes = await base44.asServiceRole.functions.invoke('getOrCreateEmergencyShelterLocation', {
        owner_email,
      });
      const shelterLocationId = shelterRes?.data?.location_id;
      tempLocation = locationMap[shelterLocationId] || { id: shelterLocationId, name: 'Emergency Shelter' };
    }

    if (!tempLocation?.id) {
      return Response.json({ success: false, reason: 'location_not_available' }, { status: 500 });
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
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentCharges = await base44.entities.FinancialTransaction.filter({
        character_id,
        reason_code: 'temp_housing_hotel',
      });
      
      const hasRecentCharge = recentCharges.some(tx => tx.created_date >= oneDayAgo);

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