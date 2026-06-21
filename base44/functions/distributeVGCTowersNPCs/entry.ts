import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CANONICAL VGC TOWERS TRAVEL SYSTEM
 *
 * Runs every hour (10 AM – 1 AM ET active window, 1–10 AM lockdown).
 * Processes ALL eligible VGC Towers NPC residents every run — no batch cap that abandons residents.
 * Residents are processed sequentially to avoid write storms.
 * ROTATION THRESHOLD: 90 minutes — resident must have been at current location
 *   for at least 90 min before being re-moved.
 *
 * VALID BLOCKERS (only these block travel):
 *   - is_jailed / incarceration_status active / house_arrest_active
 *   - resolved_presence_status: 'incarcerated' | 'house_arrest' | 'confined' | 'hospitalized'
 *   - sleeping (per-character schedule or default overnight 23:00–07:00)
 *   - currently on work schedule (work_days + work_start_time + work_end_time)
 *   - student_status === 'enrolled' during school hours (08:00–15:00)
 *   - presence_state: 'hospitalized' | 'supervised'
 *
 * ownership: owner_email ONLY. No created_by.
 * Uses user-scoped Character reads (only confirmed working path for this app).
 */
const ROTATION_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes

const NPC_ELIGIBLE_TYPES = [
  'npc', 'background', 'npc_fictitious_person', 'npc_fictitious',
  'npc_regular', 'npc_family_member', 'promoted_npc', 'family_npc',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();

    // Parse payload for force flag (admin diagnostic override only)
    let payload = {};
    try { payload = await req.json(); } catch { /* no body */ }
    const forceRun = payload.force === true;

    // LOCKDOWN: 1 AM – 10 AM — no movement, no DB reads
    // forceRun bypasses lockdown for diagnostic/proof testing only
    if (!forceRun && hour >= 1 && hour < 10) {
      return Response.json({
        success: true, mode: 'lockdown',
        message: 'Movement locked 1–10 AM ET. No DB reads.',
        total_vgc_residents: 0, eligible_this_run: 0, moved_this_run: 0,
        deferred_to_next_run: 0, blocked_with_reasons: [], batch_limit_used: BATCH_LIMIT,
        next_safe_batch_window: '10:00 AM ET',
      });
    }

    // Load characters + locations in parallel.
    // OWNERSHIP NOTE: NPC characters may have been created before owner_email was
    // consistently backfilled. We use service role to load ALL active characters,
    // then narrow to VGC Towers residents by home location ID. This is the same
    // strategy used by auditVGCTowersDuplicatesDetailed which correctly finds 13 residents.
    // owner_email filter is applied as a secondary check where the field IS populated.
    // Load locations via service role using the same multi-scope strategy that
    // auditVGCTowersDuplicatesDetailed uses — it correctly finds VGC Towers for all accounts.
    // User-session queries miss VGC Towers when it is stored with scope='account_global'.
    // Step 1: Resolve locations first to get VGC_ID — needed before character fetch
    const [userLocations, accountGlobalLocations, sharedLocations] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ owner_email: user.email }, null, 300),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'account_global' }, null, 300),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }, null, 200),
    ]);

    // Deduplicate locations — user-owned takes precedence, then account_global, then shared
    const seenIds = new Set();
    const allLocations = [...userLocations, ...accountGlobalLocations, ...sharedLocations].filter(l => {
      if (seenIds.has(l.id)) return false;
      seenIds.add(l.id);
      return true;
    });

    // Find THIS user's VGC Towers
    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    if (!vgcTowers) {
      return Response.json({
        error: 'VGC Towers not found',
        allLocationNames: allLocations.map(l => l.name),
      }, { status: 400 });
    }
    const VGC_ID = vgcTowers.id;

    // Step 2: Resident roster and character records.
    // THE SOURCE OF TRUTH: LocationReference.residents[] contains the 13 resident stubs.
    // Character.get() returns 404 under user RLS even via asServiceRole when the character
    // was created by a different owner. The correct read path is filter by owner_email of the
    // VGC Towers location — the location owner IS the character owner for this account.
    // This matches how auditVGCTowersDuplicatesDetailed resolves them.
    const vgcOwnerEmail = vgcTowers.owner_email;
    const residentStubs = vgcTowers.residents || [];
    const legacyResidentIds = vgcTowers.resident_character_ids || [];

    // Load characters via user-scoped query — asServiceRole returns 0 for Character records
    // regardless of owner_email filter when called from a user-authenticated request.
    // User-scoped filter is the only confirmed working path to read this account's characters.
    const allCharactersRaw = await base44.entities.Character.filter(
      { status: 'active' }, null, 500
    );

    // Build resident ID set from the LocationReference roster (both arrays)
    const residentIdSet = new Set([
      ...residentStubs.map(r => r.character_id).filter(Boolean),
      ...legacyResidentIds,
    ]);

    // Narrow: characters whose ID appears in the resident roster OR whose home is this VGC_ID
    const allCharacters = allCharactersRaw.filter(c =>
      residentIdSet.has(c.id) || c.current_home_location_id === VGC_ID
    );

    // DIAGNOSTIC: Log what we found
    const diagnosticNPCTypes = {};
    const diagnosticHomeMismatch = [];
    for (const c of allCharacters) {
      const t = c.character_type || 'undefined';
      diagnosticNPCTypes[t] = (diagnosticNPCTypes[t] || 0) + 1;
      if (!NPC_ELIGIBLE_TYPES.includes(c.character_type)) {
        diagnosticHomeMismatch.push({ name: c.name, type: c.character_type, owner_email: c.owner_email });
      }
    }

    // VGC residents: filtered to NPC types and not protected
    const vgcResidents = allCharacters.filter(c =>
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
      !c.protected_active
    );

    const log = [];
    log.push(`[${hour.toString().padStart(2,'0')}:${minute.toString().padStart(2,'0')} ET] VGC_ID: ${VGC_ID} | total chars loaded: ${allCharacters.length} | chars with this home: ${allCharacters.filter(c=>c.current_home_location_id===VGC_ID).length} | by type: ${JSON.stringify(diagnosticNPCTypes)} | type_blocked: ${JSON.stringify(diagnosticHomeMismatch.map(d=>d.name+':'+d.type))} | VGC residents found: ${vgcResidents.length}`);

    // PRE-FLIGHT: Fix VGC residents with no resolved location (return them home silently)
    // vgcResidents already correctly scoped to this VGC_ID — no additional ownership filter needed
    const preflightFixes = vgcResidents
      .filter(c => !c.resolved_current_location_id || c.resolved_current_location_id.length === 0)
      .map(npc => {
        log.push(`${npc.name} → PREFLIGHT: missing location, restored to VGC Towers`);
        return base44.entities.Character.update(npc.id, {
          resolved_current_location_id: VGC_ID,
          resolved_current_location_name: 'VGC Towers',
          resolved_presence_status: 'home',
          resolved_location_type: 'home',
          resolved_source_reason: 'preflight_fix_vgc_resident',
          presence_state: 'home',
          source_of_move: 'system',
          valid_from: now.toISOString(),
          last_location_update_time: now.toISOString(),
        });
      });
    if (preflightFixes.length > 0) await Promise.all(preflightFixes);

    // Valid social destinations: real LocationReference records only
    const socialLocations = allLocations.filter(loc => {
      if (loc.id === VGC_ID) return false;
      if (loc.category === 'home') return false;
      if (loc.location_type === 'character_specific') return false;
      if (loc.scope === 'character_specific') return false;
      const isUserOwned = loc.owner_email === user.email;
      const isShared = loc.scope === 'shared';
      if (!isUserOwned && !isShared) return false;
      if (isLocationClosed(loc, nowET)) return false;
      return true;
    });

    if (socialLocations.length === 0) {
      return Response.json({
        success: true, mode: 'no_destinations',
        message: 'No valid open social locations available',
        total_vgc_residents: vgcResidents.length,
        eligible_this_run: 0, moved_this_run: 0, deferred_to_next_run: 0,
        blocked_with_reasons: [], batch_limit_used: BATCH_LIMIT,
        next_safe_batch_window: getNextWindowLabel(hour),
        log,
      });
    }

    // ── ELIGIBILITY CHECK ──────────────────────────────────────────────────────
    const PRE_SLEEP_WINDOW_MINUTES = 60;
    const eligible = [];
    const blocked_with_reasons = [];

    for (const npc of vgcResidents) {
      const blockReason = forceRun ? null : getBlockReason(npc, nowET, PRE_SLEEP_WINDOW_MINUTES);
      if (blockReason) {
        // SLEEPING NPC AWAY FROM VGC TOWERS: return home immediately.
        // Do NOT leave them stranded at a public venue during their sleep window.
        const isAwayFromVGC = npc.resolved_current_location_id && npc.resolved_current_location_id !== VGC_ID;
        if (blockReason === 'sleeping' && isAwayFromVGC) {
          try {
            await base44.entities.Character.update(npc.id, {
              resolved_current_location_id: VGC_ID,
              resolved_current_location_name: 'VGC Towers',
              resolved_presence_status: 'home',
              resolved_location_type: 'home',
              resolved_source_reason: 'sleep_return_from_venue',
              presence_state: 'home',
              presence_reason: 'sleep_return',
              location_status: 'home',
              source_of_move: 'system',
              valid_from: now.toISOString(),
              valid_until: null,
              return_location_id: null,
              last_vgc_travel_at: null,
              next_move_at: null,
              last_location_update_time: now.toISOString(),
            });
            log.push(`${npc.name} → SLEEP-RETURN: returned to VGC Towers (sleeping at venue)`);
          } catch (err) {
            log.push(`${npc.name} → SLEEP-RETURN FAILED: ${err.message}`);
          }
          continue;
        }
        blocked_with_reasons.push({ name: npc.name, reason: blockReason });
        log.push(`${npc.name} → BLOCKED: ${blockReason}`);
        continue;
      }

      // Resident already out and not yet due for rotation — keep them there
      const isAlreadyOut = npc.presence_state === 'social_visit' &&
        npc.resolved_current_location_id &&
        npc.resolved_current_location_id !== VGC_ID;
      if (isAlreadyOut && !shouldRotate(npc, ROTATION_THRESHOLD_MS, now)) {
        const nextRotate = npc.valid_from
          ? new Date(new Date(npc.valid_from).getTime() + ROTATION_THRESHOLD_MS)
              .toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
          : 'N/A';
        log.push(`${npc.name} → staying at ${npc.resolved_current_location_name} (next rotation eligible: ${nextRotate})`);
        continue;
      }

      eligible.push(npc);
    }

    // ── PRIORITY ORDERING: longest-waiting since last VGC travel first ─────────
    eligible.sort((a, b) => {
      const aTime = a.last_vgc_travel_at ? new Date(a.last_vgc_travel_at).getTime() : 0;
      const bTime = b.last_vgc_travel_at ? new Date(b.last_vgc_travel_at).getTime() : 0;
      return aTime - bTime; // ascending: oldest travel time first
    });

    // ── PROCESS ALL ELIGIBLE RESIDENTS — no cap that abandons residents ────────
    // All eligible residents are processed in this run, sequentially to avoid write storms.
    const thisBatch = eligible;
    const deferred = []; // Nothing is ever deferred — all eligible residents are processed now.

    const updates = [];
    const occupancyMap = new Map();

    for (const npc of thisBatch) {
      // Age filter: under-21 cannot go to bars/clubs
      const npcAge = npc.age || null;
      const ageSafe = socialLocations.filter(loc => {
        if (npcAge && npcAge < 21) {
          if (loc.age_restricted) return false;
          const n = loc.name.toLowerCase();
          if (['bar', 'club', 'lounge', 'pub', 'tavern', 'nightclub'].some(kw => n.includes(kw))) return false;
        }
        return true;
      });

      const pool = ageSafe.length > 0 ? ageSafe : socialLocations;
      // Prefer a different location from where they currently are
      const differentPool = pool.filter(l => l.id !== npc.resolved_current_location_id);
      const finalPool = differentPool.length > 0 ? differentPool : pool;

      const selectedLoc = pickByGravity(finalPool, occupancyMap, nowET);
      // Track occupancy for this run to spread residents across destinations
      occupancyMap.set(selectedLoc.id, (occupancyMap.get(selectedLoc.id) || 0) + 1);

      const isRotation = npc.presence_state === 'social_visit' &&
        npc.resolved_current_location_id !== VGC_ID;
      const reason = isRotation ? 'vgc_rotation' : 'vgc_distribution';
      const nextMoveTime = new Date(now.getTime() + ROTATION_THRESHOLD_MS);

      updates.push({
        id: npc.id,
        name: npc.name,
        dest: selectedLoc.name,
        data: {
          // All required movement fields
          resolved_current_location_id: selectedLoc.id,
          resolved_current_location_name: selectedLoc.name,
          resolved_location_type: 'visit',
          resolved_presence_status: 'visiting',
          resolved_source_reason: reason,
          location_status: 'at_location',
          presence_state: 'social_visit',
          presence_reason: reason,
          source_of_move: 'system',
          valid_from: now.toISOString(),
          valid_until: new Date(now.getTime() + ROTATION_THRESHOLD_MS * 2).toISOString(),
          last_location_update_time: now.toISOString(),
          last_arrived_time: now.toISOString(),
          return_location_id: VGC_ID,
          next_move_at: nextMoveTime.toISOString(),
          current_travel_block: getTravelBlock(hour),
          vgc_travel_day_active: true,
          // Fairness tracking field — used for priority ordering next run
          last_vgc_travel_at: now.toISOString(),
        },
      });

      log.push(`${npc.name} → ${selectedLoc.name} (${reason})`);
    }

    // Write batch — sequential to avoid simultaneous write storm
    for (const u of updates) {
      await base44.entities.Character.update(u.id, u.data);
    }

    // SELF-HEAL: VGC residents missing location after batch (shouldn't happen, safety net)
    const selfHealUpdates = [];
    for (const npc of vgcResidents) {
      if (updates.find(u => u.id === npc.id)) continue; // already moved this run
      if (npc.resolved_current_location_id && npc.resolved_current_location_id.length > 0) continue;
      selfHealUpdates.push(base44.entities.Character.update(npc.id, {
        resolved_current_location_id: VGC_ID,
        resolved_current_location_name: 'VGC Towers',
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'self_heal_vgc_missing_location',
        presence_state: 'home',
        source_of_move: 'system',
        valid_from: now.toISOString(),
        last_location_update_time: now.toISOString(),
      }));
      log.push(`${npc.name} → SELF-HEAL: missing location after batch, returned home`);
    }
    if (selfHealUpdates.length > 0) await Promise.all(selfHealUpdates);

    // PROOF READ-BACK: verify one moved resident stayed at the destination
    let proofCheck = null;
    if (updates.length > 0) {
      const proofTarget = updates[0];
      // Proof read-back: user-scoped query (same confirmed working path as main load)
      const freshAllForProof = await base44.entities.Character.filter(
        { status: 'active' }, null, 500
      );
      const freshRecord = freshAllForProof.find(c => c.id === proofTarget.id);
      proofCheck = {
        name: proofTarget.name,
        expected_destination: proofTarget.dest,
        actual_resolved_location: freshRecord?.resolved_current_location_name,
        actual_presence_status: freshRecord?.resolved_presence_status,
        actual_valid_from: freshRecord?.valid_from,
        stayed_moved: freshRecord?.resolved_current_location_id === proofTarget.data.resolved_current_location_id,
      };
      log.push(`PROOF: ${proofTarget.name} → expected: ${proofTarget.dest}, actual: ${freshRecord?.resolved_current_location_name}, stayed_moved: ${proofCheck.stayed_moved}`);
    }

    const nextWindowLabel = getNextWindowLabel(hour);

    return Response.json({
      success: true,
      mode: 'active',
      timestamp: now.toISOString(),
      hoursET: hour,
      currentBlock: getTravelBlock(hour),
      total_vgc_residents: vgcResidents.length,
      eligible_this_run: eligible.length,
      moved_this_run: updates.length,
      deferred_to_next_run: deferred.length,
      deferred_names: deferred.map(d => d.name),
      blocked_with_reasons,
      next_window: nextWindowLabel,
      social_destinations_available: socialLocations.length,
      proof_check: proofCheck,
      log,
    });

  } catch (error) {
    console.error('[distributeVGCTowersNPCs]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});

// ── HELPERS ──────────────────────────────────────────────────────────────────

function getBlockReason(npc, nowET, preSleepWindowMin) {
  // Confinement / jail — hard block (always enforced)
  if (npc.is_jailed) return 'jailed';
  if (npc.house_arrest_active) return 'house_arrest';
  if (['incarcerated', 'house_arrest', 'confined'].includes(npc.resolved_presence_status)) {
    return npc.resolved_presence_status;
  }
  if (['hospitalized', 'supervised'].includes(npc.presence_state)) return npc.presence_state;

  // Work schedule
  if (isOnWorkSchedule(npc, nowET)) return 'at_work';

  // School hours
  if (npc.student_status === 'enrolled' && npc.education_location_id) {
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    if (nowMin >= 480 && nowMin < 900) return 'at_school'; // 8 AM – 3 PM
  }

  // ── SLEEP BLOCKER: LOCKDOWN-ONLY ─────────────────────────────────────────
  // VGC Towers residents follow the VGC travel schedule, NOT individual sleep
  // schedules during the active window (10 AM – 1 AM ET). Sleep only blocks
  // travel during the lockdown window (1 AM – 10 AM ET) when residents should
  // be home resting. During active hours, residents are awake and eligible.
  // The 1 AM return-home automation handles bringing them back.
  const hour = nowET.getHours();
  const isLockdown = hour >= 1 && hour < 10;
  
  if (isLockdown) {
    // During lockdown, sleep IS a valid blocker — no travel at all
    if (isNPCSleeping(npc, nowET)) return 'sleeping';
    if (isNPCInPreSleepWindow(npc, nowET, preSleepWindowMin)) return 'pre_sleep_window';
  }
  // During active window (10 AM – 1 AM): sleep is NEVER a blocker.
  // VGC residents are awake and eligible for travel regardless of clock.

  return null; // eligible
}

function isNPCSleeping(npc, etNow) {
  if (!npc.sleep_start_time || !npc.wake_up_time) {
    const h = etNow.getHours();
    return h >= 23 || h < 7;
  }
  const nowMin = etNow.getHours() * 60 + etNow.getMinutes();
  const [sh, sm] = npc.sleep_start_time.split(':').map(Number);
  const [wh, wm] = npc.wake_up_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const wakeMin = wh * 60 + wm;
  if (startMin > wakeMin) return nowMin >= startMin || nowMin < wakeMin;
  return nowMin >= startMin && nowMin < wakeMin;
}

function isNPCInPreSleepWindow(npc, etNow, windowMin) {
  if (!npc.sleep_start_time) return false;
  const nowMin = etNow.getHours() * 60 + etNow.getMinutes();
  const [sh, sm] = npc.sleep_start_time.split(':').map(Number);
  const sleepStart = sh * 60 + sm;
  const windowStart = (sleepStart - windowMin + 1440) % 1440;
  if (windowStart > sleepStart) return nowMin >= windowStart || nowMin < sleepStart;
  return nowMin >= windowStart && nowMin < sleepStart;
}

function isOnWorkSchedule(npc, nowET) {
  if (!npc.work_days || !npc.work_start_time || !npc.work_end_time) return false;
  const dayOfWeek = nowET.getDay();
  if (!npc.work_days.includes(dayOfWeek)) return false;
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm] = npc.work_start_time.split(':').map(Number);
  const [eh, em] = npc.work_end_time.split(':').map(Number);
  return nowMin >= sh * 60 + sm && nowMin < eh * 60 + em;
}

function shouldRotate(npc, thresholdMs, now) {
  if (!npc.valid_from) return true;
  return (now.getTime() - new Date(npc.valid_from).getTime()) >= thresholdMs;
}

function getTravelBlock(hour) {
  if (hour >= 10 && hour < 14) return 'MORNING';
  if (hour >= 14 && hour < 18) return 'AFTERNOON';
  if (hour >= 18 && hour < 22) return 'EVENING';
  if (hour >= 22) return 'WRAPUP';
  return null;
}

function getNextWindowLabel(hour) {
  if (hour < 10) return '10:00 AM ET';
  if (hour < 12) return '12:00 PM ET';
  if (hour < 14) return '2:00 PM ET';
  if (hour < 16) return '4:00 PM ET';
  if (hour < 18) return '6:00 PM ET';
  if (hour < 20) return '8:00 PM ET';
  if (hour < 22) return '10:00 PM ET';
  return '10:00 AM ET (next day)';
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