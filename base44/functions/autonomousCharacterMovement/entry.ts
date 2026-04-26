import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AUTONOMOUS CHARACTER MOVEMENT TRIGGER
 *
 * THRESHOLD RULE (internal urgency, not UI label):
 *   > 70   → no urgency, optional movement only
 *   50–70  → awareness, begin evaluating
 *   < 50   → URGENT: must attempt movement
 *   < 25   → HIGH URGENCY: strong prioritization
 *   < 10   → EMERGENCY: forced/critical response
 *
 * Blocking a movement below 50 requires a proven reason.
 * Silent skipping is a system failure.
 */

// ── RAW VALUE READERS ──────────────────────────────────────────────────────────
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

// ── URGENCY LEVEL (internal behavior driver) ───────────────────────────────────
// Returns: 0 = none, 1 = awareness, 2 = urgent, 3 = high urgency, 4 = emergency
function urgencyLevel(value) {
  if (value < 10) return 4; // emergency
  if (value < 25) return 3; // high urgency
  if (value < 50) return 2; // urgent — movement required
  if (value < 70) return 1; // awareness — start evaluating
  return 0;                 // no urgency
}

// ── LOCATION SCORER ────────────────────────────────────────────────────────────
// Scores a location based on raw need values + urgency.
// Higher urgency = larger score differential between correct and wrong venues.
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
    if (cat === 'home')       score += 1; // cook at home
  }

  // ENERGY → rest at home (low energy → home; critical energy → forced home)
  if (energyU >= 2) {
    if (cat === 'home') score += 3 + energyU * 2;
    // Gym drains energy — penalize if energy is low
    if (cat === 'gym')  score -= energyU;
  }

  // SOCIAL → go out (extrovert/ambivert); quiet for introverts
  if (socialU >= 2) {
    const isIntrovert = ['introvert', 'mostly_introvert'].includes(se);
    if (isIntrovert) {
      if (cat === 'outdoor' || cat === 'home') score += 2 + socialU;
    } else {
      if (cat === 'social' || cat === 'food_drink') score += 3 + socialU * 2;
      if (cat === 'outdoor' || cat === 'gym')       score += 2 + socialU;
    }
  }

  // HEALTH → medical care
  if (healthU >= 2) {
    if (cat === 'medical')  score += 4 + healthU * 3; // scales hard with urgency
    if (cat === 'home')     score += 1 + healthU;     // rest helps mildly
    if (cat === 'gym')      score -= healthU * 2;     // avoid gym when sick
    if (cat === 'social')   score -= healthU;         // avoid crowds when sick
  }

  // MENTAL / STRESS → calm environments
  if (mentalU >= 2) {
    if (cat === 'outdoor' || cat === 'home' || cat === 'religion') score += 2 + mentalU;
    if (cat === 'gym')    score += 1 + mentalU; // exercise helps stress
    if (cat === 'social') score -= (mentalU > 2 ? 1 : 0); // crowded = more stress if very low
  }

  // HYGIENE → home to freshen up
  if (hygieneU >= 2) {
    if (cat === 'home') score += 2 + hygieneU;
  }

  // COMFORT → change of scenery
  if (comfortU >= 2) {
    if (cat === 'outdoor' || cat === 'food_drink') score += 1 + comfortU;
    // Don't stay home if comfort is low — that's the problem
    if (cat === 'home') score -= 1;
  }

  // BASE SOCIAL ENERGY PREFERENCE (minor baseline, overridden by urgent needs)
  if (se === 'extrovert' && ['social', 'food_drink', 'outdoor'].includes(cat)) score += 1;
  if (['introvert', 'mostly_introvert'].includes(se) && ['home', 'outdoor'].includes(cat)) score += 1;
  if (se === 'ambivert') score += 0; // neutral

  return score;
}

