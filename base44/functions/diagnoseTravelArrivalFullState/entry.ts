/**
 * diagnoseTravelArrivalFullState
 *
 * COMPREHENSIVE DIAGNOSTIC: For every traveling character, show:
 * 1. Database canonical state (Character record)
 * 2. TravelSession state
 * 3. What each UI layer displays (Home, Travel, Map, Chat)
 * 4. Which writes succeeded/failed
 * 5. Work schedule state if applicable
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
    const diagnostics = [];

    // ── LOAD ALL CHARACTERS ──
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      200
    );

    // ── LOAD ALL LOCATIONS ──
    const allLocs = await base44.entities.LocationReference.filter(
      {},
      null,
      500
    );
    const locMap = Object.fromEntries(allLocs.map(l => [l.id, l]));

    // ── LOAD ALL TRAVEL SESSIONS (any status) ──
    const allSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { owner_email: user.email },
      '-created_at',
      100
    );

    // ── PROCESS EACH CHARACTER ──
    for (const char of allChars) {
      // Find active or recent session for this character
      const session = allSessions.find(s => s.character_id === char.id);
      
      // Only report on characters with active sessions or recent completions
      if (!session) continue;
      if (!['in_transit', 'arrived', 'preparing', 'delayed'].includes(session.route_status)) continue;

      const diagnostic = {
        character_id: char.id,
        character_name: char.name || char.display_name,
        owner_email: char.owner_email,
        server_time: now.toISOString(),
        
        // ── DATABASE CANONICAL STATE ──
        canonical_location: {
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
          resolved_presence_status: char.resolved_presence_status,
          resolved_location_type: char.resolved_location_type,
          resolved_source_reason: char.resolved_source_reason,
        },

        // ── TRAVEL SESSION STATE ──
        travel_session: {
          id: session.id,
          route_status: session.route_status,
          origin_location_id: session.origin_location_id,
          origin_location_name: session.origin_location_name,
          destination_location_id: session.destination_location_id,
          destination_location_name: session.destination_location_name,
          estimated_departure_time: session.estimated_departure_time,
          estimated_arrival_time: session.estimated_arrival_time,
          actual_arrival_time: session.actual_arrival_time,
          progress_percent: session.progress_percent,
          duration_minutes: session.duration_minutes,
        },

        // ── TRAVEL FLAGS ON CHARACTER ──
        travel_flags: {
          travel_status: char.travel_status,
          traveling_to_location_id: char.traveling_to_location_id,
          traveling_to_location_name: char.traveling_to_location_name,
          travel_destination_location_id: char.travel_destination_location_id,
          location_status: char.location_status,
        },

        // ── WORK/SCHEDULE STATE ──
        schedule_state: {
          current_work_location_id: char.current_work_location_id,
          current_work_location_name: locMap[char.current_work_location_id]?.name,
          work_start_time: char.work_start_time,
          work_end_time: char.work_end_time,
          work_days: char.work_days,
        },

        // ── CONSISTENCY CHECK ──
        consistency: {
          is_traveling_in_session: ['in_transit', 'preparing', 'delayed'].includes(session.route_status),
          travel_flags_cleared: !char.travel_status || char.travel_status === 'not_traveling',
          canonical_at_origin: char.resolved_current_location_id === session.origin_location_id,
          canonical_at_destination: char.resolved_current_location_id === session.destination_location_id,
          session_completed: session.route_status === 'arrived',
          actual_arrival_time_set: !!session.actual_arrival_time,
        },

        // ── CRITICAL ISSUES ──
        issues: [],
      };

      // Identify issues
      if (diagnostic.consistency.session_completed && diagnostic.consistency.canonical_at_origin) {
        diagnostic.issues.push({
          severity: 'CRITICAL',
          issue: 'ARRIVAL NOT PERSISTED',
          detail: 'Session marked arrived but character still at origin in database',
          root_cause: 'updateCharacterArrivalState likely failed or was not called',
        });
      }

      if (diagnostic.consistency.is_traveling_in_session && !diagnostic.consistency.travel_flags_cleared) {
        diagnostic.issues.push({
          severity: 'HIGH',
          issue: 'TRAVEL FLAGS NOT CLEARED',
          detail: `travel_status = ${char.travel_status}, traveling_to_location_id = ${char.traveling_to_location_id}`,
          root_cause: 'processTravelArrivals did not clear travel flags after arrival',
        });
      }

      // Work schedule issue
      if (char.current_work_location_id && char.work_start_time) {
        const [workHour, workMin] = (char.work_start_time || '').split(':').map(Number);
        const workStartMinutes = workHour * 60 + workMin;
        const nowHours = now.getUTCHours();
        const nowMinutes = now.getUTCMinutes();
        const nowTotalMinutes = nowHours * 60 + nowMinutes;

        if (nowTotalMinutes >= workStartMinutes) {
          // It's past or at work start time
          if (!diagnostic.consistency.canonical_at_destination) {
            if (char.current_work_location_id === session.destination_location_id) {
              diagnostic.issues.push({
                severity: 'HIGH',
                issue: 'WORK ARRIVAL FAILED',
                detail: `Character should be at work (${locMap[char.current_work_location_id]?.name}) since ${char.work_start_time}`,
                root_cause: 'Travel to work destination was not completed',
              });
            }
          }
        }
      }

      diagnostics.push(diagnostic);
    }

    // ── SUMMARY ──
    const critical = diagnostics.filter(d => d.issues.some(i => i.severity === 'CRITICAL'));
    const high = diagnostics.filter(d => d.issues.some(i => i.severity === 'HIGH'));

    return Response.json({
      timestamp: now.toISOString(),
      user_email: user.email,
      summary: {
        total_traveling: diagnostics.length,
        with_critical_issues: critical.length,
        with_high_issues: high.length,
        critical_issue_list: critical.map(d => ({
          character: d.character_name,
          issue: d.issues.find(i => i.severity === 'CRITICAL')?.issue,
        })),
        high_issue_list: high.map(d => ({
          character: d.character_name,
          issue: d.issues.find(i => i.severity === 'HIGH')?.issue,
        })),
      },
      diagnostics: diagnostics.sort((a, b) => {
        const aIssues = a.issues.length;
        const bIssues = b.issues.length;
        return bIssues - aIssues;
      }),
    });

  } catch (error) {
    console.error('[diagnoseTravelArrivalFullState]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});