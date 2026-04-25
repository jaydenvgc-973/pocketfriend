import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AUTONOMOUS CHARACTER MOVEMENT TRIGGER
 *
 * Fires on schedule to evaluate each active_created_character's needs state
 * and move them to appropriate locations without user prompting.
 *
 * SCOPE: Per-user isolation. Each user's characters evaluated separately.
 *
 * LOGIC:
 * 1. Discover all active_created_character (owner_email scoped)
 * 2. Exclude test/diagnostic/excluded characters
 * 3. Skip sleep, work, school, or medical blocks
 * 4. Evaluate needs state (hunger, energy, social, health, mental, comfort)
 * 5. Load available locations for the user
 * 6. Score locations based on character identity + current needs
 * 7. Select best location
 * 8. If different from current location, move character
 * 9. Update resolved_current_location_id + presence_status
 */

const BANDS = [
  { label: 'critical', min: 0,  max: 19  },
  { label: 'low',      min: 20, max: 39  },
  { label: 'reduced',  min: 40, max: 59  },
  { label: 'stable',   min: 60, max: 79  },
  { label: 'strong',   min: 80, max: 100 },
];

function getNeedBand(value) {
  const v = Math.max(0, Math.min(100, value ?? 70));
  return BANDS.find(b => v >= b.min && v <= b.max)?.label ?? 'stable';
}

function getNeedStates(character) {
  return {
    hunger:    getNeedBand(character.hunger_value),
    energy:    getNeedBand(character.energy_value),
    social:    getNeedBand(character.social_value),
    health:    getNeedBand(character.health_value),
    mental:    getNeedBand(character.mental_value),
    financial: getNeedBand(character.financial_need_value),
    hygiene:   getNeedBand(character.hygiene_value),
    comfort:   getNeedBand(character.comfort_value),
  };
}

// Simple location ranking: prefer locations matching character's current needs + social energy
function scoreLocationForNeeds(location, character, needs) {
  let score = 0;
  const category = location.category || 'generic';
  const socialEnergy = character.social_energy || 'ambivert';

  // Critical/low hunger → food_drink, grocery
  if ((needs.hunger === 'critical' || needs.hunger === 'low') && 
      (category === 'food_drink' || category === 'grocery')) {
    score += 5;
  }

  // Critical/low energy → home
  if ((needs.energy === 'critical' || needs.energy === 'low') && 
      category === 'home') {
    score += 4;
  }

  // Critical/low social → social, food_drink, outdoor (if not introvert)
  if ((needs.social === 'critical' || needs.social === 'low') && 
      (category === 'social' || category === 'food_drink' || category === 'outdoor')) {
    if (!['introvert', 'mostly_introvert'].includes(socialEnergy)) {
      score += 4;
    }
  }

  // Critical/low health → medical
  if ((needs.health === 'critical' || needs.health === 'low') && 
      category === 'medical') {
    score += 5;
  }

  // High stress/low mental → gym, outdoor, home
  if ((needs.mental === 'critical' || needs.mental === 'low') && 
      (category === 'gym' || category === 'outdoor' || category === 'home')) {
    score += 3;
  }

  // Low comfort → outdoor, social (change of scenery)
  if ((needs.comfort === 'critical' || needs.comfort === 'low') && 
      (category === 'outdoor' || category === 'social')) {
    score += 2;
  }

  // Introvert low social → home, outdoor (quiet)
  if ((needs.social === 'critical' || needs.social === 'low') && 
      ['introvert', 'mostly_introvert'].includes(socialEnergy) &&
      (category === 'home' || category === 'outdoor')) {
    score += 3;
  }

  // Base social energy preference
  const extrovertPref = ['social', 'food_drink', 'gym', 'outdoor'];
  const introvertPref = ['home', 'outdoor'];
  const ambivPref = ['food_drink', 'outdoor', 'social', 'gym', 'home'];

  if (socialEnergy === 'extrovert' && extrovertPref.includes(category)) score += 1;
  else if (['introvert', 'mostly_introvert'].includes(socialEnergy) && introvertPref.includes(category)) score += 1;
  else if (socialEnergy === 'ambivert' && ambivPref.includes(category)) score += 1;

  return score;
}

