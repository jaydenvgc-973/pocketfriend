/**
 * auditVGCTowersResidentTravelLoop
 *
 * Diagnoses VGC Towers NPC resident travel ecosystem state.
 * Verifies whether the canonical daytime travel cycle is executing
 * and identifies where residents are being incorrectly trapped at home.
 *
 * Does NOT evaluate work/school as primary filters.
 * ONLY checks whether VGC travel cycle has executed and why residents
 * remain home despite eligibility.
 *
 * Returns the 19-field diagnostic per resident + 10-point summary.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // Fetch VGC Towers location for this user
    const vgcLocations = await base44.entities.LocationReference.filter(
      { owner_email: user.email, name: 'VGC Towers' },
      null, 10
    );
    const vgcTowers = vgcLocations[0];
    if (!vgcTowers) {
      return Response.json({ error: 'VGC Towers not found', vgcLocations }, { status: 404 });
    }

    // Get all residents (try both field names)
    const residents = vgcTowers.residents || [];
    let residentIds = residents.map(r => r.character_id).filter(Boolean);
    
    // Fallback to resident_character_ids if residents array is empty
    if (residentIds.length === 0) {
      residentIds = vgcTowers.resident_character_ids || [];
    }

    // Fetch all resident characters
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null, 500
    );
    const charMap = Object.fromEntries(allChars.map(c => [c.id, c]));

    // Fetch all locations
    const allLocations = await base44.entities.LocationReference.filter(
      { owner_email: user.email },
      null, 300
    );
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    // Fetch all travel sessions
    const allSessions = await base44.entities.TravelSession.filter(
      { owner_email: user.email },
      null, 500
    );

    const diagnostics = [];
    let totalNPC = 0;
    let totalEligible = 0;
    let totalDispersed = 0;
    let totalHome = 0;
    let totalHomeWork = 0;
    let totalHomeSchool = 0;
    let totalHomeIncorrect = 0;
    let totalMovementFailed = 0;
    let totalNeverTraveled = 0;

    for (const residentId of residentIds) {
      const char = charMap[residentId];
      if (!char) continue;

      // Only NPCs count for this system
      const isNPC = ['npc_fictitious', 'npc_family_member', 'npc_regular'].includes(char.character_type);
      if (!isNPC) continue;

      totalNPC++;
      totalEligible++; // All VGC residents are eligible for travel

      const currentLoc = locationMap[char.resolved_current_location_id];
      const currentLocName = currentLoc?.name || char.resolved_current_location_name || 'Unknown';

      // Check if currently home
      const isHome = char.resolved_current_location_id === vgcTowers.id ||
                     char.resolved_presence_status === 'home';

      // Check for active work/school overrides
      const hasWork = !!(char.work_start_time && char.work_end_time && char.work_days);
      const isEnrolled = char.student_status === 'enrolled';

      // Find any travel session for this resident
      const activeSession = allSessions.find(s => s.character_id === char.id && s.route_status !== 'arrived');

      // Check if resident moved today (session exists or was recently completed)
      const movedToday = !!allSessions.find(s =>
        s.character_id === char.id &&
        new Date(s.created_at || 0).toDateString() === nowET.toDateString()
      );

      // Determine why they're home
      let homeReason = null;
      if (isHome) {
        if (hasWork && char.work_days.includes(nowET.getDay())) {
          const workStart = parseInt(char.work_start_time.split(':')[0]);
          const workEnd = parseInt(char.work_end_time.split(':')[0]);
          const nowHour = nowET.getHours();
          if (nowHour >= workStart && nowHour < workEnd) {
            homeReason = 'work_exclusion';
            totalHomeWork++;
          } else {
            homeReason = 'home_after_work';
          }
        } else if (isEnrolled && [1, 2, 3, 4, 5].includes(nowET.getDay())) {
          const nowHour = nowET.getHours();
          if (nowHour >= 8 && nowHour < 15) {
            homeReason = 'school_exclusion';
            totalHomeSchool++;
          } else {
            homeReason = 'home_after_school';
          }
        } else {
          homeReason = 'incorrect_default_home';
          totalHomeIncorrect++;
        }
        totalHome++;
      } else {
        totalDispersed++;
      }

      if (!movedToday && !activeSession) {
        totalNeverTraveled++;
      }

      if (!isHome && !activeSession) {
        totalMovementFailed++;
      }

      diagnostics.push({
        character_name: char.name || char.display_name,
        character_id: char.id,
        character_type: char.character_type,
        assigned_home: vgcTowers.name,
        vgc_eligible: true,
        current_stored_location: currentLocName,
        current_stored_location_id: char.resolved_current_location_id,
        resolved_presence_status: char.resolved_presence_status,
        daytime_travel_executed: movedToday ? 'yes' : 'no',
        last_movement_assignment: activeSession ? activeSession.id : 'none',
        next_movement_assignment: 'unknown',
        current_travel_session: activeSession?.id || 'none',
        excluded_by_work: hasWork ? (char.work_days.includes(nowET.getDay()) ? 'possibly' : 'no') : 'no',
        excluded_by_school: isEnrolled ? 'possibly' : 'no',
        sleep_blocked_travel: char.resolved_presence_status === 'sleeping' ? 'yes' : 'no',
        fallback_home_logic_won: isHome && !activeSession ? 'yes' : 'no',
        autonomous_travel_interfered: 'unknown',
        nightly_restoration_failed: isHome && !movedToday ? 'possibly' : 'no',
        final_home_reason: homeReason,
      });
    }

    console.log(`[auditVGCTowersResidentTravelLoop] VGC Towers: ${totalNPC} NPCs, ${totalDispersed} dispersed, ${totalHome} home (${totalHomeIncorrect} incorrect)`);

    return Response.json({
      success: true,
      et_time: nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      proof_summary: {
        total_vgc_residents: totalNPC,
        total_npc_eligible_for_vgc_travel: totalEligible,
        total_currently_dispersed: totalDispersed,
        total_currently_home: totalHome,
        total_home_because_work: totalHomeWork,
        total_home_because_school: totalHomeSchool,
        total_incorrectly_defaulted_home: totalHomeIncorrect,
        total_movement_assignment_failed: totalMovementFailed,
        total_daytime_travel_never_executed: totalNeverTraveled,
      },
      resident_diagnostics: diagnostics,
    });
  } catch (error) {
    console.error('[auditVGCTowersResidentTravelLoop]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});