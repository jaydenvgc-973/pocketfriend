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
          const newWorkers = (oldLoc.worker_character_ids || []).filter(id => id !== characterId);
          await base44.asServiceRole.entities.LocationReference.update(removeLocationId, {
            worker_character_ids: newWorkers,
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
      // Add as a "student/attendee" worker entry — we reuse worker_character_ids with title = program name
      const existingWorkers = location.worker_character_ids || [];
      const alreadyWorker = existingWorkers.includes(characterId);

      const updatedWorkers = alreadyWorker ? existingWorkers : [...existingWorkers, characterId];
      const updatedTitles = { ...(location.worker_job_titles || {}) };
      if (title) updatedTitles[characterId] = `Student: ${title}`;
      else updatedTitles[characterId] = 'Student';

      await base44.asServiceRole.entities.LocationReference.update(locationId, {
        worker_character_ids: updatedWorkers,
        worker_job_titles: updatedTitles,
      });
    }

    return Response.json({ success: true, locationId, locationName: location.name });
  } catch (error) {
    console.error('[linkOccupationToLocation]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});