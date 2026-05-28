import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncLocationStaffToCharacters
 *
 * Non-destructive repair of the work/staff assignment split.
 *
 * ROOT CAUSE: When characters are added to a location via the Locations edit panel,
 * they are written into LocationReference.worker_character_ids and worker_job_titles.
 * But if syncLocationJobToCharacter was not called at that time, Character.occupation_location_id
 * remains null — so the character profile, dashboard Work field, and CharacterWorkScheduleEditor
 * all show "No work locations linked yet" even though the location's arrow dropdown correctly
 * lists the character as staff/faculty/employee.
 *
 * This function inlines the sync logic with asServiceRole to avoid nested 403 auth failures.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    // Load all locations for this user
    const allLocs = await base44.entities.LocationReference.filter(
      { owner_email: ownerEmail }, null, 300
    ).catch(() => []);

    console.log(`[syncLocationStaffToCharacters] Loaded ${allLocs.length} locations for ${ownerEmail}`);

    // Load all user's active characters
    const userChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail, status: 'active' }, null, 300
    ).catch(() => []);

    const charById = {};
    userChars.forEach(c => { charById[c.id] = c; });

    console.log(`[syncLocationStaffToCharacters] Loaded ${userChars.length} characters`);

    const results = [];
    let syncedCount = 0;
    let skippedCount = 0;

    for (const loc of allLocs) {
      const workerIds = loc.worker_character_ids || [];
      const titleIds = Object.keys(loc.worker_job_titles || {});
      // Union: all character IDs referenced on this location (matches LocationDetailPanel logic)
      const allWorkerIds = [...new Set([...workerIds, ...titleIds])];

      for (const charId of allWorkerIds) {
        const char = charById[charId];
        if (!char) continue; // Not this user's character

        const alreadyLinked =
          char.occupation_location_id === loc.id ||
          (char.additional_occupation_locations || []).some(a => a.location_id === loc.id);

        const diagnostic = {
          characterId: charId,
          characterName: char.name,
          locationId: loc.id,
          locationName: loc.name,
          before: {
            occupation_location_id: char.occupation_location_id || null,
            additional_occupation_locations: (char.additional_occupation_locations || []).map(a => a.location_id),
          },
        };

        if (alreadyLinked) {
          diagnostic.action = 'skipped_already_linked';
          skippedCount++;
          results.push(diagnostic);
          continue;
        }

        diagnostic.action = dryRun ? 'would_sync' : 'synced';

        if (!dryRun) {
          try {
            const jobTitle = loc.worker_job_titles?.[charId] || '';
            const payRate = loc.worker_pay_rates?.[charId] || 0;
            const payType = loc.worker_pay_type?.[charId] || 'hourly';
            const shift = loc.worker_shifts?.[charId] || null;

            // Ensure character is in worker_character_ids on the location
            const currentWorkers = loc.worker_character_ids || [];
            if (!currentWorkers.includes(charId)) {
              await base44.asServiceRole.entities.LocationReference.update(loc.id, {
                worker_character_ids: [...currentWorkers, charId],
              });
              // Update local copy so subsequent characters in this loc see updated list
              loc.worker_character_ids = [...currentWorkers, charId];
            }

            // Build character update
            let charUpdates = {};
            const workDetails = {
              ...(char.work_details || {}),
              job_title: jobTitle || char.work_details?.job_title || '',
              workplace_type: loc.category || 'workplace',
              location_name: loc.name,
            };

            if (!char.occupation_location_id) {
              charUpdates = {
                occupation_location_id: loc.id,
                occupation_location_name: loc.name,
                current_work_location_id: loc.id,
                work_details: workDetails,
              };
              if (shift?.start) charUpdates.work_start_time = shift.start;
              if (shift?.end) charUpdates.work_end_time = shift.end;
              if (shift?.days?.length > 0) charUpdates.work_days = shift.days;
            } else {
              // Has a different primary — add as additional occupation
              const existing = char.additional_occupation_locations || [];
              const alreadyAdditional = existing.some(e => e.location_id === loc.id);
              if (!alreadyAdditional) {
                charUpdates.additional_occupation_locations = [
                  ...existing,
                  {
                    location_id: loc.id,
                    location_name: loc.name,
                    job_title: jobTitle,
                    shift_start: shift?.start || null,
                    shift_end: shift?.end || null,
                    work_days: shift?.days || [],
                  },
                ];
              }
            }

            if (Object.keys(charUpdates).length > 0) {
              // Character RLS requires owner_email match — use user-scoped client, not asServiceRole
              await base44.entities.Character.update(charId, charUpdates);
              // Update local char copy so subsequent loops see updated state
              Object.assign(char, charUpdates);
            }

            // Sync CharacterFinancial income sources
            const finArr = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: charId }).catch(() => []);
            if (finArr.length > 0) {
              const fin = finArr[0];
              const existingSources = fin.income_sources || [];
              const existingIdx = existingSources.findIndex(s => s.location_id === loc.id);
              const newSource = {
                location_id: loc.id,
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
                work_location_ids: [...new Set([...(fin.work_location_ids || []), loc.id])],
                work_location_names: [...new Set([...(fin.work_location_names || []), loc.name])],
              }).catch(e => console.warn(`[syncLocationStaffToCharacters] Financial sync warn: ${e.message}`));
            }

            diagnostic.after = { occupation_location_id: loc.id, job_title: jobTitle };
            syncedCount++;
          } catch (e) {
            diagnostic.action = 'sync_failed';
            diagnostic.error = e.message;
          }
        } else {
          syncedCount++;
        }

        results.push(diagnostic);
      }
    }

    console.log(`[syncLocationStaffToCharacters] Done | synced=${syncedCount} | skipped=${skippedCount} | dryRun=${dryRun}`);

    return Response.json({
      success: true,
      dryRun,
      synced: syncedCount,
      skipped: skippedCount,
      total_checked: results.length,
      results,
      message: dryRun
        ? `Dry run: would sync ${syncedCount} assignments, ${skippedCount} already correct.`
        : `Synced ${syncedCount} character-location assignments. ${skippedCount} already correct.`,
    });

  } catch (error) {
    console.error('[syncLocationStaffToCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});