import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * simulateActiveCharacterNeeds
 *
 * Runs elapsed-time needs simulation ONLY for Active Created Characters.
 * NPCs (npc, family_npc, background, promoted_npc) are explicitly excluded.
 *
 * Can be called:
 *  - By a scheduled automation (no payload — processes all active characters)
 *  - By the UI on profile load (payload: { characterId } — processes one character)
 */

const clamp = (v) => Math.max(0, Math.min(100, v));

// Per-hour decay/gain rates per need per context
const RATES = {
  // [hunger_per_hr, energy_per_hr, social_per_hr, health_per_hr, mental_per_hr, hygiene_per_hr, comfort_per_hr]
  sleeping:        { hunger: -1,  energy: +12, social: -0.5, health: +0.5, mental: +3,  hygiene: 0,   comfort: +4  },
  at_work:         { hunger: -4,  energy: -5,  social: +1,   health: -0.5, mental: -2,  hygiene: -2,  comfort: -2  },
  at_work_medical: { hunger: -5,  energy: -7,  social: -1,   health: -0.5, mental: -4,  hygiene: -3,  comfort: -4  }, // hospitals/ER: high stress
  at_work_service: { hunger: -5,  energy: -6,  social: +2,   health: -1,   mental: -3,  hygiene: -3,  comfort: -3  }, // bars/restaurants: physical + social
  at_work_office:  { hunger: -3,  energy: -4,  social: +1,   health: -0.5, mental: -2,  hygiene: -1,  comfort: -1  }, // office: moderate
  work_off_shift:  { hunger: -3,  energy: -3,  social: -1,   health: -0.5, mental: -3,  hygiene: -2,  comfort: -4  }, // lingering at work: no purpose, draining
  at_school:       { hunger: -3,  energy: -4,  social: +2,   health: -0.5, mental: -1,  hygiene: -1,  comfort: -1  },
  gym:             { hunger: -6,  energy: -7,  social: +1,   health: +1,   mental: +1,  hygiene: -5,  comfort: -2  },
  bar_club:        { hunger: -2,  energy: -4,  social: +5,   health: -1,   mental: +1,  hygiene: -1,  comfort: -1  },
  home_resting:    { hunger: -1,  energy: +3,  social: -1,   health: +0.5, mental: +1,  hygiene: 0,   comfort: +3  },
  home_active:     { hunger: -2,  energy: -1,  social: -1,   health: 0,    mental: 0,   hygiene: -0.5,comfort: +1  },
  hospital:        { hunger: -1,  energy: +2,  social: -1,   health: +3,   mental: -1,  hygiene: 0,   comfort: +1  },
  food_drink:      { hunger: +15, energy: +2,  social: +1,   health: +0.5, mental: +1,  hygiene: 0,   comfort: +2  },
  social_out:      { hunger: -2,  energy: -3,  social: +4,   health: 0,    mental: +1,  hygiene: -1,  comfort: -0.5},
  traveling:       { hunger: -3,  energy: -3,  social: -1,   health: 0,    mental: -1,  hygiene: -2,  comfort: -3  },
  eating:          { hunger: +15, energy: +2,  social: +1,   health: +0.5, mental: +1,  hygiene: 0,   comfort: +2  },
  resting:         { hunger: -1,  energy: +6,  social: -0.5, health: +1,   mental: +2,  hygiene: 0,   comfort: +3  },
  default:         { hunger: -2,  energy: -2,  social: -1,   health: 0,    mental: -0.5,hygiene: -1,  comfort: -1  },
};

// Determine if character is currently on shift at a given location
function isOnShift(character) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) return false;
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const [startH, startM = 0] = character.work_start_time.split(':').map(Number);
  const [endH, endM = 0] = character.work_end_time.split(':').map(Number);
  return character.work_days.includes(dayOfWeek) &&
    currentMins >= startH * 60 + startM &&
    currentMins < endH * 60 + endM;
}

