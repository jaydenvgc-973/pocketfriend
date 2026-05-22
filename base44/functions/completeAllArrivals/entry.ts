/**
 * completeAllArrivals
 *
 * Scheduled function (runs every 5 minutes).
 *
 * TRAVEL ARRIVAL FAILURE RULE — DESTINATION ENFORCEMENT
 *
 * Finds all TravelSessions in route_status: "arrival_due" and delegates to
 * completeTravelArrivalVerified (user-scoped) which is the ONLY function
 * that may set route_status: "arrived".
 *
 * Also picks up any lingering "arrived" sessions that may not have had
 * their Character write verified (legacy sessions from before this system).
 *
 * ARCHITECTURE:
 * Character entity has strict per-owner RLS. This function cannot write
 * Character directly. It delegates to completeTravelArrivalVerified which
 * runs user-scoped and owns all Character writes + read-back verification.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Load all arrival_due sessions — these need Character writes
    const dueSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'arrival_due' },
      '-updated_date',
      200
    ).catch(() => []);

    // Also check old "arrived" sessions without actual_arrival_time (pre-system legacy)
    const legacyArrived = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'arrived' },
      '-updated_date',
      100
    ).catch(() => []);
    const legacyNeedingWrite = legacyArrived.filter(s => !s.actual_arrival_time);

    const allToProcess = [...dueSessions, ...legacyNeedingWrite];

    if (allToProcess.length === 0) {
      console.log('[completeAllArrivals] No arrival_due sessions to process');
      return Response.json({ completed: 0, owners_processed: 0, arrival_due_count: 0 });
    }

    // Collect unique owner_emails
    const ownerEmails = [...new Set(
      allToProcess.map(s => s.owner_email).filter(Boolean)
    )];

    console.log(`[completeAllArrivals] ${dueSessions.length} arrival_due + ${legacyNeedingWrite.length} legacy arrived → ${ownerEmails.length} owners → delegating to completeTravelArrivalVerified`);

    const ownerResults = [];
    let totalVerified = 0;

    for (const ownerEmail of ownerEmails) {
      try {
        // completeTravelArrivalVerified runs user-scoped for this owner,
        // loads their characters, writes to destination, reads back, verifies,
        // and only then sets route_status: "arrived"
        const res = await base44.asServiceRole.functions.invoke('completeTravelArrivalVerified', {
          _owner_email_hint: ownerEmail,
        }).catch(e => ({ data: { error: e.message } }));

        const d = res?.data || {};
        const verified = d.verified_arrivals || 0;
        totalVerified += verified;

        ownerResults.push({
          owner_email: ownerEmail,
          sessions_processed: d.sessions_processed || 0,
          verified_arrivals:  verified,
          failed_arrivals:    d.failed_arrivals || 0,
          status: d.error ? 'error' : 'ok',
          error:  d.error || null,
        });

        console.log(`[completeAllArrivals] owner=${ownerEmail}: ${verified} verified arrivals`);
      } catch (e) {
        console.error(`[completeAllArrivals] Failed for owner ${ownerEmail}: ${e.message}`);
        ownerResults.push({ owner_email: ownerEmail, status: 'error', error: e.message });
      }
    }

    console.log(`[completeAllArrivals] Complete | total_verified=${totalVerified} | owners=${ownerEmails.length}`);

    // ── ENFORCEMENT PASS: Run arrival integrity check after all completion attempts ──
    base44.asServiceRole.functions.invoke('enforceArrivalIntegrity', {}).catch(e => {
      console.warn(`[completeAllArrivals] enforceArrivalIntegrity post-pass failed (non-fatal): ${e.message}`);
    });

    return Response.json({
      arrival_due_sessions: dueSessions.length,
      legacy_needing_write: legacyNeedingWrite.length,
      owners_processed:  ownerEmails.length,
      total_verified:    totalVerified,
      owner_results:     ownerResults,
      enforcement_pass:  'triggered',
    });

  } catch (error) {
    console.error('[completeAllArrivals]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});