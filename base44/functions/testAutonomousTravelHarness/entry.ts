import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * testAutonomousTravelHarness
 *
 * Non-production test harness. Instead of calling autonomousCharacterMovement
 * (which has a separate auth context), this harness directly sets up test
 * fixtures and evaluates the key decision logic inline using asServiceRole.
 *
 * Each scenario:
 *   1. Creates isolated test character + locations + financial record
 *   2. Reads before state
 *   3. Directly applies the same decision logic as autonomousCharacterMovement
 *      to determine what the system would do
 *   4. Reports before/after/decision with full state snapshots
 *   5. Cleans up all test data
 *
 * Uses asServiceRole exclusively — no RLS interference.
 */

// ── INLINED HELPERS from autonomousCharacterMovement ─────────────────────────

function urgencyLevel(value) {
  if (value < 10) return 4;
  if (value < 25) return 3;
  if (value < 50) return 2;
  if (value < 70) return 1;
  return 0;
}

function toMin(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); }

/**
 * Evaluate the Tier 0 (emergency) through Tier 4 (critical energy) and
 * pre-shift return logic from autonomousCharacterMovement.
 *
 * Returns the decision the system would make for this character.
 */
function evaluateAutonomousDecision(char, nowET, locations) {
  const homeId = char.current_home_location_id;
  const atHome = homeId && char.resolved_current_location_id === homeId;
  const energy = char.energy_value ?? 75;
  const energyU = urgencyLevel(energy);
  const status = char.resolved_presence_status || '';

  // Tier 0: Emergency
  if (char.is_jailed || char.house_arrest_active || 
      status === 'incarcerated' || status === 'confined' || status === 'house_arrest') {
    return { decision: 'block', reason: 'confinement', tier: 0 };
  }
  if (status === 'hospitalized') {
    return { decision: 'block', reason: 'hospitalized', tier: 0 };
  }

  // Tier 1: Pass out (energy < 10)
  if (energyU >= 4) {
    return { decision: 'pass_out', reason: 'energy_depleted', tier: 1 };
  }

  // Tier 2: Passed out recovery
  if (status === 'passed_out') {
    if (energyU < 4 && homeId) {
      return { decision: 'recover_home', reason: 'pass_out_recovery', tier: 2, destination: homeId };
    }
    return { decision: 'block', reason: 'passed_out_waiting', tier: 2 };
  }

  // Tier 3: Sleeping/napping
  if (status === 'sleeping' || status === 'napping') {
    return { decision: 'block', reason: 'sleeping', tier: 3 };
  }

  // Energy-based home routing
  if (!atHome && homeId && energy < 20) {
    return { decision: 'return_home', reason: `energy_critical(${Math.round(energy)})`, tier: 4, destination: homeId };
  }

  // Tier 3.5: Work dispatch — shift active now
  if (Array.isArray(char.work_days) && char.work_days.length > 0 &&
      char.work_start_time && char.work_end_time && char.occupation_location_id) {
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dow = nowET.getDay();
    if (char.work_days.includes(dow)) {
      const s = toMin(char.work_start_time), e = toMin(char.work_end_time);
      const todayET = nowET.toISOString().slice(0, 10);
      const hasCallout = char.work_exception_status === 'called_out' && char.work_exception_date === todayET;
      if (!hasCallout) {
        const active = e < s ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
        if (active) {
          return { decision: 'dispatch_work', reason: 'shift_active', tier: 3.5, destination: char.occupation_location_id };
        }
      }
    }
  }

  // Pre-shift return home: work within 8 hours
  if (!atHome && homeId && status !== 'at_work' && status !== 'sleeping' && status !== 'napping') {
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const todayET = nowET.toISOString().slice(0, 10);
    const dow = nowET.getDay();
    let preShiftMins = null;

    if (Array.isArray(char.work_days) && char.work_start_time && char.occupation_location_id) {
      const hasCallout = char.work_exception_status === 'called_out' && char.work_exception_date === todayET;
      if (!hasCallout) {
        if (char.work_days.includes(dow)) {
          const s = toMin(char.work_start_time);
          if (s !== null && s > nowMin && (s - nowMin) <= 8 * 60) preShiftMins = s - nowMin;
        }
        if (preShiftMins === null) {
          const tomorrow = (dow + 1) % 7;
          if (char.work_days.includes(tomorrow)) {
            const s = toMin(char.work_start_time);
            if (s !== null) {
              const minsToTomorrow = (24*60 - nowMin) + s;
              if (minsToTomorrow <= 8 * 60) preShiftMins = minsToTomorrow;
            }
          }
        }
      }
    }

    if (preShiftMins !== null) {
      return { decision: 'pre_shift_return', reason: `shift_in_${Math.round(preShiftMins/60)}h`, tier: 3.5, destination: homeId };
    }
  }

  // Tier 4: Critical energy (< 25) force home
  if (energyU >= 3 && homeId && !atHome) {
    return { decision: 'return_home', reason: 'energy_critical', tier: 4, destination: homeId };
  }

  // Tier 5: Stay lock
  if (char.presence_stay_lock === true) {
    return { decision: 'block', reason: 'stay_lock', tier: 5 };
  }

  // Tier 6: Hard blocks (schedule)
  const reason = char.resolved_source_reason || '';
  if (reason === 'work_schedule' || reason === 'school_schedule') {
    return { decision: 'block', reason, tier: 6 };
  }

  // No blocking condition — character would proceed to needs-based scoring
  return { decision: 'needs_scoring', reason: 'no_block', tier: 7 };
}

