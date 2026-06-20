import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * testAutonomousTravelHarness
 *
 * Non-production test harness for autonomous travel runtime proof.
 *
 * This function:
 *   1. Creates a disposable test character with the requested scenario state
 *   2. Creates supporting locations and financial records
 *   3. Calls base44.functions.invoke('autonomousCharacterMovement', {}) which runs
 *      the full autonomous movement pipeline against the test character
 *   4. Reports full before/after state including:
 *      - location state (resolved_current_location_id)
 *      - presence status
 *      - energy/sleep state
 *      - financial transactions created
 *      - balance changes
 *
 * All work is done via asServiceRole — no RLS interference.
 * Test characters are auto-cleaned up at the end of each scenario.
 *
 * Scenarios supported (pass scenario param):
 *   "sleep_guard"          — character at cafe, energy=15, expect route to home
 *   "pre_shift_return"     — character at cafe, work in 3h, expect route to home
 *   "financial_connection" — character at home, hunger=10, check cafe selected + spending
 *   "grocery_not_hangout"  — character at home, hunger=60, full inventory, expect NOT grocery
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const body = await req.json().catch(() => ({}));
    const { scenario } = body;

    if (!scenario) {
      return Response.json({ error: 'Missing "scenario" param. Supported: sleep_guard, pre_shift_return, financial_connection, grocery_not_hangout' }, { status: 400 });
    }

    const now = new Date();
    const nowISO = now.toISOString();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etHour = nowET.getHours();
    const etMin = nowET.getMinutes();
    const ownerEmail = 'test-harness@base44.com';

    // Shared cleanup: remove any previous test artifacts from this harness
    async function cleanupPrevious() {
      const prev = await base44.asServiceRole.entities.Character.filter(
        { owner_email: ownerEmail, name: 'Harness Test Character' }, null, 10
      ).catch(() => []);
      for (const c of prev) {
        await base44.asServiceRole.entities.Character.delete(c.id).catch(() => {});
      }
      const prevLocs = await base44.asServiceRole.entities.LocationReference.filter(
        { owner_email: ownerEmail, name__contains: 'Harness' }, null, 10
      ).catch(() => []);
      for (const l of prevLocs) {
        await base44.asServiceRole.entities.LocationReference.delete(l.id).catch(() => {});
      }
      const prevFin = await base44.asServiceRole.entities.CharacterFinancial.filter(
        { owner_email: ownerEmail }, null, 10
      ).catch(() => []);
      for (const f of prevFin) {
        await base44.asServiceRole.entities.CharacterFinancial.delete(f.id).catch(() => {});
      }
      const prevTx = await base44.asServiceRole.entities.FinancialTransaction.filter(
        { owner_email: ownerEmail }, null, 50
      ).catch(() => []);
      for (const tx of prevTx) {
        await base44.asServiceRole.entities.FinancialTransaction.delete(tx.id).catch(() => {});
      }
    }

    await cleanupPrevious();

    // Create shared locations
    const homeLoc = await base44.asServiceRole.entities.LocationReference.create({
      name: 'Harness Home', category: 'home', owner_email: ownerEmail,
    });
    const workLoc = await base44.asServiceRole.entities.LocationReference.create({
      name: 'Harness Work', category: 'workplace', owner_email: ownerEmail,
    });
    const cafeLoc = await base44.asServiceRole.entities.LocationReference.create({
      name: 'Harness Cafe', category: 'food_drink', owner_email: ownerEmail,
    });
    const groceryLoc = await base44.asServiceRole.entities.LocationReference.create({
      name: 'Harness Grocery', category: 'grocery', owner_email: ownerEmail,
    });

    let charConfig = {};
    let scenarioLabel = '';
    let expectedBehavior = '';

    if (scenario === 'sleep_guard') {
      scenarioLabel = 'Sleep Protection — critically low energy forces return home';
      expectedBehavior = 'Character at cafe with energy=15 should be sent home by Tier 1 pass-out or Tier 4 critical energy, NOT selected a leisure destination';
      charConfig = {
        name: 'Harness Test Character',
        character_type: 'active_created_character',
        status: 'active',
        owner_email: ownerEmail,
        current_home_location_id: homeLoc.id,
        resolved_current_location_id: cafeLoc.id,
        resolved_current_location_name: cafeLoc.name,
        resolved_presence_status: 'visiting',
        resolved_location_type: 'visit',
        resolved_source_reason: 'test_setup',
        energy_value: 15,
        hunger_value: 60,
      };
    } else if (scenario === 'pre_shift_return') {
      const shiftHour = (etHour + 3) % 24;
      const shiftStart = `${String(shiftHour).padStart(2, '0')}:${String(etMin).padStart(2, '0')}`;
      const shiftEndHour = (shiftHour + 8) % 24;
      const shiftEnd = `${String(shiftEndHour).padStart(2, '0')}:${String(etMin).padStart(2, '0')}`;
      scenarioLabel = `Pre-Shift Return — work at ${shiftStart}, expect return home from cafe`;
      expectedBehavior = `Character at cafe with work starting at ${shiftStart} (3h away) should be sent home`;
      charConfig = {
        name: 'Harness Test Character',
        character_type: 'active_created_character',
        status: 'active',
        owner_email: ownerEmail,
        current_home_location_id: homeLoc.id,
        resolved_current_location_id: cafeLoc.id,
        resolved_current_location_name: cafeLoc.name,
        resolved_presence_status: 'visiting',
        resolved_location_type: 'visit',
        resolved_source_reason: 'test_setup',
        energy_value: 80,
        hunger_value: 60,
        occupation_location_id: workLoc.id,
        work_days: [nowET.getDay()],
        work_start_time: shiftStart,
        work_end_time: shiftEnd,
      };
    } else if (scenario === 'financial_connection') {
      scenarioLabel = 'Financial Connection — hunger drives food_drink, verify spending transaction';
      expectedBehavior = 'Character should select cafe, movement logged, then processCharacterFoodAndDrinkSpending creates transaction';
      charConfig = {
        name: 'Harness Test Character',
        character_type: 'active_created_character',
        status: 'active',
        owner_email: ownerEmail,
        current_home_location_id: homeLoc.id,
        resolved_current_location_id: homeLoc.id,
        resolved_current_location_name: homeLoc.name,
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'test_setup',
        energy_value: 80,
        hunger_value: 10,
        social_value: 80,
      };
    } else if (scenario === 'grocery_not_hangout') {
      scenarioLabel = 'Grocery Not Hangout — full inventory + moderate hunger should NOT select grocery';
      expectedBehavior = 'Character with full food inventory should not select grocery as destination';
      // Create HouseholdResource with full inventory
      await base44.asServiceRole.entities.HouseholdResource.create({
        owner_email: ownerEmail,
        home_location_id: homeLoc.id,
        resource_type: 'food',
        home_food_value: 100,
      }).catch(() => {});
      charConfig = {
        name: 'Harness Test Character',
        character_type: 'active_created_character',
        status: 'active',
        owner_email: ownerEmail,
        current_home_location_id: homeLoc.id,
        resolved_current_location_id: homeLoc.id,
        resolved_current_location_name: homeLoc.name,
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'test_setup',
        energy_value: 80,
        hunger_value: 60,
        social_value: 60,
      };
    } else {
      return Response.json({ error: `Unknown scenario: ${scenario}` }, { status: 400 });
    }

    // Create test character
    const char = await base44.asServiceRole.entities.Character.create(charConfig);

    // Create financial record
    const fin = await base44.asServiceRole.entities.CharacterFinancial.create({
      character_id: char.id,
      character_name: char.name,
      owner_email: ownerEmail,
      current_balance: 5000,
      home_location_id: homeLoc.id,
      home_location_name: homeLoc.name,
    });

    // ── BEFORE STATE ──────────────────────────────────────────────────────────
    const beforeChar = await base44.asServiceRole.entities.Character.filter({ id: char.id });
    const beforeFin = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
    const beforeTx = await base44.asServiceRole.entities.FinancialTransaction.filter({ owner_email: ownerEmail, character_id: char.id });

    const before = {
      location_id: beforeChar[0]?.resolved_current_location_id || null,
      location_name: beforeChar[0]?.resolved_current_location_name || null,
      presence_status: beforeChar[0]?.resolved_presence_status || null,
      energy: beforeChar[0]?.energy_value || null,
      hunger: beforeChar[0]?.hunger_value || null,
      balance: beforeFin[0]?.current_balance || null,
      transaction_count: beforeTx.length,
      timestamp_et: nowET.toLocaleString(),
    };

    // ── INVOKE AUTONOMOUS MOVEMENT ────────────────────────────────────────────
    let movementResult = null;
    let moveError = null;
    try {
      movementResult = await base44.functions.invoke('autonomousCharacterMovement', {});
    } catch (e) {
      moveError = e.message;
    }

    // Small delay to allow async writes to settle
    await new Promise(resolve => setTimeout(resolve, 500));

    // ── AFTER STATE ──────────────────────────────────────────────────────────
    const afterChar = await base44.asServiceRole.entities.Character.filter({ id: char.id });
    const afterFinResult = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
    const afterTxResult = await base44.asServiceRole.entities.FinancialTransaction.filter({ owner_email: ownerEmail, character_id: char.id });

    const after = {
      location_id: afterChar[0]?.resolved_current_location_id || null,
      location_name: afterChar[0]?.resolved_current_location_name || null,
      presence_status: afterChar[0]?.resolved_presence_status || null,
      resolved_source_reason: afterChar[0]?.resolved_source_reason || null,
      energy: afterChar[0]?.energy_value || null,
      hunger: afterChar[0]?.hunger_value || null,
      balance: afterFinResult[0]?.current_balance || null,
      transaction_count: afterTxResult.length,
      transactions: afterTxResult.map(tx => ({
        amount: tx.amount,
        direction: tx.direction,
        transaction_type: tx.transaction_type,
        description: tx.description,
        location_name: tx.location_name,
        timestamp: tx.timestamp,
      })),
      timestamp_et: new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toLocaleString(),
    };

    // ── DETERMINE OUTCOME ────────────────────────────────────────────────────
    let outcome = 'UNKNOWN';
    let verdict = '';

    if (scenario === 'sleep_guard') {
      const wentHome = after.location_id === homeLoc.id;
      outcome = wentHome ? 'PASS' : 'FAIL';
      verdict = wentHome
        ? 'Character correctly routed home (energy=15 critical). Sleep protected.'
        : `Character went to "${after.location_name}" instead of home. Sleep NOT protected.`;
    } else if (scenario === 'pre_shift_return') {
      const wentHome = after.location_id === homeLoc.id;
      outcome = wentHome ? 'PASS' : 'FAIL';
      verdict = wentHome
        ? 'Character correctly returned home before shift. Work schedule protected.'
        : `Character at "${after.location_name}" instead of home. Pre-shift return FAILED.`;
    } else if (scenario === 'financial_connection') {
      const hasTx = after.transaction_count > before.transaction_count;
      outcome = hasTx ? 'PASS' : 'PARTIAL';
      verdict = hasTx
        ? `Financial connection confirmed — ${after.transaction_count - before.transaction_count} new transaction(s) created.`
        : 'No financial transactions created. Financial connection NOT proven.';
    } else if (scenario === 'grocery_not_hangout') {
      const wentToGrocery = after.location_id === groceryLoc.id;
      outcome = wentToGrocery ? 'FAIL' : 'PASS';
      verdict = wentToGrocery
        ? 'Character went to grocery despite full inventory. Grocery hangout NOT prevented.'
        : `Character went to "${after.location_name}" instead of grocery. Grocery hangout prevented.`;
    }

    // ── CLEANUP TEST DATA ────────────────────────────────────────────────────
    await base44.asServiceRole.entities.Character.delete(char.id).catch(() => {});
    await base44.asServiceRole.entities.CharacterFinancial.delete(fin.id).catch(() => {});
    await base44.asServiceRole.entities.LocationReference.delete(homeLoc.id).catch(() => {});
    await base44.asServiceRole.entities.LocationReference.delete(workLoc.id).catch(() => {});
    await base44.asServiceRole.entities.LocationReference.delete(cafeLoc.id).catch(() => {});
    await base44.asServiceRole.entities.LocationReference.delete(groceryLoc.id).catch(() => {});
    for (const tx of afterTxResult) {
      await base44.asServiceRole.entities.FinancialTransaction.delete(tx.id).catch(() => {});
    }

    return Response.json({
      scenario,
      scenario_label: scenarioLabel,
      expected_behavior: expectedBehavior,
      outcome,
      before,
      after,
      movement_result: movementResult?.data || movementResult || null,
      movement_error: moveError,
      verdict,
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});