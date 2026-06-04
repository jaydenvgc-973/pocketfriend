import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CANONICAL VGC TOWERS TRAVEL SYSTEM
 *
 * This is the SOLE canonical VGC Towers distribution function.
 * Called by exactly ONE active automation: "VGC Towers Block-Based Travel Loop (Every Hour)"
 *
 * Runs every hour. Uses service role only — no user session required.
 * Processes ALL accounts' VGC Towers residents independently (strict per-account isolation).
 *
 * ACTIVE WINDOW: 10:00 AM – 1:00 AM Eastern (next day)
 * LOCKDOWN WINDOW: 1:00 AM – 10:00 AM Eastern (rest period)
 *
 * DISTRIBUTION LOGIC:
 * - During ACTIVE WINDOW: ALL eligible residents who are still home are moved out on every run.
 * - Residents already out are rotated if they have been at their current location 90+ minutes.
 * - There is NO batch cap that abandons eligible residents.
 * - Every eligible resident is processed every run until they are out.
 *
 * ROTATION THRESHOLD: 90 minutes minimum at current location before re-assigning.
 *
 * VALID BLOCKERS (only these prevent travel):
 *   - is_jailed / house_arrest_active
 *   - resolved_presence_status: 'incarcerated' | 'house_arrest' | 'confined'
 *   - sleeping (per-character schedule or default overnight 23:00–07:00)
 *   - currently on work schedule (work_days + work_start_time + work_end_time)
 *   - student_status === 'enrolled' during school hours (08:00–15:00)
 *
 * OWNERSHIP: owner_email is the sole authority. created_by is never used.
 */

const NPC_ELIGIBLE_TYPES = ['npc_fictitious', 'npc_regular', 'npc_family_member', 'family_npc', 'npc', 'background', 'npc_fictitious_person', 'promoted_npc'];

