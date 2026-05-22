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
      // Remove from location roster
      const newWorkerIds = workerIds.filter(id => id !== characterId);
      await base44.entities.LocationReference.update(locationId, {
        worker_character_ids: newWorkerIds,
      });

      // Clear character work schedule + set employment status
      await base44.entities.Character.update(characterId, {
        employment_status: action === 'fire' ? 'fired' : 'quit',
        work_days: [],
        work_start_time: null,
        work_end_time: null,
        occupation_location_id: null,
        occupation_location_name: null,
        // If currently at work, move them home
        ...(character.resolved_presence_status === 'at_work' ? {
          resolved_presence_status: 'home',
          resolved_source_reason: action === 'fire' ? 'fired_from_job' : 'quit_job',
          resolved_last_updated_at: nowIso,
        } : {}),
      });

      proof.action_taken = `${action} applied`;
      proof.removed_from_roster = isOnRoster;
      proof.work_schedule_cleared = true;
      proof.presence_updated = character.resolved_presence_status === 'at_work';

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

      // Clear fired/quit status — schedule must be re-assigned by user
      await base44.entities.Character.update(characterId, {
        employment_status: 'active',
        occupation_location_id: locationId,
        occupation_location_name: location.name,
        // Note: work_days/work_start_time/work_end_time intentionally NOT set
        // User must assign new schedule separately
      });

      proof.action_taken = 'rehired — added back to roster. Schedule must be re-assigned.';
      proof.added_to_roster = !isOnRoster;
      proof.schedule_cleared = false;
      proof.note = 'work_days, work_start_time, work_end_time not set — assign schedule separately';

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