function getLocationContext(character, locationMap) {
  // Proactive activity overrides — character is actively doing something to meet a need
  const activity = (character.current_activity || '').toLowerCase();
  if (activity.includes('eat') || activity.includes('food') || activity.includes('cook') || activity.includes('meal') || activity.includes('lunch') || activity.includes('dinner') || activity.includes('breakfast') || activity.includes('snack')) return 'eating';
  if (activity.includes('rest') || activity.includes('nap') || activity.includes('relax')) return 'resting';

  const locId = character.resolved_current_location_id;
  if (!locId) {
    const presenceStatus = character.resolved_presence_status;
    if (presenceStatus === 'sleeping' || presenceStatus === 'napping') return 'sleeping';
    return 'default';
  }
  const loc = locationMap[locId];
  if (!loc) return 'default';

  const presenceStatus = character.resolved_presence_status;
  if (presenceStatus === 'sleeping' || presenceStatus === 'napping') return 'sleeping';

  // Work context: differentiate by job type AND shift status
  const workLocId = character.current_work_location_id || character.occupation_location_id;
  if (locId === workLocId) {
    if (!isOnShift(character)) {
      // Character is lingering at work after shift — location fatigue kicks in
      return 'work_off_shift';
    }
    // On shift — differentiate by job type for realistic work stress
    const cat = (loc.category || '').toLowerCase();
    const name = (loc.name || '').toLowerCase();
    if (cat === 'medical' || name.includes('hospital') || name.includes('clinic') || name.includes('emergency')) return 'at_work_medical';
    if (cat === 'food_drink' || name.includes('bar') || name.includes('restaurant') || name.includes('cafe') || name.includes('diner')) return 'at_work_service';
    return 'at_work_office'; // default office/generic work
  }

  if (presenceStatus === 'at_school') return 'at_school';

  const cat = (loc.category || '').toLowerCase();
  const name = (loc.name || '').toLowerCase();

  if (cat === 'gym') return 'gym';
  if (cat === 'medical') return 'hospital';
  if (cat === 'food_drink' || name.includes('restaurant') || name.includes('cafe') || name.includes('diner') || name.includes('kitchen')) return 'food_drink';
  if (cat === 'social' || name.includes('bar') || name.includes('club') || name.includes('lounge') || name.includes('nightclub')) return 'bar_club';
  if (cat === 'outdoor') return 'social_out';
  if (cat === 'home') {
    if (presenceStatus === 'home') return 'home_resting';
    return 'home_active';
  }
  if (character.travel_status && character.travel_status !== 'not_traveling') return 'traveling';
  return 'default';
}

function applyElapsedTime(needs, elapsedHours, context) {
  const rates = RATES[context] || RATES.default;
  return {
    hunger:         clamp((needs.hunger         ?? 70) + rates.hunger         * elapsedHours),
    energy:         clamp((needs.energy         ?? 75) + rates.energy         * elapsedHours),
    social:         clamp((needs.social         ?? 65) + rates.social         * elapsedHours),
    health:         clamp((needs.health         ?? 80) + rates.health         * elapsedHours),
    mental:         clamp((needs.mental         ?? 70) + rates.mental         * elapsedHours),
    hygiene:        clamp((needs.hygiene        ?? 75) + rates.hygiene        * elapsedHours),
    comfort:        clamp((needs.comfort        ?? 70) + rates.comfort        * elapsedHours),
  };
}

// Health and comfort degrade when hunger is critical (< 20)
// Also degrades when multiple other needs are critically low
function applyHealthDegradation(needs) {
  // Hunger critical: directly impacts health and comfort
  if (needs.hunger < 20) {
    const severity = (20 - needs.hunger) / 20; // 0 to 1, higher = worse
    needs.health  = clamp(needs.health  - 1.5 * severity);
    needs.comfort = clamp(needs.comfort - 1.0 * severity);
    needs.energy  = clamp(needs.energy  - 0.5 * severity);
  }
  // Multiple critical needs also hurt health
  const criticalCount = [needs.hunger, needs.energy, needs.mental, needs.hygiene, needs.comfort]
    .filter(v => v < 20).length;
  if (criticalCount >= 3) {
    needs.health = clamp(needs.health - 0.5);
  }
  return needs;
}

// Financial need reflects actual balance — lower balance = lower financial_need_value
function deriveFinancialNeed(character) {
  // We don't change financial_need_value here since it comes from money events
  // Just preserve whatever is stored; payday/spending functions own this value
  return character.financial_need_value ?? 60;
}

function getNeedsFromCharacter(char) {
  return {
    hunger:   char.hunger_value   ?? null,
    energy:   char.energy_value   ?? null,
    social:   char.social_value   ?? null,
    health:   char.health_value   ?? null,
    mental:   char.mental_value   ?? null,
    hygiene:  char.hygiene_value  ?? null,
    comfort:  char.comfort_value  ?? null,
  };
}

