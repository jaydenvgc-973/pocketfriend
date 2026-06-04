/**
 * repairActiveCreatedTravelingState
 *
 * SCOPE: active_created_character ONLY.
 * Does NOT touch npc_regular, npc_family_member, npc_fictitious, or any other type.
 *
 * PROBLEM:
 *   createTravelSession writes resolved_presence_status = 'traveling' when a TravelSession starts.
 *   When a TravelSession is cancelled (by confinement, hard-condition override, orphan cleanup,
 *   or arrival_failed) the Character's resolved_presence_status is never reset — it stays
 *   stuck on 'traveling' indefinitely with no active session backing it.
 *
 * THIS FUNCTION:
 *   1. Finds all active_created_character records with resolved_presence_status = 'traveling'
 *   2. For each, verifies there is NO active TravelSession (in_transit or arrival_due)
 *      - If an active session EXISTS: skip — travel is real, let processTravelArrivals handle it
 *      - If NO active session: the 'traveling' state is orphaned — repair to canonical presence
 *   3. Canonical re-resolution for active_created_character (no active session):
 *      a. On active work shift (work_days + work_start_time + work_end_time) → at_work
 *      b. In sleep window (sleep_start_time + wake_up_time) → sleeping at home
 *      c. Default → home
 *   4. Clears all orphaned travel fields in the same write.
 *
 * DOES NOT:
 *   - Touch NPC types
 *   - Modify characters with a valid active TravelSession
 *   - Reintroduce slow travel or make TravelSession authoritative
 *   - Create a new travel system
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── TIME HELPERS ──────────────────────────────────────────────────────────────
function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isOnShift(char, etTime) {
  if (!char.work_start_time || !char.work_end_time || !Array.isArray(char.work_days) || !char.occupation_location_id) return false;
  const dow = etTime.getDay();
  if (!char.work_days.includes(dow)) return false;
  const nowMin = etTime.getHours() * 60 + etTime.getMinutes();
  const start = toMin(char.work_start_time);
  const end   = toMin(char.work_end_time);
  if (start === null || end === null) return false;
  // Overnight shift support
  if (end < start) return nowMin >= start || nowMin < end;
  return nowMin >= start && nowMin < end;
}

function isInSleepWindow(char, etTime) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const nowMin = etTime.getHours() * 60 + etTime.getMinutes();
  const s = toMin(char.sleep_start_time);
  const w = toMin(char.wake_up_time);
  if (s === null || w === null) return false;
  // Overnight sleep (e.g. 23:00–07:00)
  if (s > w) return nowMin >= s || nowMin < w;
  return nowMin >= s && nowMin < w;
}

/**
 * Compute canonical presence for an active_created_character that has no active TravelSession.
 * Returns { resolved_presence_status, resolved_location_type, resolved_source_reason,
 *           resolved_current_location_id, resolved_current_location_name }
 */
