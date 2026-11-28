import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * linkOccupationToLocation
 * 
 * Links a character to a location as an employee/worker or student/attendee.
 * Called from Create Character, Character Profile, or Settings.
 * Supports multiple jobs (additive, does not overwrite existing).
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      characterId,
      locationId,
      linkType,        // 'occupation' | 'education'
      title,           // job title or program/course name
      payType,         // 'hourly' | 'annual' (optional, for occupation)
      payRate,         // number (optional)
      removeLocationId, // if set, remove character from this location before adding to new one
    } = await req.json();

    if (!characterId || !locationId || !linkType) {
      return Response.json({ error: 'characterId, locationId, and linkType required' }, { status: 400 });
    }

    const [charArr, locationArr] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ id: characterId }),
      base44.asServiceRole.entities.LocationReference.filter({ id: locationId }),
    ]);

    const character = charArr[0];
    const location = locationArr[0];

    if (!character || !location) {
      return Response.json({ error: 'Character or location not found' }, { status: 404 });
    }

    // ── Handle removal from old location if switching ─────────────────────
    if (removeLocationId && removeLocationId !== locationId) {
      const oldLocArr = await base44.asServiceRole.entities.LocationReference.filter({ id: removeLocationId });
      const oldLoc = oldLocArr[0];
      if (oldLoc) {
        if (linkType === 'occupation') {
          const newWorkers = (oldLoc.worker_character_ids || []).filter(id => id !== characterId);
          const newRates = { ...(oldLoc.worker_pay_rates || {}) };
          const newTypes = { ...(oldLoc.worker_pay_type || {}) };
          const newTitles = { ...(oldLoc.worker_job_titles || {}) };
          delete newRates[characterId];
          delete newTypes[characterId];
          delete newTitles[characterId];
          await base44.asServiceRole.entities.LocationReference.update(removeLocationId, {
            worker_character_ids: newWorkers,
            worker_pay_rates: newRates,
            worker_pay_type: newTypes,
            worker_job_titles: newTitles,
          });
        } else if (linkType === 'education') {
          // Leaving a school removes the enrollment — never a worker entry, because
          // enrollment was never a job in the first place.
          const isStudentTitle = (t: unknown) => /^student\b/i.test(String(t || '').trim());
          const newWorkers = (oldLoc.worker_character_ids || []).filter(
            (id: string) => id !== characterId || !isStudentTitle(oldLoc.worker_job_titles?.[id])
          );
          const newTitles = { ...(oldLoc.worker_job_titles || {}) };
          if (isStudentTitle(oldLoc.worker_job_titles?.[characterId])) delete newTitles[characterId];
          await base44.asServiceRole.entities.LocationReference.update(removeLocationId, {
            worker_character_ids: newWorkers,
            worker_job_titles: newTitles,
            enrolled_students: (oldLoc.enrolled_students || []).filter((s: any) => s?.character_id !== characterId),
          });
        }
      }
    }

    // ── Add character to location ──────────────────────────────────────────
    if (linkType === 'occupation') {
      const existingWorkers = location.worker_character_ids || [];
      const alreadyWorker = existingWorkers.includes(characterId);

      const updatedWorkers = alreadyWorker ? existingWorkers : [...existingWorkers, characterId];
      const updatedRates = { ...(location.worker_pay_rates || {}) };
      const updatedTypes = { ...(location.worker_pay_type || {}) };
      const updatedTitles = { ...(location.worker_job_titles || {}) };

      if (payRate) updatedRates[characterId] = payRate;
      if (payType) updatedTypes[characterId] = payType;
      if (title) updatedTitles[characterId] = title;

      await base44.asServiceRole.entities.LocationReference.update(locationId, {
        worker_character_ids: updatedWorkers,
        worker_pay_rates: updatedRates,
        worker_pay_type: updatedTypes,
        worker_job_titles: updatedTitles,
      });

      // Also update the CharacterFinancial record to include this work location
      const existingFinancials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: characterId });
      if (existingFinancials.length > 0) {
        const fin = existingFinancials[0];
        const existingWorkLocIds = fin.work_location_ids || [];
        const existingWorkLocNames = fin.work_location_names || [];
        if (!existingWorkLocIds.includes(locationId)) {
          await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, {
            work_location_ids: [...existingWorkLocIds, locationId],
            work_location_names: [...existingWorkLocNames, location.name],
          });
        }
      }

    } else if (linkType === 'education') {
      // ENROLLMENT IS NOT EMPLOYMENT. A student belongs in the school's enrolled_students
      // (and the character's own education fields) — never in the worker roster, where a
      // "Student" title turns enrollment into a job with hours.
      const isStudentTitle = (t: unknown) => /^student\b/i.test(String(t || '').trim());

      const updatedWorkers = (location.worker_character_ids || []).filter(
        (id: string) => id !== characterId || !isStudentTitle(location.worker_job_titles?.[id])
      );
      const updatedTitles = { ...(location.worker_job_titles || {}) };
      const updatedRates = { ...(location.worker_pay_rates || {}) };
      const updatedTypes = { ...(location.worker_pay_type || {}) };
      const updatedShifts = { ...(location.worker_shifts || {}) };
      // A real employee who also studies here keeps their job entry untouched.
      if (isStudentTitle(location.worker_job_titles?.[characterId])) {
        delete updatedTitles[characterId];
        delete updatedRates[characterId];
        delete updatedTypes[characterId];
        delete updatedShifts[characterId];
      }

      const enrolled = Array.isArray(location.enrolled_students) ? location.enrolled_students : [];
      const alreadyEnrolled = enrolled.some(
        (s: any) => s?.character_id === characterId && s?.status !== 'dropped' && s?.status !== 'graduated'
      );
      const updatedEnrolled = alreadyEnrolled
        ? enrolled
        : [...enrolled, {
            character_id: characterId,
            character_name: character.name,
            tuition_amount: 0,
            scholarship_enabled: false,
            enroll_date: new Date().toISOString(),
            status: 'active',
            ...(title ? { course_name: title } : {}),
          }];

      await base44.asServiceRole.entities.LocationReference.update(locationId, {
        worker_character_ids: updatedWorkers,
        worker_job_titles: updatedTitles,
        worker_pay_rates: updatedRates,
        worker_pay_type: updatedTypes,
        worker_shifts: updatedShifts,
        enrolled_students: updatedEnrolled,
      });
    }

    return Response.json({ success: true, locationId, locationName: location.name });
  } catch (error) {
    console.error('[linkOccupationToLocation]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});