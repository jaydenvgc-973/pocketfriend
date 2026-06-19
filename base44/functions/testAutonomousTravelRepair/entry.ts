// ── testAutonomousTravelRepair ──────────────────────────────────────────────
// VALIDATION-ONLY FUNCTION. Mutates NOTHING in the database.
// Loads ONLY test characters (is_test_character=true) and runs them through
// the autonomousCharacterMovement decision pipeline.
// Reports: what the system WOULD do for each character and WHY.
// Does NOT call createTravelSession. Does NOT update any records.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINED DECISION LOGIC (from autonomousCharacterMovement) ───────────────
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

function canSatisfyAtCurrentLocation(char, vals, currentLoc) {
  const top = highestUrgencyEntry(vals);
  if (!currentLoc || top.urgency < 2) return false;
  const cat = (currentLoc.category || '').toLowerCase();
  if (top.key === 'hunger') {
    if (cat === 'home' || cat === 'food_drink' || cat === 'grocery') return true;
    if (cat === 'workplace' && char.resolved_presence_status === 'at_work') return true;
    return false;
  }
  if (top.key === 'energy') return cat === 'home';
  if (top.key === 'social') return true;
  if (top.key === 'hygiene') return cat === 'home';
  if (top.key === 'comfort') return cat === 'home';
  if (top.key === 'health') {
    if (cat === 'home' && top.urgency <= 2) return true;
    if (cat === 'medical') return true;
    return false;
  }
  if (top.key === 'mental') return cat === 'home' || cat === 'outdoor';
  return false;
}

function isNightlifeVenue(location) {
  if (location.category !== 'social') return false;
  const name = (location.name || '').toLowerCase();
  const subtypes = (location.subtype || []).map(s => s.toLowerCase());
  const nkw = ['club', 'bar', 'lounge', 'nightclub', 'night club', 'pub', 'tavern', 'disco', 'bottle service', 'vip section'];
  return nkw.some(k => name.includes(k) || subtypes.includes(k));
}

function computeStayProbability(char, vals, currentLoc, nowET) {
  const cat = (currentLoc.category || '').toLowerCase();
  const hour = nowET.getHours();
  const isEvening = hour >= 17 && hour < 23;
  const isLate = hour >= 22 || hour < 5;
  const urgentNeeds = Object.entries(vals).filter(([, v]) => urgencyLevel(v) >= 2);
  const urgentKeys = urgentNeeds.map(([k]) => k);
  let stayProb = 0.55;
  if (cat === 'home') {
    stayProb += 0.20;
    if (char.trait_night_owl === false && char.trait_risk_taker === false) stayProb += 0.10;
  }
  if (urgentNeeds.length >= 2) {
    stayProb -= 0.12 * (urgentNeeds.length - 1);
    if (urgentKeys.includes('social') && urgentKeys.includes('hunger') && cat === 'home') stayProb -= 0.18;
    if (urgentKeys.includes('social') && (char.trait_competitive || /gym|fitness|workout/.test((char.health_habits || '').toLowerCase()))) stayProb -= 0.10;
    if (urgentKeys.includes('hunger') && (vals.financial || 60) < 40 && cat === 'home') stayProb += 0.12;
  }
  const se = char.social_energy || 'ambivert';
  if (se === 'extrovert' || se === 'mostly_extrovert') stayProb -= 0.12;
  if (se === 'introvert' || se === 'mostly_introvert') stayProb += 0.10;
  if (char.trait_flirty || char.trait_uninhibited) stayProb -= 0.08;
  if (char.trait_stubborn) stayProb -= 0.05;
  if (char.trait_conscientious) stayProb += 0.06;
  const emo = (char.emotional_state || 'calm').toLowerCase();
  if (['joyful', 'excited', 'bored', 'restless'].includes(emo)) stayProb -= 0.10;
  if (['sad', 'overwhelmed', 'burnt out', 'grief'].includes(emo)) stayProb += 0.12;
  if (isEvening && urgentKeys.includes('social')) stayProb -= 0.10;
  if (isLate) stayProb += 0.15;
  const quirks = char.quirks || [];
  for (const q of quirks) {
    if (!q.active) continue;
    if (q.quirk_id === 'homebody') stayProb += q.intensity === 'strong' ? 0.15 : 0.08;
    if (q.quirk_id === 'thrill_seeker') stayProb -= 0.10;
  }
  return Math.max(0.08, Math.min(0.92, stayProb));
}

