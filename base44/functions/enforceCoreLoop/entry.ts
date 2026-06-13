import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ── Inline affinity engine (no local imports in Deno) ────────────────────────
const SOCIAL_ENERGY_AFFINITIES = {
  introvert:        { preferred: ['home','outdoor','public'], acceptable: ['food_drink','education','medical','grocery','religion'], conditional: ['social','gym'] },
  mostly_introvert: { preferred: ['home','outdoor','public'], acceptable: ['food_drink','education','medical','grocery','religion','gym'], conditional: ['social'] },
  ambivert:         { preferred: ['food_drink','outdoor','home','social'], acceptable: ['gym','public','education','religion','grocery','medical'], conditional: [] },
  mostly_extrovert: { preferred: ['social','food_drink','gym'], acceptable: ['outdoor','public','home','education','religion','grocery','medical'], conditional: [] },
  extrovert:        { preferred: ['social','food_drink'], acceptable: ['gym','outdoor','public','education','religion','grocery','medical'], conditional: ['home'] },
};
const EMOTIONAL_MODIFIERS = {
  sad:{'boost':['home','outdoor'],'penalize':['social']}, anxious:{'boost':['home','outdoor'],'penalize':['social']},
  overwhelmed:{'boost':['home','outdoor'],'penalize':['social']}, reflective:{'boost':['home','outdoor','religion'],'penalize':['social']},
  'closed-off':{'boost':['home'],'penalize':['social','food_drink']}, 'burnt out':{'boost':['home','outdoor'],'penalize':['social','gym']},
  grief:{'boost':['home','religion','outdoor'],'penalize':['social']}, joyful:{'boost':['social','food_drink','outdoor'],'penalize':[]},
  excited:{'boost':['social','food_drink','outdoor','gym'],'penalize':[]}, content:{'boost':['home','outdoor','food_drink'],'penalize':[]},
  bored:{'boost':['social','food_drink','outdoor'],'penalize':['home']}, irritated:{'boost':['outdoor','gym'],'penalize':['social']},
  frustrated:{'boost':['gym','outdoor','home'],'penalize':['social']},
};

function scoreLocationForCharacter(loc, character) {
  let score = 0;
  const se = character.social_energy || 'ambivert';
  const ep = SOCIAL_ENERGY_AFFINITIES[se] || SOCIAL_ENERGY_AFFINITIES.ambivert;
  if (ep.preferred.includes(loc.category)) score += 3;
  else if (ep.acceptable.includes(loc.category)) score += 1;
  else if (ep.conditional && ep.conditional.includes(loc.category)) score -= 1;

  // Archetype
  const arch = (character.archetype||'').toLowerCase();
  const archBoosts = {'guardian':['home','religion'],'achiever':['gym','education'],'rebel':['social','outdoor'],'introvert':['home','outdoor'],'charmer':['social'],'wounded':['home','outdoor'],'chaotic':['social']};
  const archPens  = {'guardian':['social'],'introvert':['social'],'wounded':['social'],'chaotic':['home']};
  if (archBoosts[arch]?.includes(loc.category)) score += 2;
  if (archPens[arch]?.includes(loc.category))   score -= 2;

  // Health habits → gym/outdoor
  const hh = (character.health_habits||'').toLowerCase();
  if (loc.category === 'gym' && /gym|workout|fitness|exercise/.test(hh)) score += 2;
  if (loc.category === 'outdoor' && /run|jog|walk|hike|outdoor/.test(hh)) score += 2;

  // Religion
  const religion = (character.religion||'').toLowerCase();
  const isDevout = character.belief_level === 'devout';
  if (loc.category === 'religion' && religion && religion !== 'none') score += isDevout ? 4 : 2;
  if (isDevout && religion && religion !== 'none') {
    const vi = (loc.venue_identity||'').toLowerCase();
    if (/gay|lgbt|queer|strip|adult/.test(vi)) score -= 8;
    if (loc.category === 'social') score -= 1;
  }

  // Emotional state
  const em = EMOTIONAL_MODIFIERS[character.emotional_state||'calm'];
  if (em) {
    if (em.boost.includes(loc.category)) score += 2;
    if (em.penalize.includes(loc.category)) score -= 2;
  }

  // Home as refuge when worn out
  if (loc.category === 'home' && ['burnt out','overwhelmed','sad','anxious','grief'].includes(character.emotional_state)) score += 2;

  return score;
}

