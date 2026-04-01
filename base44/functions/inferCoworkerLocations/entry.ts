import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * inferCoworkerLocations
 * 
 * When an active character has a workplace location linked AND has named coworkers
 * in their fictional_relationships or work_details.coworker_names, this function
 * infers those coworkers should also be at that workplace and updates the location's
 * worker list accordingly.
 * 
 * Confidence rules:
 * - Single job: high confidence → apply automatically
 * - Multiple jobs: low confidence → return suggestions for user approval
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, autoApply = false } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Fetch the character
    const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    const character = charArr[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    // Determine all linked workplace location IDs
    const workLocIds = [];
    if (character.occupation_location_id) workLocIds.push(character.occupation_location_id);
    (character.additional_occupation_locations || []).forEach(loc => {
      if (loc.location_id) workLocIds.push(loc.location_id);
    });

    if (workLocIds.length === 0) {
      return Response.json({ success: true, message: 'No workplace location linked', inferences: [] });
    }

    const hasSingleJob = workLocIds.length === 1;
    const primaryLocationId = workLocIds[0];

    // Collect named coworkers from work_details and fictional_relationships
    const coworkerNames = new Set();
    (character.work_details?.coworker_names || []).forEach(n => coworkerNames.add(n.trim().toLowerCase()));
    (character.fictional_relationships || []).forEach(rel => {
      const relType = (rel.relationship_type || '').toLowerCase();
      if (['coworker', 'colleague', 'work friend', 'boss', 'employee', 'manager', 'supervisor', 'intern'].includes(relType)) {
        if (rel.person_name) coworkerNames.add(rel.person_name.trim().toLowerCase());
      }
    });

    if (coworkerNames.size === 0) {
      return Response.json({ success: true, message: 'No named coworkers found', inferences: [] });
    }

    // Fetch the primary location to check existing workers
    const locArr = await base44.asServiceRole.entities.LocationReference.filter({ id: primaryLocationId });
    const location = locArr[0];
    if (!location) return Response.json({ error: 'Location not found' }, { status: 404 });

    const existingWorkerIds = new Set(location.worker_character_ids || []);

    // Find active characters that match coworker names
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    const inferences = [];
    for (const char of allChars) {
      if (char.id === characterId) continue;
      if (existingWorkerIds.has(char.id)) continue; // already there
      const nameLower = (char.name || '').toLowerCase();
      const isCoworker = [...coworkerNames].some(cname =>
        nameLower === cname ||
        nameLower.startsWith(cname.split(' ')[0]) ||
        cname.startsWith(nameLower.split(' ')[0])
      );
      if (isCoworker) {
        inferences.push({
          characterId: char.id,
          characterName: char.name,
          locationId: primaryLocationId,
          locationName: location.name,
          confidence: hasSingleJob ? 'high' : 'medium',
          reason: `${char.name} is listed as a coworker of ${character.name} who works at ${location.name}`,
        });
      }
    }

    // If autoApply and single job → apply inferences automatically
    if (autoApply && hasSingleJob && inferences.length > 0) {
      const newWorkerIds = [...(location.worker_character_ids || [])];
      const newWorkerTitles = { ...(location.worker_job_titles || {}) };

      for (const inf of inferences) {
        if (!newWorkerIds.includes(inf.characterId)) {
          newWorkerIds.push(inf.characterId);
          // Try to find a job title from the source character's relationships
          const rel = character.fictional_relationships?.find(r =>
            (r.person_name || '').toLowerCase().startsWith((inf.characterName || '').toLowerCase().split(' ')[0])
          );
          newWorkerTitles[inf.characterId] = rel?.relationship_type === 'boss' ? 'Manager'
            : rel?.relationship_type === 'employee' ? 'Staff'
            : (character.work_details?.job_title || 'Employee');
        }
      }

      await base44.asServiceRole.entities.LocationReference.update(primaryLocationId, {
        worker_character_ids: newWorkerIds,
        worker_job_titles: newWorkerTitles,
      });

      // Also update each inferred character's occupation_location_id if they don't have one
      for (const inf of inferences) {
        const coworkerCharArr = await base44.asServiceRole.entities.Character.filter({ id: inf.characterId });
        const coworkerChar = coworkerCharArr[0];
        if (coworkerChar && !coworkerChar.occupation_location_id) {
          await base44.asServiceRole.entities.Character.update(inf.characterId, {
            occupation_location_id: primaryLocationId,
            occupation_location_name: location.name,
          });
        }
      }

      return Response.json({
        success: true,
        applied: true,
        count: inferences.length,
        inferences,
        message: `Applied ${inferences.length} coworker inference(s) to ${location.name}`,
      });
    }

    return Response.json({
      success: true,
      applied: false,
      requiresConfirmation: !hasSingleJob,
      inferences,
      message: inferences.length > 0
        ? `Found ${inferences.length} coworker inference(s). ${hasSingleJob ? 'Single job — safe to auto-apply.' : 'Multiple jobs — confirmation recommended.'}`
        : 'No new coworker inferences found.',
    });
  } catch (error) {
    console.error('[inferCoworkerLocations]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});