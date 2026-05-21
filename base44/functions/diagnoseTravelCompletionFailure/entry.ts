/**
 * diagnoseTravelCompletionFailure
 *
 * Diagnostic function to expose why in_transit sessions are not completing.
 *
 * For EVERY in_transit session:
 * - Check if it's due (ETA <= now)
 * - If due, simulate and actually attempt completion
 * - Capture the exact error or update result
 * - Read back the Character record to verify state change
 * - Report the full before/after state and reason for success/failure
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const results = [];
    const errors = [];

    // Load ALL in_transit sessions for this user
    let sessions = [];
    try {
      sessions = await base44.entities.TravelSession.filter(
        { owner_email: user.email, route_status: 'in_transit' },
        '-created_at',
        100
      );
    } catch (e) {
      return Response.json({ error: `Failed to load sessions: ${e.message}` }, { status: 500 });
    }

    console.log(`[diagnoseTravelCompletionFailure] Found ${sessions.length} in_transit sessions for ${user.email}`);

    for (const session of sessions) {
      const diagnostic = {
        session_id: session.id,
        character_id: session.character_id,
        character_name: session.character_name,
        origin_location_id: session.origin_location_id,
        origin_location_name: session.origin_location_name,
        destination_location_id: session.destination_location_id,
        destination_location_name: session.destination_location_name,
        estimated_arrival_time: session.estimated_arrival_time,
        route_status_before: session.route_status,
        progress_percent: session.progress_percent,
        server_time: now.toISOString(),
      };

      try {
        // ── LOAD BEFORE STATE ──
        const charBefore = await base44.asServiceRole.entities.Character.filter(
          { id: session.character_id }, null, 1
        ).catch(() => []);
        const charDataBefore = charBefore?.[0] || null;
        diagnostic.character_before = {
          id: charDataBefore?.id,
          name: charDataBefore?.name,
          current_location_id: charDataBefore?.resolved_current_location_id,
          current_location_name: charDataBefore?.resolved_current_location_name,
          presence_status: charDataBefore?.resolved_presence_status,
        };

        // ── CHECK IF DUE ──
        if (!session.estimated_arrival_time) {
          diagnostic.is_due = false;
          diagnostic.skipped_reason = 'estimated_arrival_time is null';
          results.push(diagnostic);
          continue;
        }

        const eta = new Date(session.estimated_arrival_time).getTime();
        const minsUntilEta = (eta - now.getTime()) / (1000 * 60);
        diagnostic.minutes_until_eta = Math.round(minsUntilEta * 10) / 10;
        diagnostic.is_due = eta <= now.getTime();

        if (!diagnostic.is_due) {
          diagnostic.skipped_reason = `not_yet_due (${diagnostic.minutes_until_eta} mins remaining)`;
          results.push(diagnostic);
          continue;
        }

        // ── LOAD DESTINATION LOCATION ──
        const destLoc = session.destination_location_id
          ? (await base44.asServiceRole.entities.LocationReference.filter(
              { id: session.destination_location_id }, null, 1
            ).catch(() => []))?.[0]
          : null;

        if (!destLoc) {
          diagnostic.skipped_reason = `destination_location not found (id=${session.destination_location_id})`;
          results.push(diagnostic);
          continue;
        }

        // ── ATTEMPT COMPLETION ──
        diagnostic.completion_attempted = true;
        let updateError = null;

        try {
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status: 'arrived',
            progress_percent: 100,
            actual_arrival_time: now.toISOString(),
            last_progress_update: now.toISOString(),
          });
        } catch (e) {
          updateError = e.message;
        }

        if (updateError) {
          diagnostic.completion_error = updateError;
          diagnostic.update_result = 'failed';
          results.push(diagnostic);
          continue;
        }

        // ── UPDATE CHARACTER ──
        let charUpdateError = null;
        try {
          await base44.asServiceRole.entities.Character.update(session.character_id, {
            resolved_current_location_id: destLoc.id,
            resolved_current_location_name: destLoc.name,
            resolved_presence_status: 'visiting',
            resolved_location_type: 'visit',
            resolved_last_updated_at: now.toISOString(),
            travel_status: 'not_traveling',
            traveling_to_location_id: null,
            traveling_to_location_name: null,
          });
        } catch (e) {
          charUpdateError = e.message;
        }

        if (charUpdateError) {
          diagnostic.character_update_error = charUpdateError;
          diagnostic.update_result = 'session_succeeded_char_failed';
          results.push(diagnostic);
          continue;
        }

        // ── VERIFY AFTER STATE ──
        const charAfter = await base44.asServiceRole.entities.Character.filter(
          { id: session.character_id }, null, 1
        ).catch(() => []);
        const charDataAfter = charAfter?.[0] || null;
        diagnostic.character_after = {
          id: charDataAfter?.id,
          name: charDataAfter?.name,
          current_location_id: charDataAfter?.resolved_current_location_id,
          current_location_name: charDataAfter?.resolved_current_location_name,
          presence_status: charDataAfter?.resolved_presence_status,
        };

        // Read back the session to confirm route_status changed
        const sessionAfter = await base44.asServiceRole.entities.TravelSession.filter(
          { id: session.id }, null, 1
        ).catch(() => []);
        diagnostic.session_after = sessionAfter?.[0] || null;
        diagnostic.route_status_after = sessionAfter?.[0]?.route_status || 'unknown';

        // Verification
        diagnostic.location_changed = 
          diagnostic.character_before?.current_location_id !== diagnostic.character_after?.current_location_id;
        diagnostic.location_is_destination = 
          diagnostic.character_after?.current_location_id === destLoc.id;

        diagnostic.update_result = diagnostic.location_is_destination ? 'success' : 'write_succeeded_but_verify_failed';

        results.push(diagnostic);

      } catch (e) {
        diagnostic.unexpected_error = e.message;
        errors.push(diagnostic);
      }
    }

    return Response.json({
      diagnostics: results,
      unexpected_errors: errors,
      summary: {
        total_in_transit: sessions.length,
        completed: results.filter(r => r.update_result === 'success').length,
        not_yet_due: results.filter(r => r.is_due === false).length,
        failed_to_complete: results.filter(r => r.update_result !== 'success' && r.is_due).length,
      },
      server_time: now.toISOString(),
    });

  } catch (error) {
    console.error('[diagnoseTravelCompletionFailure]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});