function pickBestFreeTimeLocation(availableLocations, character) {
  if (!availableLocations?.length) return null;
  const scored = availableLocations
    .map(loc => ({ loc, score: scoreLocationForCharacter(loc, character) }))
    .sort((a, b) => b.score - a.score);
  const top = scored.filter(s => s.score > 0).slice(0, 3);
  if (!top.length) return scored[0]?.loc || null;
  const weights = top.length === 1 ? [1] : top.length === 2 ? [0.65, 0.35] : [0.50, 0.30, 0.20];
  const roll = Math.random();
  let cum = 0;
  for (let i = 0; i < top.length; i++) {
    cum += weights[i];
    if (roll <= cum) return top[i].loc;
  }
  return top[0].loc;
}

/**
 * ENFORCE CORE LOOP — READ-ONLY DIAGNOSTIC AUDIT
 * 
 * This function reports state violations but does NOT auto-correct them.
 * Autonomous authority (autonomousCharacterMovement, simulateActiveCharacterNeeds,
 * processTravelArrivals) is the sole correction pipeline. A second correction
 * authority creates conflicting state and limbo between activities.
 * 
 * Steps:
 * 1. CHECK TIME
 * 2. CHECK SCHEDULE
 * 3. CHECK LOCATION VALIDITY
 * 4. CHECK ENVIRONMENT (open/closed)
 * 5. CHECK USER INFLUENCE
 * 6. REPORT LOCATION ISSUES (no auto-correction)
 * 7. CHECK PRESENCE CONSISTENCY
 * 8-12. Report only — no writes
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const coreLoopReport = {
      timestamp: new Date().toISOString(),
      userId: user.email,
      mode: 'CORE_LOOP_DIAGNOSTIC_READ_ONLY',
      note: 'AUTONOMOUS AUTHORITY ONLY — this function observes, does not correct. autonomousCharacterMovement + simulateActiveCharacterNeeds + processTravelArrivals own all corrections.',
      charactersProcessed: 0,
      violationsFound: 0,
      details: [],
      systemStatus: {}
    };

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const dayOfWeek = now.getDay();
    const timeString = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

    // FETCH ALL DATA — owner_email scoped
    const [characters, locations] = await Promise.all([
      base44.entities.Character.filter({ owner_email: user.email }, '-created_date', 200),
      base44.entities.LocationReference.filter({ owner_email: user.email }, null, 300),
    ]);

    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // PROCESS EACH CHARACTER — read-only, no writes
    for (const character of characters) {
      if (character.status !== 'active') continue;

      const charLoop = {
        characterId: character.id,
        characterName: character.name,
        steps: {},
        violations: []
      };

      // STEP 1: CHECK TIME
      charLoop.steps['1_CHECK_TIME'] = {
        currentTime: timeString,
        dayOfWeek,
        hour: currentHour
      };

      // STEP 2: CHECK SCHEDULE
      const isWorkDay = character.work_days && character.work_days.includes(dayOfWeek);
      const isStudentEnrolled = character.student_status === 'enrolled';

      charLoop.steps['2_CHECK_SCHEDULE'] = {
        isWorkDay,
        isStudentEnrolled,
        workStart: character.work_start_time || null,
        workEnd: character.work_end_time || null,
      };

      // STEP 3: CHECK LOCATION VALIDITY
      const resolvedLoc = character.resolved_current_location_id ? locationMap[character.resolved_current_location_id] : null;
      const homeLoc = character.current_home_location_id ? locationMap[character.current_home_location_id] : null;

      const resolvedValid = !character.resolved_current_location_id || !!resolvedLoc;
      const homeValid = !character.current_home_location_id || !!homeLoc;

      if (!resolvedValid) {
        charLoop.violations.push('resolved_current_location_id references non-existent location');
      }
      if (!homeValid) {
        charLoop.violations.push('current_home_location_id references non-existent location');
      }

      charLoop.steps['3_CHECK_LOCATION_VALIDITY'] = {
        resolvedLocationValid: resolvedValid,
        homeLocationValid: homeValid,
        resolvedLocationName: resolvedLoc?.name || null,
        resolvedPresence: character.resolved_presence_status || 'unknown',
      };

      // STEP 4: LOCATION HOURS VALIDATION — report only
      if (resolvedLoc && resolvedLoc.operating_hours && resolvedLoc.operating_hours.length > 0) {
        const todayHours = resolvedLoc.operating_hours.find(h => h.day_of_week === dayOfWeek);
        
        if (todayHours) {
          const [openHour] = todayHours.open_time.split(':').map(Number);
          const [closeHour] = todayHours.close_time.split(':').map(Number);
          const currentlyOpen = currentHour >= openHour && currentHour < closeHour;

          if (!currentlyOpen) {
            charLoop.violations.push(`Character at ${resolvedLoc.name} but location is closed (${todayHours.open_time}-${todayHours.close_time}). Will be routed home by autonomousCharacterMovement.`);
          }
        }
      }

      charLoop.steps['4_LOCATION_HOURS'] = {
        locationName: resolvedLoc?.name || null,
        isClosed: resolvedLoc ? !(resolvedLoc.operating_hours?.length ? /* computed above */ charLoop.violations.some(v => v.includes('but location is closed')) : false) : false,
      };

      // STEP 5: USER INFLUENCE — log only
      charLoop.steps['5_USER_INFLUENCE'] = {
        note: 'Managed during chat/travel interactions',
        stayLocked: character.presence_stay_lock === true,
        autonomousTravelEnabled: true, // determined per-user by autonomousCharacterMovement
      };

      // STEP 6: REPORT LOCATION CONSISTENCY — NO WRITE
      // The authoritative systems (autonomousCharacterMovement, simulateActiveCharacterNeeds)
      // own all location decisions. We report discrepancies only.
      const presenceStatus = character.resolved_presence_status || '';
      const sourceReason = character.resolved_source_reason || '';
      const locationType = character.resolved_location_type || '';

      let recommendation = null;
      if (presenceStatus === 'home' && locationType !== 'home') {
        recommendation = 'presence/location type mismatch — presence says home but location_type does not. autonomousCharacterMovement will normalize.';
      }
      if (presenceStatus === 'at_work' && locationType !== 'work') {
        recommendation = 'presence/location type mismatch — at_work but location_type is not work. autonomousCharacterMovement work dispatch will normalize.';
      }
      if (presenceStatus === 'traveling' && !character.travel_status) {
        recommendation = 'traveling presence without travel_status field — may be orphaned. autonomousCharacterMovement orphaned-travel guard will clear.';
      }

      charLoop.steps['6_REPORT_LOCATION'] = {
        presenceStatus,
        sourceReason,
        locationType,
        resolvedLocationName: resolvedLoc?.name || null,
        recommendation,
      };

      if (recommendation) {
        charLoop.violations.push(recommendation);
      }

      // STEP 7: PRESENCE CONSISTENCY — report only
      charLoop.steps['7_PRESENCE_CONSISTENCY'] = {
        presence: presenceStatus,
        location: resolvedLoc?.name || null,
        travelStatus: character.travel_status || 'not_traveling',
      };

      coreLoopReport.charactersProcessed++;
      coreLoopReport.violationsFound += charLoop.violations.length;

      if (charLoop.violations.length > 0) {
        coreLoopReport.details.push(charLoop);
      }
    }

    coreLoopReport.systemStatus = {
      charactersProcessed: coreLoopReport.charactersProcessed,
      totalViolations: coreLoopReport.violationsFound,
      systemHealth: coreLoopReport.violationsFound === 0 ? 'HEALTHY' : `${coreLoopReport.violationsFound} ISSUES REPORTED (not auto-corrected — autonomous systems handle corrections)`
    };

    return Response.json(coreLoopReport);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});