import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Check if location is currently open based on operating hours
function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isInWindow(currentMinutes, openStr, closeStr) {
  const open = toMinutes(openStr);
  const close = toMinutes(closeStr);
  if (open == null || close == null) return false;
  if (open <= close) {
    return currentMinutes >= open && currentMinutes <= close;
  }
  return currentMinutes >= open || currentMinutes <= close;
}

function isLocationOpen(location) {
  if (!location?.operating_hours || location.operating_hours.length === 0) {
    return true; // No hours = always open
  }
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nowET.getDay();
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);
  if (todayEntries.length > 0) {
    return todayEntries.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
  }
  if (daySpecific.length > 0 && todayEntries.length === 0) {
    return false;
  }
  if (dayAgnostic.length > 0) {
    return dayAgnostic.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
  }
  return true;
}

/**
 * AUTONOMOUS CHARACTER MOVEMENT — NEEDS-DRIVEN
 *
 * Runs every 30 minutes. Evaluates each active_created_character's raw need
 * values and moves them to the best available location.
 *
 * THRESHOLD (internal urgency — NOT UI labels):
 *   > 70    no urgency — optional movement only (25% chance)
 *   50–70   awareness  — begin evaluating (50% chance)
 *   < 50    URGENT     — mandatory movement attempt
 *   < 25    HIGH       — strong prioritization, no delay
 *   < 10    EMERGENCY  — maximum urgency score
 *
 * Below 50 = system MUST attempt movement or prove a blocking reason.
 * Silent skipping at < 50 is a SYSTEM FAILURE.
 *
 * OWNER_EMAIL ISOLATION: character may only move to locations where
 *   destination.owner_email === character.owner_email
 */

// ── ADAPTIVE SLEEP HELPERS (active_created_character only) ────────────────────
// Mirrors the same logic in scheduledLocationEnforcement / enforceCharacterLocationPresence.
// Sleep is planned around the character's NEXT work/school obligation, not static fields.
// Overnight workers sleep during the day; daytime workers sleep at night.
const PRE_SLEEP_WINDOW_MINUTES = 60;

function computeAdaptiveSleepWindow(character, etTime) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER   = 60;
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const dayOfWeek = etTime.getDay();

  let nextShiftStartMin = null;
  let nextShiftEndMin   = null;

  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    const isWorkDayToday    = character.work_days.includes(dayOfWeek);
    const isWorkDayTomorrow = character.work_days.includes((dayOfWeek + 1) % 7);
    if (isWorkDayToday || isWorkDayTomorrow) {
      nextShiftStartMin = toMin(character.work_start_time);
      nextShiftEndMin   = toMin(character.work_end_time);
    }
  }

  if (!nextShiftStartMin && character.student_status === 'enrolled' && character.education_location_id) {
    nextShiftStartMin = 8 * 60;
    nextShiftEndMin   = 15 * 60;
  }

  const isOvernightShift = nextShiftStartMin !== null && nextShiftEndMin !== null && nextShiftEndMin < nextShiftStartMin;

  if (nextShiftStartMin !== null) {
    if (isOvernightShift) {
      // Overnight worker: sleep after shift ends (daytime), wake before shift starts
      return {
        sleepStartMin: (nextShiftEndMin + 60) % 1440,
        wakeMin: (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440,
        isOvernightWorker: true,
      };
    } else {
      // Standard worker: wake before shift, sleep ~7h before wake
      const wakeTime = (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440;
      return {
        sleepStartMin: (wakeTime - SLEEP_DURATION_MIN + 1440) % 1440,
        wakeMin: wakeTime,
        isOvernightWorker: false,
      };
    }
  }

  // No obligation — fall back to stored schedule
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, isOvernightWorker: false };
  }

  return null;
}

function isScheduledSleeping(character, etTime) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  // No determinable sleep schedule — cannot assume sleep. Return false.
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) return now >= sleepStartMin || now < wakeMin;
  return now >= sleepStartMin && now < wakeMin;
}

function isInPreSleepWindow(character, etTime) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  // No determinable sleep schedule — cannot assume pre-sleep window. Return false.
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin } = window;
  const windowStart = (sleepStartMin - PRE_SLEEP_WINDOW_MINUTES + 1440) % 1440;
  if (windowStart > sleepStartMin) return now >= windowStart || now < sleepStartMin;
  return now >= windowStart && now < sleepStartMin;
}

// ── RAW NEED VALUES ────────────────────────────────────────────────────────────
function needValues(char) {
  return {
    hunger:   char.hunger_value          ?? 70,
    energy:   char.energy_value          ?? 75,
    social:   char.social_value          ?? 65,
    health:   char.health_value          ?? 80,
    mental:   char.mental_value          ?? 70,
    hygiene:  char.hygiene_value         ?? 75,
    comfort:  char.comfort_value         ?? 70,
    financial: char.financial_need_value ?? 60,
  };
}

