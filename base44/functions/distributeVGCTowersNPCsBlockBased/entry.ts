import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * BLOCK-BASED VGC TOWERS TRAVEL SCHEDULER
 *
 * Runs hourly as a scheduled automation (no user session required).
 * Uses service role for all data access.
 * Processes ALL accounts' VGC Towers residents independently — strict per-account isolation.
 *
 * Daily travel blocks (ET):
 * - 10:00 AM: DEPARTURE — move all home residents out
 * - 1:00 PM:  MIDDAY    — rotate if 3+ hours at location
 * - 4:00 PM:  AFTERNOON — rotate if 3+ hours at location
 * - 7:00 PM:  EVENING   — rotate if 3+ hours at location
 * - 10:00 PM: WRAP_UP   — final position before 1 AM return
 * - 1:00 AM:  Handled by returnVGCResidentsHome automation
 *
 * Lockdown window: 1 AM – 10 AM (residents stay home, cooldown/rest)
 */

// NPC character_type values that live in VGC Towers (matches Character entity schema)
const NPC_ELIGIBLE_TYPES = ['npc_fictitious', 'npc_regular', 'npc_family_member'];

// Travel blocks defined by hour (ET)
const TRAVEL_BLOCKS = [
  { name: 'DEPARTURE',  hour: 10 },
  { name: 'MIDDAY',     hour: 13 },
  { name: 'AFTERNOON',  hour: 16 },
  { name: 'EVENING',    hour: 19 },
  { name: 'WRAP_UP',    hour: 22 },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();
    const currentMinutes = hour * 60 + minute;

    // Lockdown: 1 AM – 10 AM — cooldown/rest, no travel
    const isLockdown = hour >= 1 && hour < 10;

    // Load all active characters + locations via service role
    const [allCharacters, accountLocations, sharedLocations] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'account_global' }, null, 500),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }, null, 200),
    ]);

    // Deduplicate locations
    const seenLocIds = new Set();
    const allLocations = [...accountLocations, ...sharedLocations].filter(l => {
      if (seenLocIds.has(l.id)) return false;
      seenLocIds.add(l.id);
      return true;
    });

    // Find all VGC Towers locations (one per user account)
    const vgcTowersList = allLocations.filter(l => l.name === 'VGC Towers');
    if (vgcTowersList.length === 0) {
      return Response.json({ success: true, message: 'No VGC Towers locations found' });
    }

    const globalLog = [];
    let totalMoved = 0;
    let totalReturned = 0;

    // ── PROCESS EACH ACCOUNT'S VGC TOWERS INDEPENDENTLY ──
    for (const vgcTowers of vgcTowersList) {
      const VGC_ID = vgcTowers.id;
      const ownerEmail = vgcTowers.created_by || vgcTowers.owner_email;

      // Residents of THIS VGC Towers only (account-isolated)
      const vgcResidents = allCharacters.filter(c =>
        c.current_home_location_id === VGC_ID &&
        NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
        !c.protected_active
      );

      if (vgcResidents.length === 0) continue;

      // ── LOCKDOWN: Return anyone still out back home, skip all movement ──
      if (isLockdown) {
        const away = vgcResidents.filter(npc => npc.resolved_current_location_id !== VGC_ID);
        for (const npc of away) {
          globalLog.push(`[${ownerEmail}] ${npc.name} → VGC Towers (lockdown rest)`);
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
          });
          totalReturned++;
        }
        continue; // Don't process movement during lockdown
      }

      // ── ACTIVE WINDOW: Check if this is a block trigger hour ──
      const currentBlock = TRAVEL_BLOCKS.find(b => b.hour === hour);
      if (!currentBlock) {
        globalLog.push(`[${ownerEmail}] Hour ${hour} — no block trigger, skipping`);
        continue;
      }

      globalLog.push(`[${ownerEmail}] BLOCK: ${currentBlock.name} at ${hour}:${String(minute).padStart(2, '0')}`);

      // Valid destinations for this account (account-scoped + shared, open now, non-home)
      const socialLocations = allLocations.filter(loc => {
        if (loc.id === VGC_ID) return false;
        if (loc.category === 'home' || loc.category === 'generic') return false;
        if (loc.scope === 'character_specific') return false;
        const isAccountOwned = loc.created_by === ownerEmail;
        const isShared = loc.scope === 'shared';
        if (!isAccountOwned && !isShared) return false;
        if (isLocationClosed(loc, nowET)) return false;
        return true;
      });

      if (socialLocations.length === 0) {
        globalLog.push(`[${ownerEmail}] No valid destinations — all residents stay home`);
        continue;
      }

      // ── ELIGIBILITY: skip residents blocked by work/school/hospital ──
      const BLOCKED_PRESENCE = ['at_work', 'at_school'];
      const eligible = vgcResidents.filter(npc => {
        if (BLOCKED_PRESENCE.includes(npc.resolved_presence_status)) return false;
        if (npc.resolved_presence_status === 'sleeping' || npc.resolved_presence_status === 'napping') return false;
        if (isOnWorkSchedule(npc, nowET)) return false;
        return true;
      });

      if (eligible.length === 0) {
        globalLog.push(`[${ownerEmail}] No eligible residents for ${currentBlock.name}`);
        continue;
      }

      // ── MOVEMENT DECISION ──
      const occupancyMap = new Map();
      const updates = [];

      for (const npc of eligible) {
        let shouldMove = false;
        let reason = '';

        if (currentBlock.name === 'DEPARTURE') {
          // At departure: move everyone who is still home
          shouldMove = npc.resolved_current_location_id === VGC_ID;
          reason = 'vgc_departure_block';
        } else if (currentBlock.name === 'WRAP_UP') {
          // At wrap-up: always re-evaluate (prepare for 1 AM return)
          shouldMove = true;
          reason = 'vgc_wrapup_final_position';
        } else {
          // Midday/Afternoon/Evening: rotate if 3+ hours at current location
          const movedAt = npc.valid_from ? new Date(npc.valid_from).getTime() : 0;
          const hoursSinceMove = (now.getTime() - movedAt) / 3600000;
          shouldMove = hoursSinceMove >= 3;
          reason = shouldMove ? 'vgc_rotation_due' : 'staying_at_location';
        }

        if (!shouldMove) {
          updates.push({
            id: npc.id,
            data: { next_move_at: getNextBlockTimestamp(hour, nowET) },
          });
          continue;
        }

        // Age filter
        const npcAge = npc.age || 0;
        const ageSafeLocations = socialLocations.filter(loc => {
          if (npcAge < 21) {
            const nameLC = loc.name.toLowerCase();
            if (['bar', 'club', 'lounge', 'pub', 'tavern', 'nightclub'].some(kw => nameLC.includes(kw))) return false;
          }
          return true;
        });

        const pool = ageSafeLocations.length > 0 ? ageSafeLocations : socialLocations;
        const differentPool = pool.filter(l => l.id !== npc.resolved_current_location_id);
        const finalPool = differentPool.length > 0 ? differentPool : pool;

        if (finalPool.length === 0) {
          // No valid destination — send home
          updates.push({
            id: npc.id,
            data: {
              resolved_current_location_id: VGC_ID,
              resolved_current_location_name: 'VGC Towers',
              resolved_presence_status: 'home',
              resolved_location_type: 'home',
              resolved_source_reason: 'no_valid_destinations',
              presence_state: 'home',
              source_of_move: 'system',
              valid_from: now.toISOString(),
              next_move_at: null,
            },
          });
          continue;
        }

        const selectedLoc = pickByGravity(finalPool, occupancyMap, nowET);
        occupancyMap.set(selectedLoc.id, (occupancyMap.get(selectedLoc.id) || 0) + 1);

        globalLog.push(`[${ownerEmail}] ${npc.name} → ${selectedLoc.name} (${reason})`);
        updates.push({
          id: npc.id,
          data: {
            resolved_current_location_id: selectedLoc.id,
            resolved_current_location_name: selectedLoc.name,
            resolved_presence_status: 'visiting',
            resolved_location_type: 'visit',
            resolved_source_reason: reason,
            presence_state: 'social_visit',
            source_of_move: 'system',
            valid_from: now.toISOString(),
            valid_until: new Date(now.getTime() + 4 * 3600000).toISOString(),
            return_location_id: VGC_ID,
            next_move_at: getNextBlockTimestamp(hour, nowET),
          },
        });
        totalMoved++;
      }

      // Apply all updates in parallel for this account
      if (updates.length > 0) {
        await Promise.all(updates.map(u =>
          base44.asServiceRole.entities.Character.update(u.id, u.data)
        ));
      }
    }

    return Response.json({
      success: true,
      mode: isLockdown ? 'lockdown' : 'active',
      block: isLockdown ? null : (TRAVEL_BLOCKS.find(b => b.hour === hour)?.name || 'no_block'),
      hoursET: hour,
      totalMoved,
      totalReturned,
      accountsProcessed: vgcTowersList.length,
      log: globalLog,
    });

  } catch (error) {
    console.error('[distributeVGCTowersNPCsBlockBased]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── HELPERS ──────────────────────────────────────────────────────────────────

function getNextBlockTimestamp(currentHour, nowET) {
  const blocks = [10, 13, 16, 19, 22];
  const next = blocks.find(h => h > currentHour);
  const base = new Date(nowET);
  if (!next) {
    // Next block is tomorrow at 10 AM
    base.setDate(base.getDate() + 1);
    base.setHours(10, 0, 0, 0);
  } else {
    base.setHours(next, 0, 0, 0);
  }
  return base.toISOString();
}

function isOnWorkSchedule(npc, nowET) {
  if (!npc.work_days || !npc.work_start_time || !npc.work_end_time) return false;
  const dayOfWeek = nowET.getDay();
  if (!npc.work_days.includes(dayOfWeek)) return false;
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
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

const CATEGORY_BASE_POPULARITY = {
  home: 10, workplace: 30, school: 30, gym: 45, grocery: 40,
  medical: 25, religion: 35, outdoor: 55, food_drink: 65,
  social: 75, community: 60, business: 40, government: 20, public: 50,
};

const CATEGORY_TIME_RULES = {
  gym:       [[5, 9, 1.6], [17, 20, 1.5]],
  food_drink:[[7, 10, 1.4], [12, 14, 1.5], [17, 20, 1.3]],
  social:    [[18, 23, 1.8], [14, 17, 1.3]],
  outdoor:   [[8, 12, 1.5], [15, 18, 1.4]],
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