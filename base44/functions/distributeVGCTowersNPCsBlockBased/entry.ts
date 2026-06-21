import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * VGC TOWERS NPC TRAVEL — REPAIRED (2026-06-21)
 *
 * Boundary-strict VGC Towers NPC distribution function.
 *
 * HARD BOUNDARIES:
 * - Character RLS is NOT modified.
 * - autonomous_travel_enabled is NEVER used.
 * - active_created_character records are NEVER processed.
 * - Global Character reads are NOT used.
 * - Financial systems are untouched.
 *
 * AUTHORITY: VGC Towers LocationReference.resident_character_ids roster only.
 *
 * ACTIVE WINDOW: 10:00 AM – 1:00 AM Eastern
 * LOCKDOWN WINDOW: 1:00 AM – 10:00 AM (returns strays home only)
 */

const BATCH_SIZE = 5;
const ROTATION_THRESHOLD_MS = 90 * 60 * 1000;

const VGC_ELIGIBLE_TYPES = new Set([
  'npc_regular', 'npc_family_member', 'npc_fictitious',
  'family_npc', 'npc', 'background', 'npc_fictitious_person', 'promoted_npc'
]);

// ── CHUNK HELPER ───────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── VGC RESIDENT LOADER ───────────────────────────────────────────────────────
// Fetches ONLY the Character records whose IDs appear in the VGC Towers roster.
// Uses targeted id-based lookups. If any ID cannot be fetched, it is logged and
// skipped — the function continues with whatever residents can be safely accessed.

