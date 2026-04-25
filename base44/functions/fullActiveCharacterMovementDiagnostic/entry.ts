import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FULL MOVEMENT DIAGNOSTIC — ALL active_created_characters
 * 
 * For EACH character, check ALL possible reasons they cannot move:
 * 1. Home location assignment
 * 2. Location resolution state
 * 3. Travel/movement status fields
 * 4. Work schedule configuration
 * 5. Sleep schedule state
 * 6. Any hard locks or constraints
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch ALL characters and locations using service role (RLS-bypassed)
    // Characters are created by service account, so we need service role to query them
    const [allChars, allLocations] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ status: 'active' }),
      base44.asServiceRole.entities.LocationReference.filter({ owner_email: user.email }),
    ]);

    // FILTER: Only active_created_character type
    const activeCreated = allChars.filter(c => c.character_type === 'active_created_character');

    const characterDiagnostics = [];

    for (const char of activeCreated) {
      const diag = {
        name: char.name,
        id: char.id,
        type: char.character_type,
        status: char.status,
        issues: [],
        fieldState: {},
        locationResolution: {},
      };

      // === FIELD STATE ===
      diag.fieldState = {
        current_home_location_id: char.current_home_location_id || null,
        resolved_current_location_id: char.resolved_current_location_id || null,
        resolved_current_location_name: char.resolved_current_location_name || null,
        resolved_presence_status: char.resolved_presence_status || null,
        resolved_location_type: char.resolved_location_type || null,
        location_status: char.location_status || 'home',
        travel_status: char.travel_status || 'not_traveling',
        traveling_to_location_id: char.traveling_to_location_id || null,
        current_work_location_id: char.current_work_location_id || null,
        occupation_location_id: char.occupation_location_id || null,
        current_school_location_id: char.current_school_location_id || null,
        education_location_id: char.education_location_id || null,
        student_status: char.student_status || 'not_student',
        is_homeless: char.is_homeless || false,
        housing_context: char.housing_context || null,
      };

      // === CHECK 1: Home location assignment ===
      if (!char.current_home_location_id) {
        diag.issues.push('CRITICAL: current_home_location_id is NULL — no home assigned');
      } else {
        const homeLoc = allLocations.find(l => l.id === char.current_home_location_id);
        if (!homeLoc) {
          diag.issues.push(`CRITICAL: current_home_location_id="${char.current_home_location_id}" does not exist in LocationReference`);
        } else {
          diag.locationResolution.home = { id: homeLoc.id, name: homeLoc.name, category: homeLoc.category };
        }
      }

      // === CHECK 2: Location resolution state ===
      if (char.resolved_current_location_id) {
        const resolvedLoc = allLocations.find(l => l.id === char.resolved_current_location_id);
        if (resolvedLoc) {
          diag.locationResolution.resolved = { id: resolvedLoc.id, name: resolvedLoc.name };
        } else {
          diag.issues.push(`resolved_current_location_id="${char.resolved_current_location_id}" does not exist`);
        }
      }

      // === CHECK 3: Travel status ===
      if (char.travel_status === 'traveling' && char.traveling_to_location_id) {
        const travelLoc = allLocations.find(l => l.id === char.traveling_to_location_id);
        if (travelLoc) {
          diag.locationResolution.traveling = { id: travelLoc.id, name: travelLoc.name };
        } else {
          diag.issues.push(`traveling_to_location_id="${char.traveling_to_location_id}" does not exist`);
        }
      } else if (char.travel_status && char.travel_status !== 'not_traveling') {
        diag.issues.push(`travel_status="${char.travel_status}" set but traveling_to_location_id is ${char.traveling_to_location_id ? 'set' : 'NULL'}`);
      }

      // === CHECK 4: Work configuration ===
      if (char.current_work_location_id || char.occupation_location_id) {
        const workLocId = char.current_work_location_id || char.occupation_location_id;
        const workLoc = allLocations.find(l => l.id === workLocId);
        if (workLoc) {
          diag.locationResolution.work = { id: workLoc.id, name: workLoc.name };
          diag.fieldState.work_start_time = char.work_start_time || '09:00';
          diag.fieldState.work_end_time = char.work_end_time || '17:00';
          diag.fieldState.work_days = char.work_days || [1, 2, 3, 4, 5];
        } else {
          diag.issues.push(`Work location ID="${workLocId}" does not exist in LocationReference`);
        }
      }

      // === CHECK 5: School/education configuration ===
      if (char.current_school_location_id || char.education_location_id) {
        const eduLocId = char.current_school_location_id || char.education_location_id;
        const eduLoc = allLocations.find(l => l.id === eduLocId);
        if (eduLoc) {
          diag.locationResolution.school = { id: eduLoc.id, name: eduLoc.name };
          diag.fieldState.student_status = char.student_status;
        } else {
          diag.issues.push(`Education location ID="${eduLocId}" does not exist in LocationReference`);
        }
      }

      // === CHECK 6: Sleep schedule ===
      diag.fieldState.sleep_start_time = char.sleep_start_time || '23:00';
      diag.fieldState.wake_up_time = char.wake_up_time || '07:00';

      // === CHECK 7: Hard state locks ===
      if (char.location_status === 'home') {
        diag.issues.push(`LOCK: location_status is hardcoded to "home" — prevents all movement`);
      }
      if (char.is_homeless) {
        diag.issues.push(`CONSTRAINT: is_homeless=true — may restrict location options`);
      }
      if (char.housing_context && (char.housing_context === 'homeless_unsheltered' || char.housing_context === 'temporary_shelter')) {
        diag.issues.push(`CONSTRAINT: housing_context="${char.housing_context}" — affects location eligibility`);
      }

      // === CHECK 8: Check if character can actually move somewhere ===
      const hasHome = !!char.current_home_location_id;
      const hasWork = !!(char.current_work_location_id || char.occupation_location_id);
      const hasSchool = !!(char.current_school_location_id || char.education_location_id);
      const hasManualLocation = !!char.resolved_current_location_id;
      const isActive = char.status === 'active' && char.character_type === 'active_created_character';

      if (!hasHome && !hasWork && !hasSchool) {
        diag.issues.push('NO DESTINATIONS: Character has no home, work, or school location configured');
      }

      diag.mobility = {
        has_home: hasHome,
        has_work: hasWork,
        has_school: hasSchool,
        has_manual_location: hasManualLocation,
        is_active: isActive,
        can_potentially_move: hasWork || hasSchool,
      };

      characterDiagnostics.push(diag);
    }

    // === SUMMARY ===
    const summary = {
      total_active_created: activeCreated.length,
      issues_by_type: {
        no_home_location: 0,
        location_ids_invalid: 0,
        location_status_locked: 0,
        no_work_configured: 0,
        homeless_constraint: 0,
      },
      characters_with_issues: 0,
    };

    for (const diag of characterDiagnostics) {
      if (diag.issues.length > 0) {
        summary.characters_with_issues++;
      }
      for (const issue of diag.issues) {
        if (issue.includes('current_home_location_id is NULL')) summary.issues_by_type.no_home_location++;
        if (issue.includes('does not exist in LocationReference')) summary.issues_by_type.location_ids_invalid++;
        if (issue.includes('location_status is hardcoded')) summary.issues_by_type.location_status_locked++;
        if (issue.includes('NO DESTINATIONS')) summary.issues_by_type.no_work_configured++;
        if (issue.includes('CONSTRAINT:')) summary.issues_by_type.homeless_constraint++;
      }
    }

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary,
      diagnostics: characterDiagnostics,
    });

  } catch (error) {
    console.error('[fullActiveCharacterMovementDiagnostic]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});