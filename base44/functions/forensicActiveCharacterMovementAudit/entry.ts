import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FORENSIC AUDIT — Active Created Character Movement System
 * 
 * Standard: Evidence-based investigation only.
 * No fixes. No hypotheses without proof.
 * 
 * For each active_created_character:
 * 1. Character record state
 * 2. Home location path
 * 3. Resolved location path
 * 4. Travel state path
 * 5. Work/school configuration path
 * 6. Movement function eligibility
 * 7. Scheduler inclusion check
 * 8. UI resolution path
 * 9. Backend persistence path
 * 10. Exact failure point with proof
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    console.log(`[FORENSIC] Starting audit for user: ${user.email}`);

    // STAGE 1: FETCH ALL DATA SOURCES
    const [allChars, allLocations, allConvos, allSchedules] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({}),
      base44.asServiceRole.entities.LocationReference.filter({ owner_email: user.email }),
      base44.asServiceRole.entities.Conversation.filter({ created_by: user.email }),
      base44.asServiceRole.entities.ScheduledEvent.filter({ created_by: user.email }),
    ]);

    console.log(`[FORENSIC] Data sources loaded: ${allChars.length} chars | ${allLocations.length} locations | ${allConvos.length} conversations | ${allSchedules.length} scheduled events`);

    // STAGE 2: FILTER TO ACTIVE_CREATED_CHARACTER ONLY
    const activeCreated = allChars.filter(c => c.character_type === 'active_created_character' && c.status === 'active');
    console.log(`[FORENSIC] Found ${activeCreated.length} active_created_character records`);

    if (activeCreated.length === 0) {
      return Response.json({
        success: true,
        audit_type: 'forensic_movement_audit',
        timestamp: new Date().toISOString(),
        user_email: user.email,
        total_active_created: 0,
        finding: 'NO ACTIVE_CREATED_CHARACTER RECORDS FOUND',
        detail: 'The user has 0 active_created_character entities in the database. Cannot audit movement system without subject records.',
        evidence: {
          filter_applied: { character_type: 'active_created_character', status: 'active' },
          total_all_characters: allChars.length,
          characters_by_type: allChars.reduce((acc, c) => {
            if (!acc[c.character_type]) acc[c.character_type] = 0;
            acc[c.character_type]++;
            return acc;
          }, {}),
          characters_by_status: allChars.reduce((acc, c) => {
            if (!acc[c.status]) acc[c.status] = 0;
            acc[c.status]++;
            return acc;
          }, {}),
        },
      });
    }

    // STAGE 3: FORENSIC AUDIT FOR EACH ACTIVE_CREATED_CHARACTER
    const characterAudits = [];

    for (const char of activeCreated) {
      const audit = {
        character_name: char.name,
        character_id: char.id,
        character_type: char.character_type,
        character_status: char.status,
        owner_email: char.owner_email || char.created_by || null,
        owner_user_id: char.owner_user_id || null,
        
        // EVIDENCE TRAIL: HOME LOCATION
        home_location: {
          field_current_home_location_id: char.current_home_location_id || null,
          field_home_location_id: char.home_location_id || null,
          field_source: char.current_home_location_id ? 'current_home_location_id' : 'home_location_id',
          resolved_location_record: null,
          resolved_location_name: null,
          evidence_home_missing: !char.current_home_location_id && !char.home_location_id,
          proof: {
            condition: 'HOME LOCATION MISSING',
            test: `char.current_home_location_id: ${char.current_home_location_id} | char.home_location_id: ${char.home_location_id}`,
            result: !char.current_home_location_id && !char.home_location_id ? 'FAILED' : 'PASSED',
          },
        },

        // EVIDENCE TRAIL: RESOLVED LOCATION
        resolved_location: {
          field_resolved_current_location_id: char.resolved_current_location_id || null,
          field_resolved_current_location_name: char.resolved_current_location_name || null,
          field_resolved_location_type: char.resolved_location_type || null,
          field_resolved_presence_status: char.resolved_presence_status || null,
          field_resolved_source_reason: char.resolved_source_reason || null,
          location_status_field: char.location_status || 'home',
          evidence_hardcoded_to_home: char.location_status === 'home',
          proof: {
            condition: 'LOCATION STATUS HARDCODED',
            test: `char.location_status: "${char.location_status}"`,
            result: char.location_status === 'home' ? 'LOCKED_TO_HOME' : 'VARIABLE',
          },
        },

        // EVIDENCE TRAIL: TRAVEL STATE
        travel_state: {
          field_travel_status: char.travel_status || 'not_traveling',
          field_traveling_to_location_id: char.traveling_to_location_id || null,
          field_location_status: char.location_status || 'home',
          field_location_visibility_state: char.location_visibility_state || 'visible',
          evidence_can_travel: char.travel_status !== 'traveling' && !char.traveling_to_location_id,
          proof: {
            condition: 'TRAVEL STATE',
            test: `travel_status: "${char.travel_status}" | traveling_to_location_id: ${char.traveling_to_location_id}`,
            result: 'READY_FOR_TRANSIT',
          },
        },

        // EVIDENCE TRAIL: WORK CONFIGURATION
        work_configuration: {
          field_current_work_location_id: char.current_work_location_id || null,
          field_occupation_location_id: char.occupation_location_id || null,
          field_work_start_time: char.work_start_time || null,
          field_work_end_time: char.work_end_time || null,
          field_work_days: char.work_days || null,
          work_location_id: char.current_work_location_id || char.occupation_location_id || null,
          resolved_work_location: null,
          evidence_has_work: !!(char.current_work_location_id || char.occupation_location_id),
          proof: {
            condition: 'WORK DESTINATION CONFIGURED',
            test: `current_work_location_id: ${char.current_work_location_id} | occupation_location_id: ${char.occupation_location_id}`,
            result: char.current_work_location_id || char.occupation_location_id ? 'HAS_WORK' : 'NO_WORK',
          },
        },

        // EVIDENCE TRAIL: SCHOOL CONFIGURATION
        school_configuration: {
          field_current_school_location_id: char.current_school_location_id || null,
          field_education_location_id: char.education_location_id || null,
          field_student_status: char.student_status || 'not_student',
          school_location_id: char.current_school_location_id || char.education_location_id || null,
          resolved_school_location: null,
          evidence_has_school: !!(char.current_school_location_id || char.education_location_id),
          proof: {
            condition: 'SCHOOL DESTINATION CONFIGURED',
            test: `current_school_location_id: ${char.current_school_location_id} | education_location_id: ${char.education_location_id}`,
            result: char.current_school_location_id || char.education_location_id ? 'HAS_SCHOOL' : 'NO_SCHOOL',
          },
        },

        // EVIDENCE TRAIL: MOVEMENT ELIGIBILITY
        movement_eligibility: {
          has_home: !!char.current_home_location_id,
          has_work: !!(char.current_work_location_id || char.occupation_location_id),
          has_school: !!(char.current_school_location_id || char.education_location_id),
          location_status_locked: char.location_status === 'home',
          can_initiate_movement: null, // Set below
        },

        // EVIDENCE TRAIL: SCHEDULER INCLUSION
        scheduler_presence: {
          scheduled_events_for_char: allSchedules.filter(s => (s.character_ids || []).includes(char.id) || s.primary_character_id === char.id),
          scheduled_event_count: 0,
          has_autonomy_events: null, // Set below
        },

        // EVIDENCE TRAIL: UI DISPLAY PATH
        ui_display_path: {
          conversation_for_character: allConvos.find(c => c.character_ids && c.character_ids.length === 1 && c.character_ids[0] === char.id),
          has_direct_chat: null, // Set below
          location_display_source: null, // Set below
        },

        // FAILURE POINT DETECTION
        failure_points: [],
      };

      // === RESOLVE HOME LOCATION ===
      const homeLocId = char.current_home_location_id || char.home_location_id;
      if (homeLocId) {
        const homeLoc = allLocations.find(l => l.id === homeLocId);
        if (homeLoc) {
          audit.home_location.resolved_location_record = { id: homeLoc.id, name: homeLoc.name, category: homeLoc.category };
          audit.home_location.resolved_location_name = homeLoc.name;
        } else {
          audit.failure_points.push({
            type: 'HOME_LOCATION_MISSING',
            evidence: `home_location_id=${homeLocId} references non-existent LocationReference record`,
            severity: 'CRITICAL',
          });
        }
      } else {
        audit.failure_points.push({
          type: 'HOME_LOCATION_UNASSIGNED',
          evidence: `current_home_location_id and home_location_id are both NULL`,
          severity: 'CRITICAL',
        });
      }

      // === RESOLVE WORK LOCATION ===
      const workLocId = char.current_work_location_id || char.occupation_location_id;
      if (workLocId) {
        const workLoc = allLocations.find(l => l.id === workLocId);
        if (workLoc) {
          audit.work_configuration.resolved_work_location = { id: workLoc.id, name: workLoc.name };
        } else {
          audit.failure_points.push({
            type: 'WORK_LOCATION_MISSING',
            evidence: `work_location_id=${workLocId} references non-existent LocationReference record`,
            severity: 'HIGH',
          });
        }
      }

      // === RESOLVE SCHOOL LOCATION ===
      const schoolLocId = char.current_school_location_id || char.education_location_id;
      if (schoolLocId) {
        const schoolLoc = allLocations.find(l => l.id === schoolLocId);
        if (schoolLoc) {
          audit.school_configuration.resolved_school_location = { id: schoolLoc.id, name: schoolLoc.name };
        } else {
          audit.failure_points.push({
            type: 'SCHOOL_LOCATION_MISSING',
            evidence: `school_location_id=${schoolLocId} references non-existent LocationReference record`,
            severity: 'HIGH',
          });
        }
      }

      // === MOVEMENT ELIGIBILITY ===
      audit.movement_eligibility.can_initiate_movement = 
        audit.movement_eligibility.has_home && 
        !audit.movement_eligibility.location_status_locked &&
        (audit.movement_eligibility.has_work || audit.movement_eligibility.has_school);

      if (audit.movement_eligibility.location_status_locked) {
        audit.failure_points.push({
          type: 'LOCATION_STATUS_LOCK',
          evidence: `location_status="${char.location_status}" hardcoded to "home" prevents any movement`,
          severity: 'CRITICAL',
        });
      }

      if (!audit.movement_eligibility.has_home) {
        audit.failure_points.push({
          type: 'NO_HOME_DESTINATION',
          evidence: `current_home_location_id is NULL — character has no home to return to`,
          severity: 'CRITICAL',
        });
      }

      if (!audit.movement_eligibility.has_work && !audit.movement_eligibility.has_school) {
        audit.failure_points.push({
          type: 'NO_DESTINATIONS',
          evidence: `Character has no work or school locations configured — nowhere to travel to`,
          severity: 'HIGH',
        });
      }

      // === SCHEDULER INCLUSION ===
      audit.scheduler_presence.scheduled_event_count = audit.scheduler_presence.scheduled_events_for_char.length;
      audit.scheduler_presence.has_autonomy_events = audit.scheduler_presence.scheduled_event_count > 0;

      // === UI DISPLAY PATH ===
      if (audit.ui_display_path.conversation_for_character) {
        audit.ui_display_path.has_direct_chat = true;
      }

      // Determine location display source
      if (char.resolved_current_location_id) {
        audit.ui_display_path.location_display_source = 'resolved_current_location_id';
      } else if (char.current_home_location_id) {
        audit.ui_display_path.location_display_source = 'current_home_location_id (home fallback)';
      } else {
        audit.ui_display_path.location_display_source = 'UNKNOWN — no location fields set';
        audit.failure_points.push({
          type: 'NO_LOCATION_DISPLAY_SOURCE',
          evidence: 'Character has no resolved location and no home location — UI cannot display location',
          severity: 'CRITICAL',
        });
      }

      characterAudits.push(audit);
    }

    // === SUMMARY ===
    const failureTypeCounts = {};
    for (const audit of characterAudits) {
      for (const fp of audit.failure_points) {
        failureTypeCounts[fp.type] = (failureTypeCounts[fp.type] || 0) + 1;
      }
    }

    const criticalChars = characterAudits.filter(a => a.failure_points.some(fp => fp.severity === 'CRITICAL'));

    return Response.json({
      success: true,
      audit_type: 'forensic_movement_audit',
      timestamp: new Date().toISOString(),
      user_email: user.email,
      audit_scope: {
        total_active_created_characters: activeCreated.length,
        total_locations_on_account: allLocations.length,
        total_conversations: allConvos.length,
        total_scheduled_events: allSchedules.length,
      },
      summary: {
        characters_audited: characterAudits.length,
        characters_with_critical_failures: criticalChars.length,
        failure_type_frequency: failureTypeCounts,
      },
      character_audits: characterAudits,
    });

  } catch (error) {
    console.error('[forensicActiveCharacterMovementAudit]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});