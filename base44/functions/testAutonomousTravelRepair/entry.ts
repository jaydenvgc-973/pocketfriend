// ── testAutonomousTravelRepair ──────────────────────────────────────────────
// VALIDATION-ONLY FUNCTION. Mutates NOTHING. No live characters touched.
// Loads ONLY test characters (is_test_character=true) and runs them through
// the REPAIRED autonomous movement decision pipeline.
// Reports PASS/FAIL per scenario against expected behavior.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ═══════════════════════════════════════════════════════════════════════════
// REPAIRED DECISION LOGIC — all fixes applied
// ═══════════════════════════════════════════════════════════════════════════

function needValues(char) {
  return {
    hunger: char.hunger_value ?? 70, energy: char.energy_value ?? 75,
    social: char.social_value ?? 65, health: char.health_value ?? 80,
    mental: char.mental_value ?? 70, hygiene: char.hygiene_value ?? 75,
    comfort: char.comfort_value ?? 70, financial: char.financial_need_value ?? 60,
  };
}

function urgencyLevel(value) {
  if (value < 10) return 4; if (value < 25) return 3;
  if (value < 50) return 2; if (value < 70) return 1; return 0;
}

function highestUrgencyEntry(vals) {
  return Object.entries(vals)
    .map(([k, v]) => ({ key: k, value: v, urgency: urgencyLevel(v) }))
    .sort((a, b) => b.urgency - a.urgency || a.value - b.value)[0];
}

// ── REPAIR A: satisfactionQuality evaluates ALL urgent needs at current loc ──
// Returns the WORST quality across all urgent needs — because one unsolved
// urgent need can override one satisfied need. Combined pressures matter.
function satisfactionQuality(char, vals, currentLoc) {
  if (!currentLoc) return { quality: 'no_location', detail: 'No current location' };
  const urgentNeeds = Object.entries(vals).filter(([, v]) => urgencyLevel(v) >= 2);
  if (urgentNeeds.length === 0) return { quality: 'no_need', detail: 'No urgent need' };

  const cat = (currentLoc.category || '').toLowerCase();
  const se = char.social_energy || 'ambivert';
  const qualities = [];

  for (const [key, val] of urgentNeeds) {
    const urg = urgencyLevel(val);

    if (key === 'hunger') {
      if (cat === 'home')
        qualities.push({ key, quality: 'fully', detail: 'Can cook/eat at home' });
      else if (cat === 'food_drink')
        qualities.push({ key, quality: 'fully', detail: 'At a food venue' });
      else if (cat === 'grocery')
        qualities.push({ key, quality: 'fully', detail: 'Can buy food' });
      else if (cat === 'workplace' && char.resolved_presence_status === 'at_work')
        qualities.push({ key, quality: 'partially', detail: 'May eat at work' });
      else
        qualities.push({ key, quality: 'not', detail: 'No food available here' });
    }
    else if (key === 'energy') {
      if (cat === 'home')
        qualities.push({ key, quality: 'fully', detail: 'Can rest at home' });
      else
        qualities.push({ key, quality: 'not', detail: 'Cannot properly rest here' });
    }
    else if (key === 'social') {
      if (cat === 'social' || cat === 'food_drink')
        qualities.push({ key, quality: 'fully', detail: 'Real in-person social interaction available' });
      else if (cat === 'outdoor' || cat === 'community')
        qualities.push({ key, quality: 'fully', detail: 'Public space with social possibilities' });
      else if (cat === 'workplace' && char.resolved_presence_status === 'at_work')
        qualities.push({ key, quality: 'partially', detail: 'Coworker interaction available' });
      else if (cat === 'school')
        qualities.push({ key, quality: 'partially', detail: 'Peer interaction available' });
      else if (cat === 'home') {
        if (urg <= 2 && val >= 40)
          qualities.push({ key, quality: 'fully', detail: 'Text/call sufficient for mild social need' });
        else if (urg >= 3 || val < 25)
          qualities.push({ key, quality: 'weakly', detail: 'Only text/call at home — in-person would be better' });
        else
          qualities.push({ key, quality: 'partially', detail: 'Text/call possible but in-person better' });
      }
      else {
        if (val < 30)
          qualities.push({ key, quality: 'weakly', detail: 'Only text/call available' });
        else
          qualities.push({ key, quality: 'partially', detail: 'Text/call is possible' });
      }
    }
    else if (key === 'hygiene') {
      if (cat === 'home')
        qualities.push({ key, quality: 'fully', detail: 'Can shower/groom at home' });
      else if (cat === 'gym') {
        const features = (currentLoc.features || []).map(f => f.toLowerCase());
        if (features.some(f => f.includes('shower') || f.includes('locker')))
          qualities.push({ key, quality: 'partially', detail: 'Gym has shower/locker facilities' });
        else
          qualities.push({ key, quality: 'weakly', detail: 'Gym without showers' });
      }
      else
        qualities.push({ key, quality: 'not', detail: 'No hygiene facilities here' });
    }
    else if (key === 'comfort') {
      if (cat === 'home')
        qualities.push({ key, quality: 'fully', detail: 'Home is comfortable' });
      else if (cat === 'outdoor')
        qualities.push({ key, quality: 'partially', detail: 'Change of scenery helps' });
      else
        qualities.push({ key, quality: 'weakly', detail: 'Limited comfort options' });
    }
    else if (key === 'health') {
      if (cat === 'medical')
        qualities.push({ key, quality: 'fully', detail: 'Medical facility' });
      else if (cat === 'home' && urg <= 2)
        qualities.push({ key, quality: 'partially', detail: 'Can rest at home' });
      else
        qualities.push({ key, quality: 'not', detail: 'Cannot address health here' });
    }
    else if (key === 'mental') {
      if (cat === 'home' || cat === 'outdoor' || cat === 'religion')
        qualities.push({ key, quality: 'fully', detail: 'Calm environment' });
      else if (cat === 'gym')
        qualities.push({ key, quality: 'partially', detail: 'Exercise helps mental state' });
      else
        qualities.push({ key, quality: 'weakly', detail: 'Limited mental recovery' });
    }
    else {
      qualities.push({ key, quality: 'not', detail: `Cannot satisfy ${key}` });
    }
  }

  // Return the WORST quality — one unsolved need makes the location less satisfying
  const rank = { fully: 3, partially: 2, weakly: 1, not: 0 };
  qualities.sort((a, b) => rank[a.quality] - rank[b.quality]);
  const worst = qualities[0];
  const allDetails = qualities.map(q => `${q.key}:${q.quality}`).join(', ');

  return {
    quality: worst.quality,
    detail: `${worst.detail} [${allDetails}]`,
    per_need: qualities,
  };
}

