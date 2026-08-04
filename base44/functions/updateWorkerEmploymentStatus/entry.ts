/**
 * updateWorkerEmploymentStatus
 *
 * Fire, quit, or rehire a character at a specific location.
 *
 * Actions:
 *   fire     — remove from location roster, set employment_status=fired, clear work schedule
 *   quit     — remove from location roster, set employment_status=quit, clear work schedule
 *   rehire   — add back to location roster, clear employment_status, require new schedule
 *
 * Source of truth:
 *   - Location.worker_character_ids is the roster
 *   - Character.employment_status is the status
 *   - Character.work_days/work_start_time/occupation_location_id is the schedule
 *
 * Ownership: both character and location must belong to caller's owner_email.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, locationId, action } = await req.json();
    if (!characterId || !locationId) return Response.json({ error: 'characterId and locationId required' }, { status: 400 });
    if (!['fire', 'quit', 'rehire'].includes(action)) return Response.json({ error: 'action must be fire, quit, or rehire' }, { status: 400 });

    const nowIso = new Date().toISOString();

    // Load character and location — verify ownership
    const [charList, locList] = await Promise.all([
      base44.entities.Character.filter({ id: characterId, owner_email: user.email }, null, 1),
      base44.entities.LocationReference.filter({ id: locationId }, null, 1),
    ]);

    const character = charList?.[0];
    const location = locList?.[0];

    if (!character) return Response.json({ error: 'Character not found or does not belong to your account', character_id: characterId }, { status: 404 });
    if (!location) return Response.json({ error: 'Location not found', location_id: locationId }, { status: 404 });
    // Location ownership: either owner_email matches or created_by matches (legacy)
    const locationOwned = location.owner_email === user.email || location.created_by === user.email;
    if (!locationOwned) return Response.json({ error: 'Location does not belong to your account' }, { status: 403 });

    const workerIds = [...(location.worker_character_ids || [])];
    const isOnRoster = workerIds.includes(characterId);
    const proof = {
      character_name: character.name,
      location_name: location.name,
      action,
      was_on_roster: isOnRoster,
      previous_employment_status: character.employment_status || null,
      previous_work_days: character.work_days || [],
      previous_work_start: character.work_start_time || null,
      previous_occupation_location_id: character.occupation_location_id || null,
      timestamp: nowIso,
    };

    if (action === 'fire' || action === 'quit') {
      // ── FULL ROSTER + DATA REMOVAL ──────────────────────────────────────────
      // The character no longer works at this location. Every trace of their
      // employment must be removed from BOTH the location record AND the
      // character record. Leaving stale worker_shifts / worker_job_titles /
      // worker_pay_rates keys on the location causes the UI roster merge
      // (worker_character_ids ∪ keys(worker_job_titles) ∪ keys(worker_shifts))
      // to keep showing them as employed.
      const newWorkerIds = workerIds.filter(id => id !== characterId);

      // Helper: strip this character's key from a per-worker map on the location.
      const stripKey = (map) => {
        if (!map || typeof map !== 'object') return undefined;
        if (!(characterId in map)) return undefined; // not present — skip no-op write
        const copy = { ...map };
        delete copy[characterId];
        return copy;
      };

      const locUpdate = { worker_character_ids: newWorkerIds };
      const strippedShifts = stripKey(location.worker_shifts);
      const strippedTitles = stripKey(location.worker_job_titles);
      const strippedRates = stripKey(location.worker_pay_rates);
      const strippedType = stripKey(location.worker_pay_type);
      const strippedManualUniforms = stripKey(location.worker_manual_uniforms);
      if (strippedShifts !== undefined) locUpdate.worker_shifts = strippedShifts;
      if (strippedTitles !== undefined) locUpdate.worker_job_titles = strippedTitles;
      if (strippedRates !== undefined) locUpdate.worker_pay_rates = strippedRates;
      if (strippedType !== undefined) locUpdate.worker_pay_type = strippedType;
      if (strippedManualUniforms !== undefined) locUpdate.worker_manual_uniforms = strippedManualUniforms;

      await base44.entities.LocationReference.update(locationId, locUpdate);

      // ── CHARACTER RECORD: SURGICAL CLEANUP ────────────────────────────────────
      // Clear workplace identifiers ONLY when they reference the terminated
      // employment. Do NOT clear identifiers belonging to the character's
      // current active employment (e.g. a new rabbit-hole job). This is the
      // One Truth safeguard: stale persisted IDs from a former job must
      // never survive a Fired/Quit operation.
      const isPrimaryJob = character.occupation_location_id === locationId;
      const additionalOccs = Array.isArray(character.additional_occupation_locations)
        ? character.additional_occupation_locations
        : [];
      const additionalIdx = additionalOccs.findIndex(e => e?.location_id === locationId);
      const isSecondaryJob = additionalIdx >= 0;

      // Check whether current_work_location_id references the terminated
      // employment. This is independent of isPrimaryJob — the primary
      // occupation may have already been changed to a different job (e.g. a
      // rabbit-hole), but the stale current_work_location_id from the former
      // linked job may still be populated. This is the exact field the
      // Geolocator reads — if it survives termination, the One Truth is
      // violated.
      const currentWorkLocMatchesTerminated = character.current_work_location_id === locationId;

      // Check whether resolved_current_location_id references the terminated
      // employment. Any surface that reads this field directly (Geolocator,
      // Travel, Chat header) will show the stale workplace if it survives.
      const resolvedLocMatchesTerminated = character.resolved_current_location_id === locationId;

      const charUpdate = {
        employment_status: action === 'fire' ? 'fired' : 'quit',
      };

      if (isPrimaryJob) {
        // This was their primary linked job — clear the primary work schedule
        // + location identifiers that belong to THIS employment.
        charUpdate.work_days = [];
        charUpdate.work_start_time = null;
        charUpdate.work_end_time = null;
        charUpdate.occupation_location_id = null;
        charUpdate.occupation_location_name = null;
        charUpdate.work_exception_status = null;
        charUpdate.work_exception_date = null;
        charUpdate.work_exception_reason = null;
        // Clear work_details if it references this location
        if (character.work_details && (
          character.work_details.location_name === location.name ||
          character.work_details.location_id === locationId
        )) {
          charUpdate.work_details = {};
        }
        // If they also have this location as a SECONDARY job, that entry is
        // removed below. If they have OTHER secondary jobs, leave them — only
        // this location's employment is being terminated.
      }

      // ── ONE TRUTH SAFEGUARD: Clear current_work_location_id whenever it
      //    references the terminated employment — even if the primary
      //    occupation was already changed to a different job (e.g. a
      //    rabbit-hole). Stale persisted IDs from a former job must never
      //    survive termination. Do NOT clear it if it references a different
      //    (current active) workplace.
      if (currentWorkLocMatchesTerminated) {
        charUpdate.current_work_location_id = null;
      }

      // Also clear occupation_location_id if it still references this
      // location even though isPrimaryJob was false (edge case: occupation
      // was changed but the old ID was not cleared in a prior update).
      if (!isPrimaryJob && character.occupation_location_id === locationId) {
        charUpdate.occupation_location_id = null;
        charUpdate.occupation_location_name = null;
      }

      // Remove this location from additional_occupation_locations if present
      if (isSecondaryJob) {
        charUpdate.additional_occupation_locations = additionalOccs.filter((_, i) => i !== additionalIdx);
      }

      // ── CANONICAL PRESENCE RECOMPUTATION ──────────────────────────────────────
      // This recomputation happens as part of the existing save flow — it
      // must NOT rely on scheduler execution, polling, page refreshes,
      // reopening the application, delayed repair jobs, or maintenance tasks.
      // The character's current location must be correct immediately after
      // the employment transaction completes.
      //
      // If the character was at work at this location OR if any resolved
      // location field still references the terminated workplace, clear the
      // stale resolved location and redirect to home. The Geolocator and all
      // other surfaces read resolved_current_location_id — if it still points
      // to the terminated workplace, the One Truth is violated even though
      // resolved_presence_status may have been changed.
      const wasAtWorkHere = character.resolved_presence_status === 'at_work'
        && (character.current_work_location_id === locationId
            || character.occupation_location_id === locationId
            || resolvedLocMatchesTerminated);

      if (wasAtWorkHere || resolvedLocMatchesTerminated) {
        const homeLocId = character.current_home_location_id || character.home_location_id || null;
        charUpdate.resolved_current_location_id = homeLocId;
        charUpdate.resolved_current_location_name = null;
        charUpdate.resolved_location_type = 'home';
        if (character.resolved_presence_status === 'at_work') {
          charUpdate.resolved_presence_status = 'home';
        }
        charUpdate.resolved_source_reason = action === 'fire' ? 'fired_from_job' : 'quit_job';
        charUpdate.resolved_last_updated_at = nowIso;
      }

      // Release any work stay-lock tied to this location
      if (character.presence_stay_lock && character.presence_stay_lock_location_id === locationId) {
        charUpdate.presence_stay_lock = false;
        charUpdate.presence_stay_lock_reason = null;
        charUpdate.presence_stay_lock_authority = null;
        charUpdate.presence_stay_lock_location_id = null;
        charUpdate.presence_stay_lock_set_at = null;
        charUpdate.presence_stay_lock_created_by = null;
      }

      await base44.entities.Character.update(characterId, charUpdate);

      proof.action_taken = `${action} applied`;
      proof.removed_from_roster = isOnRoster;
      proof.was_primary_job = isPrimaryJob;
      proof.was_secondary_job = isSecondaryJob;
      proof.work_schedule_cleared = isPrimaryJob;
      proof.current_work_location_cleared = currentWorkLocMatchesTerminated;
      proof.occupation_location_id_cleared = isPrimaryJob || (!isPrimaryJob && character.occupation_location_id === locationId);
      proof.resolved_location_cleared = resolvedLocMatchesTerminated;
      proof.location_maps_cleaned = Object.keys(locUpdate).filter(k => k !== 'worker_character_ids');
      proof.presence_recomputed = wasAtWorkHere || resolvedLocMatchesTerminated;

      // Log LifeEvent
      await base44.asServiceRole.entities.LifeEvent.create({
        character_id: characterId,
        character_name: character.name,
        event_type: 'occupation_change',
        valence: action === 'fire' ? 'negative' : 'mixed',
        severity: 'significant',
        title: action === 'fire' ? `Fired from ${location.name}` : `Quit job at ${location.name}`,
        description: action === 'fire'
          ? `${character.name} was fired from their position at ${location.name}.`
          : `${character.name} quit their job at ${location.name}.`,
        triggered_by: 'user_action',
        timestamp: nowIso,
        context_tags: ['employment', action, location.name],
      }).catch(() => {});

    } else if (action === 'rehire') {
      // Add back to roster (if not already there)
      if (!isOnRoster) {
        workerIds.push(characterId);
        await base44.entities.LocationReference.update(locationId, {
          worker_character_ids: workerIds,
        });
      }

      // Retrieve existing shift data from location for this character
      const existingShift = location.worker_shifts?.[characterId];
      const updateData = {
        employment_status: 'active',
        occupation_location_id: locationId,
        occupation_location_name: location.name,
      };

      // If location has stored shift data for this character, sync it to Character
      if (existingShift?.start && existingShift?.end) {
        updateData.work_start_time = existingShift.start;
        updateData.work_end_time = existingShift.end;
        updateData.work_days = existingShift.days || [];
      }

      await base44.entities.Character.update(characterId, updateData);

      proof.action_taken = 'rehired — added back to roster' + (existingShift?.start ? ' with previous schedule restored.' : '. Schedule must be configured.');
      proof.added_to_roster = !isOnRoster;
      proof.schedule_restored = !!existingShift?.start;
      proof.note = existingShift?.start ? 'Schedule restored from location record' : 'No prior schedule found — assign new schedule';

      await base44.asServiceRole.entities.LifeEvent.create({
        character_id: characterId,
        character_name: character.name,
        event_type: 'occupation_change',
        valence: 'positive',
        severity: 'significant',
        title: `Rehired at ${location.name}`,
        description: `${character.name} was rehired at ${location.name}. A new work schedule must be assigned.`,
        triggered_by: 'user_action',
        timestamp: nowIso,
        context_tags: ['employment', 'rehire', location.name],
      }).catch(() => {});
    }

    return Response.json({ success: true, proof });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});