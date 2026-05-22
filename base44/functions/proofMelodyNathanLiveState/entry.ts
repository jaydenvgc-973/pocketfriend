/**
 * proofMelodyNathanLiveState
 *
 * Live diagnostic for Melody Jackson Perry and Nathan Parker.
 * Reads from the AUTHENTICATED user's account only (owner_email scope).
 * Returns raw DB fields + active TravelSessions + pending CharacterCommitments.
 * Does NOT modify any data.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;

    // Load all active_created_characters for this owner — owner_email scope only
    const allChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      '-updated_date',
      200
    ).catch(() => []);

    // Find Melody and Nathan by name (case-insensitive partial match)
    const melody = allChars.find(c =>
      (c.name || '').toLowerCase().includes('melody') ||
      (c.display_name || '').toLowerCase().includes('melody')
    );
    const nathan = allChars.find(c =>
      (c.name || '').toLowerCase().includes('nathan') ||
      (c.display_name || '').toLowerCase().includes('nathan')
    );

    const targetIds = [melody?.id, nathan?.id].filter(Boolean);

    // Load active TravelSessions for these characters
    let travelSessions = [];
    if (targetIds.length > 0) {
      const allSessions = await base44.entities.TravelSession.filter(
        { owner_email: ownerEmail },
        '-created_at',
        50
      ).catch(() => []);
      travelSessions = allSessions.filter(s =>
        targetIds.includes(s.character_id) &&
        ['in_transit', 'arrival_due', 'preparing'].includes(s.route_status)
      );
    }

    // Load pending CharacterCommitments for these characters
    let commitments = [];
    if (targetIds.length > 0) {
      const allCommitments = await base44.entities.CharacterCommitment.filter(
        { owner_email: ownerEmail },
        '-created_at',
        20
      ).catch(() => []);
      commitments = allCommitments.filter(c =>
        targetIds.includes(c.character_id) && c.status === 'active'
      );
    }

    // Compute current ET time for sleep window check
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();

    function toMin(t) {
      if (!t) return null;
      const [h, m] = t.split(':').map(Number);
      return h * 60 + (m || 0);
    }

    function computeSleepWindow(char) {
      if (char.sleep_start_time && char.wake_up_time) {
        return { sleepStart: toMin(char.sleep_start_time), wakeMin: toMin(char.wake_up_time), source: 'stored_schedule' };
      }
      if (char.work_start_time && char.work_end_time && Array.isArray(char.work_days)) {
        const dow = nowET.getDay();
        if (char.work_days.includes(dow) || char.work_days.includes((dow + 1) % 7)) {
          const ws = toMin(char.work_start_time);
          const we = toMin(char.work_end_time);
          if (ws !== null && we !== null) {
            const overnight = we < ws;
            if (overnight) {
              return { sleepStart: (we + 60) % 1440, wakeMin: (ws - 60 + 1440) % 1440, source: 'derived_overnight_work' };
            } else {
              const wake = (ws - 60 + 1440) % 1440;
              return { sleepStart: (wake - 7 * 60 + 1440) % 1440, wakeMin: wake, source: 'derived_work_schedule' };
            }
          }
        }
      }
      return null;
    }

    function isSleepingNow(char) {
      if (char.decided_to_stay_up_until && new Date() < new Date(char.decided_to_stay_up_until)) return false;
      const w = computeSleepWindow(char);
      if (!w) return false;
      const { sleepStart, wakeMin } = w;
      if (sleepStart > wakeMin) return currentMinutes >= sleepStart || currentMinutes < wakeMin;
      return currentMinutes >= sleepStart && currentMinutes < wakeMin;
    }

    function buildCharProof(char) {
      if (!char) return null;
      const sleepWindow = computeSleepWindow(char);
      const sleepingNow = isSleepingNow(char);
      const activeSessions = travelSessions.filter(s => s.character_id === char.id);
      const activeCommitments = commitments.filter(c => c.character_id === char.id);

      return {
        id: char.id,
        name: char.name,
        display_name: char.display_name || null,
        owner_email: char.owner_email,
        character_type: char.character_type,
        status: char.status,

        // DB presence fields (raw — may be stale)
        db_resolved_current_location_id: char.resolved_current_location_id || null,
        db_resolved_current_location_name: char.resolved_current_location_name || null,
        db_resolved_presence_status: char.resolved_presence_status || null,
        db_resolved_source_reason: char.resolved_source_reason || null,
        db_resolved_location_type: char.resolved_location_type || null,

        // Home
        current_home_location_id: char.current_home_location_id || null,
        home_location_id: char.home_location_id || null,
        temporary_housing_location_id: char.temporary_housing_location_id || null,

        // Work
        occupation_location_id: char.occupation_location_id || null,
        work_start_time: char.work_start_time || null,
        work_end_time: char.work_end_time || null,
        work_days: char.work_days || null,
        work_exception_status: char.work_exception_status || null,

        // School
        student_status: char.student_status || null,
        education_location_id: char.education_location_id || null,

        // Sleep
        sleep_start_time: char.sleep_start_time || null,
        wake_up_time: char.wake_up_time || null,
        decided_to_stay_up_until: char.decided_to_stay_up_until || null,
        sleep_debt_hours: char.sleep_debt_hours || 0,
        computed_sleep_window: sleepWindow,
        is_sleeping_now_canonical: sleepingNow,

        // Travel flags (raw DB)
        travel_status: char.travel_status || null,
        travel_destination_location_id: char.travel_destination_location_id || null,
        traveling_to_location_name: char.traveling_to_location_name || null,

        // Restrictions
        is_jailed: char.is_jailed || false,
        house_arrest_active: char.house_arrest_active || false,

        // Active sessions
        active_travel_sessions: activeSessions.map(s => ({
          session_id: s.id,
          route_status: s.route_status,
          destination: s.destination_location_name,
          destination_id: s.destination_location_id,
          origin: s.origin_location_name,
          eta: s.estimated_arrival_time,
          progress_percent: s.progress_percent,
          travel_source: s.travel_source,
          interruption_allowed: s.interruption_allowed,
        })),

        // Active commitments
        active_commitments: activeCommitments.map(c => ({
          commitment_id: c.id,
          type: c.commitment_type,
          destination: c.destination_location_name,
          status: c.status,
          commitment_text: c.commitment_text,
          expected_arrival: c.expected_arrival_time,
        })),

        // Diagnostic verdict
        canonical_verdict: (() => {
          if (char.is_jailed) return 'TIER_0_INCARCERATED';
          if (char.house_arrest_active) return 'TIER_0_HOUSE_ARREST';
          if (activeSessions.length > 0) return `TIER_1_IN_TRANSIT_TO_${activeSessions[0].destination_location_name}`;
          if (sleepingNow) return 'TIER_2_SLEEPING';
          if (char.work_start_time && char.work_end_time) return 'TIER_5_WORK_SCHEDULE_OR_FREE';
          return 'TIER_FREE_HOME_OR_VISIT';
        })(),

        et_time_now: `${nowET.getHours().toString().padStart(2,'0')}:${nowET.getMinutes().toString().padStart(2,'0')} ET`,
      };
    }

    // Also report character_type for all active_created on account (to confirm Melody/Nathan classification)
    const typeReport = allChars.map(c => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      status: c.status,
      owner_email: c.owner_email,
    }));

    return Response.json({
      owner_email: ownerEmail,
      et_time: nowET.toISOString(),
      total_chars_on_account: allChars.length,
      melody: buildCharProof(melody),
      nathan: buildCharProof(nathan),
      not_found: [
        !melody && 'Melody Jackson Perry',
        !nathan && 'Nathan Parker',
      ].filter(Boolean),
      all_characters_type_report: typeReport,
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});