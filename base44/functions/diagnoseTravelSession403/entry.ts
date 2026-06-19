/**
 * DIAGNOSTIC: Trace the 403 in autonomousCharacterMovement → createTravelSession.
 * Uses ONLY test characters. Mutates NOTHING (test characters only).
 * No live characters touched.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const results = [];

    // ── STEP 1: Load test characters for this user ──────────────────────────
    let testChars = [];
    try {
      const allChars = await base44.entities.Character.filter(
        { owner_email: user.email, status: 'active' },
        '-updated_date', 200
      );
      testChars = allChars.filter(c => c.is_test_character === true);
    } catch (e) {
      return Response.json({ error: `Character load failed: ${e.message}`, step: 'load_chars' });
    }

    if (testChars.length === 0) {
      return Response.json({ error: 'No test characters found', email: user.email });
    }

    results.push({ step: 'loaded_test_chars', count: testChars.length });

    // ── STEP 2: Load locations for this user ────────────────────────────────
    let locations = [];
    try {
      locations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    } catch (e) {
      return Response.json({ error: `Location load failed: ${e.message}`, step: 'load_locations' });
    }

    results.push({ step: 'loaded_locations', count: locations.length });

    // ── STEP 3: Find a test character at home with a viable destination ──────
    const testChar = testChars.find(c =>
      c.resolved_presence_status === 'home' &&
      !c.is_jailed &&
      !c.house_arrest_active &&
      c.current_home_location_id
    );

    if (!testChar) {
      return Response.json({
        error: 'No eligible test character found',
        char_states: testChars.map(c => ({
          name: c.name,
          status: c.resolved_presence_status,
          jailed: c.is_jailed,
          home: !!c.current_home_location_id,
        })),
      });
    }

    // Pick a destination that's different from current location
    const destLoc = locations.find(l =>
      l.id !== testChar.resolved_current_location_id &&
      l.category !== 'home' &&
      l.owner_email === testChar.owner_email
    );

    if (!destLoc) {
      return Response.json({
        error: 'No valid destination found',
        char: { name: testChar.name, id: testChar.id, current: testChar.resolved_current_location_id },
        location_count: locations.length,
        sample_locations: locations.slice(0, 5).map(l => ({ id: l.id, name: l.name, owner_email: l.owner_email })),
      });
    }

    results.push({
      step: 'selected_test_characters',
      character: { id: testChar.id, name: testChar.name, owner_email: testChar.owner_email, current: testChar.resolved_current_location_id },
      destination: { id: destLoc.id, name: destLoc.name, owner_email: destLoc.owner_email, category: destLoc.category },
    });

    // ── STEP 4: Call createTravelSession via base44.functions.invoke ────────
    const travelRes = await base44.functions.invoke('createTravelSession', {
      characterId: testChar.id,
      destinationLocationId: destLoc.id,
      travelReason: 'diagnostic_test_403',
      travelSource: 'autonomous_need',
      ownerEmail: testChar.owner_email,
      characterData: testChar,
    }).catch(e => ({
      data: {
        success: false,
        error: e.message,
        status: e.status,
        blocked: false,
        blocker: null,
        blocker_reason: null,
      },
    }));

    const td = travelRes?.data || {};
    results.push({
      step: 'createTravelSession_result',
      result: td,
    });

    // ── STEP 5: Also test calling createTravelSession WITHOUT owner_email ────
    const travelRes2 = await base44.functions.invoke('createTravelSession', {
      characterId: testChar.id,
      destinationLocationId: destLoc.id,
      travelReason: 'diagnostic_no_owner_email',
      travelSource: 'autonomous_need',
      characterData: testChar,
      // NO ownerEmail — to test reliance on user context
    }).catch(e => ({
      data: {
        success: false,
        error: e.message,
        status: e.status,
        blocked: false,
        blocker: null,
        blocker_reason: null,
      },
    }));
    results.push({
      step: 'createTravelSession_no_ownerEmail',
      result: travelRes2?.data || {},
    });

    // ── STEP 6: Test with WRONG owner_email (ownership rejection test) ───────
    const travelRes3 = await base44.functions.invoke('createTravelSession', {
      characterId: testChar.id,
      destinationLocationId: destLoc.id,
      travelReason: 'diagnostic_wrong_owner',
      travelSource: 'autonomous_need',
      ownerEmail: 'wrong@example.com',
      characterData: testChar,
    }).catch(e => ({
      data: {
        success: false,
        error: e.message,
        status: e.status,
        blocked: false,
        blocker: null,
        blocker_reason: null,
      },
    }));
    results.push({
      step: 'createTravelSession_wrong_owner',
      result: travelRes3?.data || {},
    });

    return Response.json({
      success: true,
      user_email: user.email,
      now_et: nowET.toISOString(),
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});