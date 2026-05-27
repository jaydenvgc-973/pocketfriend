/**
 * checkLifecycleEvents
 *
 * User-scoped lifecycle checker. Runs on homepage load.
 * 
 * EDUCATION COMPLETION:
 *   - Finds active enrollments whose end_date has passed
 *   - Moves enrollment to completed_education, marks graduated
 *   - Updates LocationReference.enrolled_students to 'graduated'
 *   - Removes campus residency if applicable
 *   - Idempotency: lifecycle_processed_at on the enrollment entry (character_id + location_id + end_date unique)
 *   - Returns graduations[] for the frontend GraduationEventModal
 *   - Does NOT create UserAchievement (those IDs are not in the registry — modal handles display directly)
 *
 * INCARCERATION RELEASE:
 *   - Finds characters whose sentence end date has passed AND who are still jailed
 *   - AUTO-RELEASES them immediately (sentence complete = character is free)
 *   - Records a lifecycle_processed_at keyed on the sentence end date ISO string
 *   - Returns releases[] so the frontend can show a "Released" notification popup
 *   - Idempotency key: Character.jail_lifecycle_key = `${character_id}::${releaseDateISO}` stored on character
 *   - Does NOT write last_release_popup_at before the popup fires (was causing suppress-before-show bug)
 *
 * Owner-email scoped only. Never uses created_by.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const nowISO = now.toISOString();

    // Load all active characters for this user (owner_email scoped)
    const characters = await base44.entities.Character.filter(
      { owner_email: user.email, status: 'active' },
      null,
      200
    );

    const graduationsProcessed = [];
    const autoReleasedCharacters = [];

    for (const character of characters) {
      // ── 1. EDUCATION COMPLETION ────────────────────────────────────────────
      const enrollments = character.education_enrollments || [];
      let enrollmentsChanged = false;
      const updatedEnrollments = [...enrollments];
      const newCompleted = [...(character.completed_education || [])];

      for (let i = 0; i < updatedEnrollments.length; i++) {
        const enr = updatedEnrollments[i];
        if (enr.status !== 'active' && enr.status !== 'enrolled') continue;

        const endDateStr = enr.end_date || enr.completion_date || null;
        if (!endDateStr) continue;
        if (now < new Date(endDateStr)) continue; // not yet complete

        // Idempotency: keyed on end_date ISO string stored inside the enrollment
        if (enr.lifecycle_processed_at) continue;

        updatedEnrollments[i] = {
          ...enr,
          status: 'graduated',
          lifecycle_processed_at: nowISO,
          actual_completion_date: nowISO,
        };
        enrollmentsChanged = true;

        newCompleted.push({
          ...enr,
          status: 'graduated',
          completion_date: endDateStr,
          actual_completion_date: nowISO,
          lifecycle_processed_at: nowISO,
        });

        const locationId = enr.location_id || enr.institution_location_id || null;
        const programName = enr.course_name || enr.program_name || enr.institution || 'School';
        const completionType = enr.enrollment_type === 'full_school' ? 'diploma'
          : enr.enrollment_type === 'certification' ? 'certificate'
          : enr.enrollment_type === 'course' ? 'course_completion'
          : 'training_completion';

        // Update location enrolled_students to 'graduated' and clear campus residency
        if (locationId) {
          try {
            const locs = await base44.entities.LocationReference.filter({ id: locationId });
            if (locs[0]) {
              const loc = locs[0];
              const updatedStudents = (loc.enrolled_students || []).map(s =>
                s.character_id === character.id ? { ...s, status: 'graduated' } : s
              );
              let updatedResidents = loc.residents || [];
              let campusResidencyRemoved = false;
              if (character.current_home_location_id === locationId) {
                updatedResidents = updatedResidents.filter(r => r.character_id !== character.id);
                campusResidencyRemoved = true;
              }
              await base44.entities.LocationReference.update(locationId, {
                enrolled_students: updatedStudents,
                residents: updatedResidents,
              });
              if (campusResidencyRemoved) {
                await base44.entities.Character.update(character.id, {
                  current_home_location_id: null,
                  current_school_location_id: null,
                });
              }
            }
          } catch (locErr) {
            console.warn(`[checkLifecycleEvents] Failed to update location ${locationId}:`, locErr.message);
          }
        }

        graduationsProcessed.push({
          character_id: character.id,
          character_name: character.name,
          avatar_url: character.avatar_url || null,
          program: programName,
          completion_type: completionType,
          end_date: endDateStr,
        });
      }

      if (enrollmentsChanged) {
        const stillEnrolled = updatedEnrollments.some(e => e.status === 'active' || e.status === 'enrolled');
        await base44.entities.Character.update(character.id, {
          education_enrollments: updatedEnrollments,
          completed_education: newCompleted,
          student_status: stillEnrolled ? 'enrolled' : 'graduated',
          current_school_location_id: stillEnrolled ? character.current_school_location_id : null,
        });
      }

      // ── 2. INCARCERATION AUTO-RELEASE ──────────────────────────────────────
      if (!character.is_jailed) continue;

      let releaseDateMs = null;
      if (character.jail_release_date) {
        releaseDateMs = new Date(character.jail_release_date).getTime();
      } else if (character.jailed_at && character.jail_sentence_days) {
        releaseDateMs = new Date(character.jailed_at).getTime() + (character.jail_sentence_days * 24 * 60 * 60 * 1000);
      }
      if (releaseDateMs === null) continue;
      if (now.getTime() < releaseDateMs) continue; // sentence not yet complete

      const releaseDateISO = new Date(releaseDateMs).toISOString();

      // Idempotency: sentence-specific key stored on the character.
      // This key is set AFTER release is processed, so it does NOT block the popup
      // from appearing before the release happens.
      const sentenceKey = `${character.id}::${releaseDateISO}`;
      if (character.jail_lifecycle_key === sentenceKey) continue; // already processed this sentence

      // AUTO-RELEASE the character — sentence complete means they're free
      const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const releasePayload = {
        is_jailed: false,
        incarceration_status: 'released',
        jail_release_date: releaseDateISO,
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'sentence_complete_auto_release',
        resolved_last_updated_at: nowISO,
        jail_lifecycle_key: sentenceKey, // mark this sentence as processed
        incarceration_facility_id: null,
      };

      if (character.current_home_location_id) {
        releasePayload.resolved_current_location_id = character.current_home_location_id;
        releasePayload.resolved_current_location_name = character.resolved_current_location_name || null;
      }

      try {
        await base44.entities.Character.update(character.id, releasePayload);

        // Log a LifeEvent
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: character.id,
          character_name: character.name,
          event_type: 'major_life_event',
          valence: 'mixed',
          severity: 'major',
          title: 'Released from incarceration',
          description: `${character.name} completed their sentence (${character.jail_sentence_days || '?'} days) and was automatically released.`,
          emotional_impact: 'Relief mixed with uncertainty about what comes next',
          triggered_by: 'system_auto_release',
          timestamp: nowISO,
          context_tags: ['jail', 'release', 'auto_release'],
        }).catch(() => {});

        autoReleasedCharacters.push({
          character_id: character.id,
          character_name: character.name,
          avatar_url: character.avatar_url || null,
          facility_name: character.incarceration_facility_name || 'Detention Facility',
          charges: character.pending_charges || [],
          jailed_at: character.jailed_at || null,
          jail_release_date: releaseDateISO,
          sentence_days: character.jail_sentence_days || null,
          overdue_hours: Math.round((now.getTime() - releaseDateMs) / 3600000),
        });
      } catch (releaseErr) {
        console.warn(`[checkLifecycleEvents] Failed to release ${character.name}:`, releaseErr.message);
      }
    }

    return Response.json({
      success: true,
      owner_email: user.email,
      checked_at: nowISO,
      graduations_processed: graduationsProcessed.length,
      auto_released: autoReleasedCharacters.length,
      // Frontend reads graduations[] to show GraduationEventModal
      graduations: graduationsProcessed,
      // Frontend reads releases[] to show "Released" notification (character already free)
      releases: autoReleasedCharacters,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});