// ── URGENCY LEVEL ──────────────────────────────────────────────────────────────
// 0 = none | 1 = awareness | 2 = urgent | 3 = high | 4 = emergency
function urgencyLevel(value) {
  if (value < 10) return 4;
  if (value < 25) return 3;
  if (value < 50) return 2;
  if (value < 70) return 1;
  return 0;
}

// ── LOWEST URGENCY NEED ────────────────────────────────────────────────────────
function highestUrgencyEntry(vals) {
  return Object.entries(vals)
    .map(([k, v]) => ({ key: k, value: v, urgency: urgencyLevel(v) }))
    .sort((a, b) => b.urgency - a.urgency || a.value - b.value)[0];
}

// ── LOCATION SCORER ────────────────────────────────────────────────────────────
// Score scales with urgency so correct category wins harder when need is worse.
function scoreLocation(location, char, vals) {
  let score = 0;
  const cat = location.category || 'generic';
  const se = char.social_energy || 'ambivert';

  const hungerU  = urgencyLevel(vals.hunger);
  const energyU  = urgencyLevel(vals.energy);
  const socialU  = urgencyLevel(vals.social);
  const healthU  = urgencyLevel(vals.health);
  const mentalU  = urgencyLevel(vals.mental);
  const hygieneU = urgencyLevel(vals.hygiene);
  const comfortU = urgencyLevel(vals.comfort);

  // HUNGER → food or grocery
  if (hungerU >= 2) {
    if (cat === 'food_drink') score += 3 + hungerU * 2;
    if (cat === 'grocery')    score += 2 + hungerU;
    if (cat === 'home')       score += 1;       // can cook at home
  }

  // ENERGY → rest at home
  if (energyU >= 2) {
    if (cat === 'home') score += 3 + energyU * 2;
    if (cat === 'gym')  score -= energyU;       // gym makes it worse
  }

  // SOCIAL → go out (extrovert/ambivert) OR quiet (introvert)
  if (socialU >= 2) {
    const isIntro = ['introvert', 'mostly_introvert'].includes(se);
    if (isIntro) {
      if (cat === 'outdoor' || cat === 'home') score += 2 + socialU;
    } else {
      if (cat === 'social' || cat === 'food_drink') score += 3 + socialU * 2;
      if (cat === 'outdoor' || cat === 'gym')       score += 2 + socialU;
    }
  }

  // HEALTH → medical care — scales most aggressively
  if (healthU >= 2) {
    if (cat === 'medical')  score += 4 + healthU * 3;
    if (cat === 'home')     score += 1 + healthU;
    if (cat === 'gym')      score -= healthU * 2;
    if (cat === 'social')   score -= healthU;
  }

  // MENTAL / STRESS → calm environments
  if (mentalU >= 2) {
    if (['outdoor', 'home', 'religion'].includes(cat)) score += 2 + mentalU;
    if (cat === 'gym') score += 1 + mentalU;
  }

  // HYGIENE → home to freshen up
  if (hygieneU >= 2) {
    if (cat === 'home') score += 2 + hygieneU;
  }

  // COMFORT → change of scenery
  if (comfortU >= 2) {
    if (cat === 'outdoor' || cat === 'food_drink') score += 1 + comfortU;
    if (cat === 'home') score -= 1; // staying home IS the comfort problem
  }

  // BASE social energy preference (minor, overridden by urgent needs)
  if (se === 'extrovert' && ['social', 'food_drink', 'outdoor'].includes(cat))      score += 1;
  if (['introvert', 'mostly_introvert'].includes(se) && ['home', 'outdoor'].includes(cat)) score += 1;

  return score;
}