// ── REPAIR B: computeStayProbability uses QUALITY and EXACT VALUES ─────────
function computeStayProbability(char, vals, currentLoc, nowET, satQuality) {
  const cat = (currentLoc?.category || '').toLowerCase();
  const hour = nowET.getHours();
  const isEvening = hour >= 17 && hour < 23;
  const isLate = hour >= 22 || hour < 5;
  const urgentNeeds = Object.entries(vals).filter(([, v]) => urgencyLevel(v) >= 2);
  const urgentKeys = urgentNeeds.map(([k]) => k);
  const urgentCount = urgentNeeds.length;

  let stayProb = 0.55;

  // ── SATISFACTION QUALITY WEIGHT ────────────────────────────────────────
  // Core repair: quality of satisfaction directly affects stay probability.
  // "fully" for ALL urgent needs = strong stay. "weakly" for any = travel pressure.
  if (satQuality) {
    if (satQuality.quality === 'fully')  stayProb += 0.25;
    if (satQuality.quality === 'partially') stayProb += 0.05;
    if (satQuality.quality === 'weakly') stayProb -= 0.25; // strongly encourage travel
    if (satQuality.quality === 'not')    stayProb -= 0.40; // must travel
  }

  // ── LOCATION BASE ──────────────────────────────────────────────────────
  if (cat === 'home') {
    stayProb += 0.08; // reduced from 0.20 — home shouldn't dominate weakly satisfied needs
    if (char.trait_night_owl === false && char.trait_risk_taker === false) stayProb += 0.05;
  }

  // ── NEED SEVERITY (exact values, not just urgency buckets) ─────────────
  // Only penalize for needs NOT fully satisfied at current location.
  // If the venue fully satisfies a need, there's no pressure to leave for it.
  const perNeedQuality = {};
  if (satQuality && satQuality.per_need) {
    for (const pn of satQuality.per_need) perNeedQuality[pn.key] = pn.quality;
  }
  for (const [key, val] of urgentNeeds) {
    const curSatisfied = perNeedQuality[key] || 'not';
    if (curSatisfied === 'fully') continue; // no pressure — need is handled here
    const severity = (100 - val) / 100;
    if (key === 'social' && cat === 'home' && curSatisfied !== 'fully') {
      stayProb -= severity * 0.35;
    } else {
      stayProb -= severity * 0.15;
    }
  }

  // ── COMBINED PRESSURES ─────────────────────────────────────────────────
  const unmetUrgentKeys = urgentKeys.filter(k => perNeedQuality[k] !== 'fully');
  const unmetUrgentCount = unmetUrgentKeys.length;
  if (unmetUrgentCount >= 2) {
    stayProb -= 0.10 * (unmetUrgentCount - 1);
    if (unmetUrgentKeys.includes('social') && unmetUrgentKeys.includes('hunger') && cat === 'home')
      stayProb -= 0.15;
    if (unmetUrgentKeys.includes('social') && (char.trait_competitive || /gym|fitness|workout/.test((char.health_habits || '').toLowerCase())))
      stayProb -= 0.10;
    if (unmetUrgentKeys.includes('hunger') && (vals.financial || 60) < 40 && cat === 'home')
      stayProb += 0.10;
  }

  // ── PERSONALITY ────────────────────────────────────────────────────────
  const se = char.social_energy || 'ambivert';
  if (se === 'extrovert' || se === 'mostly_extrovert') stayProb -= 0.12;
  if (se === 'introvert' || se === 'mostly_introvert') stayProb += 0.10;
  if (char.trait_flirty || char.trait_uninhibited) stayProb -= 0.08;
  if (char.trait_stubborn) stayProb -= 0.05;
  if (char.trait_conscientious) stayProb += 0.06;

  // ── EMOTIONAL STATE ────────────────────────────────────────────────────
  const emo = (char.emotional_state || 'calm').toLowerCase();
  if (['joyful', 'excited', 'bored', 'restless'].includes(emo)) stayProb -= 0.10;
  if (['sad', 'overwhelmed', 'burnt out', 'grief'].includes(emo)) stayProb += 0.12;

  // ── TIME OF DAY ────────────────────────────────────────────────────────
  if (isEvening && urgentKeys.includes('social')) stayProb -= 0.10;
  if (isLate) stayProb += 0.15;

  // ── QUIRKS ────────────────────────────────────────────────────────────
  const quirks = char.quirks || [];
  for (const q of quirks) {
    if (!q.active) continue;
    if (q.quirk_id === 'homebody') stayProb += q.intensity === 'strong' ? 0.15 : 0.08;
    if (q.quirk_id === 'thrill_seeker') stayProb -= 0.10;
  }

  return Math.max(0.05, Math.min(0.92, stayProb));
}