async function loadRosterResidents(base44, residentIds, ownerEmail, phaseLog) {
  if (!residentIds || residentIds.length === 0) {
    phaseLog.push(`  [ROSTER] No resident_character_ids on this VGC Towers record`);
    return { residents: [], unavailable: [] };
  }

  phaseLog.push(`  [ROSTER] ${residentIds.length} resident IDs referenced`);

  const residents = [];
  const unavailable = [];

  // Fetch residents individually by ID to avoid broad scans.
  // asServiceRole + specific id filter is the narrowest access path.
  for (const rid of residentIds) {
    try {
      const results = await base44.asServiceRole.entities.Character.filter(
        { id: rid, status: 'active' }, null, 1
      );
      if (results && results.length > 0) {
        residents.push(results[0]);
      } else {
        unavailable.push({ id: rid, reason: 'NOT_FOUND_OR_INACTIVE' });
      }
    } catch (err) {
      unavailable.push({ id: rid, reason: `FETCH_ERROR: ${err.message}` });
    }
  }

  phaseLog.push(`  [ROSTER] ${residents.length} residents fetched, ${unavailable.length} unavailable`);
  if (unavailable.length > 0) {
    phaseLog.push(`  [ROSTER] UNAVAILABLE: ${unavailable.map(u => `${u.id.slice(0,8)}... (${u.reason})`).join(', ')}`);
  }

  return { residents, unavailable };
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

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 0: VGC TRAVEL GATE (VGC-specific, NOT autonomous_travel_enabled)
  // ══════════════════════════════════════════════════════════════════════════
  const ts = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ET`;
  const isLockdown = hour >= 1 && hour < 10;

  if (isLockdown && !forceRun) {
    phaseLog.push(`[PHASE 0] ${ts} | LOCKDOWN — returning strays only, no distribution`);
  } else if (!isLockdown) {
    phaseLog.push(`[PHASE 0] ${ts} | ACTIVE WINDOW — distribution + rotation enabled`);
  } else {
    phaseLog.push(`[PHASE 0] ${ts} | LOCKDOWN OVERRIDE (force=true)`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: LOAD VGC TOWERS LOCATIONS
  // ══════════════════════════════════════════════════════════════════════════
  phaseLog.push('[PHASE 1] Loading VGC Towers locations...');

  const [accountLocations, sharedLocations] = await Promise.all([
    base44.asServiceRole.entities.LocationReference.filter({ scope: 'account_global' }, null, 500),
    base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }, null, 200),
  ]);

  const seenIds = new Set();
  const allLocations = [...accountLocations, ...sharedLocations].filter(l => {
    if (seenIds.has(l.id)) return false;
    seenIds.add(l.id);
    return true;
  });

  const vgcTowersList = allLocations.filter(l => l.name === 'VGC Towers');
  phaseLog.push(`[PHASE 1] ${allLocations.length} locations | ${vgcTowersList.length} VGC Towers`);

  if (vgcTowersList.length === 0) {
    return Response.json({
      success: true, status: 'NO_VGC_TOWERS',
      hoursET: hour, minutesET: minute,
      moved: 0, returned: 0, blocked: 0, skipped: 0, unavailable: 0,
      activeCreatedCount: 0, totalBatches: 0, batchResults: [],
      phaseLog,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PER-ACCOUNT PROCESSING
  // ══════════════════════════════════════════════════════════════════════════
  let totalMoved = 0;
  let totalReturned = 0;
  let totalBlocked = 0;
  let totalSkipped = 0;
  let totalUnavailable = 0;
  let activeCreatedCount = 0;
  let totalBatches = 0;
  const allBatchResults = [];

  for (const vgcTowers of vgcTowersList) {
    const VGC_ID = vgcTowers.id;
    const ownerEmail = vgcTowers.owner_email;

    if (!ownerEmail) {
      phaseLog.push(`[ACCOUNT SKIP] VGC ${VGC_ID.slice(0, 8)}... — no owner_email`);
      continue;
    }

    phaseLog.push(`[ACCOUNT] ${ownerEmail} | VGC Towers ID=${VGC_ID.slice(0, 8)}...`);

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2: EXTRACT RESIDENT IDS FROM ROSTER (authority: LocationReference)
    // ════════════════════════════════════════════════════════════════════════
    const rosterIds = [
      ...(vgcTowers.resident_character_ids || []),
      ...((vgcTowers.residents || []).map(r => r.character_id).filter(Boolean)),
    ];
    // deduplicate
    const uniqueRosterIds = [...new Set(rosterIds)];

    phaseLog.push(`[PHASE 2] [${ownerEmail}] ${uniqueRosterIds.length} unique resident IDs in roster`);

    if (uniqueRosterIds.length === 0) {
      phaseLog.push(`[${ownerEmail}] No resident IDs in roster — skipping`);
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3: FETCH ONLY ROSTER-REFERENCED RESIDENT RECORDS
    // ════════════════════════════════════════════════════════════════════════
    const { residents: allRosterResidents, unavailable } = await loadRosterResidents(
      base44, uniqueRosterIds, ownerEmail, phaseLog
    );
    totalUnavailable += unavailable.length;

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 4: FILTER TO VGC-ELIGIBLE NPC TYPES ONLY
    // ════════════════════════════════════════════════════════════════════════
    // EXCLUDE active_created_character. Count them for proof.
    const activeCreated = allRosterResidents.filter(c => c.character_type === 'active_created_character');
    activeCreatedCount += activeCreated.length;
    if (activeCreated.length > 0) {
      phaseLog.push(`[PHASE 4] [${ownerEmail}] EXCLUDED ${activeCreated.length} active_created_character records`);
    }

    const vgcNpcResidents = allRosterResidents.filter(c => {
      // Exclude active_created_character
      if (c.character_type === 'active_created_character') return false;
      // Include only VGC-eligible NPC types
      if (!VGC_ELIGIBLE_TYPES.has(c.character_type)) return false;
      // Exclude protected
      if (c.protected_active) return false;
      return true;
    });

    phaseLog.push(`[PHASE 4] [${ownerEmail}] ${vgcNpcResidents.length} VGC-eligible NPC residents`);

    if (vgcNpcResidents.length === 0) {
      phaseLog.push(`[${ownerEmail}] No eligible NPC residents after filtering`);
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // LOCKDOWN: Return strays home in batches
    // ════════════════════════════════════════════════════════════════════════
    if (isLockdown && !forceRun) {
      const stray = vgcNpcResidents.filter(npc => npc.resolved_current_location_id !== VGC_ID);
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
              presence_reason: 'lockdown_rest',
              return_location_id: null,
              valid_from: now.toISOString(),
              valid_until: null,
              last_vgc_travel_at: null,
              last_location_update_time: now.toISOString(),
            });
            batchResult.moved++;
            totalReturned++;
            phaseLog.push(`  [B${totalBatches}] ${npc.name} → VGC Towers (lockdown return)`);
          } catch (err) {
            batchResult.failed.push({ name: npc.name, error: err.message });
            phaseLog.push(`  [B${totalBatches}] ${npc.name} → FAILED: ${err.message}`);
          }
        }
        allBatchResults.push(batchResult);
      }
      continue;
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 5: BUILD DESTINATION POOL + ELIGIBILITY FILTERING
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

    phaseLog.push(`[PHASE 5] [${ownerEmail}] ${socialLocations.length} open destinations`);

    if (socialLocations.length === 0) {
      phaseLog.push(`[${ownerEmail}] No valid destinations — all residents stay home`);
      continue;
    }

    const occupancyMap = new Map();
    const eligibleMoves = [];
    let accountBlocked = 0;
    let accountSkipped = 0;

    for (const npc of vgcNpcResidents) {
      const blockReason = getBlockReason(npc, nowET);
      if (blockReason) {
        // SLEEPING NPC AWAY FROM VGC TOWERS: return home immediately.
        // Do NOT leave them stranded at a public venue during their sleep window.
        const isAwayFromVGC = npc.resolved_current_location_id && npc.resolved_current_location_id !== VGC_ID;
        if (blockReason === 'sleeping' && isAwayFromVGC) {
          try {
            await base44.asServiceRole.entities.Character.update(npc.id, {
              resolved_current_location_id: VGC_ID,
              resolved_current_location_name: 'VGC Towers',
              resolved_presence_status: 'home',
              resolved_location_type: 'home',
              resolved_source_reason: 'sleep_return_from_venue',
              presence_state: 'home',
              presence_reason: 'sleep_return',
              return_location_id: null,
              valid_from: now.toISOString(),
              valid_until: null,
              last_vgc_travel_at: null,
              last_location_update_time: now.toISOString(),
            });
            totalReturned++;
            phaseLog.push(`  SLEEP-RETURN: ${npc.name} → VGC Towers (sleeping at venue, returned home)`);
          } catch (err) {
            phaseLog.push(`  SLEEP-RETURN FAILED: ${npc.name} → ${err.message}`);
          }
          continue;
        }
        accountBlocked++;
        totalBlocked++;
        phaseLog.push(`  BLOCKED: ${npc.name} → ${blockReason}`);
        continue;
      }

      const atHome = !npc.resolved_current_location_id || npc.resolved_current_location_id === VGC_ID;

      if (!atHome) {
        const timeAtLoc = now.getTime() - (npc.valid_from ? new Date(npc.valid_from).getTime() : 0);
        if (timeAtLoc < ROTATION_THRESHOLD_MS) {
          accountSkipped++;
          totalSkipped++;
          continue;
        }
      }

      // Age-safe filter
      const npcAge = npc.age || 0;
      const pool = socialLocations.filter(loc => {
        if (npcAge < 21) {
          const n = loc.name.toLowerCase();
          if (['bar', 'club', 'lounge', 'pub', 'tavern', 'nightclub'].some(kw => n.includes(kw))) return false;
        }
        return true;
      });

      const finalPool = pool.length > 0 ? pool : socialLocations;
      const differentPool = finalPool.filter(l => l.id !== npc.resolved_current_location_id);
      const chosenPool = differentPool.length > 0 ? differentPool : finalPool;
      if (chosenPool.length === 0) continue;

      const sel = pickByGravity(chosenPool, occupancyMap, nowET);
      occupancyMap.set(sel.id, (occupancyMap.get(sel.id) || 0) + 1);

      const reason = atHome ? 'vgc_distribution' : 'vgc_rotation';

      eligibleMoves.push({
        id: npc.id,
        name: npc.name,
        destId: sel.id,
        destName: sel.name,
        data: {
          resolved_current_location_id: sel.id,
          resolved_current_location_name: sel.name,
          resolved_presence_status: 'visiting',
          resolved_location_type: 'visit',
          resolved_source_reason: reason,
          presence_state: 'social_visit',
          presence_reason: reason,
          return_location_id: VGC_ID,
          valid_from: now.toISOString(),
          valid_until: new Date(now.getTime() + ROTATION_THRESHOLD_MS * 2).toISOString(),
          last_vgc_travel_at: now.toISOString(),
          last_location_update_time: now.toISOString(),
        },
      });
    }

    phaseLog.push(`[PHASE 5] [${ownerEmail}] ${eligibleMoves.length} eligible | ${accountBlocked} blocked | ${accountSkipped} rotation-skipped`);

    if (eligibleMoves.length === 0) continue;

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 6: FIVE-PERSON BATCH WRITES
    // ════════════════════════════════════════════════════════════════════════
    const batches = chunkArray(eligibleMoves, BATCH_SIZE);
    phaseLog.push(`[PHASE 6] [${ownerEmail}] ${batches.length} batch(es) of ≤${BATCH_SIZE}`);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      totalBatches++;
      const batchResult = { batchNumber: totalBatches, residentCount: batch.length, moved: 0, failed: [], type: 'distribution' };

      phaseLog.push(`  [BATCH ${totalBatches}] ${batch.length} NPCs`);

      for (const move of batch) {
        try {
          await base44.asServiceRole.entities.Character.update(move.id, move.data);
          batchResult.moved++;
          totalMoved++;
          phaseLog.push(`    ✓ ${move.name} → ${move.destName}`);
        } catch (err) {
          batchResult.failed.push({ name: move.name, dest: move.destName, error: err.message });
          phaseLog.push(`    ✗ ${move.name} → FAILED: ${err.message}`);
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

  phaseLog.push(`[SUMMARY] status=${status} mode=${mode} accounts=${vgcTowersList.length} batches=${totalBatches} moved=${totalMoved} returned=${totalReturned} blocked=${totalBlocked} skipped=${totalSkipped} unavailable=${totalUnavailable} activeCreated=${activeCreatedCount}`);

  return Response.json({
    success: partialBatches.length === 0,
    status,
    mode,
    hoursET: hour,
    minutesET: minute,
    accountsProcessed: vgcTowersList.length,
    locationsLoaded: allLocations.length,
    totalBatches,
    moved: totalMoved,
    returned: totalReturned,
    blocked: totalBlocked,
    skipped: totalSkipped,
    unavailable: totalUnavailable,
    activeCreatedCount,
    partialBatches: partialBatches.map(b => ({
      batchNumber: b.batchNumber, failedCount: b.failed.length,
      failures: b.failed.map(f => ({ name: f.name, error: f.error })),
    })),
    batchResults: allBatchResults.map(b => ({
      batchNumber: b.batchNumber, residentCount: b.residentCount,
      moved: b.moved, failed: b.failed.length, type: b.type,
    })),
    phaseLog,
  });
});

// ── BLOCKER DETECTION (VGC NPC residents only) ─────────────────────────────

function getBlockReason(npc, nowET) {
  if (npc.is_jailed) return 'jailed';
  if (npc.house_arrest_active) return 'house_arrest';
  if (['incarcerated', 'house_arrest', 'confined', 'hospitalized'].includes(npc.resolved_presence_status)) {
    return npc.resolved_presence_status;
  }
  if (isNPCSleeping(npc, nowET)) return 'sleeping';
  if (isOnWorkSchedule(npc, nowET)) return 'at_work';
  if (npc.student_status === 'enrolled' && npc.education_location_id) {
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    if (nowMin >= 480 && nowMin < 900) return 'at_school';
  }
  return null;
}

function isNPCSleeping(npc, etNow) {
  const hour = etNow.getHours();
  if (!npc.sleep_start_time || !npc.wake_up_time) return hour >= 23 || hour < 7;
  const nowMin = hour * 60 + etNow.getMinutes();
  const [sh, sm] = npc.sleep_start_time.split(':').map(Number);
  const [wh, wm] = npc.wake_up_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const wakeMin = wh * 60 + wm;
  return startMin > wakeMin ? nowMin >= startMin || nowMin < wakeMin : nowMin >= startMin && nowMin < wakeMin;
}

function isOnWorkSchedule(npc, nowET) {
  if (!npc.work_days || !npc.work_start_time || !npc.work_end_time) return false;
  if (!npc.work_days.includes(nowET.getDay())) return false;
  const [sh, sm] = npc.work_start_time.split(':').map(Number);
  const [eh, em] = npc.work_end_time.split(':').map(Number);
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  return nowMin >= sh * 60 + sm && nowMin < eh * 60 + em;
}

// ── LOCATION HOURS ──────────────────────────────────────────────────────────

function isLocationClosed(location, currentTime) {
  if (!location.operating_hours || location.operating_hours.length === 0) return false;
  const day = currentTime.getDay();
  const cm = currentTime.getHours() * 60 + currentTime.getMinutes();
  const today = location.operating_hours.filter(h => h.day_of_week === day);
  const generic = location.operating_hours.filter(h => h.day_of_week == null);
  const entries = today.length > 0 ? today : generic;
  if (entries.length === 0) return false;
  return !entries.some(h => isInWindow(cm, h.open_time, h.close_time));
}

function isInWindow(cm, openStr, closeStr) {
  if (!openStr || !closeStr) return true;
  const [oh, om] = openStr.split(':').map(Number);
  const [ch, cm2] = closeStr.split(':').map(Number);
  const om2 = oh * 60 + om, cm3 = ch * 60 + cm2;
  return om2 <= cm3 ? cm >= om2 && cm <= cm3 : cm >= om2 || cm <= cm3;
}

// ── GRAVITY ─────────────────────────────────────────────────────────────────

const BASE_POPULARITY = {
  gym: 45, grocery: 40, park: 55, outdoor: 50, food_drink: 65,
  restaurant: 65, social: 75, community: 60, business: 40, public: 50,
  generic: 40, home: 10, workplace: 30, school: 30, medical: 25, church: 35,
};
const TIME_RULES = {
  gym: [[5,9,1.6],[17,20,1.5]], food_drink: [[7,10,1.4],[12,14,1.5],[17,20,1.3]],
  restaurant: [[11,14,1.6],[18,21,1.7]], social: [[18,23,1.8],[14,17,1.3]],
  park: [[8,12,1.5],[15,18,1.4]], grocery: [[10,13,1.5],[16,19,1.6]],
  church: [[8,13,1.8]],
};

function getTimeMult(cat, h) {
  const r = TIME_RULES[cat]; if (!r) return 1.0;
  for (const [s,e,m] of r) { if (h >= s && h < e) return m; }
  return 0.8;
}

function calcGravity(loc, occ, et) {
  const cat = loc.category || 'generic', h = et.getHours();
  const base = typeof loc.popularity_score === 'number' ? loc.popularity_score : (BASE_POPULARITY[cat] ?? 40);
  const tm = getTimeMult(cat, h);
  const sb = occ === 0 ? 0 : occ === 1 ? 5 : occ <= 3 ? 20 : 30;
  return Math.max(1, Math.round(base * tm + sb));
}

function pickByGravity(locs, occMap, et) {
  const w = locs.map(l => ({ l, w: calcGravity(l, occMap.get(l.id) || 0, et) }));
  const total = w.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const { l, w: weight } of w) { r -= weight; if (r <= 0) return l; }
  return w[w.length - 1].l;
}