function needsAreUninitialized(needs) {
  // If all values are null (never set), we need to initialize
  return Object.values(needs).every(v => v === null);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}

    const { characterId } = payload;

    // Determine if we're in service-role mode (scheduled) or user mode (UI call)
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}

    const sdk = user ? base44 : base44.asServiceRole;

    // Load locations for context detection
    const allLocations = await sdk.entities.LocationReference.list();
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    let characters = [];
    if (characterId) {
      // Single character mode (called from profile UI)
      const found = await sdk.entities.Character.filter({ id: characterId });
      characters = found.filter(c => c.character_type === 'active' && c.status === 'active');
    } else {
      // Batch mode (scheduled automation) — all active characters across all users
      const all = await base44.asServiceRole.entities.Character.list('-updated_date', 200);
      characters = all.filter(c => c.character_type === 'active' && c.status === 'active');
    }

    const now = new Date();
    const updates = [];

    for (const char of characters) {
      const lastSimulated = char.last_need_simulated_at ? new Date(char.last_need_simulated_at) : null;
      const currentNeeds = getNeedsFromCharacter(char);
      const isUninitialized = !char.needs_initialized || needsAreUninitialized(currentNeeds);

      // Initialize if never set before
      if (isUninitialized) {
        // Randomize starting values slightly so they don't all look the same
        const seed = char.name.charCodeAt(0) || 65;
        const base = updates.length;
        const initialNeeds = {
          hunger_value:       clamp(65 + ((seed + base * 7) % 20) - 10),
          energy_value:       clamp(70 + ((seed + base * 11) % 20) - 10),
          social_value:       clamp(60 + ((seed + base * 13) % 30) - 15),
          health_value:       clamp(78 + ((seed + base * 5) % 14) - 7),
          mental_value:       clamp(68 + ((seed + base * 9) % 20) - 10),
          financial_need_value: char.financial_need_value ?? 60,
          hygiene_value:      clamp(72 + ((seed + base * 17) % 16) - 8),
          comfort_value:      clamp(68 + ((seed + base * 3) % 20) - 10),
          last_need_simulated_at: now.toISOString(),
          needs_initialized: true,
        };
        updates.push({ id: char.id, data: initialNeeds, action: 'initialized' });
        continue;
      }

      // Elapsed time recovery
      if (!lastSimulated) {
        // Never simulated but initialized — set baseline now
        updates.push({
          id: char.id,
          data: { last_need_simulated_at: now.toISOString() },
          action: 'timestamp_set'
        });
        continue;
      }

      const elapsedMs = now.getTime() - lastSimulated.getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      // Cap elapsed time at 24 hours to prevent runaway decay
      const cappedHours = Math.min(elapsedHours, 24);

      // Skip if less than 3 minutes have passed (avoid micro-updates)
      if (elapsedMs < 3 * 60 * 1000) {
        updates.push({ id: char.id, data: null, action: 'skipped_too_soon' });
        continue;
      }

      // Proactive need resolution: if a need is critical (<20) or low (<50),
      // inject a corrective activity into current_activity so the context picks it up.
      // This simulates the character autonomously addressing their needs.
      let proactiveActivity = null;
      const hunger = currentNeeds.hunger ?? 70;
      const energy = currentNeeds.energy ?? 75;
      const hygiene = currentNeeds.hygiene ?? 75;
      const mental = currentNeeds.mental ?? 70;

      // Priority order: critical needs first, then below-50 needs
      if (hunger < 20) {
        // Critical hunger — character MUST eat regardless of what they're doing
        proactiveActivity = 'eating a meal (critical hunger)';
      } else if (hunger < 50 && context === 'home_resting') {
        // Low hunger + home = grab food
        proactiveActivity = 'cooking and eating at home';
      } else if (energy < 20 && context !== 'sleeping') {
        proactiveActivity = 'resting urgently (critical energy)';
      } else if (hygiene < 20) {
        proactiveActivity = 'showering (critical hygiene)';
      } else if (mental < 20) {
        proactiveActivity = 'resting and decompressing';
      } else if (context === 'work_off_shift') {
        // Home pull: off-shift at work — character should head home
        const homeLocId = char.current_home_location_id;
        if (homeLocId) {
          // Move them home via the work schedule enforcer logic inline
          sdk.entities.Character.update(char.id, {
            resolved_current_location_id: homeLocId,
            resolved_presence_status: 'home',
            resolved_location_type: 'home',
            resolved_last_updated_at: now.toISOString(),
            current_activity: 'arrived home after work',
          }).catch(() => {});
        }
      }

      // Apply proactive override to character (fire and forget, non-blocking)
      if (proactiveActivity && char.current_activity !== proactiveActivity) {
        sdk.entities.Character.update(char.id, { current_activity: proactiveActivity }).catch(() => {});
      }

      // Use proactive activity for context if overriding
      const overriddenChar = proactiveActivity
        ? { ...char, current_activity: proactiveActivity }
        : char;
      const context = getLocationContext(overriddenChar, locationMap);

      // Apply elapsed-time decay/gain using the correct context
      let newNeeds = applyElapsedTime(currentNeeds, cappedHours, context);
      newNeeds = applyHealthDegradation(newNeeds);
      const financialNeed = deriveFinancialNeed(char);

      updates.push({
        id: char.id,
        name: char.name,
        action: 'simulated',
        context,
        elapsedHours: Math.round(cappedHours * 100) / 100,
        data: {
          hunger_value:         Math.round(newNeeds.hunger),
          energy_value:         Math.round(newNeeds.energy),
          social_value:         Math.round(newNeeds.social),
          health_value:         Math.round(newNeeds.health),
          mental_value:         Math.round(newNeeds.mental),
          financial_need_value: Math.round(financialNeed),
          hygiene_value:        Math.round(newNeeds.hygiene),
          comfort_value:        Math.round(newNeeds.comfort),
          last_need_simulated_at: now.toISOString(),
        }
      });
    }

    // Write updates
    const writeResults = await Promise.all(
      updates
        .filter(u => u.data !== null)
        .map(u => sdk.entities.Character.update(u.id, u.data).catch(e => ({ error: e.message, id: u.id })))
    );

    return Response.json({
      success: true,
      processed: characters.length,
      updates: updates.map(u => ({
        id: u.id,
        name: u.name,
        action: u.action,
        context: u.context,
        elapsedHours: u.elapsedHours,
      })),
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('[simulateActiveCharacterNeeds]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});