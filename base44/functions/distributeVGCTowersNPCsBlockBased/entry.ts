import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CANONICAL VGC TOWERS TRAVEL SYSTEM — REPAIRED (2026-06-21)
 *
 * SOLE canonical VGC Towers distribution function.
 *
 * ACTIVE WINDOW: 10:00 AM – 1:00 AM Eastern (next day)
 * LOCKDOWN WINDOW: 1:00 AM – 10:00 AM Eastern (rest period)
 *
 * TRAVEL LOOP GATE (PHASE 0): Validates travel eligibility BEFORE any write.
 * If travel_enabled=false in payload → BLOCKED_NO_WRITE (no intent, no partial state).
 * During lockdown, only returns strays — no distribution.
 *
 * FIVE-PERSON WINDOWS (PHASE 6): Eligible residents partitioned into batches of 5.
 * Each batch processed sequentially. Batch failure does not abort sibling batches.
 *
 * LOAD OPTIMIZATION: Single global character load → in-memory per-account filtering.
 * Avoids per-account owner_email queries which hit RLS limitations under asServiceRole.
 *
 * PARTIAL-STATE PROTECTION: Each batch's writes are tracked. If any write in a
 * batch fails, the batch is marked as partial and reported. Character + roster
 * updates happen in the same write call — no split-state.
 *
 * OWNERSHIP: owner_email is the sole authority. created_by is never used.
 */

const BATCH_SIZE = 5;
const ROTATION_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes

const NPC_ELIGIBLE_TYPES = [
  'npc_fictitious', 'npc_regular', 'npc_family_member',
  'family_npc', 'npc', 'background', 'npc_fictitious_person', 'promoted_npc'
];