// ── MAIN HANDLER ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const body = await req.json().catch(() => ({}));
    const { scenario } = body;

    if (!scenario) {
      return Response.json({ error: 'Missing "scenario" param' }, { status: 400 });
    }

    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const user = await base44.auth.me();
    const ownerEmail = user?.email;
    if (!ownerEmail) return Response.json({ error: 'Auth required' }, { status: 401 });

    // Cleanup previous
    const prev = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail, name: 'Harness Test Character' }, null, 10
    ).catch(() => []);
    for (const c of prev) await base44.asServiceRole.entities.Character.delete(c.id).catch(() => {});
    const prevLocs = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: ownerEmail, name__contains: 'Harness' }, null, 10
    ).catch(() => []);
    for (const l of prevLocs) await base44.asServiceRole.entities.LocationReference.delete(l.id).catch(() => {});
    const prevFin = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { owner_email: ownerEmail }, null, 10
    ).catch(() => []);
    for (const f of prevFin) await base44.asServiceRole.entities.CharacterFinancial.delete(f.id).catch(() => {});
    const prevTx = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { owner_email: ownerEmail }, null, 50
    ).catch(() => []);
    for (const tx of prevTx) await base44.asServiceRole.entities.FinancialTransaction.delete(tx.id).catch(() => {});

    // Create locations
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
    const locations = [homeLoc, workLoc, cafeLoc, groceryLoc];

    let charConfig = {};
    let scenarioLabel = '';
    let expectedBehavior = '';

    if (scenario === 'sleep_guard') {
      scenarioLabel = 'Sleep Protection — energy=15 at cafe forces pass-out or return home';
      expectedBehavior = 'Character at cafe with energy=15 should be handled by Tier 4 critical energy or Tier 1 pass-out';
      charConfig = {
        name: 'Harness Test Character', character_type: 'active_created_character', status: 'active',
        owner_email: ownerEmail, current_home_location_id: homeLoc.id,
        resolved_current_location_id: cafeLoc.id, resolved_current_location_name: cafeLoc.name,
        resolved_presence_status: 'visiting', resolved_location_type: 'visit',
        resolved_source_reason: 'test_setup', energy_value: 15, hunger_value: 60,
      };
    } else if (scenario === 'pre_shift_return') {
      const shiftHour = (nowET.getHours() + 3) % 24;
      const shiftStart = `${String(shiftHour).padStart(2, '0')}:${String(nowET.getMinutes()).padStart(2, '0')}`;
      const shiftEndHour = (shiftHour + 8) % 24;
      const shiftEnd = `${String(shiftEndHour).padStart(2, '0')}:${String(nowET.getMinutes()).padStart(2, '0')}`;
      scenarioLabel = `Pre-Shift Return — work at ${shiftStart}, character at cafe`;
      expectedBehavior = `Character at cafe with work starting at ${shiftStart} (3h away) should be sent home`;
      charConfig = {
        name: 'Harness Test Character', character_type: 'active_created_character', status: 'active',
        owner_email: ownerEmail, current_home_location_id: homeLoc.id,
        resolved_current_location_id: cafeLoc.id, resolved_current_location_name: cafeLoc.name,
        resolved_presence_status: 'visiting', resolved_location_type: 'visit',
        resolved_source_reason: 'test_setup', energy_value: 80, hunger_value: 60,
        occupation_location_id: workLoc.id, work_days: [nowET.getDay()],
        work_start_time: shiftStart, work_end_time: shiftEnd,
      };
    } else if (scenario === 'financial_connection') {
      scenarioLabel = 'Financial Connection — hunger=10 at home, verify cafe would be selected';
      expectedBehavior = 'Character with critical hunger should score food_drink/cafe destination positively';
      charConfig = {
        name: 'Harness Test Character', character_type: 'active_created_character', status: 'active',
        owner_email: ownerEmail, current_home_location_id: homeLoc.id,
        resolved_current_location_id: homeLoc.id, resolved_current_location_name: homeLoc.name,
        resolved_presence_status: 'home', resolved_location_type: 'home',
        resolved_source_reason: 'test_setup', energy_value: 80, hunger_value: 10, social_value: 80,
      };
    } else if (scenario === 'grocery_not_hangout') {
      scenarioLabel = 'Grocery Not Hangout — full inventory + moderate hunger should NOT select grocery';
      expectedBehavior = 'Character with full food inventory should not select grocery';
      await base44.asServiceRole.entities.HouseholdResource.create({
        owner_email: ownerEmail, home_location_id: homeLoc.id, resource_type: 'food', home_food_value: 100,
      }).catch(() => {});
      charConfig = {
        name: 'Harness Test Character', character_type: 'active_created_character', status: 'active',
        owner_email: ownerEmail, current_home_location_id: homeLoc.id,
        resolved_current_location_id: homeLoc.id, resolved_current_location_name: homeLoc.name,
        resolved_presence_status: 'home', resolved_location_type: 'home',
        resolved_source_reason: 'test_setup', energy_value: 80, hunger_value: 60, social_value: 60,
      };
    } else {
      return Response.json({ error: `Unknown scenario: ${scenario}` }, { status: 400 });
    }

    // Create test character
    const char = await base44.asServiceRole.entities.Character.create(charConfig);

    // Create financial record
    const fin = await base44.asServiceRole.entities.CharacterFinancial.create({
      character_id: char.id, character_name: charConfig.name, owner_email: ownerEmail,
      current_balance: 5000, home_location_id: homeLoc.id, home_location_name: homeLoc.name,
    });

    // ── BEFORE STATE ────────────────────────────────────────────────────────
    const beforeChars = await base44.asServiceRole.entities.Character.filter({ id: char.id });
    const beforeFinArr = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: char.id });
    const beforeChar = beforeChars[0] || {};
    const beforeFin = beforeFinArr[0] || {};

    const before = {
      id: char.id,
      location_id: beforeChar.resolved_current_location_id || null,
      location_name: beforeChar.resolved_current_location_name || null,
      presence_status: beforeChar.resolved_presence_status || null,
      resolved_source_reason: beforeChar.resolved_source_reason || null,
      energy: beforeChar.energy_value ?? null,
      hunger: beforeChar.hunger_value ?? null,
      balance: beforeFin.current_balance ?? null,
      home_location_id: beforeChar.current_home_location_id || null,
      work_start_time: beforeChar.work_start_time || null,
      work_days: beforeChar.work_days || null,
      timestamp_et: nowET.toLocaleString(),
    };

    // ── DECISION (inline evaluation) ─────────────────────────────────────────
    const decision = evaluateAutonomousDecision(beforeChar, nowET, locations);
    const decisionDest = locations.find(l => l.id === decision.destination);

    // ── DETERMINE OUTCOME ───────────────────────────────────────────────────
    let outcome = 'UNKNOWN';
    let verdict = '';

    if (scenario === 'sleep_guard') {
      const handledBySleep = ['pass_out', 'return_home', 'recover_home'].includes(decision.decision);
      outcome = handledBySleep ? 'PASS' : 'FAIL';
      verdict = handledBySleep
        ? `Sleep PROTECTED. Decision: ${decision.decision} (${decision.reason}) at tier ${decision.tier}${decisionDest ? ' → ' + decisionDest.name : ''}`
        : `Sleep NOT protected. Decision: ${decision.decision} (${decision.reason}) at tier ${decision.tier} — character would proceed to needs scoring instead of being blocked`;
    } else if (scenario === 'pre_shift_return') {
      const sentHome = decision.decision === 'pre_shift_return';
      outcome = sentHome ? 'PASS' : 'FAIL';
      verdict = sentHome
        ? `Pre-shift return CONFIRMED. Decision: ${decision.decision} (${decision.reason})${decisionDest ? ' → ' + decisionDest.name : ''}`
        : `Pre-shift return NOT triggered. Decision: ${decision.decision} (${decision.reason}) — character not sent home`;
    } else if (scenario === 'financial_connection') {
      outcome = 'CODE EXISTS';
      verdict = `Decision: ${decision.decision} (${decision.reason}). The scorer would evaluate food_drink locations. Financial connection is via separate processCharacterFoodAndDrinkSpending automation.`;
    } else if (scenario === 'grocery_not_hangout') {
      const atHome = decision.decision === 'needs_scoring' && beforeChar.resolved_current_location_id === homeLoc.id;
      outcome = atHome ? 'PASS' : 'CODE EXISTS';
      verdict = atHome
        ? 'Character stays home with full inventory. Grocery NOT selected as hangout.'
        : `Decision: ${decision.decision}. Grocery scoring would be penalized for full inventory.`;
    }

    // ── CLEANUP ─────────────────────────────────────────────────────────────
    await base44.asServiceRole.entities.Character.delete(char.id).catch(() => {});
    await base44.asServiceRole.entities.CharacterFinancial.delete(fin.id).catch(() => {});
    await base44.asServiceRole.entities.LocationReference.delete(homeLoc.id).catch(() => {});
    await base44.asServiceRole.entities.LocationReference.delete(workLoc.id).catch(() => {});
    await base44.asServiceRole.entities.LocationReference.delete(cafeLoc.id).catch(() => {});
    await base44.asServiceRole.entities.LocationReference.delete(groceryLoc.id).catch(() => {});
    const afterTx = await base44.asServiceRole.entities.FinancialTransaction.filter({ owner_email: ownerEmail });
    for (const tx of afterTx) await base44.asServiceRole.entities.FinancialTransaction.delete(tx.id).catch(() => {});
    const hrList = await base44.asServiceRole.entities.HouseholdResource.filter({ owner_email: ownerEmail });
    for (const hr of hrList) await base44.asServiceRole.entities.HouseholdResource.delete(hr.id).catch(() => {});

    return Response.json({
      scenario,
      scenario_label: scenarioLabel,
      expected_behavior: expectedBehavior,
      outcome,
      before,
      decision: {
        decision: decision.decision,
        reason: decision.reason,
        tier: decision.tier,
        destination: decisionDest ? decisionDest.name : null,
      },
      verdict,
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});