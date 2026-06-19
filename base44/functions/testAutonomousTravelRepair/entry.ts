import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Inlined helpers from autonomousCharacterMovement (test-only) ──────────────
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
function urgencyLevel(value) {
  if (value < 10) return 4;
  if (value < 25) return 3;
  if (value < 50) return 2;
  if (value < 70) return 1;
  return 0;
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
    if (cat === 'work' && char.resolved_presence_status === 'at_work') return true;
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

function scoreLocation(location, char, vals) {
  let score = 0;
  const cat = (location.category || '').toLowerCase();
  const hungerU = urgencyLevel(vals.hunger);
  const energyU = urgencyLevel(vals.energy);
  const socialU = urgencyLevel(vals.social);
  const healthU = urgencyLevel(vals.health);
  const mentalU = urgencyLevel(vals.mental);
  const hygieneU = urgencyLevel(vals.hygiene);

  if (hungerU >= 2) {
    if (cat === 'food_drink') score += 3 + hungerU * 2;
    if (cat === 'grocery') score += 2 + hungerU;
    if (cat === 'home') score += 1;
  }
  if (energyU >= 2) {
    if (cat === 'home') score += 3 + energyU * 2;
    if (cat === 'gym') score -= energyU;
  }
  if (hygieneU >= 2) {
    if (cat === 'home') score += 2 + hygieneU;
  }
  if (cat === 'home' && char.resolved_current_location_id === char.current_home_location_id) score += 1;
  return score;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { owner_email } = body;

    if (!owner_email) return Response.json({ error: 'owner_email required' }, { status: 400 });

    const allChars = await base44.asServiceRole.entities.Character.filter({ owner_email, is_test_character: true });
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter({ owner_email });

    const results = [];

    for (const char of allChars) {
      const vals = needValues(char);
      const top = highestUrgencyEntry(vals);
      const currentLoc = allLocs.find(l => l.id === char.resolved_current_location_id);

      const canStay = currentLoc ? canSatisfyAtCurrentLocation(char, vals, currentLoc) : false;

      // Score test destinations
      const scored = allLocs
        .filter(l => l.id !== char.resolved_current_location_id)
        .map(l => ({ id: l.id, name: l.name, category: l.category, score: scoreLocation(l, char, vals) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);

      const topDests = scored.slice(0, 3);

      // ── VIOLATION DETECTION: hygiene → non-hygiene destination ──────────
      const hygieneViolations = [];
      if (top.key === 'hygiene' && !canStay) {
        for (const d of topDests) {
          const cat = (d.category || '').toLowerCase();
          if (cat === 'food_drink' || cat === 'social' || cat === 'outdoor' || cat === 'grocery') {
            hygieneViolations.push({
              destination: d.name,
              category: d.category,
              violation: `HYGIENE need should NOT score ${cat} as a destination. Hygiene care destinations: home, gym (with shower), salon/barber/spa only.`,
            });
          }
        }
      }

      // ── VIOLATION DETECTION: hunger → non-food destination ──────────────
      const hungerViolations = [];
      if (top.key === 'hunger' && !canStay) {
        for (const d of topDests) {
          const cat = (d.category || '').toLowerCase();
          if (cat !== 'food_drink' && cat !== 'grocery' && cat !== 'home') {
            hungerViolations.push({
              destination: d.name,
              category: d.category,
              violation: `HUNGER need scored ${cat} above 0. Only food_drink, grocery, or home should score for hunger.`,
            });
          }
        }
      }

      results.push({
        character_name: char.name,
        character_id: char.id,
        current_location: currentLoc ? `${currentLoc.name} (${currentLoc.category})` : 'unknown',
        top_need: top.key,
        top_need_value: Math.round(top.value),
        top_need_urgency: top.urgency,
        can_satisfy_at_current_location: canStay,
        verdict: canStay
          ? `STAY — ${top.key} can be satisfied at current location (${currentLoc?.name})`
          : `TRAVEL MAY BE NEEDED — ${top.key} requires a destination`,
        top_destinations: topDests,
        hygiene_violations: hygieneViolations,
        hunger_violations: hungerViolations,
        needs_passed: !hygieneViolations.length && !hungerViolations.length,
        has_violations: hygieneViolations.length > 0 || hungerViolations.length > 0,
      });
    }

    const allPassed = results.every(r => r.needs_passed);
    const violationCount = results.filter(r => r.has_violations).length;

    return Response.json({
      test_fixtures_used: results.length,
      all_tests_passed: allPassed,
      violation_count: violationCount,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});