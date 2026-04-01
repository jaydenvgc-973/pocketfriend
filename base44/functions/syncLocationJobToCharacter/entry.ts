import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * syncLocationJobToCharacter
 *
 * When a worker is added to a location, this syncs their job title back to
 * the Character entity without overwriting existing occupation data.
 * Also handles education/school location → character education sync.
 *
 * Payload:
 *   locationId: string
 *   characterId: string
 *   syncType: 'work' | 'education'   (default: 'work')
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

    // Fetch location and character
    const [locArr, charArr] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ id: locationId }),
      base44.asServiceRole.entities.Character.filter({ id: characterId }),
    ]);
    const loc = locArr[0];
    const char = charArr[0];
    if (!loc || !char) return Response.json({ error: 'Location or character not found' }, { status: 404 });

    let updates = {};

    if (syncType === 'work') {
      const jobTitle = loc.worker_job_titles?.[characterId] || '';
      const payRate = loc.worker_pay_rates?.[characterId] || 0;
      const payType = loc.worker_pay_type?.[characterId] || 'hourly';

      // If character has no primary occupation location, set it
      if (!char.occupation_location_id) {
        updates.occupation_location_id = locationId;
        updates.occupation_location_name = loc.name;
        if (jobTitle && !char.work_details?.job_title) {
          updates.work_details = {
            ...(char.work_details || {}),
            job_title: jobTitle,
            workplace_type: loc.category || 'workplace',
          };
        }
      } else if (char.occupation_location_id !== locationId) {
        // Already has a primary job — add as additional
        const existing = char.additional_occupation_locations || [];
        const alreadyLinked = existing.some(e => e.location_id === locationId);
        if (!alreadyLinked) {
          updates.additional_occupation_locations = [
            ...existing,
            { location_id: locationId, location_name: loc.name, job_title: jobTitle },
          ];
        }
      } else {
        // Same location — just update job title if blank
        if (jobTitle && !char.work_details?.job_title) {
          updates.work_details = { ...(char.work_details || {}), job_title: jobTitle };
        }
      }

      // Sync pay data to CharacterFinancial
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
          let newSources;
          if (existingIdx >= 0) {
            newSources = existingSources.map((s, i) => i === existingIdx ? newSource : s);
          } else {
            newSources = [...existingSources, newSource];
          }
          await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, {
            income_sources: newSources,
            work_location_ids: [...new Set([...(fin.work_location_ids || []), locationId])],
            work_location_names: [...new Set([...(fin.work_location_names || []), loc.name])],
          });
        }
      } catch (e) {
        console.warn('Financial sync failed (non-fatal):', e.message);
      }
    }

    if (syncType === 'education') {
      const programName = loc.name;
      const locCategory = loc.category;

      if (!char.education_location_id) {
        updates.education_location_id = locationId;
        updates.education_location_name = loc.name;
        if (!char.current_education_activity || char.current_education_activity === 'none') {
          updates.current_education_activity = programName;
          updates.education_details = {
            ...(char.education_details || {}),
            institution: loc.name,
          };
        }
      } else if (char.education_location_id !== locationId) {
        const existing = char.additional_education_locations || [];
        const alreadyLinked = existing.some(e => e.location_id === locationId);
        if (!alreadyLinked) {
          updates.additional_education_locations = [
            ...existing,
            { location_id: locationId, location_name: loc.name, program_name: programName },
          ];
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await base44.asServiceRole.entities.Character.update(characterId, updates);
    }

    return Response.json({
      success: true,
      updatesApplied: Object.keys(updates),
      message: `Synced ${syncType} from ${loc.name} to ${char.name}`,
    });
  } catch (error) {
    console.error('[syncLocationJobToCharacter]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});