function selectBestLocation(locations, character, needs) {
  if (!locations || locations.length === 0) return null;

  const scored = locations.map(loc => ({
    location: loc,
    score: scoreLocationForNeeds(loc, character, needs),
  }))
  .filter(s => s.score >= 0)
  .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // Fallback: home location
    const home = locations.find(l => l.category === 'home');
    return home || locations[0];
  }

  // Weighted random from top 3 to avoid robotics
  const top = scored.slice(0, Math.min(3, scored.length));
  const weights = top.length === 1 ? [1] : top.length === 2 ? [0.65, 0.35] : [0.50, 0.30, 0.20];
  
  const roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < top.length; i++) {
    cumulative += weights[i] || 0;
    if (roll <= cumulative) return top[i].location;
  }
  
  return top[0].location;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let callerEmail = null;
    try {
      const me = await base44.auth.me();
      callerEmail = me?.email || null;
    } catch { /* scheduled — no user session */ }

    // ── DISCOVER ALL ACTIVE CREATED CHARACTERS (user-scoped) ──────────────────
    const characters = await base44.entities.Character.filter({
      character_type: 'active_created_character',
    });

    const eligible = characters.filter(c =>
      c.owner_email && // STRICT: owner_email required
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'moved_away' &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.exclude_from_homepage &&
      c.current_home_location_id // Must have a home base
    );

    console.log(`[autonomousMovement] Eligible characters: ${eligible.length}`);

    // ── GROUP BY USER (owner_email) ────────────────────────────────────────────
    const byUser = {};
    for (const c of eligible) {
      if (!byUser[c.owner_email]) byUser[c.owner_email] = [];
      byUser[c.owner_email].push(c);
    }

    let totalMoved = 0;
    const moveLog = [];

    // ── PROCESS EACH USER'S CHARACTER SET ──────────────────────────────────────
    for (const [userEmail, userChars] of Object.entries(byUser)) {
      console.log(`[autonomousMovement] Processing user ${userEmail}: ${userChars.length} characters`);

      // Load this user's locations once (owner_email scoped)
      let userLocations = [];
      try {
        userLocations = await base44.entities.LocationReference.filter({
          owner_email: userEmail,
        });
      } catch (e) {
        console.warn(`[autonomousMovement] Failed to load locations for ${userEmail}:`, e.message);
        continue;
      }

      // ── EVALUATE EACH CHARACTER ────────────────────────────────────────────
      for (const char of userChars) {
        // SKIP: Sleep, work, school, medical, prayer, jailing
        const reason = char.resolved_source_reason || '';
        const status = char.resolved_presence_status || '';
        
        const isBlocked = 
          status === 'sleeping' ||
          status === 'napping' ||
          reason === 'work_schedule' ||
          reason === 'school_schedule' ||
          reason === 'praying_at_home' ||
          reason === 'medical_need' ||
          char.is_jailed;

        if (isBlocked) {
          console.log(`[autonomousMovement] ${char.name}: BLOCKED (${reason || status})`);
          continue;
        }

        // EVALUATE NEEDS STATE
        const needs = getNeedStates(char);
        
        // SKIP: If all needs are strong/stable, no autonomy trigger
        const criticalNeeds = Object.values(needs).filter(n => n === 'critical' || n === 'low').length;
        if (criticalNeeds === 0) {
          console.log(`[autonomousMovement] ${char.name}: No critical needs, staying put`);
          continue;
        }

        // SELECT BEST LOCATION
        const bestLocation = selectBestLocation(userLocations, char, needs);
        if (!bestLocation) {
          console.log(`[autonomousMovement] ${char.name}: No valid location available`);
          continue;
        }

        // CHECK: Is this a different location?
        const currentLocId = char.resolved_current_location_id;
        const newLocId = bestLocation.id;

        if (currentLocId === newLocId) {
          console.log(`[autonomousMovement] ${char.name}: Already at ${bestLocation.name}`);
          continue;
        }

        // MOVE: Update character location
        try {
          const newStatus = bestLocation.category === 'home' ? 'home' : 'visiting';
          await base44.entities.Character.update(char.id, {
            resolved_current_location_id: newLocId,
            resolved_current_location_name: bestLocation.name,
            resolved_presence_status: newStatus,
            resolved_location_type: bestLocation.category,
            resolved_source_reason: 'autonomous_needs_driven',
            resolved_last_updated_at: new Date().toISOString(),
          });

          totalMoved++;
          const criticalList = Object.entries(needs)
            .filter(([, v]) => v === 'critical' || v === 'low')
            .map(([k]) => k)
            .join(', ');
          const msg = `${char.name} → ${bestLocation.name} (needs: ${criticalList})`;
          moveLog.push(msg);
          console.log(`[autonomousMovement] ✓ ${msg}`);
        } catch (e) {
          console.error(`[autonomousMovement] Failed to move ${char.name}:`, e.message);
        }
      }
    }

    return Response.json({
      success: true,
      users_processed: Object.keys(byUser).length,
      characters_moved: totalMoved,
      moves: moveLog,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[autonomousMovement]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});