// ── REPAIR C: scoreLocation with hygiene fix and combined-pressure emphasis ─
function scoreLocation(location, char, vals, nowET) {
  let score = 0;
  const cat = location.category || 'generic';
  const se = char.social_energy || 'ambivert';
  const hungerU = urgencyLevel(vals.hunger), energyU = urgencyLevel(vals.energy);
  const socialU = urgencyLevel(vals.social), healthU = urgencyLevel(vals.health);
  const mentalU = urgencyLevel(vals.mental), hygieneU = urgencyLevel(vals.hygiene);
  const comfortU = urgencyLevel(vals.comfort);

  // HUNGER → food/grocery/home (introverts prefer home cooking)
  const isIntro = ['introvert', 'mostly_introvert'].includes(se);
  if (hungerU >= 2) {
    if (cat === 'food_drink') {
      // Introverts with solo hunger prefer home; extroverts prefer dining out
      const hasSocialUrgent = socialU >= 2;
      if (isIntro && !hasSocialUrgent) {
        score += 2 + hungerU; // reduced — cooking at home is preferred
      } else {
        score += 3 + hungerU * 2;
      }
    }
    if (cat === 'grocery')    score += 2 + hungerU;
    if (cat === 'home')       score += isIntro ? (3 + hungerU * 1.5) : (1 + Math.floor(hungerU * 0.5));
  }
  // ENERGY → home
  if (energyU >= 2) {
    if (cat === 'home') score += 3 + energyU * 2;
    if (cat === 'gym')  score -= energyU;
  }
  // SOCIAL → varies by personality
  if (socialU >= 2) {
    const isIntro = ['introvert', 'mostly_introvert'].includes(se);
    if (isIntro) {
      if (cat === 'outdoor') score += 2 + socialU;
      if (cat === 'home')    score -= socialU;
    } else {
      if (cat === 'social' || cat === 'food_drink') score += 3 + socialU * 2;
      if (cat === 'outdoor' || cat === 'gym')       score += 2 + socialU;
      if (cat === 'home')                           score -= 2 + socialU;
    }
  }
  // HEALTH → medical
  if (healthU >= 2) {
    if (cat === 'medical') score += 4 + healthU * 3;
    if (cat === 'home')   score += 1 + healthU;
    if (cat === 'gym')    score -= healthU * 2;
    if (cat === 'social') score -= healthU;
  }
  // MENTAL → calm environments
  if (mentalU >= 2) {
    if (['outdoor', 'home', 'religion'].includes(cat)) score += 2 + mentalU;
    if (cat === 'gym') score += 1 + mentalU;
  }
  // HYGIENE — REPAIRED: home/self-care only, PENALIZE food/social/outdoor
  if (hygieneU >= 2) {
    if (cat === 'home') score += 3 + hygieneU * 2;
    if (cat === 'gym') {
      const features = (location.features || []).map(f => f.toLowerCase());
      if (features.some(f => f.includes('shower') || f.includes('locker')))
        score += 2 + hygieneU;
      else
        score -= 1; // gym without showers is not hygiene-friendly
    }
    // CRITICAL: penalize food/social/outdoor for hygiene
    if (cat === 'food_drink') score -= 4; // restaurant is not for showering
    if (cat === 'social') score -= 4; // bar is not for showering
    if (cat === 'outdoor') score -= 3; // park is not for showering
    if (cat === 'grocery') score -= 3;
  }
  // COMFORT → scenery change
  if (comfortU >= 2) {
    if (cat === 'outdoor' || cat === 'food_drink') score += 1 + comfortU;
    if (cat === 'home') score -= 1;
  }
  // Base personality preference
  if (se === 'extrovert' && ['social', 'food_drink', 'outdoor'].includes(cat)) score += 1;
  if (['introvert', 'mostly_introvert'].includes(se) && ['home', 'outdoor'].includes(cat)) score += 1;

  // ── COMBINED PRESSURE BONUSES ──────────────────────────────────────────
  const urgentCount = [hungerU, energyU, socialU, healthU, mentalU, hygieneU, comfortU].filter(u => u >= 2).length;
  if (urgentCount >= 2) {
    // hunger + social → dining out
    if (hungerU >= 2 && socialU >= 2 && cat === 'food_drink') score += 5;
    // hunger + social → picnic/outdoor
    if (hungerU >= 2 && socialU >= 2 && cat === 'outdoor')   score += 2;
    // social + fitness → gym
    if (socialU >= 2 && /gym|fitness|workout/.test((char.health_habits || '').toLowerCase()) && cat === 'gym') score += 4;
    // social + mental → calm social
    if (socialU >= 2 && mentalU >= 2 && (cat === 'outdoor' || cat === 'religion' || cat === 'community')) score += 3;
    // hunger + broke → grocery
    if (hungerU >= 2 && (vals.financial || 60) < 40 && cat === 'grocery') score += 3;
    // energy + comfort → home double benefit
    if (energyU >= 2 && comfortU >= 2 && cat === 'home') score += 3;
  }

  // Nightlife penalty (test context — simplified)
  if (cat === 'social') {
    const name = (location.name || '').toLowerCase();
    const nkw = ['club', 'bar', 'lounge', 'nightclub', 'pub', 'tavern', 'disco'];
    if (nkw.some(k => name.includes(k))) score -= 3;
  }

  return score;
}

