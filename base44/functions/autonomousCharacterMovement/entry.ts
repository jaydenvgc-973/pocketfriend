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

      for (const char of userChars) {
        const status = char.resolved_presence_status || '';
        const reason = char.resolved_source_reason || '';

        // ── PROVEN HARD BLOCKS ──────────────────────────────────────────────
        if (
          status === 'sleeping'   ||
          status === 'napping'    ||
          status === 'passed_out' ||
          status === 'hospitalized' ||
          reason === 'work_schedule'   ||
          reason === 'school_schedule' ||
          reason === 'praying_at_home' ||
          char.is_jailed
        ) {
          console.log(`[autonomousMovement] ${char.name}: HARD BLOCK (${reason || status})`);
          continue;
        }

        // ── READ RAW NEED VALUES ────────────────────────────────────────────
        const vals = needValues(char);
        const top = highestUrgencyEntry(vals);

        // ── DECIDE IF MOVEMENT IS REQUIRED ─────────────────────────────────
        // < 50 on any need = mandatory. 50-70 = probabilistic. > 70 = skip/rare.
        let shouldAttempt = false;
        let isMandatory = false;

        if (top.urgency >= 2) {
          // Below 50 on at least one need — MANDATORY
          shouldAttempt = true;
          isMandatory = true;
        } else if (top.urgency === 1) {
          // 50–70 awareness window — 50% chance to evaluate
          shouldAttempt = Math.random() < 0.50;
        } else {
          // All needs above 70 — 25% chance for personality-driven optional movement
          shouldAttempt = Math.random() < 0.25;
        }

        if (!shouldAttempt) {
          console.log(`[autonomousMovement] ${char.name}: needs OK, skipping`);
          skippedLog.push(`${char.name}: all needs OK`);
          continue;
        }

        // ── FILTER OUT CLOSED LOCATIONS ─────────────────────────────────────
        const openLocations = userLocations.filter(loc => isLocationOpen(loc));

        // ── SELECT BEST LOCATION ────────────────────────────────────────────
        const bestLocation = selectBestLocation(openLocations, char, vals);

        if (!bestLocation) {
          // SYSTEM MUST REPORT: mandatory trigger, no valid location
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

        // ── HOME WRITE PROTECTION ────────────────────────────────────────────
        // If the best location is home-category but NOT this character's authoritative home,
        // that write is invalid. Re-select from non-home locations only.
        let finalLocation = bestLocation;
        if (bestLocation.category === 'home' && bestLocation.id !== char.current_home_location_id) {
          console.warn(`[autonomousMovement] BLOCKED_INVALID_HOME_WRITE: ${char.name} → ${bestLocation.name} (not their home). Re-selecting.`);
          blockedLog.push(`${char.name}: BLOCKED_INVALID_HOME_WRITE — ${bestLocation.name} is not their authoritative home`);
          const nonHomeLocations = openLocations.filter(loc => loc.category !== 'home' && loc.category !== 'generic');
          const fallback = selectBestLocation(nonHomeLocations, char, vals);
          if (!fallback) {
            console.log(`[autonomousMovement] ${char.name}: no non-home fallback, skipping`);
            skippedLog.push(`${char.name}: blocked wrong home write, no non-home fallback`);
            continue;
          }
          if (fallback.score <= 0) {
            skippedLog.push(`${char.name}: no positive-scoring non-home location`);
            continue;
          }
          finalLocation = fallback;
        }

        // ── MOVE ────────────────────────────────────────────────────────────
        try {
          const newStatus = finalLocation.category === 'home' ? 'home' : 'visiting';
          const updatePayload = {
            resolved_current_location_id:   finalLocation.id,
            resolved_current_location_name: finalLocation.name,
            resolved_presence_status:       newStatus,
            resolved_location_type:         finalLocation.category,
            resolved_source_reason:         'autonomous_needs_driven',
            resolved_last_updated_at:       new Date().toISOString(),
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