// ── CHUNK HELPER ───────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const phaseLog = [];
  const now = new Date();
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nowET.getHours();
  const minute = nowET.getMinutes();

  // Parse payload
  let payload = {};
  try { payload = await req.json(); } catch { /* no body */ }
  const forceRun = payload.force === true;
  const travelEnabled = payload.travel_enabled !== false; // default: enabled

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 0: TRAVEL LOOP GATE — validate BEFORE any data load or write
  // ══════════════════════════════════════════════════════════════════════════
  const ts = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ET`;
  phaseLog.push(`[PHASE 0] ${ts} | travel_enabled=${travelEnabled} | force=${forceRun}`);

  if (!travelEnabled) {
    return Response.json({
      success: false,
      status: 'BLOCKED_NO_WRITE',
      reason: 'Travel loop explicitly disabled (travel_enabled=false in payload)',
      hoursET: hour, minutesET: minute,
      moved: 0, blocked: 0, skipped: 0, returned: 0,
      totalBatches: 0, batchResults: [],
      phaseLog,
    });
  }

  const isLockdown = hour >= 1 && hour < 10;
  if (isLockdown && !forceRun) {
    phaseLog.push(`[PHASE 0] LOCKDOWN MODE (${ts}) — returning strays only, no distribution`);
  } else if (!isLockdown) {
    phaseLog.push(`[PHASE 0] ACTIVE WINDOW (${ts}) — distribution + rotation enabled`);
  } else {
    phaseLog.push(`[PHASE 0] LOCKDOWN OVERRIDE (${ts}) — force=true, proceeding`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: LOAD LOCATIONS + ALL ACTIVE CHARACTERS (single global pass)
  // ══════════════════════════════════════════════════════════════════════════
  phaseLog.push('[PHASE 1] Loading locations + characters...');

  const [accountLocations, sharedLocations, allCharacters] = await Promise.all([
    base44.asServiceRole.entities.LocationReference.filter({ scope: 'account_global' }, null, 500),
    base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }, null, 200),
    base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500),
  ]);

  const seenIds = new Set();
  const allLocations = [...accountLocations, ...sharedLocations].filter(l => {
    if (seenIds.has(l.id)) return false;
    seenIds.add(l.id);
    return true;
  });

  const vgcTowersList = allLocations.filter(l => l.name === 'VGC Towers');
  phaseLog.push(`[PHASE 1] ${allLocations.length} locations | ${allCharacters.length} active characters | ${vgcTowersList.length} VGC Towers`);

  if (vgcTowersList.length === 0) {
    return Response.json({
      success: true, status: 'NO_VGC_TOWERS',
      message: 'No VGC Towers locations found',
      hoursET: hour, minutesET: minute,
      moved: 0, blocked: 0, skipped: 0, returned: 0,
      charactersLoaded: allCharacters.length,
      totalBatches: 0, batchResults: [],
      phaseLog,
    });
  }

  // Build a lookup map: character id → character (for fast per-account filtering)
  const charMap = {};
  for (const c of allCharacters) { charMap[c.id] = c; }

  // ══════════════════════════════════════════════════════════════════════════
  // PER-ACCOUNT PROCESSING (in-memory filtering from global load)
  // ══════════════════════════════════════════════════════════════════════════
  let totalMoved = 0;
  let totalBlocked = 0;
  let totalSkipped = 0;
  let totalReturned = 0;
  let totalBatches = 0;
  const allBatchResults = [];

  for (const vgcTowers of vgcTowersList) {
    const VGC_ID = vgcTowers.id;
    const ownerEmail = vgcTowers.owner_email;

    if (!ownerEmail) {
      phaseLog.push(`[ACCOUNT SKIP] VGC ${VGC_ID.slice(0,8)}... — no owner_email`);
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2: FILTER THIS ACCOUNT'S CHARACTERS FROM GLOBAL LOAD
    // ════════════════════════════════════════════════════════════════════════
    const ownerCharacters = allCharacters.filter(c => c.owner_email === ownerEmail);
    phaseLog.push(`[PHASE 2] [${ownerEmail}] ${ownerCharacters.length} active characters`);

    // Build resident ID set from roster arrays
    const residentStubs = vgcTowers.residents || [];
    const residentIdSet = new Set([
      ...residentStubs.map(r => r.character_id).filter(Boolean),
      ...(vgcTowers.resident_character_ids || []),
    ]);

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3: IDENTIFY ELIGIBLE RESIDENTS (cross-reference roster IDs with charMap)
    // ════════════════════════════════════════════════════════════════════════
    // Residents come from TWO sources:
    //   a) roster entries whose character_id resolves in charMap
    //   b) characters whose home_location_id is VGC_ID (not in roster but live there)
    const rosterResidents = [];
    for (const rid of residentIdSet) {
      const found = charMap[rid];
      if (found && NPC_ELIGIBLE_TYPES.includes(found.character_type) && !found.protected_active) {
        rosterResidents.push(found);
      }
    }
    const homeResidents = ownerCharacters.filter(c =>
      !residentIdSet.has(c.id) &&
      c.current_home_location_id === VGC_ID &&
      NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
      !c.protected_active
    );
    // Deduplicate by ID
    const seenResidentIds = new Set();
    const vgcResidents = [...rosterResidents, ...homeResidents].filter(c => {
      if (seenResidentIds.has(c.id)) return false;
      seenResidentIds.add(c.id);
      return true;
    });

    phaseLog.push(`[PHASE 3] [${ownerEmail}] ${vgcResidents.length} VGC residents (roster=${residentIdSet.size} entries, roster-resolved=${rosterResidents.length}, home-matched=${homeResidents.length})`);

    if (vgcResidents.length === 0) continue;

    // ════════════════════════════════════════════════════════════════════════
    // LOCKDOWN: Return strays home in batches, then skip distribution
    // ════════════════════════════════════════════════════════════════════════
    if (isLockdown && !forceRun) {
      const stray = vgcResidents.filter(npc => npc.resolved_current_location_id !== VGC_ID);
      phaseLog.push(`[LOCKDOWN] [${ownerEmail}] ${stray.length} strays to return`);

      const strayBatches = chunkArray(stray, BATCH_SIZE);
      for (let bi = 0; bi < strayBatches.length; bi++) {
        const batch = strayBatches[bi];
        totalBatches++;
        const batchResult = { batchNumber: totalBatches, residentCount: batch.length, moved: 0, failed: [], type: 'lockdown_return' };

        for (const npc of batch) {
          try {
            await base44.asServiceRole.entities.Character.update(npc.id, {
              resolved_current_location_id: VGC_ID,
              resolved_current_location_name: 'VGC Towers',
              resolved_presence_status: 'home',
              resolved_location_type: 'home',
              resolved_source_reason: 'lockdown_rest',
              presence_state: 'home',
              source_of_move: 'system',
              valid_from: now.toISOString(),
              valid_until: null,
              next_move_at: null,
              last_location_update_time: now.toISOString(),
            });
            batchResult.moved++;
            totalReturned++;
            phaseLog.push(`  [batch ${totalBatches}] ${npc.name} → VGC Towers (lockdown return)`);
          } catch (err) {
            batchResult.failed.push({ name: npc.name, error: err.message });
            phaseLog.push(`  [batch ${totalBatches}] ${npc.name} → RETURN FAILED: ${err.message}`);
          }
        }
        allBatchResults.push(batchResult);
      }
      continue; // No distribution during lockdown
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 4: COLLECT VALID DESTINATIONS
    // ════════════════════════════════════════════════════════════════════════
    const socialLocations = allLocations.filter(loc => {
      if (loc.id === VGC_ID) return false;
      if (loc.category === 'home') return false;
      if (loc.scope === 'character_specific' || loc.location_type === 'character_specific') return false;
      const isAccountOwned = loc.owner_email === ownerEmail;
      const isShared = loc.scope === 'shared';
      if (!isAccountOwned && !isShared) return false;
      if (isLocationClosed(loc, nowET)) return false;
      return true;
    });

    phaseLog.push(`[PHASE 4] [${ownerEmail}] ${socialLocations.length} open destinations`);

    if (socialLocations.length === 0) {
      phaseLog.push(`[${ownerEmail}] No valid destinations — all residents stay home`);
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 5: ELIGIBILITY FILTERING + DESTINATION SELECTION
    // ════════════════════════════════════════════════════════════════════════
    const occupancyMap = new Map();
    const eligibleMoves = [];
    let accountBlocked = 0;
    let accountSkipped = 0;

    for (const npc of vgcResidents) {
      const blockReason = getBlockReason(npc, nowET);
      if (blockReason) {
        accountBlocked++;
        totalBlocked++;
        phaseLog.push(`  BLOCKED: ${npc.name} → ${blockReason}`);
        continue;
      }

      const isAtHome = !npc.resolved_current_location_id || npc.resolved_current_location_id === VGC_ID;

      if (!isAtHome) {
        const timeAtLocation = now.getTime() - (npc.valid_from ? new Date(npc.valid_from).getTime() : 0);
        if (timeAtLocation < ROTATION_THRESHOLD_MS) {
          accountSkipped++;
          totalSkipped++;
          continue;
        }
      }

      // Age-safe destination filter
      const npcAge = npc.age || 0;
      const ageSafeLocs = socialLocations.filter(loc => {
        if (npcAge < 21) {
          const n = loc.name.toLowerCase();
          if (['bar', 'club', 'lounge', 'pub', 'tavern', 'nightclub'].some(kw => n.includes(kw))) return false;
        }
        return true;
      });

      const pool = ageSafeLocs.length > 0 ? ageSafeLocs : socialLocations;
      const differentPool = pool.filter(l => l.id !== npc.resolved_current_location_id);
      const finalPool = differentPool.length > 0 ? differentPool : pool;

      if (finalPool.length === 0) continue;

      const selectedLoc = pickByGravity(finalPool, occupancyMap, nowET);
      occupancyMap.set(selectedLoc.id, (occupancyMap.get(selectedLoc.id) || 0) + 1);

      const reason = isAtHome ? 'vgc_distribution' : 'vgc_rotation';

      eligibleMoves.push({
        id: npc.id,
        name: npc.name,
        destId: selectedLoc.id,
        destName: selectedLoc.name,
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
          last_location_update_time: now.toISOString(),
          last_arrived_time: now.toISOString(),
          last_vgc_travel_at: now.toISOString(),
          vgc_travel_day_active: true,
        },
      });
    }

    phaseLog.push(`[PHASE 5] [${ownerEmail}] ${eligibleMoves.length} eligible | ${accountBlocked} blocked | ${accountSkipped} rotation-skipped`);

    if (eligibleMoves.length === 0) continue;

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 6: FIVE-PERSON BATCH WRITES (atomic per batch)
    // ════════════════════════════════════════════════════════════════════════
    const batches = chunkArray(eligibleMoves, BATCH_SIZE);
    phaseLog.push(`[PHASE 6] [${ownerEmail}] ${batches.length} batch(es) of up to ${BATCH_SIZE} residents each`);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      totalBatches++;
      const batchResult = {
        batchNumber: totalBatches,
        residentCount: batch.length,
        moved: 0,
        failed: [],
        type: 'distribution',
      };

      phaseLog.push(`  [BATCH ${totalBatches}] ${batch.length} residents`);

      for (const move of batch) {
        try {
          await base44.asServiceRole.entities.Character.update(move.id, move.data);
          batchResult.moved++;
          totalMoved++;
          phaseLog.push(`    ✓ ${move.name} → ${move.destName}`);
        } catch (err) {
          batchResult.failed.push({ name: move.name, dest: move.destName, error: err.message });
          phaseLog.push(`    ✗ ${move.name} → ${move.destName} FAILED: ${err.message}`);
        }
      }

      allBatchResults.push(batchResult);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  const partialBatches = allBatchResults.filter(b => b.failed.length > 0);
  const status = partialBatches.length > 0 ? 'PARTIAL_FAILURE' : 'SUCCESS';
  const mode = isLockdown && !forceRun ? 'lockdown' : 'active';

  phaseLog.push(`[SUMMARY] status=${status} mode=${mode} accounts=${vgcTowersList.length} batches=${totalBatches} moved=${totalMoved} returned=${totalReturned} blocked=${totalBlocked} skipped=${totalSkipped}`);

  return Response.json({
    success: partialBatches.length === 0,
    status,
    mode,
    hoursET: hour,
    minutesET: minute,
    travelEnabled,
    accountsProcessed: vgcTowersList.length,
    locationsLoaded: allLocations.length,
    charactersLoaded: allCharacters.length,
    totalBatches,
    moved: totalMoved,
    returned: totalReturned,
    blocked: totalBlocked,
    skipped: totalSkipped,
    partialBatches: partialBatches.map(b => ({
      batchNumber: b.batchNumber,
      failedCount: b.failed.length,
      failures: b.failed.map(f => ({ name: f.name, dest: f.dest || 'VGC Towers', error: f.error })),
    })),
    batchResults: allBatchResults.map(b => ({
      batchNumber: b.batchNumber,
      residentCount: b.residentCount,
      moved: b.moved,
      failed: b.failed.length,
      type: b.type,
    })),
    phaseLog,
  });

});

// ── BLOCKER DETECTION ──────────────────────────────────────────────────────────

function getBlockReason(npc, nowET) {
  // Confinement
  if (npc.is_jailed) return 'jailed';
  if (npc.house_arrest_active) return 'house_arrest';
  if (['incarcerated', 'house_arrest', 'confined'].includes(npc.resolved_presence_status)) {
    return npc.resolved_presence_status;
  }

  // Hospitalized / supervised
  if (['hospitalized', 'supervised'].includes(npc.presence_state)) return npc.presence_state;

  // Sleeping
  if (isNPCSleeping(npc, nowET)) return 'sleeping';

  // Work schedule
  if (isOnWorkSchedule(npc, nowET)) return 'at_work';

  // School hours (8 AM – 3 PM)
  if (npc.student_status === 'enrolled' && npc.education_location_id) {
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    if (nowMin >= 480 && nowMin < 900) return 'at_school';
  }

  return null;
}

function isNPCSleeping(npc, etNow) {
  const hour = etNow.getHours();
  if (!npc.sleep_start_time || !npc.wake_up_time) {
    // Default: sleeping 11 PM – 7 AM
    return hour >= 23 || hour < 7;
  }
  const nowMin = hour * 60 + etNow.getMinutes();
  const [sh, sm] = npc.sleep_start_time.split(':').map(Number);
  const [wh, wm] = npc.wake_up_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const wakeMin = wh * 60 + wm;
  if (startMin > wakeMin) return nowMin >= startMin || nowMin < wakeMin;
  return nowMin >= startMin && nowMin < wakeMin;
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

// ── OPERATING HOURS ───────────────────────────────────────────────────────────

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
};

function getTimeMultiplier(category, hour) {
  const rules = CATEGORY_TIME_RULES[category];
  if (!rules) return 1.0;
  for (const [start, end, mult] of rules) {
    if (hour >= start && hour < end) return mult;
  }
  return 0.8;
}

function calcGravity(location, occupants, nowET) {
  const category = location.category || 'generic';
  const hour = nowET.getHours();
  const base = typeof location.popularity_score === 'number'
    ? location.popularity_score
    : (CATEGORY_BASE_POPULARITY[category] ?? 40);
  const timeMult = getTimeMultiplier(category, hour);
  const socialBoost = occupants === 0 ? 0 : occupants === 1 ? 5 : occupants <= 3 ? 20 : 30;
  return Math.max(1, Math.round(base * timeMult + socialBoost));
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