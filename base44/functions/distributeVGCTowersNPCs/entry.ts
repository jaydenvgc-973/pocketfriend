import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * VGC TOWERS TRAVEL SYSTEM — BLOCK-BASED MOVEMENT LOOP
 * 
 * Explicit blocks ensure reliable, scheduled movement:
 * - 10:00 AM: DEPARTURE BLOCK — move eligible residents to first destinations
 * - 1:00 PM: MIDDAY BLOCK — re-evaluate, rotate if needed
 * - 4:00 PM: AFTERNOON BLOCK — rotate again
 * - 7:00 PM: EVENING BLOCK — final rotations
 * - 10:00 PM: WRAP-UP BLOCK — prepare for return
 * - 1:00 AM: RETURN-HOME BLOCK (handled by separate automation)
 * 
 * Runs hourly. Current block is determined by time-of-day.
 * Each block re-evaluates eligibility and moves characters appropriately.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    // CRITICAL: Use Eastern Time for all time-of-day logic, not server UTC
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();
    const currentMinutes = hour * 60 + minute;

    // ── FAST LOCKDOWN EXIT (before any DB calls) ─────────────────────────────
    // During 1 AM – 10 AM, movement is disabled. Exit immediately to avoid
    // unnecessary DB reads that contribute to rate limit exhaustion.
    const isLockdown = hour >= 1 && hour < 10;
    if (isLockdown) {
      return Response.json({ success: true, mode: 'lockdown', message: 'Return-home automation active (1-10 AM). No DB reads needed.', distributed: 0 });
    }

    // Define travel blocks explicitly
    const blocks = [
      { name: 'DEPARTURE', start: 10 * 60, end: 13 * 60 },      // 10 AM - 1 PM
      { name: 'MIDDAY', start: 13 * 60, end: 16 * 60 },         // 1 PM - 4 PM
      { name: 'AFTERNOON', start: 16 * 60, end: 19 * 60 },      // 4 PM - 7 PM
      { name: 'EVENING', start: 19 * 60, end: 22 * 60 },        // 7 PM - 10 PM
      { name: 'WRAPUP', start: 22 * 60, end: 25 * 60 },         // 10 PM - 1 AM (wraps to 01:00)
    ];
    
    let currentBlock = null;
    if (currentMinutes >= blocks[0].start && currentMinutes < blocks[4].end) {
      for (const block of blocks) {
        if (currentMinutes >= block.start && currentMinutes < block.end) {
          currentBlock = block.name;
          break;
        }
      }
    }

    // Load this user's characters + ALL locations (user-owned + shared)
    // CRITICAL: Use owner_email ONLY for ownership scoping
    const [allCharacters, userLocations, sharedLocations] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, status: 'active' }),
      base44.entities.LocationReference.filter({ owner_email: user.email }),
      base44.entities.LocationReference.filter({ scope: 'shared' }),
    ]);

    // Merge and deduplicate locations — user-owned takes precedence
    const seenIds = new Set();
    const allLocations = [...userLocations, ...sharedLocations].filter(l => {
      if (seenIds.has(l.id)) return false;
      seenIds.add(l.id);
      return true;
    });

    // Find VGC Towers — search across ALL locations (it may be shared or user-owned)
    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    if (!vgcTowers) return Response.json({ error: 'VGC Towers not found in any locations', allLocationNames: allLocations.map(l => l.name) }, { status: 400 });
    const VGC_ID = vgcTowers.id;

    // ── IDENTIFY VGC TOWERS NPC RESIDENTS ──────────────────────────────────────
    // TRAVEL ELIGIBILITY HARD RULES:
    // 1. Must belong to current user (owner_email OR created_by)
    // 2. character_type must be NPC (NOT active — promoted characters lose travel eligibility)
    // 3. home/residence must be THIS USER's VGC Towers (not a shared or another user's instance)
    // 4. Not protected
    const NPC_ELIGIBLE_TYPES = ['npc', 'background', 'npc_fictitious_person', 'npc_fictitious', 'npc_regular', 'npc_family_member'];
    // NOTE: 'promoted_npc' and 'family_npc' are excluded — promoted means transitioning to active
    
    const log = [];

    // PRE-FLIGHT: Identify NPCs with missing resolved locations.
    // RULE: Missing location does NOT mean "lives at VGC Towers".
    // Only NPCs explicitly assigned to VGC Towers (current_home_location_id === VGC_ID)
    // are eligible for the distribution system. NPCs missing a home are flagged
    // for repair but are NOT relocated here.
    const npcsMissingLocation = allCharacters.filter(c =>
      NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
      !c.protected_active &&
      c.owner_email === user.email &&
      (!c.resolved_current_location_id || c.resolved_current_location_id.length === 0) &&
      c.current_home_location_id === VGC_ID  // Only VGC-assigned residents
    );

    const preflightFixes = [];
    const preflightSkipped = [];  // NPCs missing location that are NOT VGC residents — not touched
    for (const npc of npcsMissingLocation) {
      // NPC is a confirmed VGC resident with no resolved location — return them home.
      preflightFixes.push(
        base44.entities.Character.update(npc.id, {
          resolved_current_location_id: VGC_ID,
          resolved_current_location_name: 'VGC Towers',
          resolved_presence_status: 'home',
          resolved_location_type: 'home',
          resolved_source_reason: 'preflight_fix_vgc_resident',
          presence_state: 'home',
          source_of_move: 'system',
          valid_from: now.toISOString(),
        })
      );
      log.push(`${npc.name} → PREFLIGHT_FIX: VGC resident returned home (was missing resolved location)`);
    }

    // Log NPCs with missing locations that are NOT VGC residents — do not touch them
    allCharacters.filter(c =>
      NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
      !c.protected_active &&
      c.owner_email === user.email &&
      (!c.resolved_current_location_id || c.resolved_current_location_id.length === 0) &&
      c.current_home_location_id !== VGC_ID
    ).forEach(npc => {
      preflightSkipped.push(npc.name);
      log.push(`${npc.name} → PREFLIGHT_SKIP: missing location but not a VGC resident — needs housing repair, not VGC assignment`);
    });

    if (preflightFixes.length > 0) await Promise.all(preflightFixes);
    
    const vgcResidents = allCharacters.filter(c =>
      c.current_home_location_id === VGC_ID &&
      NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
      !c.protected_active &&
      c.owner_email === user.email
    );
    log.push(`[BLOCK: ${currentBlock}] Time: ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ET`);

    // If no active block, return early (safety check)
    if (!currentBlock) {
      log.push('No active travel block at this time.');
      return Response.json({ success: true, mode: 'no_block', message: 'Outside active travel window', distributed: 0, log });
    }

    // ── ACTIVE WINDOW ────────────────────────────────────────────────────────────

    // Valid social destinations:
    // - NOT VGC Towers itself
    // - NOT residential/home category
    // - NOT character-specific locations (prevents cross-account pollution)
    // - NOT closed right now
    // - Must belong to this user OR be a shared location (scope: shared)
    const socialLocations = allLocations.filter(loc => {
      if (loc.id === VGC_ID) return false;
      if (loc.category === 'home') return false;
      if (loc.location_type === 'character_specific') return false;
      if (loc.scope === 'character_specific') return false;
      // Only allow user-owned or shared — never another user's private location
      const isUserOwned = loc.owner_email === user.email;
      const isShared = loc.scope === 'shared';
      if (!isUserOwned && !isShared) return false;
      if (isLocationClosed(loc, nowET)) return false;
      return true;
    });

    if (socialLocations.length === 0) {
      return Response.json({ success: true, mode: 'active', message: 'No valid social locations open', distributed: 0, log });
    }

    // ── ELIGIBILITY CHECK ─────────────────────────────────────────────────────
    const BLOCKED_STATES = ['work', 'school', 'hospital', 'supervised'];
    const PRE_SLEEP_WINDOW_MINUTES = 60;

    // Per-character sleep schedule check (replaces hardcoded 2-8 AM)
    function isNPCSleeping(npc, etNow) {
      if (!npc.sleep_start_time || !npc.wake_up_time) {
        // Fallback: default overnight window 23:00–07:00
        const h = etNow.getHours();
        return h >= 23 || h < 7;
      }
      const now = etNow.getHours() * 60 + etNow.getMinutes();
      const [sh, sm] = npc.sleep_start_time.split(':').map(Number);
      const [wh, wm] = npc.wake_up_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const wakeMin = wh * 60 + wm;
      if (startMin > wakeMin) return now >= startMin || now < wakeMin;
      return now >= startMin && now < wakeMin;
    }

    function isNPCInPreSleepWindow(npc, etNow) {
      if (!npc.sleep_start_time) return false;
      const now = etNow.getHours() * 60 + etNow.getMinutes();
      const [sh, sm] = npc.sleep_start_time.split(':').map(Number);
      const sleepStart = sh * 60 + sm;
      const windowStart = (sleepStart - PRE_SLEEP_WINDOW_MINUTES + 1440) % 1440;
      if (windowStart > sleepStart) return now >= windowStart || now < sleepStart;
      return now >= windowStart && now < sleepStart;
    }

    const eligible = [];
    const ineligible = [];

    for (const npc of vgcResidents) {
      if (BLOCKED_STATES.includes(npc.presence_state)) {
        ineligible.push({ name: npc.name, reason: npc.presence_state });
        continue;
      }
      if (isNPCSleeping(npc, nowET)) {
        ineligible.push({ name: npc.name, reason: 'sleeping_schedule' });
        continue;
      }
      if (isNPCInPreSleepWindow(npc, nowET)) {
        ineligible.push({ name: npc.name, reason: 'pre_sleep_return_window' });
        continue;
      }
      if (isOnWorkSchedule(npc, nowET)) {
        ineligible.push({ name: npc.name, reason: 'work_schedule' });
        continue;
      }
      eligible.push(npc);
    }

    // ── BLOCK-BASED MOVEMENT ─────────────────────────────────────────
    // Each block evaluates movement independently.
    // Rotation threshold: 30 minutes from last move, OR first move of the day.
    const ROTATION_THRESHOLD_MS = 30 * 60 * 1000;
    const updates = [];

    for (let i = 0; i < eligible.length; i++) {
      const npc = eligible[i];

      const needsRotation = shouldRotate(npc, ROTATION_THRESHOLD_MS, now);
      const isAlreadyOut = npc.presence_state === 'social_visit' &&
        npc.resolved_current_location_id &&
        npc.resolved_current_location_id !== VGC_ID;

      // SELF-HEAL: If away but next_move_at is missing/stale, recalculate
      if (isAlreadyOut && !npc.valid_from) {
        log.push(`${npc.name} → SELF-HEAL: Missing valid_from, forcing rotation`);
        // Fall through to move
      } else if (isAlreadyOut && !needsRotation) {
        log.push(`${npc.name} → staying at ${npc.resolved_current_location_name} (moved within last 30min, next check at ${new Date(new Date(npc.valid_from).getTime() + ROTATION_THRESHOLD_MS).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })})`);
        continue;
      }

      // Age filter
      const npcAge = npc.age || null;
      const ageFilteredLocations = socialLocations.filter(loc => {
        if (npcAge && npcAge < 21) {
          if (loc.age_restricted) return false;
          const nameLC = loc.name.toLowerCase();
          if (['bar', 'club', 'lounge', 'pub', 'tavern', 'nightclub'].some(kw => nameLC.includes(kw))) return false;
        }
        return true;
      });

      const pool = ageFilteredLocations.length > 0 ? ageFilteredLocations : socialLocations;
      const currentLocId = npc.resolved_current_location_id;
      const differentLocations = pool.filter(l => l.id !== currentLocId);
      const finalPool = differentLocations.length > 0 ? differentLocations : pool;

      // Build current occupancy map from already-queued updates + current resolved locations
      const occupancyMap = new Map();
      for (const u of updates) {
        occupancyMap.set(u.data.resolved_current_location_id, (occupancyMap.get(u.data.resolved_current_location_id) || 0) + 1);
      }
      const selectedLoc = pickByGravity(finalPool, occupancyMap, nowET);

      const reason = (isAlreadyOut && needsRotation) ? 'vgc_rotation' : 'vgc_distribution';
      const nextMoveTime = new Date(now.getTime() + ROTATION_THRESHOLD_MS);
      const nextMoveET = nextMoveTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

      updates.push({
        id: npc.id,
        name: npc.name,
        data: {
          resolved_current_location_id: selectedLoc.id,
          resolved_current_location_name: selectedLoc.name,
          resolved_presence_status: 'visiting',
          resolved_location_type: 'visit',
          resolved_source_reason: reason,
          presence_state: 'social_visit',
          presence_reason: reason,
          source_of_move: 'system',
          valid_from: now.toISOString(),
          valid_until: new Date(now.getTime() + ROTATION_THRESHOLD_MS * 2).toISOString(),
          return_location_id: VGC_ID,
          current_travel_block: currentBlock,
          next_move_at: nextMoveTime.toISOString(),
          vgc_travel_day_active: true,
        }
      });

      log.push(`${npc.name} → ${selectedLoc.name} (${reason}, block: ${currentBlock}, next move: ${nextMoveET})`);
    }

    await Promise.all(updates.map(u => base44.entities.Character.update(u.id, u.data)));

    // FINAL STATE VERIFICATION + SELF-HEAL
    const allFreshChars = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email, status: 'active' });
    
    const finalNPCStates = [];
    const selfHealUpdates = [];

    for (const npc of vgcResidents) {
      const fresh = allFreshChars.find(c => c.id === npc.id) || npc;
      const hasLocation = fresh.resolved_current_location_id && fresh.resolved_current_location_id.length > 0;
      
      // SELF-HEAL #1: No location assigned
      // Only self-heal to VGC Towers if this NPC is a confirmed VGC resident.
      // An NPC without a resolved location that is NOT a VGC resident needs housing
      // repair — NOT relocation to VGC Towers.
      if (!hasLocation) {
        if (fresh.current_home_location_id === VGC_ID) {
          selfHealUpdates.push(base44.entities.Character.update(npc.id, {
            resolved_current_location_id: VGC_ID,
            resolved_current_location_name: 'VGC Towers',
            resolved_presence_status: 'home',
            resolved_location_type: 'home',
            resolved_source_reason: 'self_heal_vgc_resident',
            presence_state: 'home',
            source_of_move: 'system',
            valid_from: now.toISOString(),
            vgc_travel_day_active: false,
            current_travel_block: null,
          }));
          log.push(`${npc.name} → SELF-HEAL #1: VGC resident missing location, returned home`);
          finalNPCStates.push({ name: npc.name, location: 'VGC Towers (self-healed)', presence_state: 'home', flag: 'SELF_HEAL_VGC_RESIDENT' });
        } else {
          log.push(`${npc.name} → SELF-HEAL #1 SKIPPED: no location but not a VGC resident — needs housing repair`);
          finalNPCStates.push({ name: npc.name, location: 'UNRESOLVED', presence_state: 'location_unresolved', flag: 'NEEDS_HOUSING_REPAIR' });
        }
        continue;
      }
      
      // SELF-HEAL #2: Away but no valid_from timestamp
      if (fresh.presence_state === 'social_visit' && !fresh.valid_from) {
        selfHealUpdates.push(base44.entities.Character.update(npc.id, {
          valid_from: now.toISOString(),
          next_move_at: new Date(now.getTime() + ROTATION_THRESHOLD_MS).toISOString(),
          current_travel_block: currentBlock,
        }));
        log.push(`${npc.name} → SELF-HEAL #2: Missing valid_from, reset movement timer`);
      }
      
      finalNPCStates.push({
        name: npc.name,
        location: fresh.resolved_current_location_name,
        presence_state: fresh.presence_state,
        is_traveling: fresh.presence_state === 'social_visit',
        block: fresh.current_travel_block,
        next_move: fresh.next_move_at ? new Date(fresh.next_move_at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) : 'N/A',
      });
    }
    if (selfHealUpdates.length > 0) await Promise.all(selfHealUpdates);

    return Response.json({
      success: true,
      mode: 'active',
      timestamp: now.toISOString(),
      hoursET: hour,
      currentBlock,
      preflightFixed: preflightFixes.length,
      preflightSkipped: preflightSkipped.length,
      totalVGCResidents: vgcResidents.length,
      eligible: eligible.length,
      ineligible,
      moved: updates.length,
      selfHealed: selfHealUpdates.length,
      socialLocationsAvailable: socialLocations.map(l => l.name),
      finalNPCStates,
      log,
    });

  } catch (error) {
    console.error('[distributeVGCTowersNPCs]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});

// ── HELPERS ──────────────────────────────────────────────────────────────────

function shouldRotate(npc, thresholdMs, now) {
  if (!npc.valid_from) return true;
  const movedAt = new Date(npc.valid_from).getTime();
  return (now.getTime() - movedAt) >= thresholdMs;
}

function isOnWorkSchedule(npc, now) {
  if (!npc.work_days || !npc.work_start_time || !npc.work_end_time) return false;
  const dayOfWeek = now.getDay();
  if (!npc.work_days.includes(dayOfWeek)) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = npc.work_start_time.split(':').map(Number);
  const [eh, em] = npc.work_end_time.split(':').map(Number);
  return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em;
}

function isLocationClosed(location, currentTime) {
  if (!location.operating_hours || location.operating_hours.length === 0) return false;
  const dayOfWeek = currentTime.getDay();
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const todayEntries = location.operating_hours.filter(h => h.day_of_week === dayOfWeek);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const entries = todayEntries.length > 0 ? todayEntries : dayAgnostic;
  if (entries.length === 0) return false;
  return !entries.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
}

function isInWindow(currentMinutes, openStr, closeStr) {
  if (!openStr || !closeStr) return true;
  const [oh, om] = openStr.split(':').map(Number);
  const [ch, cm] = closeStr.split(':').map(Number);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  if (openMin <= closeMin) return currentMinutes >= openMin && currentMinutes <= closeMin;
  return currentMinutes >= openMin || currentMinutes <= closeMin;
}

// ── GRAVITY SYSTEM ────────────────────────────────────────────────────────────

const CATEGORY_BASE_POPULARITY = {
  home: 10, workplace: 30, school: 30, gym: 45, grocery: 40,
  medical: 25, hospital: 25, clinic: 25, church: 35, religion: 35,
  park: 55, outdoor: 50, food_drink: 65, restaurant: 65,
  bar: 70, social: 75, community: 60, business: 40, government: 20,
  public: 50, generic: 40,
};

const CATEGORY_TIME_RULES = {
  gym:        [[5, 9, 1.6], [17, 20, 1.5]],
  food_drink: [[7, 10, 1.4], [12, 14, 1.5], [17, 20, 1.3]],
  restaurant: [[11, 14, 1.6], [18, 21, 1.7]],
  bar:        [[20, 23, 1.9], [22, 24, 2.0], [0, 2, 1.7]],
  social:     [[18, 23, 1.8], [14, 17, 1.3]],
  park:       [[8, 12, 1.5], [15, 18, 1.4]],
  grocery:    [[10, 13, 1.5], [16, 19, 1.6]],
  church:     [[8, 13, 1.8]],
  workplace:  [[8, 17, 1.5]],
  school:     [[7, 15, 1.6]],
};

function getTimeMultiplier(category, hour) {
  const rules = CATEGORY_TIME_RULES[category];
  if (!rules) return 1.0;
  for (const [start, end, mult] of rules) {
    if (hour >= start && hour < end) return mult;
  }
  return 0.8;
}

function socialAmplification(count) {
  if (count === 0) return 0;
  if (count === 1) return 5;
  if (count === 2) return 12;
  if (count === 3) return 20;
  if (count <= 5) return 30;
  if (count <= 8) return 42;
  return 55;
}

function calcGravity(location, occupants, nowET) {
  const category = location.category || 'generic';
  const hour = nowET.getHours();
  const base = typeof location.popularity_score === 'number'
    ? location.popularity_score
    : (CATEGORY_BASE_POPULARITY[category] ?? 40);
  const timeMult = getTimeMultiplier(category, hour);
  const social = socialAmplification(occupants);
  const boost = typeof location.activity_boost === 'number' ? location.activity_boost : 0;
  return Math.max(1, Math.round(base * timeMult + social + boost));
}

function pickByGravity(locations, occupancyMap, nowET) {
  const weighted = locations.map(loc => ({
    loc,
    weight: calcGravity(loc, occupancyMap.get(loc.id) || 0, nowET),
  }));
  const total = weighted.reduce((s, w) => s + w.weight, 0);
  let rand = Math.random() * total;
  for (const { loc, weight } of weighted) {
    rand -= weight;
    if (rand <= 0) return loc;
  }
  return weighted[weighted.length - 1].loc;
}