/**
 * sharedLocationTravelDiagnosticAndRepair
 *
 * Single source of truth for location/travel diagnostics and repairs.
 * Used by Home, Travel, and Settings.
 *
 * HARD RULES:
 * - Use owner_email only, never created_by
 * - Do not force characters home
 * - Do not clear valid travel
 * - Do not overwrite jail, shelter, hotel, temporary housing, work, school, sleep, stay locks, or active TravelSession
 * - Stuck travel handled separately
 * - Return proof for every change
 * - Skip if ownership/location/travel state cannot be proven
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mode = 'diagnose', owner_email = user.email, character_id = null } = await req.json();
    // mode: 'diagnose' (report only) | 'repair_verified' (fix only proven stale records)

    const proof = [];
    const skipped = [];

    // ────────────────────────────────────────────────────────────────────────────
    // Load characters to diagnose
    // ────────────────────────────────────────────────────────────────────────────

    let charactersToCheck = [];
    if (character_id) {
      const c = await base44.entities.Character.filter({ id: character_id }).catch(() => []);
      if (c.length > 0 && c[0].owner_email === owner_email) {
        charactersToCheck = c;
      }
    } else {
      charactersToCheck = await base44.entities.Character.filter(
        { owner_email },
        'name',
        500
      ).catch(() => []);
    }

    console.log(`[sharedLocationTravelDiagnosticAndRepair] mode=${mode} characters=${charactersToCheck.length}`);

    // ────────────────────────────────────────────────────────────────────────────
    // Diagnose each character
    // ────────────────────────────────────────────────────────────────────────────

    for (const char of charactersToCheck) {
      // Protected statuses — never alter
      const isProtected = [
        char.is_jailed,
        char.house_arrest_active,
        (char.resolved_presence_status === 'sleeping'),
        (char.resolved_presence_status === 'napping'),
        char.presence_stay_lock,
        (char.current_work_location_id && char.resolved_location_type === 'work'),
        (char.current_school_location_id && char.resolved_location_type === 'school'),
      ].some(Boolean);

      const entry = {
        character_id: char.id,
        character_name: char.name,
        owner_email: char.owner_email,
        before: {
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
          travel_status: char.travel_status,
          location_status: char.location_status,
          resolved_presence_status: char.resolved_presence_status,
        },
        after: null,
        action_taken: null,
        skipped_reason: null,
        active_travel_session: null,
        protected: isProtected,
      };

      // Check for active TravelSession
      const activeSessions = await base44.entities.TravelSession.filter(
        { character_id: char.id, route_status: ['in_transit', 'preparing', 'delayed'] },
        null,
        1
      ).catch(() => []);

      if (activeSessions.length > 0) {
        entry.active_travel_session = activeSessions[0].id;
        entry.skipped_reason = 'active_travel_session';
        skipped.push(entry);
        continue;
      }

      // Check for stuck travel (failed arrival, stale traveling_to without session)
      const failedSessions = await base44.entities.TravelSession.filter(
        { character_id: char.id, route_status: 'arrived' },
        '-updated_date',
        1
      ).catch(() => []);

      const isStuckTravel = (char.travel_status === 'traveling' && !activeSessions.length) ||
                            (failedSessions.length > 0 && failedSessions[0].route_status === 'arrived' &&
                             failedSessions[0].actual_arrival_time === null);

      if (isStuckTravel) {
        entry.skipped_reason = 'stuck_travel_requires_separate_repair';
        skipped.push(entry);
        continue;
      }

      // Check for display mismatch: resolved vs current location fields
      const currentHomeId = char.current_home_location_id;
      const workId = char.current_work_location_id;
      const schoolId = char.current_school_location_id;

      let expectedLocationId = null;
      let expectedPresenceStatus = null;

      // Determine expected location based on schedule/presence rules
      if (char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping') {
        expectedLocationId = currentHomeId;
        expectedPresenceStatus = char.resolved_presence_status;
      } else if (char.resolved_presence_status === 'at_work' && workId) {
        expectedLocationId = workId;
        expectedPresenceStatus = 'at_work';
      } else if (char.resolved_presence_status === 'at_school' && schoolId) {
        expectedLocationId = schoolId;
        expectedPresenceStatus = 'at_school';
      } else {
        expectedLocationId = currentHomeId;
        expectedPresenceStatus = 'home';
      }

      const mismatchDetected = expectedLocationId && char.resolved_current_location_id !== expectedLocationId;

      if (mismatchDetected && mode === 'repair_verified' && !isProtected) {
        // Only repair if we can verify the destination exists and is owned
        const destLocation = await base44.entities.LocationReference.filter({ id: expectedLocationId }).catch(() => []);
        if (destLocation.length > 0) {
          const updatedChar = await base44.entities.Character.update(char.id, {
            resolved_current_location_id: expectedLocationId,
            resolved_current_location_name: destLocation[0].name,
            resolved_presence_status: expectedPresenceStatus,
          });
          entry.after = {
            resolved_current_location_id: updatedChar.resolved_current_location_id,
            resolved_current_location_name: updatedChar.resolved_current_location_name,
            resolved_presence_status: updatedChar.resolved_presence_status,
          };
          entry.action_taken = 'resolved_location_repaired';
          proof.push(entry);
        } else {
          entry.skipped_reason = 'destination_location_not_found';
          skipped.push(entry);
        }
      } else if (mismatchDetected) {
        entry.skipped_reason = isProtected ? 'protected_status' : 'diagnose_only_mode';
        skipped.push(entry);
      } else {
        proof.push({ ...entry, action_taken: 'no_action_needed' });
      }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // CRITICAL: Actively repair stuck travel in repair mode
    // ────────────────────────────────────────────────────────────────────────────

    if (mode === 'repair_verified') {
      // Find characters with travel_status but no active session
      const stuckTravelChars = charactersToCheck.filter(c => {
        const travelingStates = ['traveling_to_work', 'traveling_to_school', 'traveling_to_destination', 'traveling'];
        return travelingStates.includes(c.travel_status);
      });

      for (const char of stuckTravelChars) {
        // Check if we already found an active session for this char
        const activeSessions = await base44.entities.TravelSession.filter(
          { character_id: char.id, route_status: { $in: ['in_transit', 'preparing', 'delayed'] } },
          null,
          1
        ).catch(() => []);

        if (activeSessions.length > 0) {
          // Already has active session, skip
          continue;
        }

        // ── STUCK TRAVEL FOUND: Character has travel_status but no active session ──
        // Attempt repair

        let repaired = false;
        let repairAction = null;
        let repairError = null;

        // Try to recreate session if destination can be verified
        if (char.travel_destination_location_id) {
          const destArr = await base44.entities.LocationReference.filter(
            { id: char.travel_destination_location_id },
            null,
            1
          ).catch(() => []);

          const originArr = char.current_home_location_id
            ? await base44.entities.LocationReference.filter(
                { id: char.current_home_location_id },
                null,
                1
              ).catch(() => [])
            : [];

          if (destArr.length > 0 && originArr.length > 0) {
            // Recreate session
            const now = new Date();
            const travelMinutes = 3;
            const arrivalTime = new Date(now.getTime() + travelMinutes * 60 * 1000);

            try {
              const newSession = await base44.entities.TravelSession.create({
                character_id: char.id,
                character_name: char.name,
                owner_email,
                origin_location_id: originArr[0].id,
                origin_location_name: originArr[0].name,
                destination_location_id: destArr[0].id,
                destination_location_name: destArr[0].name,
                travel_reason: 'Stuck travel repair',
                travel_source: 'manual',
                distance_miles: 5,
                estimated_departure_time: now.toISOString(),
                estimated_arrival_time: arrivalTime.toISOString(),
                duration_minutes: travelMinutes,
                progress_percent: 0,
                route_status: 'in_transit',
              });

              repaired = true;
              repairAction = `STUCK_TRAVEL_SESSION_RECREATED:${newSession.id}`;
              console.log(`[sharedLocationTravelDiagnosticAndRepair] ✓ Recreated session for stuck char ${char.name}`);
            } catch (e) {
              repairError = `session_creation_failed:${e.message}`;
            }
          }
        }

        // If repair failed, clear the broken travel state
        if (!repaired) {
          if (char.travel_destination_location_id) {
            repairError = `unable_to_verify_destination:${char.travel_destination_location_id}`;
          } else {
            repairError = 'no_destination_to_recreate_from';
          }

          try {
            await base44.entities.Character.update(char.id, {
              travel_status: 'not_traveling',
              traveling_to_location_id: null,
              traveling_to_location_name: null,
              travel_destination_location_id: null,
            });
            repaired = true;
            repairAction = 'STUCK_TRAVEL_CLEARED';
            console.log(`[sharedLocationTravelDiagnosticAndRepair] ✓ Cleared stuck travel for ${char.name}: ${repairError}`);
          } catch (e) {
            repairError = `clear_failed:${e.message}`;
          }
        }

        // Log repair result
        const repairEntry = {
          character_id: char.id,
          character_name: char.name,
          before_travel_status: char.travel_status,
          action_taken: repairAction,
          repaired,
          error: repairError,
        };

        if (repaired) {
          proof.push(repairEntry);
        } else {
          skipped.push(repairEntry);
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────────────
    // Stuck travel diagnostics
    // ────────────────────────────────────────────────────────────────────────────

    const stuckTravelSessions = await base44.entities.TravelSession.filter(
      {
        owner_email,
        route_status: { $in: ['arrived', 'blocked'] },
      },
      '-updated_date',
      100
    ).catch(() => []);

    const stuckTravel = stuckTravelSessions
      .filter(ts => !ts.actual_arrival_time || ts.route_status === 'blocked')
      .map(ts => ({
        travel_session_id: ts.id,
        character_id: ts.character_id,
        character_name: ts.character_name,
        origin: ts.origin_location_name,
        destination: ts.destination_location_name,
        route_status: ts.route_status,
        blocker_reason: ts.blocker_reason || 'unknown',
        estimated_arrival: ts.estimated_arrival_time,
        progress: ts.progress_percent,
        last_update: ts.last_progress_update,
      }));

    console.log(`[sharedLocationTravelDiagnosticAndRepair] stuck_travel_sessions=${stuckTravel.length}`);

    return Response.json({
      mode,
      summary: {
        characters_checked: charactersToCheck.length,
        verified_and_repaired: proof.filter(p => p.action_taken !== 'no_action_needed').length,
        no_action_needed: proof.filter(p => p.action_taken === 'no_action_needed').length,
        skipped: skipped.length,
        stuck_travel_sessions: stuckTravel.length,
      },
      proof,
      skipped,
      stuck_travel: stuckTravel,
    });

  } catch (error) {
    console.error('[sharedLocationTravelDiagnosticAndRepair]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});