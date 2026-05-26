import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncLocationJobToCharacter
 *
 * When a worker is added to a location, this directly syncs the job assignment
 * back to the Character entity (occupation_location_id, current_work_location_id,
 * work_start_time, work_end_time, work_days, work_details) AND the LocationReference
 * (worker_character_ids, worker_shifts, worker_pay_rates, worker_job_titles).
 *
 * Also handles education/school location → character education sync.
 *
 * Payload:
 *   locationId: string
 *   characterId: string
 *   syncType: 'work' | 'education' | 'religion'   (default: 'work')
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { locationId, characterId, syncType = 'work' } = await req.json();
    if (!locationId || !characterId) {
      return Response.json({ error: 'locationId and characterId required' }, { status: 400 });
    }

    // Fetch location and character concurrently
    const [locArr, charArr] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ id: locationId }),
      base44.asServiceRole.entities.Character.filter({ id: characterId }),
    ]);
    const loc = locArr[0];
    const char = charArr[0];
    if (!loc || !char) return Response.json({ error: 'Location or character not found' }, { status: 404 });

    let charUpdates = {};
    const appliedSyncs = [];

    // ── WORK SYNC ───────────────────────────────────────────────────────────────
    if (syncType === 'work') {
      const jobTitle = loc.worker_job_titles?.[characterId] || '';
      const payRate = loc.worker_pay_rates?.[characterId] || 0;
      const payType = loc.worker_pay_type?.[characterId] || 'hourly';
      const shift = loc.worker_shifts?.[characterId] || null;

      // Ensure character is in worker_character_ids on the location
      const currentWorkers = loc.worker_character_ids || [];
      if (!currentWorkers.includes(characterId)) {
        await base44.asServiceRole.entities.LocationReference.update(locationId, {
          worker_character_ids: [...currentWorkers, characterId],
        });
      }

      const workDetails = {
        ...(char.work_details || {}),
        job_title: jobTitle || char.work_details?.job_title || '',
        workplace_type: loc.category || 'workplace',
        location_name: loc.name,
      };

      if (!char.occupation_location_id) {
        // Set as primary occupation — direct write, no approval gate
        charUpdates = {
          occupation_location_id: locationId,
          occupation_location_name: loc.name,
          current_work_location_id: locationId,
          work_details: workDetails,
        };
        if (shift?.start) charUpdates.work_start_time = shift.start;
        if (shift?.end) charUpdates.work_end_time = shift.end;
        if (shift?.days?.length > 0) charUpdates.work_days = shift.days;
        appliedSyncs.push('primary_occupation_set');
      } else if (char.occupation_location_id === locationId) {
        // Same location — refresh schedule fields and job title
        charUpdates = {
          current_work_location_id: locationId,
          work_details: workDetails,
        };
        if (shift?.start) charUpdates.work_start_time = shift.start;
        if (shift?.end) charUpdates.work_end_time = shift.end;
        if (shift?.days?.length > 0) charUpdates.work_days = shift.days;
        appliedSyncs.push('primary_occupation_refreshed');
      } else {
        // Already has a different primary job — add as additional occupation (direct write)
        const existing = char.additional_occupation_locations || [];
        const alreadyLinked = existing.some(e => e.location_id === locationId);
        if (!alreadyLinked) {
          charUpdates.additional_occupation_locations = [
            ...existing,
            {
              location_id: locationId,
              location_name: loc.name,
              job_title: jobTitle,
              shift_start: shift?.start || null,
              shift_end: shift?.end || null,
              work_days: shift?.days || [],
            },
          ];
          appliedSyncs.push('additional_occupation_added');
        } else {
          // Update the existing additional entry
          charUpdates.additional_occupation_locations = existing.map(e =>
            e.location_id === locationId
              ? { ...e, job_title: jobTitle, shift_start: shift?.start || e.shift_start, shift_end: shift?.end || e.shift_end, work_days: shift?.days || e.work_days || [] }
              : e
          );
          appliedSyncs.push('additional_occupation_updated');
        }
      }

      // Sync CharacterFinancial income sources
      try {
        const finArr = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: characterId });
        if (finArr.length > 0) {
          const fin = finArr[0];
          const existingSources = fin.income_sources || [];
          const existingIdx = existingSources.findIndex(s => s.location_id === locationId);
          const newSource = {
            location_id: locationId,
            location_name: loc.name,
            pay_type: payType,
            pay_amount: payRate,
            total_earned: existingSources[existingIdx]?.total_earned || 0,
          };
          const newSources = existingIdx >= 0
            ? existingSources.map((s, i) => i === existingIdx ? newSource : s)
            : [...existingSources, newSource];
          await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, {
            income_sources: newSources,
            work_location_id: char.occupation_location_id === locationId ? locationId : fin.work_location_id,
            work_location_ids: [...new Set([...(fin.work_location_ids || []), locationId])],
            work_location_names: [...new Set([...(fin.work_location_names || []), loc.name])],
          });
        }
      } catch (e) {
        console.warn('[syncLocationJobToCharacter] Financial sync failed (non-fatal):', e.message);
      }
    }

    // ── EDUCATION SYNC ──────────────────────────────────────────────────────────
    if (syncType === 'education') {
      const alreadyEnrolled =
        char.education_location_id === locationId ||
        (char.additional_education_locations || []).some(e => e.location_id === locationId);

      if (!alreadyEnrolled) {
        if (!char.education_location_id) {
          charUpdates = {
            education_location_id: locationId,
            education_location_name: loc.name,
            current_school_location_id: locationId,
            student_status: 'enrolled',
            current_education_activity: loc.name,
            education_details: { ...(char.education_details || {}), institution: loc.name },
          };
        } else {
          charUpdates.additional_education_locations = [
            ...(char.additional_education_locations || []),
            { location_id: locationId, location_name: loc.name, program_name: loc.name },
          ];
        }
        appliedSyncs.push('education_synced');
      }
    }

    // ── RELIGION SYNC ───────────────────────────────────────────────────────────
    if (syncType === 'religion') {
      if (!char.religious_location_id) {
        charUpdates = {
          religious_location_id: locationId,
          religious_location_name: loc.name,
        };
        appliedSyncs.push('religion_synced');
      }
    }

    // Apply character updates
    if (Object.keys(charUpdates).length > 0) {
      await base44.asServiceRole.entities.Character.update(characterId, charUpdates);
    }

    return Response.json({
      success: true,
      updatesApplied: appliedSyncs,
      charUpdates: Object.keys(charUpdates),
      message: `Synced ${syncType} from ${loc.name} to ${char.name}`,
    });
  } catch (error) {
    console.error('[syncLocationJobToCharacter]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});