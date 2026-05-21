/**
 * lockTravelStatusWrites
 *
 * AUDIT & ENFORCEMENT FUNCTION
 *
 * Run this as a scheduled check (e.g., hourly) to ensure NO code path
 * has bypassed enforceCanonicalTravelStart.
 *
 * If a character has travel_status="traveling_to_*" but:
 * - No active TravelSession exists, OR
 * - TravelSession is missing required fields, OR
 * - Character ownership doesn't match session ownership
 *
 * Then this is a CRITICAL BUG and must be fixed immediately.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Find all characters with travel status
    const travelingChars = await base44.asServiceRole.entities.Character.filter(
      {
        $or: [
          { travel_status: 'traveling_to_work' },
          { travel_status: 'traveling_to_school' },
          { travel_status: 'traveling_to_destination' },
        ],
      },
      '-updated_date',
      500
    );

    const violations = [];
    const valid = [];

    for (const char of travelingChars) {
      // Find active session
      const [session] = await base44.asServiceRole.entities.TravelSession.filter(
        {
          character_id: char.id,
          owner_email: char.owner_email,
          route_status: { $in: ['preparing', 'in_transit', 'delayed'] },
        },
        '-created_at',
        1
      ).catch(() => []);

      if (!session) {
        violations.push({
          character_id: char.id,
          character_name: char.name,
          owner_email: char.owner_email,
          travel_status: char.travel_status,
          violation: 'NO_ACTIVE_SESSION',
          severity: 'CRITICAL',
        });
        continue;
      }

      // Verify session has all required fields
      const missingFields = [];
      if (!session.estimated_arrival_time) missingFields.push('estimated_arrival_time');
      if (!session.duration_minutes) missingFields.push('duration_minutes');
      if (session.progress_percent === null || session.progress_percent === undefined) {
        missingFields.push('progress_percent');
      }
      if (!session.origin_location_id) missingFields.push('origin_location_id');
      if (!session.destination_location_id) missingFields.push('destination_location_id');

      if (missingFields.length > 0) {
        violations.push({
          character_id: char.id,
          character_name: char.name,
          travel_status: char.travel_status,
          session_id: session.id,
          violation: 'SESSION_INCOMPLETE',
          missing_fields: missingFields,
          severity: 'CRITICAL',
        });
        continue;
      }

      // Verify ownership match
      if (char.owner_email !== session.owner_email) {
        violations.push({
          character_id: char.id,
          character_name: char.name,
          violation: 'OWNERSHIP_MISMATCH',
          character_owner: char.owner_email,
          session_owner: session.owner_email,
          severity: 'CRITICAL',
        });
        continue;
      }

      valid.push({
        character_id: char.id,
        character_name: char.name,
        session_id: session.id,
        route_status: session.route_status,
      });
    }

    console.log(`[lockTravelStatusWrites] Audit complete | valid=${valid.length} | violations=${violations.length}`);

    if (violations.length > 0) {
      console.error('[lockTravelStatusWrites] ⚠️ VIOLATIONS DETECTED:', violations);
    }

    return Response.json({
      audit_result: violations.length === 0 ? 'PASS' : 'FAIL',
      valid_traveling_count: valid.length,
      violation_count: violations.length,
      violations,
      valid,
    });

  } catch (error) {
    console.error('[lockTravelStatusWrites]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});