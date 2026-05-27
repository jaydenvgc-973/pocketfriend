/**
 * checkLifecycleEvents
 *
 * User-scoped lifecycle checker. Runs on homepage load (session-gated).
 * Checks:
 *   1. Education / graduation / certification completion — end_date passed
 *   2. Incarceration sentence completion — jail_release_date passed
 *
 * Idempotency:
 *   - Education: checks Character.education_enrollments[].lifecycle_processed_at
 *     A completed entry is only processed once (keyed on character_id + location_id + end_date).
 *   - Incarceration: checks Character.last_release_popup_at vs jail_release_date.
 *     A release popup is shown once per jail sentence end date.
 *
 * On graduation/completion:
 *   - Moves the enrollment record to character.completed_education
 *   - Updates location.enrolled_students to 'graduated'
 *   - Removes campus residency if applicable
 *   - Creates a UserAchievement (reuses existing popup infrastructure)
 *   - Marks the enrollment as lifecycle_processed
 *
 * On incarceration release:
 *   - Does NOT auto-release — that is the user's decision (popup with extend option)
 *   - Returns overdue_releases[] for the frontend to display the release popup
 *   - Frontend dispatches the actual release or extension
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
    const todayStr = now.toISOString().slice(0, 10);

    // Load all active characters for this user (owner_email scoped)
    const characters = await base44.entities.Character.filter(
      { owner_email: user.email, status: 'active' },
      null,
      200
    );

    const graduationsProcessed = [];
    const overdueReleases = [];

    for (const character of characters) {
      // ── 1. EDUCATION COMPLETION ────────────────────────────────────────────
      const enrollments = character.education_enrollments || [];
      let enrollmentsChanged = false;
      const updatedEnrollments = [...enrollments];
      const newCompleted = [...(character.completed_education || [])];

      for (let i = 0; i < updatedEnrollments.length; i++) {
        const enr = updatedEnrollments[i];
        if (enr.status !== 'active' && enr.status !== 'enrolled') continue;

        // Determine end date — use end_date or completion_date
        const endDateStr = enr.end_date || enr.completion_date || null;
        if (!endDateStr) continue;

        const endDate = new Date(endDateStr);
        if (now < endDate) continue; // not yet complete

        // Idempotency: skip if already lifecycle-processed
        if (enr.lifecycle_processed_at) continue;

        // Mark as completed in the enrollments array
        updatedEnrollments[i] = {
          ...enr,
          status: 'graduated',
          lifecycle_processed_at: nowISO,
          actual_completion_date: nowISO,
        };
        enrollmentsChanged = true;

        // Archive to completed_education
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

        // Update location enrolled_students to 'graduated'
        if (locationId) {
          try {
            const locs = await base44.entities.LocationReference.filter({ id: locationId });
            if (locs[0]) {
              const loc = locs[0];
              // Update enrolled_students status
              const updatedStudents = (loc.enrolled_students || []).map(s =>
                s.character_id === character.id ? { ...s, status: 'graduated' } : s
              );
              // Remove campus residency if character lives at this school
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
              // Clear campus home if applicable
              if (campusResidencyRemoved) {
                await base44.entities.Character.update(character.id, {
                  current_home_location_id: null,
                });
              }
            }
          } catch (locErr) {
            // Non-fatal: location update failure doesn't block popup
            console.warn(`[checkLifecycleEvents] Failed to update location ${locationId}:`, locErr.message);
          }
        }

        // Create a UserAchievement to trigger the existing AchievementUnlockModal
        // We use a synthetic achievement_id scoped to this lifecycle event so it's unique
        const achievementId = `graduation_${character.id}_${endDateStr.slice(0, 10)}`;
        try {
          // Only create if not already created (prevents duplicates on rapid re-runs)
          const existing = await base44.entities.UserAchievement.filter({
            owner_email: user.email,
            achievement_id: achievementId,
          });
          if (existing.length === 0) {
            await base44.entities.UserAchievement.create({
              owner_email: user.email,
              achievement_id: achievementId,
              character_id: character.id,
              character_name: character.name,
              unlocked_at: nowISO,
              tier: 'gold',
              is_seen: false,
              // Extra metadata for the graduation popup (read by LifecycleEventModal)
              event_type: 'graduation',
              event_details: {
                program_name: programName,
                completion_type: completionType,
                location_id: locationId,
                completion_date: endDateStr,
              },
            });
          }
        } catch (achErr) {
          console.warn('[checkLifecycleEvents] Failed to create achievement:', achErr.message);
        }

        graduationsProcessed.push({
          character_id: character.id,
          character_name: character.name,
          program: programName,
          completion_type: completionType,
          end_date: endDateStr,
        });
      }

      // Write updated enrollments back to character
      if (enrollmentsChanged) {
        const studentStatusUpdate = updatedEnrollments.some(e => e.status === 'active' || e.status === 'enrolled')
          ? 'enrolled' : 'graduated';
        await base44.entities.Character.update(character.id, {
          education_enrollments: updatedEnrollments,
          completed_education: newCompleted,
          student_status: studentStatusUpdate,
        });
      }

      // ── 2. INCARCERATION RELEASE CHECK ────────────────────────────────────
      if (!character.is_jailed) continue;

      // Determine release date
      let releaseDateMs = null;
      if (character.jail_release_date) {
        releaseDateMs = new Date(character.jail_release_date).getTime();
      } else if (character.jailed_at && character.jail_sentence_days) {
        releaseDateMs = new Date(character.jailed_at).getTime() + (character.jail_sentence_days * 24 * 60 * 60 * 1000);
      }
      if (releaseDateMs === null) continue;

      const releaseDate = new Date(releaseDateMs);
      if (now < releaseDate) continue; // sentence not yet complete

      // Idempotency: only show popup once per this specific release date
      const releaseDateKey = releaseDate.toISOString().slice(0, 10);
      if (character.last_release_popup_at) {
        const lastPopupDate = character.last_release_popup_at.slice(0, 10);
        if (lastPopupDate === releaseDateKey) continue; // already shown for this sentence end date
      }

      overdueReleases.push({
        character_id: character.id,
        character_name: character.name,
        avatar_url: character.avatar_url || null,
        facility_id: character.incarceration_facility_id || null,
        facility_name: character.incarceration_facility_name || 'Detention Facility',
        charges: character.pending_charges || [],
        jailed_at: character.jailed_at || null,
        jail_release_date: releaseDate.toISOString(),
        sentence_days: character.jail_sentence_days || null,
        overdue_hours: Math.round((now.getTime() - releaseDateMs) / 3600000),
        release_date_key: releaseDateKey,
      });

      // Mark popup as shown so next session doesn't re-show it
      await base44.entities.Character.update(character.id, {
        last_release_popup_at: nowISO,
      });
    }

    return Response.json({
      success: true,
      owner_email: user.email,
      checked_at: nowISO,
      graduations_processed: graduationsProcessed.length,
      overdue_releases: overdueReleases.length,
      graduations: graduationsProcessed,
      // Frontend reads this to show release popups
      releases: overdueReleases,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});