function resolveCanonicalPresence(char, etTime) {
  const homeId   = char.current_home_location_id || char.home_location_id || null;
  const homeName = char.resolved_current_location_name || null;

  // Jailed / house_arrest: do not move them
  if (char.is_jailed === true) {
    return {
      resolved_presence_status:       'incarcerated',
      resolved_location_type:         'incarcerated',
      resolved_source_reason:         'incarceration_active',
      resolved_current_location_id:   char.incarceration_facility_id || homeId,
      resolved_current_location_name: char.incarceration_facility_name || 'Facility',
    };
  }
  if (char.house_arrest_active === true) {
    return {
      resolved_presence_status:       'house_arrest',
      resolved_location_type:         'home',
      resolved_source_reason:         'house_arrest_active',
      resolved_current_location_id:   char.house_arrest_location_id || homeId,
      resolved_current_location_name: char.resolved_current_location_name || 'Home',
    };
  }

  // Sleep window — only if sleep_start_time is set
  if (isInSleepWindow(char, etTime) && homeId) {
    return {
      resolved_presence_status:       'sleeping',
      resolved_location_type:         'home',
      resolved_source_reason:         'sleep_window_canonical_repair',
      resolved_current_location_id:   homeId,
      resolved_current_location_name: homeName || 'Home',
    };
  }

  // Work shift
  const todayStr = etTime.toISOString().slice(0, 10);
  const hasCallout = char.work_exception_status === 'called_out' && char.work_exception_date === todayStr;
  if (!hasCallout && isOnShift(char, etTime) && char.occupation_location_id) {
    return {
      resolved_presence_status:       'at_work',
      resolved_location_type:         'work',
      resolved_source_reason:         'work_schedule_canonical_repair',
      resolved_current_location_id:   char.occupation_location_id,
      resolved_current_location_name: char.occupation_location_name || 'Work',
    };
  }

  // Default: home
  return {
    resolved_presence_status:       'home',
    resolved_location_type:         'home',
    resolved_source_reason:         'orphaned_travel_state_canonical_repair',
    resolved_current_location_id:   homeId,
    resolved_current_location_name: homeName || 'Home',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    // Authoritative ET time
    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etStr = `${etTime.getFullYear()}-${String(etTime.getMonth()+1).padStart(2,'0')}-${String(etTime.getDate()).padStart(2,'0')} ${String(etTime.getHours()).padStart(2,'0')}:${String(etTime.getMinutes()).padStart(2,'0')} ET`;

    console.log(`[repairActiveCreatedTravelingState] START | ${etStr} | dry_run=${dryRun}`);

    // ── STEP 1: Load all active_created_character with resolved_presence_status = 'traveling' ──
    // Use user-scoped filter (works for RLS). Then fall back to asServiceRole for admin.
    let stuckChars = [];
    try {
      stuckChars = await base44.entities.Character.filter(
        { character_type: 'active_created_character', resolved_presence_status: 'traveling' },
        null,
        100
      ).catch(() => []);
    } catch {
      stuckChars = await base44.asServiceRole.entities.Character.filter(
        { character_type: 'active_created_character', resolved_presence_status: 'traveling' },
        null,
        100
      ).catch(() => []);
    }

    // Safety: also pull any with no character_type set (legacy) that have traveling status, owned by this user
    let legacyStuck = [];
    try {
      const all = await base44.entities.Character.filter(
        { owner_email: user.email, resolved_presence_status: 'traveling' },
        null,
        100
      ).catch(() => []);
      legacyStuck = all.filter(c =>
        !c.character_type || c.character_type === 'active_created_character'
      );
    } catch { /* non-fatal */ }

    // Deduplicate by id
    const seenIds = new Set();
    const candidates = [...stuckChars, ...legacyStuck].filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return (
        c.status !== 'deleted' &&
        c.status !== 'soft_deleted' &&
        c.status !== 'moved_away' &&
        !c.is_test_character &&
        !c.diagnostic_only
      );
    });

    console.log(`[repairActiveCreatedTravelingState] Found ${candidates.length} active_created_character records with resolved_presence_status='traveling'`);

    if (candidates.length === 0) {
      return Response.json({
        success: true,
        run_at_et: etStr,
        found: 0,
        repaired: 0,
        skipped_active_session: 0,
        results: [],
        message: 'No active_created_character records with stuck traveling state found.',
      });
    }

    const results = [];
    let repairedCount = 0;
    let skippedActiveSession = 0;

    for (const char of candidates) {
      const ownerEmail = char.owner_email;

      // ── STEP 2: Check for active TravelSession ────────────────────────────
      // Active = in_transit (real travel in progress)
      // STALE = arrival_due with arrival_write_attempts = 0 AND ETA passed > 1 hour ago
      //   → completeTravelArrivalVerified has never succeeded — these are permanently stuck.
      //   → Cancel them so the 'traveling' presence can be cleared to canonical state.
      let activeSession = null;
      let staleArrivalDueSessions = [];
      try {
        const sessions = await base44.asServiceRole.entities.TravelSession.filter({
          owner_email: ownerEmail,
          character_id: char.id,
        }, '-created_at', 10).catch(() => []);
        const nowMs = Date.now();
        const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
        for (const s of (sessions || [])) {
          if (s.route_status === 'in_transit') {
            activeSession = s;
            break;
          }
          if (s.route_status === 'arrival_due') {
            // Check if this is genuinely fresh (ETA < 1h ago) or stuck (no write attempts, ETA > 1h ago)
            const etaMs = s.estimated_arrival_time ? new Date(s.estimated_arrival_time).getTime() : 0;
            const isStale = (s.arrival_write_attempts || 0) === 0 && (nowMs - etaMs) > STALE_THRESHOLD_MS;
            if (isStale) {
              staleArrivalDueSessions.push(s);
            } else {
              // Recent arrival_due with write attempts or fresh ETA — still live, let completeTravelArrivalVerified handle
              activeSession = s;
              break;
            }
          }
        }
      } catch { /* non-fatal */ }

      // Cancel any stale stuck arrival_due sessions (permanently blocked, no write ever succeeded)
      for (const stale of staleArrivalDueSessions) {
        const etaET = stale.estimated_arrival_time
          ? new Date(new Date(stale.estimated_arrival_time).toLocaleString('en-US', { timeZone: 'America/New_York' })).toLocaleString('en-US')
          : 'unknown';
        console.warn(`[repairActiveCreatedTravelingState] CANCEL stale arrival_due session ${stale.id} for ${char.name} → ${stale.destination_location_name} (ETA was ${etaET}, 0 write attempts)`);
        await base44.asServiceRole.entities.TravelSession.update(stale.id, {
          route_status:   'arrival_failed',
          blocker_reason: 'stale_arrival_due_no_write_attempts_cancelled_by_repair',
          arrival_due:    false,
          arrival_pending_character_write: false,
        }).catch(() => {});
      }

      if (activeSession) {
        // Travel is real and in progress (in_transit or recent arrival_due) — skip, let processTravelArrivals handle
        console.log(`[repairActiveCreatedTravelingState] SKIP ${char.name}: active session ${activeSession.id} (${activeSession.route_status}) → ${activeSession.destination_location_name}`);
        skippedActiveSession++;
        results.push({
          character_id:   char.id,
          character_name: char.name,
          action:         'skipped_active_session',
          reason:         `Active TravelSession ${activeSession.id} (${activeSession.route_status}) → ${activeSession.destination_location_name}. Let processTravelArrivals complete.`,
          repaired:       false,
        });
        continue;
      }

      // ── STEP 3: No active session → resolve canonical presence ────────────
      const canonical = resolveCanonicalPresence(char, etTime);

      const patch = {
        resolved_presence_status:       canonical.resolved_presence_status,
        resolved_location_type:         canonical.resolved_location_type,
        resolved_source_reason:         canonical.resolved_source_reason,
        resolved_current_location_id:   canonical.resolved_current_location_id,
        resolved_current_location_name: canonical.resolved_current_location_name,
        resolved_last_updated_at:       new Date().toISOString(),
        // Clear all orphaned travel fields
        travel_status:                  'not_traveling',
        travel_destination_location_id: null,
        traveling_to_location_id:       null,
        traveling_to_location_name:     null,
      };

      console.log(`[repairActiveCreatedTravelingState] REPAIR ${char.name}: traveling → ${canonical.resolved_presence_status} at "${canonical.resolved_current_location_name}" [${canonical.resolved_source_reason}]${dryRun ? ' [DRY_RUN]' : ''}`);

      if (!dryRun) {
        try {
          await base44.entities.Character.update(char.id, patch);
        } catch {
          // Fallback: service role if user-scoped update fails (e.g. admin running for another user)
          try {
            await base44.asServiceRole.entities.Character.update(char.id, patch);
          } catch (err2) {
            console.error(`[repairActiveCreatedTravelingState] WRITE FAILED for ${char.name}: ${err2.message}`);
            results.push({
              character_id:   char.id,
              character_name: char.name,
              action:         'write_failed',
              reason:         err2.message,
              repaired:       false,
              canonical_presence: canonical.resolved_presence_status,
            });
            continue;
          }
        }
      }

      repairedCount++;
      results.push({
        character_id:            char.id,
        character_name:          char.name,
        action:                  dryRun ? 'would_repair' : 'repaired',
        previous_presence:       'traveling',
        canonical_presence:      canonical.resolved_presence_status,
        canonical_location_id:   canonical.resolved_current_location_id,
        canonical_location_name: canonical.resolved_current_location_name,
        canonical_reason:        canonical.resolved_source_reason,
        repaired:                !dryRun,
        had_home_location_id:    !!(char.current_home_location_id || char.home_location_id),
      });
    }

    const etEnd = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etEndStr = `${etEnd.getFullYear()}-${String(etEnd.getMonth()+1).padStart(2,'0')}-${String(etEnd.getDate()).padStart(2,'0')} ${String(etEnd.getHours()).padStart(2,'0')}:${String(etEnd.getMinutes()).padStart(2,'0')} ET`;

    console.log(`[repairActiveCreatedTravelingState] DONE | repaired=${repairedCount} | skipped_active=${skippedActiveSession} | dry_run=${dryRun}`);

    return Response.json({
      success: true,
      run_at_et: etStr,
      completed_at_et: etEndStr,
      dry_run: dryRun,
      found: candidates.length,
      repaired: repairedCount,
      skipped_active_session: skippedActiveSession,
      results,
    });

  } catch (error) {
    console.error('[repairActiveCreatedTravelingState] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});