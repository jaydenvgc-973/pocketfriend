import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncEmploymentAssignments
 *
 * Non-destructive, owner_email-scoped backfill that reconciles the employment
 * data split between Location and Character entities.
 *
 * The problem: characters may appear in a location's worker_job_titles / worker_shifts /
 * worker_pay_rates dictionaries (the canonical source for the arrow dropdown) but NOT in
 * worker_character_ids, AND their Character.occupation_location_id may be unset.
 * This causes the edit panel and character profile to show "No work locations linked yet"
 * even though the location clearly lists them as staff.
 *
 * This function:
 *   1. Scans all non-home locations owned by the caller.
 *   2. Finds every characterId that appears as a key in worker_job_titles / worker_shifts /
 *      worker_pay_rates but is NOT in worker_character_ids.
 *   3. Adds them to worker_character_ids (location-side repair).
 *   4. If the character has no occupation_location_id set, calls syncLocationJobToCharacter
 *      to write it back (character-side repair).
 *   5. Never overwrites existing correct data. Never deletes anything.
 *
 * Payload: {} (no params — always scoped to the caller's owner_email)
 */

const WORK_CATEGORIES = new Set([
  'workplace', 'business', 'food_drink', 'gym', 'social', 'education',
  'medical', 'school', 'grocery', 'religion', 'government', 'community', 'jail_prison',
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    // Load all relevant locations for this user
    const allLocations = await base44.entities.LocationReference.filter({ owner_email: ownerEmail }).catch(() => []);
    const workLocations = allLocations.filter(l => WORK_CATEGORIES.has(l.category));

    // Load all characters for this user (needed for occupation_location_id check)
    const allChars = await base44.entities.Character.filter({ owner_email: ownerEmail, status: 'active' }).catch(() => []);
    const charMap = {};
    allChars.forEach(c => { charMap[c.id] = c; });

    const locationRepairs = [];
    const characterRepairs = [];
    const errors = [];

    for (const loc of workLocations) {
      // Collect all characterIds that have employment metadata on this location
      const employedIds = new Set([
        ...Object.keys(loc.worker_job_titles || {}),
        ...Object.keys(loc.worker_shifts || {}),
        ...Object.keys(loc.worker_pay_rates || {}),
        ...(loc.worker_character_ids || []),
      ]);

      if (employedIds.size === 0) continue;

      // Check which IDs are missing from worker_character_ids
      const currentWorkerIds = new Set(loc.worker_character_ids || []);
      const missingFromArray = [...employedIds].filter(id => !currentWorkerIds.has(id));

      // LOCATION-SIDE REPAIR: add missing IDs to worker_character_ids
      if (missingFromArray.length > 0) {
        const newWorkerIds = [...currentWorkerIds, ...missingFromArray];
        await base44.entities.LocationReference.update(loc.id, {
          worker_character_ids: newWorkerIds,
        }).catch(err => {
          errors.push({ locationId: loc.id, locationName: loc.name, error: err.message });
        });
        locationRepairs.push({
          locationId: loc.id,
          locationName: loc.name,
          addedIds: missingFromArray,
        });
      }

      // CHARACTER-SIDE REPAIR: for each employed character who has no occupation_location_id,
      // sync this location back to the character entity.
      for (const charId of employedIds) {
        const char = charMap[charId];
        if (!char) continue; // character not found or not owned by this user — skip safely

        const hasOccupation = !!char.occupation_location_id;
        const hasThisAsAdditional = (char.additional_occupation_locations || []).some(l => l.location_id === loc.id);

        if (!hasOccupation && !hasThisAsAdditional) {
          // Character has no employment link at all — sync this location as primary
          await base44.functions.invoke('syncLocationJobToCharacter', {
            locationId: loc.id,
            characterId: charId,
            syncType: 'work',
          }).catch(err => {
            errors.push({ charId, locationId: loc.id, error: err.message });
          });
          // Update local charMap so subsequent locations don't re-trigger for same char
          charMap[charId] = { ...char, occupation_location_id: loc.id };
          characterRepairs.push({
            characterId: charId,
            characterName: char.name,
            linkedLocation: loc.name,
            locationId: loc.id,
          });
        } else if (hasOccupation && char.occupation_location_id !== loc.id && !hasThisAsAdditional) {
          // Character has a different primary job — sync this as additional
          await base44.functions.invoke('syncLocationJobToCharacter', {
            locationId: loc.id,
            characterId: charId,
            syncType: 'work',
          }).catch(err => {
            errors.push({ charId, locationId: loc.id, error: err.message });
          });
          characterRepairs.push({
            characterId: charId,
            characterName: char.name,
            linkedLocation: loc.name,
            locationId: loc.id,
            note: 'added_as_additional',
          });
        }
      }
    }

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      locations_scanned: workLocations.length,
      location_repairs: locationRepairs.length,
      character_repairs: characterRepairs.length,
      errors: errors.length,
      details: {
        locationRepairs,
        characterRepairs,
        errors,
      },
    });

  } catch (error) {
    console.error('[syncEmploymentAssignments]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});