// ── BEST LOCATION SELECTOR ─────────────────────────────────────────────────────
function selectBestLocation(locations, char, vals) {
  if (!locations || locations.length === 0) return null;

  const scored = locations
    .map(loc => ({ location: loc, score: scoreLocation(loc, char, vals) }))
    .sort((a, b) => b.score - a.score);

  // Must score positive — no movement just to move
  const positives = scored.filter(s => s.score > 0);
  if (positives.length === 0) return null;

  // Weighted random from top 3 to avoid robotic repetition
  const top = positives.slice(0, Math.min(3, positives.length));
  const weights = top.length === 1 ? [1] : top.length === 2 ? [0.65, 0.35] : [0.50, 0.30, 0.20];
  const roll = Math.random();
  let cum = 0;
  for (let i = 0; i < top.length; i++) {
    cum += weights[i] || 0;
    if (roll <= cum) return top[i].location;
  }
  return top[0].location;
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled — no session */ }

    // ── LOAD ALL active_created_character ────────────────────────────────────
    // Use session user if available, fall back to service role for scheduled runs
    let characters = [];
    try {
      const allChars = await base44.entities.Character.list('-updated_date', 500);
      characters = allChars.filter(c => c.character_type === 'active_created_character');
    } catch {
      const allChars = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
      characters = allChars.filter(c => c.character_type === 'active_created_character');
    }

    const eligible = characters.filter(c =>
      c.owner_email &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'moved_away' &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.exclude_from_homepage &&
      // Accept home via either explicit field OR resolved location marked as home type
      (c.current_home_location_id || (c.resolved_current_location_id && c.resolved_location_type === 'home'))
    );

    console.log(`[autonomousMovement] Eligible: ${eligible.length}`);

    // ── GROUP BY owner_email (strict isolation) ──────────────────────────────
    const byUser = {};
    for (const c of eligible) {
      if (!byUser[c.owner_email]) byUser[c.owner_email] = [];
      byUser[c.owner_email].push(c);
    }

    let totalMoved = 0;
    const moveLog = [];
    const blockedLog = [];
    const skippedLog = [];

    for (const [userEmail, userChars] of Object.entries(byUser)) {
      // Load ONLY this user's locations (owner_email scope)
      let userLocations = [];
      try {
        userLocations = await base44.entities.LocationReference.filter({ owner_email: userEmail });
      } catch {
        try {
          userLocations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: userEmail });
        } catch (e2) {
          console.warn(`[autonomousMovement] Location load failed for ${userEmail}:`, e2.message);
          continue;
        }
      }

      // Check if autonomous travel is enabled for this user (default: ON)
      // owner_email is the sole ownership source of truth — created_by is permanently forbidden
      let autonomousTravelEnabled = true;
      try {
        const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: userEmail }, null, 1);
        const userSettings = userSettingsList?.[0];
        if (userSettings && userSettings.autonomous_travel_enabled === false) {
          autonomousTravelEnabled = false;
        }
      } catch { /* non-fatal — default to enabled */ }

      for (const char of userChars) {
        const status = char.resolved_presence_status || '';
        const reason = char.resolved_source_reason || '';
        const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const vals = needValues(char);
        const energyUrgency = urgencyLevel(vals.energy);

        // ── TIER 0: EMERGENCY / HOSPITALIZED — hard stop, nothing overrides ──
        if (status === 'hospitalized' || char.is_jailed) {
          console.log(`[autonomousMovement] ${char.name}: EMERGENCY BLOCK (${status})`);
          continue;
        }

        // ── TIER 1: ZERO ENERGY — PASS OUT ──────────────────────────────────
        // energy < 10 → character passes out at current location regardless of
        // toggle, stay-lock, schedule, or personality. Overrides everything
        // except hospitalization/jail.
        if (energyUrgency >= 4) {
          if (status !== 'passed_out') {
            const passOutPayload = {
              resolved_presence_status:   'passed_out',
              resolved_source_reason:     'energy_depleted_pass_out',
              energy_value:               0,
              last_arrived_time:          new Date().toISOString(),
            };
            try {
              await base44.entities.Character.update(char.id, passOutPayload);
            } catch {
              await base44.asServiceRole.entities.Character.update(char.id, passOutPayload);
            }
            moveLog.push(`${char.name}: PASSED OUT at ${char.resolved_current_location_name || 'current location'} [energy depleted]`);
            console.log(`[autonomousMovement] ⚠️ ${char.name}: PASSED OUT`);
          } else {
            console.log(`[autonomousMovement] ${char.name}: already passed_out — no change`);
          }
          continue;
        }

        // ── TIER 2: ALREADY PASSED OUT — RECOVERY ────────────────────────────
        // Character is passed out but energy > 10 (has recovered enough).
        // Route to home for full recovery. Overrides toggle.
        if (status === 'passed_out') {
          if (energyUrgency < 4 && char.current_home_location_id) {
            const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
            if (ownHome) {
              const recoveryPayload = {
                resolved_current_location_id:   ownHome.id,
                resolved_current_location_name: ownHome.name,
                resolved_presence_status:       'sleeping',
                resolved_location_type:         'home',
                resolved_source_reason:         'pass_out_recovery',
                last_arrived_time:              new Date().toISOString(),
              };
              try {
                await base44.entities.Character.update(char.id, recoveryPayload);
              } catch {
                await base44.asServiceRole.entities.Character.update(char.id, recoveryPayload);
              }
              moveLog.push(`${char.name} → ${ownHome.name} [PASS_OUT_RECOVERY]`);
              console.log(`[autonomousMovement] ✓ ${char.name}: recovering → ${ownHome.name}`);
            }
          }
          continue;
        }

        // ── TIER 3: SLEEP WINDOW ENFORCEMENT ────────────────────────────────
        // Character is in their sleep window. If already at the right sleep location → block further movement.
        // If NOT at a valid sleep location → FORCE return home. This overrides toggle, stay-lock, personality.
        const sleeping = isScheduledSleeping(char, nowET);
        const inPreSleep = isInPreSleepWindow(char, nowET);

        if (
          status === 'sleeping'                   ||
          status === 'napping'                     ||
          status === 'returning_home_for_sleep'    ||
          reason === 'sleep_return_home'           ||
          reason === 'sleep_location_correction'   ||
          reason === 'adaptive_sleep_location_lock' ||
          reason === 'adaptive_sleep_location_correction' ||
          reason === 'adaptive_pre_sleep_return'   ||
          reason === 'no_valid_sleep_location'
        ) {
          // ── WAKE CHECK: Recalculate adaptive sleep window right now ───────────
          // Do NOT trust the stored status as permanent. If the sleep window has ended,
          // wake the character and fall through to schedule/work/movement evaluation.
          const stillSleeping = isScheduledSleeping(char, nowET);
          if (!stillSleeping && (status === 'sleeping' || status === 'napping')) {
            const wakePayload = {
              resolved_presence_status:   'home',
              resolved_source_reason:     'adaptive_sleep_ended_wake',
              resolved_last_updated_at:   nowET.toISOString(),
            };
            try {
              await base44.entities.Character.update(char.id, wakePayload);
            } catch {
              await base44.asServiceRole.entities.Character.update(char.id, wakePayload);
            }
            console.log(`[autonomousMovement] ✓ ${char.name}: WOKE UP — sleep window ended, released to schedule/movement`);
            // Update char in memory so the rest of this loop iteration sees the new status
            char.resolved_presence_status = 'home';
            char.resolved_source_reason = 'adaptive_sleep_ended_wake';
            // Do NOT continue — fall through to schedule, work, travel, and movement evaluation
          } else {
            // Sleep window is still active (or it's a non-sleeping sleep-adjacent state) —
            // validate sleep location and hold.
            // Valid = current_home_location_id OR temporary_housing_location_id (explicit alternate sleep).
            // MUST NOT write home fields, residence fields, or location ownership. Presence fields only.
            const assignedHomeId     = char.current_home_location_id;
            const assignedSleepAltId = char.temporary_housing_location_id;
            const currentLocId       = char.resolved_current_location_id;

            const isAtHome     = assignedHomeId     && currentLocId === assignedHomeId;
            const isAtSleepAlt = assignedSleepAltId && currentLocId === assignedSleepAltId;

            if (isAtHome || isAtSleepAlt) {
              console.log(`[autonomousMovement] ${char.name}: SLEEP STATE valid (${reason || status})`);
              continue;
            }

            // Invalid sleep location — correct presence to assigned home or sleep alternate.
            const validSleepLocId = assignedHomeId || assignedSleepAltId;
            const validSleepLoc   = validSleepLocId ? userLocations.find(loc => loc.id === validSleepLocId) : null;

            if (!validSleepLoc) {
              const failMsg = `${char.name}: SLEEP_LOCATION_INVALID — current=${currentLocId || 'none'}, assigned_home=${assignedHomeId || 'MISSING'}, sleep_alt=${assignedSleepAltId || 'MISSING'} — needs housing assignment`;
              blockedLog.push(failMsg);
              console.warn(`[autonomousMovement] ⚠️ SLEEP_INVALID: ${failMsg}`);
              await base44.entities.Character.update(char.id, {
                resolved_source_reason:   'no_valid_sleep_location',
                resolved_presence_status: 'sleeping',
              }).catch(() => base44.asServiceRole.entities.Character.update(char.id, {
                resolved_source_reason: 'no_valid_sleep_location',
              }).catch(() => {}));
              continue;
            }

            const sleepCorrectionPayload = {
              resolved_current_location_id:   validSleepLoc.id,
              resolved_current_location_name: validSleepLoc.name,
              resolved_presence_status:       'sleeping',
              resolved_location_type:         validSleepLoc.id === assignedHomeId ? 'home' : 'temporary_housing',
              resolved_source_reason:         'sleep_location_correction',
              last_arrived_time:              new Date().toISOString(),
            };
            try {
              await base44.entities.Character.update(char.id, sleepCorrectionPayload);
            } catch {
              await base44.asServiceRole.entities.Character.update(char.id, sleepCorrectionPayload);
            }
            totalMoved++;
            moveLog.push(`${char.name} → ${validSleepLoc.name} [SLEEP_LOCATION_CORRECTION] was at invalid: ${currentLocId}`);
            console.log(`[autonomousMovement] ✓ ${char.name}: sleep correction → ${validSleepLoc.name} (was at invalid ${currentLocId})`);
            continue;
          }
        }

        if (sleeping || inPreSleep) {
          // Sleep window is active. Character must be at home or a valid sleep location.
          const homeId = char.current_home_location_id;
          const alreadyHome = homeId && char.resolved_current_location_id === homeId;
          if (!alreadyHome && homeId) {
            // Force return to sleep location — overrides toggle, stay-lock, wandering
            const sleepHome = userLocations.find(loc => loc.id === homeId);
            if (sleepHome) {
              const sleepReturnPayload = {
                resolved_current_location_id:   sleepHome.id,
                resolved_current_location_name: sleepHome.name,
                resolved_presence_status:       sleeping ? 'sleeping' : 'returning_home_for_sleep',
                resolved_location_type:         'home',
                resolved_source_reason:         sleeping ? 'adaptive_sleep_location_lock' : 'adaptive_pre_sleep_return',
                last_arrived_time:              new Date().toISOString(),
                presence_stay_lock:             false,
                presence_stay_lock_location_id: null,
              };
              try {
                await base44.entities.Character.update(char.id, sleepReturnPayload);
              } catch {
                await base44.asServiceRole.entities.Character.update(char.id, sleepReturnPayload);
              }
              totalMoved++;
              moveLog.push(`${char.name} → ${sleepHome.name} [SLEEP_ENFORCEMENT${sleeping ? '' : '_PRE_SLEEP'}]`);
              console.log(`[autonomousMovement] ✓ ${char.name}: sleep return → ${sleepHome.name}`);
            } else {
              blockedLog.push(`${char.name}: sleep time but home location not found (id=${homeId})`);
            }
          } else {
            console.log(`[autonomousMovement] ${char.name}: sleep window — already home`);
          }
          continue;
        }

        // ── TIER 3.5: ACTIVE WORK / SCHOOL DISPATCH ─────────────────────────
        // Runs immediately after sleep/wake evaluation, BEFORE energy or needs scoring.
        // If the character's actual schedule is active right now, send them to work/school.
        // This is the correct post-wake priority: schedule > needs.
        //
        // RULES:
        //   - Reads the character's actual fields: work_days, work_start_time, work_end_time,
        //     occupation_location_id, additional_occupation_locations, education_location_id
        //   - Does NOT hardcode 09:00–17:00
        //   - Respects work_exception_status === 'called_out' for today
        //   - If shift active AND character not already at work location → dispatch
        //   - If shift active AND character already there → preserve work_schedule reason + continue
        //   - If no shift active → fall through to existing tiers unchanged
        //
        // ENERGY RULE: Energy does NOT block work dispatch after a completed sleep window.
        // A character who just woke (adaptive_sleep_ended_wake) is considered awake-ready.
        // Energy is already at 100 for most characters after sleep; even if low it must not
        // prevent the character from going to work — energy-critical path (Tier 4) is below.
        {
          const todayET = nowET.toISOString().slice(0, 10); // YYYY-MM-DD in ET
          const nowMin  = nowET.getHours() * 60 + nowET.getMinutes();
          const dowNow  = nowET.getDay(); // 0=Sun, 6=Sat

          // ── WORK SCHEDULE CHECK ────────────────────────────────────────────
          // Use the character's actual stored fields — do not assume any defaults.
          let workDispatchDone = false;

          if (
            Array.isArray(char.work_days) && char.work_days.length > 0 &&
            char.work_start_time && char.work_end_time &&
            char.occupation_location_id
          ) {
            const isWorkDay = char.work_days.includes(dowNow);

            if (isWorkDay) {
              const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
              const shiftStart = toMin(char.work_start_time);
              const shiftEnd   = toMin(char.work_end_time);
              // Overnight shift support (e.g. 22:00–06:00)
              const isOvernightShift = shiftEnd < shiftStart;
              const shiftActiveNow   = isOvernightShift
                ? (nowMin >= shiftStart || nowMin < shiftEnd)
                : (nowMin >= shiftStart && nowMin < shiftEnd);

              if (shiftActiveNow) {
                // CALLOUT GUARD: skip if character has a valid callout for today
                const hasCallout = char.work_exception_status === 'called_out' &&
                                   char.work_exception_date === todayET;
                if (hasCallout) {
                  console.log(`[autonomousMovement] ${char.name}: WORK DISPATCH skipped — valid callout for ${todayET}`);
                } else {
                  // Resolve work location — check worker_shifts[char.id] on location record
                  // for per-character shift overrides. If none, use character-level schedule.
                  // Primary location: occupation_location_id. Additional locations checked
                  // only if they have an active per-character shift right now.
                  let activeWorkLocId = char.occupation_location_id;

                  // Check additional_occupation_locations for an alternate active shift
                  if (Array.isArray(char.additional_occupation_locations)) {
                    for (const entry of char.additional_occupation_locations) {
                      if (!entry.location_id) continue;
                      const altLoc = userLocations.find(l => l.id === entry.location_id);
                      if (!altLoc) continue;
                      // If this alternate location has a worker_shifts entry for this character,
                      // check if it is active right now — if so, it takes priority.
                      const altShift = altLoc.worker_shifts?.[char.id];
                      if (altShift && altShift.start && altShift.end) {
                        const altStart = toMin(altShift.start);
                        const altEnd   = toMin(altShift.end);
                        const altOvernight = altEnd < altStart;
                        const altActive = altOvernight
                          ? (nowMin >= altStart || nowMin < altEnd)
                          : (nowMin >= altStart && nowMin < altEnd);
                        if (altActive) {
                          // Also check day constraint on shift if present
                          const altDayOk = !Array.isArray(altShift.days) || altShift.days.length === 0 || altShift.days.includes(dowNow);
                          if (altDayOk) {
                            activeWorkLocId = entry.location_id;
                            break;
                          }
                        }
                      }
                    }
                  }

                  const workLoc = userLocations.find(l => l.id === activeWorkLocId);
                  if (!workLoc) {
                    console.warn(`[autonomousMovement] ${char.name}: WORK DISPATCH — shift active but work location id=${activeWorkLocId} not in user scope`);
                  } else if (char.resolved_current_location_id === workLoc.id) {
                    // Already at work — ensure source reason is correct and skip
                    if (char.resolved_source_reason !== 'work_schedule') {
                      try {
                        await base44.entities.Character.update(char.id, {
                          resolved_presence_status: 'at_work',
                          resolved_location_type:   'work',
                          resolved_source_reason:   'work_schedule',
                          resolved_last_updated_at: nowET.toISOString(),
                        });
                      } catch {
                        await base44.asServiceRole.entities.Character.update(char.id, {
                          resolved_presence_status: 'at_work',
                          resolved_location_type:   'work',
                          resolved_source_reason:   'work_schedule',
                          resolved_last_updated_at: nowET.toISOString(),
                        });
                      }
                    }
                    console.log(`[autonomousMovement] ${char.name}: WORK — already at ${workLoc.name}`);
                    workDispatchDone = true;
                  } else {
                    // Dispatch to work
                    const workPayload = {
                      resolved_current_location_id:   workLoc.id,
                      resolved_current_location_name: workLoc.name,
                      resolved_presence_status:       'at_work',
                      resolved_location_type:         'work',
                      resolved_source_reason:         'work_schedule',
                      resolved_last_updated_at:       nowET.toISOString(),
                      last_arrived_time:              nowET.toISOString(),
                      travel_status:                  'not_traveling',
                      travel_destination_location_id: null,
                    };
                    try {
                      await base44.entities.Character.update(char.id, workPayload);
                    } catch {
                      await base44.asServiceRole.entities.Character.update(char.id, workPayload);
                    }
                    totalMoved++;
                    moveLog.push(`${char.name} → ${workLoc.name} [WORK_SCHEDULE] shift: ${char.work_start_time}–${char.work_end_time}`);
                    console.log(`[autonomousMovement] ✓ ${char.name}: WORK DISPATCH → ${workLoc.name}`);
                    workDispatchDone = true;
                  }
                }
              }
            }
          }

          if (workDispatchDone) continue;

          // ── SCHOOL SCHEDULE CHECK ──────────────────────────────────────────
          // Only for enrolled students with an assigned education_location_id.
          // School hours use the standard 08:00–15:00 window (no stored override field).
          if (
            char.student_status === 'enrolled' &&
            char.education_location_id
          ) {
            const SCHOOL_START = 8 * 60;   // 08:00
            const SCHOOL_END   = 15 * 60;  // 15:00
            const schoolActiveNow = nowMin >= SCHOOL_START && nowMin < SCHOOL_END;

            if (schoolActiveNow) {
              const schoolLoc = userLocations.find(l => l.id === char.education_location_id);
              if (!schoolLoc) {
                console.warn(`[autonomousMovement] ${char.name}: SCHOOL DISPATCH — enrolled but location id=${char.education_location_id} not in user scope`);
              } else if (char.resolved_current_location_id === schoolLoc.id) {
                if (char.resolved_source_reason !== 'school_schedule') {
                  try {
                    await base44.entities.Character.update(char.id, {
                      resolved_presence_status: 'at_school',
                      resolved_location_type:   'school',
                      resolved_source_reason:   'school_schedule',
                      resolved_last_updated_at: nowET.toISOString(),
                    });
                  } catch {
                    await base44.asServiceRole.entities.Character.update(char.id, {
                      resolved_presence_status: 'at_school',
                      resolved_location_type:   'school',
                      resolved_source_reason:   'school_schedule',
                      resolved_last_updated_at: nowET.toISOString(),
                    });
                  }
                }
                console.log(`[autonomousMovement] ${char.name}: SCHOOL — already at ${schoolLoc.name}`);
                continue;
              } else {
                const schoolPayload = {
                  resolved_current_location_id:   schoolLoc.id,
                  resolved_current_location_name: schoolLoc.name,
                  resolved_presence_status:       'at_school',
                  resolved_location_type:         'school',
                  resolved_source_reason:         'school_schedule',
                  resolved_last_updated_at:       nowET.toISOString(),
                  last_arrived_time:              nowET.toISOString(),
                  travel_status:                  'not_traveling',
                  travel_destination_location_id: null,
                };
                try {
                  await base44.entities.Character.update(char.id, schoolPayload);
                } catch {
                  await base44.asServiceRole.entities.Character.update(char.id, schoolPayload);
                }
                totalMoved++;
                moveLog.push(`${char.name} → ${schoolLoc.name} [SCHOOL_SCHEDULE]`);
                console.log(`[autonomousMovement] ✓ ${char.name}: SCHOOL DISPATCH → ${schoolLoc.name}`);
                continue;
              }
            }
          }
        }
        // END TIER 3.5

        // ── TIER 4: CRITICAL ENERGY (< 25) — force home regardless of toggle ─
        // Not at pass-out level but critically low. Must go home NOW.
        // Overrides stay-lock and toggle.
        if (energyUrgency >= 3 && char.current_home_location_id) {
          const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
          if (ownHome && char.resolved_current_location_id !== ownHome.id) {
            const critPayload = {
              resolved_current_location_id:   ownHome.id,
              resolved_current_location_name: ownHome.name,
              resolved_presence_status:       'home',
              resolved_location_type:         'home',
              resolved_source_reason:         'energy_critical_return_home',
              last_arrived_time:              new Date().toISOString(),
              presence_stay_lock:             false,
              presence_stay_lock_location_id: null,
            };
            try {
              await base44.entities.Character.update(char.id, critPayload);
            } catch {
              await base44.asServiceRole.entities.Character.update(char.id, critPayload);
            }
            totalMoved++;
            moveLog.push(`${char.name} → ${ownHome.name} [ENERGY_CRITICAL] energy(${Math.round(vals.energy)})`);
            console.log(`[autonomousMovement] ✓ ${char.name}: critical energy → ${ownHome.name}`);
          } else if (ownHome) {
            console.log(`[autonomousMovement] ${char.name}: critical energy, already home`);
          }
          continue;
        }

        // ── TIER 5: PRESENCE STAY LOCK ────────────────────────────────────────
        // User explicitly chose STAY for this character at a scene exit.
        // Only checked AFTER sleep and energy-critical enforcement above.
        if (char.presence_stay_lock === true) {
          console.log(`[autonomousMovement] ${char.name}: STAY_LOCK active — skipping (locked at ${char.presence_stay_lock_location_id})`);
          skippedLog.push(`${char.name}: STAY_LOCK active`);
          continue;
        }

        // ── TIER 6: AUTONOMOUS TRAVEL TOGGLE ─────────────────────────────────
        // When OFF, only energy urgency >= 2 (< 50) or above triggers movement.
        // Sleep, pass-out, and critical energy are already handled above.
        const topNeedCheck = highestUrgencyEntry(vals);
        if (!autonomousTravelEnabled && topNeedCheck.urgency < 2) {
          skippedLog.push(`${char.name}: autonomous travel OFF, needs not urgent enough`);
          continue;
        }

        // ── HARD BLOCKS (schedule-based) ─────────────────────────────────────
        if (
          reason === 'work_schedule'   ||
          reason === 'school_schedule' ||
          reason === 'praying_at_home'
        ) {
          console.log(`[autonomousMovement] ${char.name}: HARD BLOCK (${reason || status})`);
          continue;
        }

        // ── READ FULL NEEDS + DECIDE IF MOVEMENT IS REQUIRED ─────────────────
        const top = highestUrgencyEntry(vals);

        let shouldAttempt = false;
        let isMandatory = false;

        if (top.urgency >= 2) {
          shouldAttempt = true;
          isMandatory = true;
        } else if (top.urgency === 1) {
          shouldAttempt = Math.random() < 0.50;
        } else {
          shouldAttempt = Math.random() < 0.25;
        }

        if (!shouldAttempt) {
          console.log(`[autonomousMovement] ${char.name}: needs OK, skipping`);
          skippedLog.push(`${char.name}: all needs OK`);
          continue;
        }

        // ── FILTER OUT CLOSED LOCATIONS ───────────────────────────────────────
        const openLocations = userLocations.filter(loc => isLocationOpen(loc));

        // ── LOW ENERGY (urgent, < 50) → route home before scoring ────────────
        if (energyUrgency >= 2 && char.current_home_location_id) {
          const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
          if (ownHome && char.resolved_current_location_id !== ownHome.id) {
            try {
              await base44.entities.Character.update(char.id, {
                resolved_current_location_id:   ownHome.id,
                resolved_current_location_name: ownHome.name,
                resolved_presence_status:       'home',
                resolved_location_type:         'home',
                resolved_source_reason:         'energy_low_return_home',
                last_arrived_time:              new Date().toISOString(),
              }).catch(() => base44.asServiceRole.entities.Character.update(char.id, {
                resolved_current_location_id:   ownHome.id,
                resolved_current_location_name: ownHome.name,
                resolved_presence_status:       'home',
                resolved_location_type:         'home',
                resolved_source_reason:         'energy_low_return_home',
                last_arrived_time:              new Date().toISOString(),
              }));
              totalMoved++;
              moveLog.push(`${char.name} → ${ownHome.name} [ENERGY_LOW_HOME] energy(${Math.round(vals.energy)})`);
              console.log(`[autonomousMovement] ✓ ${char.name} → ${ownHome.name} [ENERGY_LOW_HOME]`);
            } catch (e) {
              blockedLog.push(`${char.name}: energy home write failed — ${e.message}`);
            }
            continue;
          }
          if (ownHome && char.resolved_current_location_id === ownHome.id) {
            console.log(`[autonomousMovement] ${char.name}: low energy, already home`);
            continue;
          }
        }

        // ── SELECT BEST LOCATION ──────────────────────────────────────────────
        const bestLocation = selectBestLocation(openLocations, char, vals);

        if (!bestLocation) {
          const urgentNeeds = Object.entries(vals)
            .filter(([, v]) => urgencyLevel(v) >= 2)
            .map(([k, v]) => `${k}(${Math.round(v)})`)
            .join(', ');
          const msg = `${char.name}: URGENT [${urgentNeeds}] — NO valid location in scope`;
          blockedLog.push(msg);
          console.warn(`[autonomousMovement] BLOCK: ${msg}`);
          continue;
        }

        // ── ALREADY THERE — no-op ───────────────────────────────────────────
        if (char.resolved_current_location_id === bestLocation.id) {
          console.log(`[autonomousMovement] ${char.name}: already at ${bestLocation.name}`);
          continue;
        }

        // ── DECLARE finalLocation EARLY so correction lock and home protection can both assign it ──
        let finalLocation = bestLocation;

        // ── CORRECTION LOCK: Do not move character back to a recently-corrected-FROM location ──
        // If the character has a correction lock active and the destination matches the
        // location they were just corrected away from, block the move.
        if (char.location_correction_locked_until && char.location_correction_previous_id) {
          const lockUntil = new Date(char.location_correction_locked_until);
          if (nowET < lockUntil && finalLocation.id === char.location_correction_previous_id) {
            const msg = `${char.name}: CORRECTION_LOCK blocked return to "${finalLocation.name}" — lock expires ${lockUntil.toISOString()}`;
            blockedLog.push(msg);
            console.warn(`[autonomousMovement] CORRECTION_LOCK: ${msg}`);
            // Re-select excluding the locked location
            const nonLockedOpen = openLocations.filter(loc => loc.id !== char.location_correction_previous_id);
            const lockFallback = selectBestLocation(nonLockedOpen, char, vals);
            if (!lockFallback) {
              skippedLog.push(`${char.name}: correction lock active, no valid fallback`);
              continue;
            }
            finalLocation = lockFallback;
          }
        }

        // ── HOME WRITE PROTECTION ────────────────────────────────────────────
        // If the selected location is home-category but NOT this character's authoritative home,
        // that write is invalid. Re-select from non-home locations only.
        if (finalLocation.category === 'home' && finalLocation.id !== char.current_home_location_id) {
          console.warn(`[autonomousMovement] BLOCKED_INVALID_HOME_WRITE: ${char.name} → ${finalLocation.name} (not their home). Re-selecting.`);
          blockedLog.push(`${char.name}: BLOCKED_INVALID_HOME_WRITE — ${finalLocation.name} is not their authoritative home`);
          const nonHomeLocations = openLocations.filter(loc => loc.category !== 'home' && loc.category !== 'generic');
          const homeFallback = selectBestLocation(nonHomeLocations, char, vals);
          if (!homeFallback) {
            console.log(`[autonomousMovement] ${char.name}: no non-home fallback, skipping`);
            skippedLog.push(`${char.name}: blocked wrong home write, no non-home fallback`);
            continue;
          }
          finalLocation = homeFallback;
        }

        // ── MOVE ────────────────────────────────────────────────────────────
        try {
          const newStatus = finalLocation.category === 'home' ? 'home' : 'visiting';
          const updatePayload = {
            resolved_current_location_id:   finalLocation.id,
            resolved_current_location_name: finalLocation.name,
            resolved_presence_status:       newStatus,
            resolved_location_type:         finalLocation.category === 'home' ? 'home' : 'visit',
            resolved_source_reason:         'autonomous_needs_driven',
            last_arrived_time:              new Date().toISOString(),
            // Clear stale travel fields so nothing can override this move
            travel_destination_location_id: null,
            travel_status:                  'not_traveling',
            autonomous_destination_id:      null,
            autonomous_movement_status:     null,
          };
          try {
            await base44.entities.Character.update(char.id, updatePayload);
          } catch {
            await base44.asServiceRole.entities.Character.update(char.id, updatePayload);
          }

          totalMoved++;
          const urgentList = Object.entries(vals)
            .filter(([, v]) => urgencyLevel(v) >= 2)
            .map(([k, v]) => `${k}(${Math.round(v)})`)
            .join(', ') || `${top.key}(${Math.round(top.value)})`;
          const mandatory = isMandatory ? '[MANDATORY]' : '[optional]';
          const msg = `${char.name} → ${finalLocation.name} ${mandatory} needs: ${urgentList}`;
          moveLog.push(msg);
          console.log(`[autonomousMovement] ✓ ${msg}`);
        } catch (e) {
          console.error(`[autonomousMovement] Move FAILED for ${char.name}:`, e.message);
          blockedLog.push(`${char.name}: write failed — ${e.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      users_processed: Object.keys(byUser).length,
      characters_moved: totalMoved,
      moves: moveLog,
      blocked_with_reason: blockedLog,
      skipped: skippedLog.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[autonomousMovement]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});