const ROTATION_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();

    // Parse payload — force flag allows diagnostic override of lockdown
    let payload = {};
    try { payload = await req.json(); } catch { /* no body */ }
    const forceRun = payload.force === true;

    // LOCKDOWN: 1 AM – 10 AM — rest period, no movement
    const isLockdown = hour >= 1 && hour < 10;
    if (isLockdown && !forceRun) {
      // During lockdown, still return any stray residents who are out back home
      // (handled below after loading data)
    }

    // Load all active characters + locations via service role (no user session needed)
    const [allCharacters, ownerLocations, sharedLocations] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'account_global' }, null, 500),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }, null, 200),
    ]);

    // Deduplicate locations
    const seenLocIds = new Set();
    const allLocations = [...ownerLocations, ...sharedLocations].filter(l => {
      if (seenLocIds.has(l.id)) return false;
      seenLocIds.add(l.id);
      return true;
    });

    // Gather all VGC Towers instances from all location sources
    const allVGCTowers = allLocations.filter(l => l.name === 'VGC Towers');
    if (allVGCTowers.length === 0) {
      return Response.json({ success: true, message: 'No VGC Towers locations found', hoursET: hour });
    }

    // Also load user-owned locations (scope may be 'account_global' or other values)
    // to ensure we have every VGC Towers regardless of scope stored on it
    const userOwnedLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { location_type: 'global' }, null, 500
    );
    const extraVGC = userOwnedLocations.filter(l => l.name === 'VGC Towers' && !allLocations.find(x => x.id === l.id));
    const finalVGCList = [...allVGCTowers, ...extraVGC];

    const globalLog = [];
    let totalMoved = 0;
    let totalReturned = 0;
    let totalBlocked = 0;
    let totalAlreadyOut = 0;

    // ── PROCESS EACH ACCOUNT'S VGC TOWERS INDEPENDENTLY ──────────────────────
    for (const vgcTowers of finalVGCList) {
      const VGC_ID = vgcTowers.id;
      const ownerEmail = vgcTowers.owner_email;

      if (!ownerEmail) {
        globalLog.push(`[SKIP] VGC Towers ${VGC_ID} has no owner_email — skipping`);
        continue;
      }

      // Load characters for this specific owner via owner_email filter
      // This is the confirmed working path for service-role character reads
      const ownerCharacters = await base44.asServiceRole.entities.Character.filter(
        { owner_email: ownerEmail, status: 'active' }, null, 300
      );

      // Build resident ID set from both arrays on the location record
      const residentStubs = vgcTowers.residents || [];
      const legacyResidentIds = vgcTowers.resident_character_ids || [];
      const residentIdSet = new Set([
        ...residentStubs.map(r => r.character_id).filter(Boolean),
        ...legacyResidentIds,
      ]);

      // Residents: characters whose ID is in the roster OR whose home is this VGC_ID
      // AND character type is an eligible NPC type AND not protected
      const vgcResidents = ownerCharacters.filter(c =>
        (residentIdSet.has(c.id) || c.current_home_location_id === VGC_ID) &&
        NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
        c.status === 'active' &&
        !c.protected_active
      );

      if (vgcResidents.length === 0) {
        globalLog.push(`[${ownerEmail}] No eligible NPC residents found for VGC_ID: ${VGC_ID}`);
        continue;
      }

      globalLog.push(`[${ownerEmail}] ${hour.toString().padStart(2,'0')}:${minute.toString().padStart(2,'0')} ET | VGC_ID: ${VGC_ID} | residents: ${vgcResidents.length}`);

      // ── LOCKDOWN MODE: return stray residents home, then stop ─────────────
      if (isLockdown && !forceRun) {
        const stray = vgcResidents.filter(npc => npc.resolved_current_location_id !== VGC_ID);
        for (const npc of stray) {
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
          totalReturned++;
          globalLog.push(`[${ownerEmail}] ${npc.name} → VGC Towers (lockdown return)`);
        }
        continue;
      }

      // ── ACTIVE WINDOW: collect valid destinations ─────────────────────────
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

      if (socialLocations.length === 0) {
        globalLog.push(`[${ownerEmail}] No valid open destinations — all residents stay home`);
        continue;
      }

      // ── ELIGIBILITY + MOVEMENT DECISIONS ─────────────────────────────────
      const occupancyMap = new Map();
      const updates = [];
      const blockedList = [];

      for (const npc of vgcResidents) {
        // Check hard blockers
        const blockReason = getBlockReason(npc, nowET);
        if (blockReason) {
          blockedList.push({ name: npc.name, reason: blockReason });
          totalBlocked++;
          globalLog.push(`[${ownerEmail}] ${npc.name} → BLOCKED: ${blockReason}`);
          continue;
        }

        const isAtHome = !npc.resolved_current_location_id || npc.resolved_current_location_id === VGC_ID;
        const isAlreadyOut = !isAtHome;

        if (isAlreadyOut) {
          // Already out — check rotation threshold
          const timeAtLocation = now.getTime() - (npc.valid_from ? new Date(npc.valid_from).getTime() : 0);
          if (timeAtLocation < ROTATION_THRESHOLD_MS) {
            // Not yet eligible for rotation — keep them there
            const nextRotateET = npc.valid_from
              ? new Date(new Date(npc.valid_from).getTime() + ROTATION_THRESHOLD_MS)
                  .toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
              : 'N/A';
            totalAlreadyOut++;
            globalLog.push(`[${ownerEmail}] ${npc.name} → staying at ${npc.resolved_current_location_name} (rotation eligible: ${nextRotateET} ET)`);
            continue;
          }
          // Past rotation threshold — re-assign to a new location
        }

        // Resident is either at home OR past rotation threshold — assign destination
        const npcAge = npc.age || 0;
        const ageSafeLocations = socialLocations.filter(loc => {
          if (npcAge < 21) {
            const n = loc.name.toLowerCase();
            if (['bar', 'club', 'lounge', 'pub', 'tavern', 'nightclub'].some(kw => n.includes(kw))) return false;
          }
          return true;
        });

        const pool = ageSafeLocations.length > 0 ? ageSafeLocations : socialLocations;
        // Prefer a different location from their current one
        const differentPool = pool.filter(l => l.id !== npc.resolved_current_location_id);
        const finalPool = differentPool.length > 0 ? differentPool : pool;

        if (finalPool.length === 0) {
          globalLog.push(`[${ownerEmail}] ${npc.name} → no valid pool, returned home`);
          updates.push({
            id: npc.id,
            name: npc.name,
            dest: 'VGC Towers',
            data: {
              resolved_current_location_id: VGC_ID,
              resolved_current_location_name: 'VGC Towers',
              resolved_presence_status: 'home',
              resolved_location_type: 'home',
              resolved_source_reason: 'no_valid_destinations_return_home',
              presence_state: 'home',
              source_of_move: 'system',
              valid_from: now.toISOString(),
              last_location_update_time: now.toISOString(),
            },
          });
          continue;
        }

        const selectedLoc = pickByGravity(finalPool, occupancyMap, nowET);
        occupancyMap.set(selectedLoc.id, (occupancyMap.get(selectedLoc.id) || 0) + 1);

        const reason = isAlreadyOut ? 'vgc_rotation' : 'vgc_distribution';

        updates.push({
          id: npc.id,
          name: npc.name,
          dest: selectedLoc.name,
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
        totalMoved++;
        globalLog.push(`[${ownerEmail}] ${npc.name} → ${selectedLoc.name} (${reason})`);
      }

      // Write all updates sequentially with small delay to avoid write storms
      for (const u of updates) {
        await base44.asServiceRole.entities.Character.update(u.id, u.data);
      }

      globalLog.push(`[${ownerEmail}] SUMMARY: residents=${vgcResidents.length} moved=${updates.filter(u=>u.dest !== 'VGC Towers').length} blocked=${blockedList.length} already_stable_out=${totalAlreadyOut}`);
    }

    return Response.json({
      success: true,
      mode: isLockdown && !forceRun ? 'lockdown' : 'active',
      hoursET: hour,
      minutesET: minute,
      totalMoved,
      totalReturned,
      totalBlocked,
      totalAlreadyOut,
      accountsProcessed: allVGCTowers.length,
      log: globalLog,
    });

  } catch (error) {
    console.error('[distributeVGCTowersNPCsBlockBased]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Returns a blocker reason string if the NPC cannot travel right now, null if eligible.
 * Only hard, legitimate blockers are recognized.
 */
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