function selectBestLocation(locations, char, vals, nowET) {
  if (!locations || locations.length === 0) return null;
  const scored = locations
    .map(loc => ({ location: loc, score: scoreLocation(loc, char, vals, nowET) }))
    .sort((a, b) => b.score - a.score);
  const positives = scored.filter(s => s.score > 0);
  if (positives.length === 0) return null;
  return positives[0].location; // deterministic: #1
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO EXPECTATIONS — defines PASS/FAIL criteria per fixture
// ═══════════════════════════════════════════════════════════════════════════

const SCENARIO_MAP = {
  'Test Fixture 1': {
    scenario: 'Hungry introvert at home',
    expected: {
      canSatisfy: 'fully',
      stayPctMin: 50,    // should strongly favor stay
      bestDestCat: 'home', // home/food should win
      blocker: null,
    },
  },
  'Test Fixture 2': {
    scenario: 'Hungry + social extrovert at home',
    expected: {
      canSatisfy: 'weakly', // social=20 at home = only text/call = weakly satisfied
      stayPctMax: 40,    // must strongly push toward travel
      bestDestCat: 'food_drink', // dining out should compete/win
      blocker: null,
    },
  },
  'Test Fixture 3': {
    scenario: 'Social + fitness at home',
    expected: {
      canSatisfy: 'partially',
      stayPctMax: 55,    // gym should compete strongly
      bestDestCat: 'gym', // gym should win from combined pressure
      blocker: null,
    },
  },
  'Test Fixture 4': {
    scenario: 'Hungry at work',
    expected: {
      canSatisfy: 'partially', // can eat at work
      blocker: 'work_schedule', // MUST be blocked
    },
  },
  'Test Fixture 5': {
    scenario: 'Hungry + social already at diner',
    expected: {
      canSatisfy: 'fully', // diner handles both perfectly
      stayPctMin: 55,    // favors staying — extroverts may still roam
      blocker: null,
    },
  },
  'Test Fixture 6': {
    scenario: 'Critical social extrovert at home',
    expected: {
      canSatisfy: 'weakly', // text/call is weak for social=15
      stayPctMax: 45,     // must NOT default to 73% stay
      bestDestCat: ['social', 'food_drink', 'outdoor'], // must go somewhere social
      blocker: null,
    },
  },
  'Test Fixture 7': {
    scenario: 'Hygiene low at home',
    expected: {
      canSatisfy: 'fully', // shower at home
      stayPctMin: 70,
      bestDestCat: 'home',
      blocker: null,
    },
  },
  'Test Fixture 8': {
    scenario: 'Hygiene low away from home',
    expected: {
      canSatisfy: 'not', // diner has no hygiene
      stayPctMax: 25,    // must go home
      bestDestCat: 'home', // must route home, NOT to food/social
      blocker: null,
    },
  },
};

function evaluateFixture(result, fixtureName) {
  // Match by prefix — fixture names have colon-delimited descriptions
  const matchKey = Object.keys(SCENARIO_MAP).find(k => fixtureName.startsWith(k));
  const spec = matchKey ? SCENARIO_MAP[matchKey] : null;
  const scenarioLabel = spec ? spec.scenario : 'Unknown';
  if (!spec) return { pass: null, reason: `No spec for '${fixtureName}'. Known keys: ${Object.keys(SCENARIO_MAP).join(', ')}` };

  const exp = spec.expected;
  const failures = [];

  // Check canSatisfy quality
  if (exp.canSatisfy && result.satisfaction_quality !== exp.canSatisfy) {
    failures.push(`canSatisfy: expected '${exp.canSatisfy}', got '${result.satisfaction_quality}' (${result.satisfaction_detail})`);
  }

  // Check stay probability bounds
  if (exp.stayPctMin !== undefined && result.stay_probability_pct !== null && result.stay_probability_pct < exp.stayPctMin) {
    failures.push(`stayPct: expected >=${exp.stayPctMin}%, got ${result.stay_probability_pct}%`);
  }
  if (exp.stayPctMax !== undefined && result.stay_probability_pct !== null && result.stay_probability_pct > exp.stayPctMax) {
    failures.push(`stayPct: expected <=${exp.stayPctMax}%, got ${result.stay_probability_pct}%`);
  }

  // Check blocker
  if (exp.blocker !== undefined) {
    if (exp.blocker === null && result.blocker !== null) {
      failures.push(`blocker: expected none, got '${result.blocker}'`);
    } else if (exp.blocker !== null && result.blocker !== exp.blocker) {
      failures.push(`blocker: expected '${exp.blocker}', got '${result.blocker}'`);
    }
  }

  // Check best destination category
  if (exp.bestDestCat && result.best_destination) {
    const expectedCats = Array.isArray(exp.bestDestCat) ? exp.bestDestCat : [exp.bestDestCat];
    if (!expectedCats.includes(result.best_destination.category)) {
      failures.push(`bestDestCat: expected ${expectedCats.join('/')}, got '${result.best_destination.category}' (${result.best_destination.name})`);
    }
  } else if (exp.bestDestCat === 'home' && !result.best_destination) {
    // OK if home wins and is current location
  }

  // Special: hygiene away from home must NOT route to food/social
  if (fixtureName === 'Test Fixture 8' && result.best_destination) {
    const badCats = ['food_drink', 'social', 'outdoor'];
    if (badCats.includes(result.best_destination.category)) {
      failures.push(`HYGIENE VIOLATION: routing to ${result.best_destination.category} (${result.best_destination.name}) — must go home for hygiene`);
    }
  }

  return {
    pass: failures.length === 0,
    reason: failures.length === 0 ? 'All checks passed' : failures.join('; '),
    failures,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── LOAD TEST CHARACTERS ONLY ──────────────────────────────────────
    let allChars = [];
    try {
      allChars = await base44.entities.Character.filter(
        { owner_email: user.email, status: 'active' },
        '-updated_date', 200
      );
    } catch {
      try {
        allChars = await base44.asServiceRole.entities.Character.filter(
          { owner_email: user.email, status: 'active' },
          '-updated_date', 200
        );
      } catch (e2) {
        return Response.json({ error: `Character load failed: ${e2.message}` });
      }
    }
    const chars = allChars.filter(c => c.is_test_character === true);
    if (!chars.length) return Response.json({ error: 'No test characters found', email: user.email, total: allChars.length });

    // ── LOAD LOCATIONS ──────────────────────────────────────────────────
    const locations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: user.email });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const results = [];
    let totalPass = 0, totalFail = 0;

    for (const char of chars) {
      const vals = needValues(char);
      const top = highestUrgencyEntry(vals);
      const currentLoc = locations.find(l => l.id === char.resolved_current_location_id);

      // ── BLOCKER CHECKS ────────────────────────────────────────────────
      let blocker = null;
      if (char.resolved_source_reason === 'work_schedule') blocker = 'work_schedule';
      else if (char.resolved_source_reason === 'school_schedule') blocker = 'school_schedule';
      else if (char.is_jailed || char.house_arrest_active) blocker = 'confinement';
      else if (char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping') blocker = 'sleeping';

      // ── SATISFACTION QUALITY ──────────────────────────────────────────
      const sat = currentLoc ? satisfactionQuality(char, vals, currentLoc) : { quality: 'not', detail: 'No current location' };

      // ── STAY PROBABILITY ──────────────────────────────────────────────
      let stayProb = null;
      if (!blocker && sat.quality !== 'not' && sat.quality !== 'no_need' && currentLoc) {
        stayProb = computeStayProbability(char, vals, currentLoc, nowET, sat);
      }

      // ── BEST DESTINATION ──────────────────────────────────────────────
      const bestLoc = selectBestLocation(locations, char, vals, nowET);

      // ── SCORE TABLE ───────────────────────────────────────────────────
      const scoredLocs = locations
        .map(loc => ({ id: loc.id, name: loc.name, category: loc.category, score: scoreLocation(loc, char, vals, nowET) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // ── DECISION ──────────────────────────────────────────────────────
      let decisionLabel, explanation;
      if (blocker) {
        decisionLabel = 'BLOCKED';
        explanation = `Blocked by: ${blocker}`;
      } else if (top.urgency < 2) {
        decisionLabel = 'NO_URGENT_NEED';
        explanation = `Top need ${top.key}=${Math.round(top.value)} (urgency=${top.urgency})`;
      } else if (stayProb !== null) {
        if (stayProb >= 0.50) {
          decisionLabel = 'LIKELY_STAY';
          explanation = `Stay prob ${(stayProb*100).toFixed(0)}% — satisfaction=${sat.quality} — likely stays`;
        } else {
          decisionLabel = 'LIKELY_TRAVEL';
          explanation = `Stay prob ${(stayProb*100).toFixed(0)}% — satisfaction=${sat.quality} — likely travels to ${bestLoc?.name || 'unknown'}`;
        }
      } else if (bestLoc && bestLoc.id !== char.resolved_current_location_id) {
        decisionLabel = 'WOULD_TRAVEL';
        explanation = `No satisfaction at current — would go to ${bestLoc.name}`;
      } else {
        decisionLabel = 'NO_VALID_OPTION';
        explanation = 'No positive-scoring destination found';
      }

      const resultEntry = {
        id: char.id,
        name: char.name,
        scenario: (() => {
          const mk = Object.keys(SCENARIO_MAP).find(k => char.name.startsWith(k));
          return mk ? SCENARIO_MAP[mk].scenario : 'Unknown';
        })(),
        current_location: currentLoc?.name || 'unknown',
        current_category: currentLoc?.category || 'unknown',
        presence_status: char.resolved_presence_status || 'unknown',
        top_need: top.key,
        top_need_value: Math.round(top.value),
        top_need_urgency: top.urgency,
        urgent_needs: Object.entries(vals)
          .filter(([, v]) => urgencyLevel(v) >= 2)
          .map(([k, v]) => `${k}=${Math.round(v)}(u${urgencyLevel(v)})`),
        satisfaction_quality: sat.quality,
        satisfaction_detail: sat.detail,
        stay_probability_pct: stayProb !== null ? Math.round(stayProb * 100) : null,
        blocker,
        decision: decisionLabel,
        explanation,
        best_destination: bestLoc ? { id: bestLoc.id, name: bestLoc.name, category: bestLoc.category } : null,
        top_scored_locations: scoredLocs,
        needs: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Math.round(v)])),
        social_energy: char.social_energy || 'not_set',
      };

      // ── EVALUATE ──────────────────────────────────────────────────────
      const evalResult = evaluateFixture(resultEntry, char.name);
      resultEntry.evaluation = evalResult;
      if (evalResult.pass === true) totalPass++;
      else if (evalResult.pass === false) totalFail++;

      results.push(resultEntry);
    }

    // ── CONSOLE REPORT ──────────────────────────────────────────────────
    console.log('═══════════════════════════════════════════════');
    console.log(`AUTONOMOUS MOVEMENT REPAIR VALIDATION — ${results.length} fixtures`);
    console.log(`Time: ${nowET.toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern`);
    console.log('───────────────────────────────────────────────────');
    for (const r of results) {
      const pf = r.evaluation?.pass === true ? 'PASS' : r.evaluation?.pass === false ? 'FAIL' : 'N/A';
      console.log(`${pf.padEnd(5)} | ${r.name.padEnd(45)} | sat=${r.satisfaction_quality.padEnd(10)} | stay=${(r.stay_probability_pct ?? 'N/A').toString().padEnd(4)} | ${r.decision.padEnd(14)} | best=${r.best_destination?.name || 'none'} | ${r.evaluation?.reason || ''}`);
    }
    console.log(`───────────────────────────────────────────────────`);
    console.log(`PASS: ${totalPass} | FAIL: ${totalFail} | TOTAL: ${results.length}`);
    console.log('═══════════════════════════════════════════════');

    return Response.json({
      success: true,
      fixtures_tested: results.length,
      pass_count: totalPass,
      fail_count: totalFail,
      live_characters_touched: false,
      live_locations_touched: false,
      travel_sessions_created: false,
      results,
      now_et: nowET.toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});