// ── LOCATION SELECTOR ─────────────────────────────────────────────────────────
function selectBestLocation(locations, char, vals) {
  if (!locations || locations.length === 0) return null;

  const scored = locations
    .map(loc => ({ location: loc, score: scoreLocation(loc, char, vals) }))
    .sort((a, b) => b.score - a.score);

  // Require a minimum positive score — don't move just to move
  const positives = scored.filter(s => s.score > 0);
  if (positives.length === 0) return null;

  // Weighted random from top 3 to avoid robotics
  const top = positives.slice(0, Math.min(3, positives.length));
  const weights = top.length === 1 ? [1] : top.length === 2 ? [0.65, 0.35] : [0.50, 0.30, 0.20];
  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < top.length; i++) {
    cumulative += weights[i] || 0;
    if (roll <= cumulative) return top[i].location;
  }
  return top[0].location;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled — no session */ }

    // Load all active_created_character
    const characters = await base44.entities.Character.filter({
      character_type: 'active_created_character',
    });

    const eligible = characters.filter(c =>
      c.owner_email &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'moved_away' &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.exclude_from_homepage &&
      c.current_home_location_id
    );

    console.log(`[autonomousMovement] Eligible: ${eligible.length}`);

    // Group by owner_email
    const byUser = {};
    for (const c of eligible) {
      if (!byUser[c.owner_email]) byUser[c.owner_email] = [];
      byUser[c.owner_email].push(c);
    }

    let totalMoved = 0;
    const moveLog = [];
    const skippedLog = [];

    for (const [userEmail, userChars] of Object.entries(byUser)) {
      let userLocations = [];
      try {
        userLocations = await base44.entities.LocationReference.filter({ owner_email: userEmail });
      } catch (e) {
        console.warn(`[autonomousMovement] Location load failed for ${userEmail}:`, e.message);
        continue;
      }

      for (const char of userChars) {
        const status = char.resolved_presence_status || '';
        const reason = char.resolved_source_reason || '';

        // ── HARD BLOCKS: proven physical constraints ────────────────────────
        const isBlocked =
          status === 'sleeping' ||
          status === 'napping'  ||
          reason === 'work_schedule'   ||
          reason === 'school_schedule' ||
          reason === 'praying_at_home' ||
          char.is_jailed;

        if (isBlocked) {
          console.log(`[autonomousMovement] ${char.name}: BLOCKED (${reason || status})`);
          continue;
        }

        // ── READ RAW NEED VALUES ────────────────────────────────────────────
        const vals = needValues(char);

        // ── CHECK URGENCY: any need below 50 = urgent action required ──────
        const urgentNeeds = Object.entries(vals).filter(([, v]) => urgencyLevel(v) >= 2);

        if (urgentNeeds.length === 0) {
          // No need below 50 — no mandatory movement
          // Optional: still allow movement for awareness-level needs (50–70) sometimes
          const awarenessNeeds = Object.entries(vals).filter(([, v]) => urgencyLevel(v) === 1);
          if (awarenessNeeds.length === 0 || Math.random() > 0.25) {
            console.log(`[autonomousMovement] ${char.name}: All needs OK, skipping`);
            continue;
          }
        }

        // ── SELECT BEST LOCATION ────────────────────────────────────────────
        const bestLocation = selectBestLocation(userLocations, char, vals);

        if (!bestLocation) {
          // SYSTEM: Log this as a proven block (no valid locations)
          const msg = `${char.name}: URGENT needs (${urgentNeeds.map(([k]) => k).join(', ')}) but NO valid location found`;
          skippedLog.push(msg);
          console.warn(`[autonomousMovement] ${msg}`);
          continue;
        }

        // ── ALREADY THERE? ──────────────────────────────────────────────────
        if (char.resolved_current_location_id === bestLocation.id) {
          console.log(`[autonomousMovement] ${char.name}: Already at ${bestLocation.name}`);
          continue;
        }

        // ── MOVE ────────────────────────────────────────────────────────────
        try {
          const newStatus = bestLocation.category === 'home' ? 'home' : 'visiting';
          await base44.entities.Character.update(char.id, {
            resolved_current_location_id:   bestLocation.id,
            resolved_current_location_name: bestLocation.name,
            resolved_presence_status:       newStatus,
            resolved_location_type:         bestLocation.category,
            resolved_source_reason:         'autonomous_needs_driven',
            resolved_last_updated_at:       new Date().toISOString(),
          });

          totalMoved++;
          const urgentList = urgentNeeds.map(([k, v]) => `${k}(${Math.round(v)})`).join(', ');
          const msg = `${char.name} → ${bestLocation.name} [urgent: ${urgentList}]`;
          moveLog.push(msg);
          console.log(`[autonomousMovement] ✓ ${msg}`);
        } catch (e) {
          console.error(`[autonomousMovement] Move failed for ${char.name}:`, e.message);
        }
      }
    }

    return Response.json({
      success: true,
      users_processed: Object.keys(byUser).length,
      characters_moved: totalMoved,
      moves: moveLog,
      blocked_with_reason: skippedLog,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[autonomousMovement]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});