function scoreLocation(location, char, vals, nowET) {
  let score = 0;
  const cat = location.category || 'generic';
  const se = char.social_energy || 'ambivert';
  const hungerU = urgencyLevel(vals.hunger), energyU = urgencyLevel(vals.energy);
  const socialU = urgencyLevel(vals.social), healthU = urgencyLevel(vals.health);
  const mentalU = urgencyLevel(vals.mental), hygieneU = urgencyLevel(vals.hygiene);
  const comfortU = urgencyLevel(vals.comfort);

  if (hungerU >= 2) {
    if (cat === 'food_drink') score += 3 + hungerU * 2;
    if (cat === 'grocery')    score += 2 + hungerU;
    if (cat === 'home')       score += 1;
  }
  if (energyU >= 2) {
    if (cat === 'home') score += 3 + energyU * 2;
    if (cat === 'gym')  score -= energyU;
  }
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
  if (healthU >= 2) {
    if (cat === 'medical') score += 4 + healthU * 3;
    if (cat === 'home')   score += 1 + healthU;
    if (cat === 'gym')    score -= healthU * 2;
    if (cat === 'social') score -= healthU;
  }
  if (mentalU >= 2) {
    if (['outdoor', 'home', 'religion'].includes(cat)) score += 2 + mentalU;
    if (cat === 'gym') score += 1 + mentalU;
  }
  if (hygieneU >= 2) {
    if (cat === 'home') score += 2 + hygieneU;
  }
  if (comfortU >= 2) {
    if (cat === 'outdoor' || cat === 'food_drink') score += 1 + comfortU;
    if (cat === 'home') score -= 1;
  }
  if (se === 'extrovert' && ['social', 'food_drink', 'outdoor'].includes(cat)) score += 1;
  if (['introvert', 'mostly_introvert'].includes(se) && ['home', 'outdoor'].includes(cat)) score += 1;

  // Combined pressure bonuses
  const urgentCount = [hungerU, energyU, socialU, healthU, mentalU, hygieneU, comfortU].filter(u => u >= 2).length;
  if (urgentCount >= 2) {
    if (hungerU >= 2 && socialU >= 2 && cat === 'food_drink') score += 4;
    if (hungerU >= 2 && socialU >= 2 && cat === 'outdoor')   score += 2;
    if (socialU >= 2 && /gym|fitness/.test((char.health_habits || '').toLowerCase()) && cat === 'gym') score += 3;
    if (socialU >= 2 && mentalU >= 2 && (cat === 'outdoor' || cat === 'religion')) score += 2;
    if (hungerU >= 2 && (vals.financial || 60) < 40 && cat === 'grocery') score += 3;
    if (energyU >= 2 && comfortU >= 2 && cat === 'home') score += 2;
  }

  if (isNightlifeVenue(location)) score -= 3; // generic penalty for test

  return score;
}

