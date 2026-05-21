/**
 * auditTravelSystemArchitecture
 *
 * Maps the complete travel system:
 * - All functions that create travel
 * - All functions that update progress
 * - All functions that mark arrival
 * - All functions that write Character canonical location
 * - All pages/components that read presence
 * - The order of operations
 * - Where split truth is possible
 *
 * No changes. Architectural proof only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const system = {
      phases: {
        create_travel: {
          description: 'User initiates travel from point A to point B',
          functions: [
            {
              name: 'createTravelSession',
              file: 'functions/createTravelSession',
              writes_to: ['TravelSession (creates record)', 'Character (sets travel_status=traveling_to_destination, traveling_to_location_id, traveling_to_location_name)'],
              reads_from: ['Character', 'LocationReference (origin and destination)'],
              source_of_truth: 'TravelSession.id, origin_location_id, destination_location_id, estimated_arrival_time',
            },
          ],
          split_truth_risk: 'Character travel_status set BEFORE TravelSession created → race condition if Character write succeeds but TravelSession fails',
        },

        progress_update: {
          description: 'Travel progress updates from 0% to 100%',
          functions: [
            {
              name: 'processTravelArrivals (scheduled every 5 min)',
              file: 'functions/processTravelArrivals',
              reads_from: ['TravelSession (all in_transit, estimated_arrival_time < now)', 'Character (for checks)', 'LocationReference'],
              updates_field: 'TravelSession.progress_percent (interpolated between now and ETA)',
              condition: 'route_status === "in_transit" AND estimated_arrival_time > now',
              source_of_truth: 'TravelSession.estimated_arrival_time (system of record for progress)',
            },
          ],
          split_truth_risk: 'None during transit — progress is read-only.',
        },

        arrival_completion: {
          description: 'Travel completes when estimated_arrival_time passes',
          functions: [
            {
              name: 'processTravelArrivals (line 100+)',
              file: 'functions/processTravelArrivals',
              logic: [
                '1. Load TravelSession where route_status="in_transit" AND estimated_arrival_time <= now + 2min threshold',
                '2. For each due session, call updateCharacterArrivalState(...) with destination_location_id',
                '3. updateCharacterArrivalState writes Character.resolved_current_location_id = destination',
                '4. processTravelArrivals waits for updateCharacterArrivalState to succeed',
                '5. If success, mark TravelSession.route_status = "arrived"',
                '6. If failure, log error, do NOT mark arrived (CRITICAL)',
              ],
              writes_to_on_success: [
                'Character: resolved_current_location_id, resolved_current_location_name, resolved_presence_status, resolved_last_updated_at, travel_status=not_traveling, traveling_to_location_id=null',
                'TravelSession: route_status="arrived", actual_arrival_time=now, progress_percent=100',
              ],
              writes_to_on_failure: [
                'TravelSession: route_status="arrival_failed" (SHOULD BE, but currently logs and continues to mark arrived anyway)',
              ],
              source_of_truth: 'TravelSession.destination_location_id (what the user booked)',
              critical_read_back: 'After Character write, read back Character.resolved_current_location_id and verify it equals destination_location_id',
            },
            {
              name: 'updateCharacterArrivalState',
              file: 'functions/updateCharacterArrivalState',
              logic: [
                '1. Receive character_id, owner_email, updates object',
                '2. Query Character as asServiceRole (bypasses user RLS)',
                '3. Verify ownership: char.owner_email === request.owner_email',
                '4. Write Character with updates (resolved_current_location_id = destination)',
                '5. Return success or error',
              ],
              writes_to: ['Character entity'],
              reads_from: ['Character (to verify ownership)'],
              source_of_truth: 'Character.resolved_current_location_id after successful write',
              critical_issue: 'asServiceRole.entities.Character.filter({id:...}) fails if RLS blocks read (no owner_email in filter). Returns empty array → "not found" error.',
            },
          ],
          split_truth_risk: 'CRITICAL: processTravelArrivals marks session "arrived" even if updateCharacterArrivalState fails (line 156). Session says arrived, Character still at origin → permanent split.',
        },

        character_location_display: {
          description: 'All pages show Character canonical location',
          pages_and_components: [
            {
              page: 'pages/Home',
              component: 'Home card character card',
              reads_from: 'travelPresenceResolver (lib/travelPresenceResolver.js)',
              displays: 'Character.resolved_current_location_name',
              fallback: 'If resolved_current_location_id not in locationMap, falls back to home (TIER2 fallback)',
            },
            {
              page: 'pages/Travel',
              component: 'LivePresenceMap + TravelCharacterSelector',
              reads_from: 'travelPresenceResolver',
              displays: 'map markers at Character.resolved_current_location_id, travel selector shows travel_status',
              fallback: 'Home fallback masks arrival failures',
            },
            {
              page: 'pages/Chat, pages/Text',
              component: 'Scene context, message bubbles',
              reads_from: 'Character.resolved_current_location_id directly (via conversation context)',
              displays: 'Character location in scene header',
            },
            {
              page: 'pages/Scene',
              component: 'Scene page (character at location check)',
              reads_from: 'Character.resolved_current_location_id',
              displays: 'Shows characters physically present in scene',
            },
            {
              page: 'Locations page',
              component: 'Location detail → Who\'s here list',
              reads_from: 'travelPresenceResolver → occupants array',
              displays: 'Characters present at location',
            },
          ],
          source_of_truth: 'Character.resolved_current_location_id (single source)',
          split_truth_risk: 'CRITICAL: If Character location not updated after arrival (Bug 1), all pages show origin/home, not destination. travelPresenceResolver has no way to detect the split.',
        },

        schedule_enforcement: {
          description: 'Work schedule enforcer may overwrite travel destination',
          functions: [
            {
              name: 'enforceCharacterWorkSchedule',
              file: 'functions/enforceCharacterWorkSchedule',
              logic: 'Scheduled every 5 min: if character has active work shift right now, move them to work_location',
              reads_from: ['Character.work_schedule or additional_occupation_locations or occupation + work_start_time/work_end_time/work_days', 'Character.resolved_current_location_id'],
              checks: 'Is it a work day? Is it work hours? Does character have an active work shift?',
              writes_to: 'Character.resolved_current_location_id = work_location_id',
              critical_issue_1: 'Does NOT read TravelSession to check if character is in_transit',
              critical_issue_2: 'Does NOT read all job sources (only checks occupation + work fields, may miss work_schedule array or additional_occupation_locations)',
              critical_issue_3: 'Overwrites manual travel destination with work location',
            },
            {
              name: 'scheduledLocationEnforcement',
              file: 'functions/scheduledLocationEnforcement',
              logic: 'Similar: enforces presence based on schedule',
              same_issues: 'Does not check for active travel, may overwrite destination',
            },
          ],
          split_truth_risk: 'CRITICAL: Character arrives at JoJo\'s (destination), work schedule runs, moves character to work_location, discards JoJo\'s destination. Character appears at work, but TravelSession still says arrived at JoJo\'s.',
        },

        travel_flags_cleanup: {
          description: 'Clearing travel_status after arrival',
          when: 'Should happen: after Character destination write succeeds AND is verified',
          currently: 'Happens in updateCharacterArrivalState (as part of updates object)',
          split_truth_risk: 'If Character write fails, travel_status is NOT cleared. Calling function must handle cleanup on error.',
        },
      },

      source_of_truth_map: {
        canonical_character_location: {
          entity: 'Character',
          field: 'resolved_current_location_id + resolved_current_location_name',
          written_by: [
            'createTravelSession (sets to origin)',
            'updateCharacterArrivalState (sets to destination on arrival)',
            'enforceCharacterWorkSchedule (sets to work_location)',
            'scheduledLocationEnforcement (sets per schedule)',
            'updateCharacterLocationFromMessage (manual updates)',
            'other direct updates',
          ],
          read_by: 'ALL pages, travelPresenceResolver, components',
        },
        active_travel_session: {
          entity: 'TravelSession',
          fields: 'route_status, destination_location_id, estimated_arrival_time, progress_percent',
          written_by: 'processTravelArrivals (updates progress, marks arrived)',
          read_by: 'Travel page, map, schedulers',
        },
        travel_status_flags: {
          entity: 'Character',
          fields: 'travel_status, traveling_to_location_id, traveling_to_location_name',
          written_by: 'createTravelSession, updateCharacterArrivalState, clearers',
          read_by: 'Travel selector, availability checks',
        },
      },

      split_truth_points: [
        {
          point: 'Arrival completion atomicity',
          issue: 'processTravelArrivals marks session "arrived" before verifying Character destination write succeeded. Session=arrived but Character still at origin.',
          files_involved: ['functions/processTravelArrivals', 'functions/updateCharacterArrivalState'],
          data_inconsistency: 'TravelSession.route_status != Character.resolved_current_location_id',
        },
        {
          point: 'Schedule overwrite after arrival',
          issue: 'Character arrives at manual destination. Work schedule enforcer runs and moves character to work location. Destination is lost.',
          files_involved: ['functions/processTravelArrivals', 'functions/enforceCharacterWorkSchedule'],
          data_inconsistency: 'TravelSession.destination_location_id != Character.resolved_current_location_id',
        },
        {
          point: 'Multi-job schedule read incompleteness',
          issue: 'Work enforcer checks occupation + work_start_time, but job is stored in additional_occupation_locations[]. Enforcer doesn\'t find the job, can\'t determine if shift is active.',
          files_involved: ['functions/enforceCharacterWorkSchedule', 'Character entity'],
          data_inconsistency: 'Job exists but is not queried, so schedule enforcement is incomplete or wrong',
        },
        {
          point: 'Home fallback masks arrival failure',
          issue: 'If Character.resolved_current_location_id not in locationMap, travelPresenceResolver returns home. Hides arrival failure from UI.',
          files_involved: ['lib/travelPresenceResolver.js', 'components/travel/LivePresenceMap'],
          data_inconsistency: 'Character at origin, TravelSession at destination, UI shows home — triple split.',
        },
      ],

      repair_sequence: [
        {
          priority: 'CRITICAL 1',
          fix: 'processTravelArrivals: DO NOT mark arrived until Character destination write is verified',
          files: ['functions/processTravelArrivals', 'functions/updateCharacterArrivalState'],
          logic: [
            'Call updateCharacterArrivalState',
            'Wait for response',
            'If error, set TravelSession.route_status = "arrival_failed", TravelSession.error_reason = error.message',
            'If success, read back Character to verify resolved_current_location_id === destination_location_id',
            'If verification passes, set TravelSession.route_status = "arrived"',
            'If verification fails, set route_status = "arrival_failed" (Character write didn\'t persist)',
          ],
        },
        {
          priority: 'CRITICAL 2',
          fix: 'updateCharacterArrivalState: Fix RLS-compliant query',
          files: ['functions/updateCharacterArrivalState'],
          logic: [
            'Change asServiceRole.entities.Character.filter({id:...}) to filter({id:..., owner_email:...})',
            'This matches RLS condition and returns the record',
            'After write, read back and verify destination persisted',
          ],
        },
        {
          priority: 'CRITICAL 3',
          fix: 'enforceCharacterWorkSchedule: Check for active TravelSession before overwriting',
          files: ['functions/enforceCharacterWorkSchedule'],
          logic: [
            'Before overwriting Character location with work_location',
            'Check if character has active TravelSession (route_status = "in_transit")',
            'If yes, skip the update',
            'Also: read ALL job sources (occupation, additional_occupation_locations, work_schedule array)',
          ],
        },
        {
          priority: 'CRITICAL 4',
          fix: 'travelPresenceResolver: Remove home fallback, fail visibly',
          files: ['lib/travelPresenceResolver.js'],
          logic: [
            'If resolved_current_location_id not in locationMap',
            'Do NOT fallback to home',
            'Instead: set is_currently_present = false, mark as "Location data missing"',
            'This exposes the state rather than hiding it',
          ],
        },
      ],
    };

    return Response.json({
      timestamp: new Date().toISOString(),
      architecture: system,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});