function selectBestLocation(locations, char, vals, nowET) {
  if (!locations || locations.length === 0) return null;
  const scored = locations
    .map(loc => ({ location: loc, score: scoreLocation(loc, char, vals, nowET) }))
    .sort((a, b) => b.score - a.score);
  const positives = scored.filter(s => s.score > 0);
  if (positives.length === 0) return null;
  const top = positives.slice(0, Math.min(3, positives.length));
  return top[0].location; // deterministic: pick #1 for test validation
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── LOAD TEST CHARACTERS ONLY ──────────────────────────────────────────
    // Match the load pattern from autonomousCharacterMovement: user-scoped filter.
    let allChars = [];
    try {
      allChars = await base44.entities.Character.filter(
        { owner_email: user.email, status: 'active' },
        '-updated_date',
        200
      );
    } catch {
      try {
        allChars = await base44.asServiceRole.entities.Character.filter(
          { owner_email: user.email, status: 'active' },
          '-updated_date',
          200
        );
      } catch (e2) {
        return Response.json({ error: `Character load failed: ${e2.message}` });
      }
    }
    const chars = allChars.filter(c => c.is_test_character === true);
    if (!chars.length) return Response.json({
      error: 'No test characters found',
      email: user.email,
      total_loaded: allChars.length,
    });

    // ── LOAD LOCATIONS ────────────────────────────────────────────────────
    const locations = await base44.asServiceRole.entities.LocationReference.filter({
      owner_email: user.email,
    });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const results = [];

    for (const char of chars) {
      const vals = needValues(char);
      const top = highestUrgencyEntry(vals);
      const currentLoc = locations.find(l => l.id === char.resolved_current_location_id);

      // ── BLOCKER CHECKS ───────────────────────────────────────────────────
      let blocker = null;

      // Work schedule override
      if (char.resolved_source_reason === 'work_schedule') {
        blocker = 'work_schedule';
      } else if (char.resolved_source_reason === 'school_schedule') {
        blocker = 'school_schedule';
      } else if (char.is_jailed || char.house_arrest_active) {
        blocker = 'confinement';
      } else if (char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping') {
        blocker = 'sleeping';
      }

      // ── CAN SATISFY AT CURRENT? ──────────────────────────────────────────
      const canSatisfy = currentLoc ? canSatisfyAtCurrentLocation(char, vals, currentLoc) : false;
      let stayProb = null;
      let wouldStay = false;
      if (canSatisfy && currentLoc) {
        stayProb = computeStayProbability(char, vals, currentLoc, nowET);
        wouldStay = Math.random() < stayProb; // one sample
      }

      // ── BEST DESTINATION ─────────────────────────────────────────────────
      const bestLoc = selectBestLocation(locations, char, vals, nowET);
      const bestScore = bestLoc
        ? locations.map(l => ({ loc: l, score: scoreLocation(l, char, vals, nowET) }))
            .find(s => s.loc.id === bestLoc.id)?.score ?? 0
        : null;

      // ── FULL SCORE TABLE ─────────────────────────────────────────────────
      const scoredLocs = locations
        .map(loc => ({ id: loc.id, name: loc.name, category: loc.category, score: scoreLocation(loc, char, vals, nowET) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // ── DECISION TRACE ───────────────────────────────────────────────────
      let decisionLabel = 'NO_ACTION';
      let explanation = '';

      if (blocker) {
        decisionLabel = 'BLOCKED';
        explanation = `Blocked by: ${blocker}`;
      } else if (top.urgency < 2) {
        decisionLabel = 'NO_URGENT_NEED';
        explanation = `Top need ${top.key}=${Math.round(top.value)} (urgency=${top.urgency}) — not urgent enough to trigger movement`;
      } else if (canSatisfy && wouldStay) {
        decisionLabel = 'STAY';
        explanation = `Can satisfy ${top.key} at current (${currentLoc?.name || 'unknown'}). Stay probability=${(stayProb*100).toFixed(0)}% — coin flip chose STAY.`;
      } else if (bestLoc && bestLoc.id !== char.resolved_current_location_id) {
        decisionLabel = 'WOULD_TRAVEL';
        explanation = `Would route to ${bestLoc.name} (score=${bestScore}) for ${top.key}=${Math.round(top.value)}`;
      } else if (bestLoc && bestLoc.id === char.resolved_current_location_id) {
        decisionLabel = 'ALREADY_THERE';
        explanation = `Best location is already current: ${bestLoc.name}`;
      } else {
        decisionLabel = 'NO_VALID_DESTINATION';
        explanation = `No location scored positive for ${top.key}=${Math.round(top.value)}`;
      }

      results.push({
        id: char.id,
        name: char.name,
        current_location: currentLoc?.name || 'unknown',
        current_category: currentLoc?.category || 'unknown',
        presence_status: char.resolved_presence_status,
        top_need: top.key,
        top_need_value: Math.round(top.value),
        top_need_urgency: top.urgency,
        urgent_needs: Object.entries(vals)
          .filter(([, v]) => urgencyLevel(v) >= 2)
          .map(([k, v]) => `${k}=${Math.round(v)}(u${urgencyLevel(v)})`),
        can_satisfy_at_current: canSatisfy,
        stay_probability_pct: stayProb !== null ? Math.round(stayProb * 100) : null,
        blocker,
        decision: decisionLabel,
        explanation,
        best_destination: bestLoc ? { id: bestLoc.id, name: bestLoc.name, category: bestLoc.category, score: bestScore } : null,
        top_scored_locations: scoredLocs,
        needs: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Math.round(v)])),
        social_energy: char.social_energy || 'not_set',
        health_habits: char.health_habits || null,
      });
    }

    // Compact console summary (not truncated like Response.json)
    console.log('═══════════════════════════════════════');
    console.log(`AUTONOMOUS MOVEMENT VALIDATION — ${results.length} test characters`);
    console.log(`Time: ${nowET.toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern`);
    console.log('───────────────────────────────────────');
    for (const r of results) {
      console.log(`${r.decision.padEnd(16)} | ${r.name.padEnd(45)} | ${r.top_need}=${r.top_need_value}(u${r.top_need_urgency}) | canSatisfy=${r.can_satisfy_at_current} | stayPct=${r.stay_probability_pct ?? 'N/A'} | blocker=${r.blocker || 'none'} | bestDest=${r.best_destination?.name || 'none'}`);
    }
    console.log('═══════════════════════════════════════');

    return Response.json({
      success: true,
      characters_tested: results.length,
      results,
      now_et: nowET.toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});