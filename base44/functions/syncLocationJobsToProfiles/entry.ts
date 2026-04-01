/**
 * syncLocationJobsToProfiles
 *
 * When a location's worker list or education list is updated,
 * sync those job titles / education links back to character profiles.
 *
 * Rules:
 * - If character has no occupation_location_id → set it (primary job)
 * - If character already has a primary job → add to additional_occupation_locations (second job)
 * - Same logic for education: education_location_id → additional_education_locations
 * - Never remove existing jobs/education — only add
 * - Also updates CharacterFinancial income_sources with pay data
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { location_id } = body;

    // Fetch location
    const locations = location_id
      ? await base44.asServiceRole.entities.LocationReference.filter({ id: location_id })
      : await base44.asServiceRole.entities.LocationReference.filter({ created_by: user.email });

    const results = { synced_jobs: [], synced_education: [], errors: [] };

    const isEducationType = (cat) => ['school', 'education'].includes(cat);
    const isWorkType = (cat) => ['workplace', 'business', 'food_drink', 'gym', 'social', 'education', 'medical', 'school', 'grocery', 'religion', 'government'].includes(cat);

    for (const loc of locations) {
      const workerIds = loc.worker_character_ids || [];
      const isEduLoc = isEducationType(loc.category);

      // ── Sync workers → occupation / education on profiles ────────────────
      for (const charId of workerIds) {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: charId });
        const char = chars[0];
        if (!char) continue;

        const jobTitle = loc.worker_job_titles?.[charId] || '';
        const payRate = loc.worker_pay_rates?.[charId] || 0;
        const payType = loc.worker_pay_type?.[charId] || 'hourly';

        if (isEduLoc) {
          // Education location — sync to education fields
          const alreadyPrimary = char.education_location_id === loc.id;
          const alreadyAdditional = (char.additional_education_locations || []).some(e => e.location_id === loc.id);

          if (!alreadyPrimary && !alreadyAdditional) {
            const update = {};
            if (!char.education_location_id) {
              update.education_location_id = loc.id;
              update.education_location_name = loc.name;
              if (!char.current_education_activity || char.current_education_activity === 'none') {
                update.current_education_activity = jobTitle || 'enrolled';
              }
            } else {
              update.additional_education_locations = [
                ...(char.additional_education_locations || []),
                { location_id: loc.id, location_name: loc.name, program_name: jobTitle || '' }
              ];
            }
            await base44.asServiceRole.entities.Character.update(charId, update);
            results.synced_education.push({ character_id: charId, character_name: char.name, location: loc.name });
          }
        } else {
          // Work location — sync to occupation fields
          const alreadyPrimary = char.occupation_location_id === loc.id;
          const alreadyAdditional = (char.additional_occupation_locations || []).some(e => e.location_id === loc.id);

          if (!alreadyPrimary && !alreadyAdditional) {
            const update = {};
            if (!char.occupation_location_id) {
              update.occupation_location_id = loc.id;
              update.occupation_location_name = loc.name;
              if (jobTitle && !char.work_details?.job_title) {
                update.work_details = { ...(char.work_details || {}), job_title: jobTitle };
              }
            } else {
              update.additional_occupation_locations = [
                ...(char.additional_occupation_locations || []),
                { location_id: loc.id, location_name: loc.name, job_title: jobTitle }
              ];
            }
            await base44.asServiceRole.entities.Character.update(charId, update);
            results.synced_jobs.push({ character_id: charId, character_name: char.name, location: loc.name, job_title: jobTitle });
          }

          // Sync to CharacterFinancial income_sources
          if (payRate > 0) {
            const financials = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: charId });
            if (financials.length > 0) {
              const fin = financials[0];
              const sources = fin.income_sources || [];
              const existingIdx = sources.findIndex(s => s.location_id === loc.id);
              const newSource = {
                location_id: loc.id,
                location_name: loc.name,
                pay_type: payType,
                pay_amount: payRate,
                total_earned: existingIdx >= 0 ? sources[existingIdx].total_earned || 0 : 0,
                last_payment_date: existingIdx >= 0 ? sources[existingIdx].last_payment_date : null,
              };
              if (existingIdx >= 0) {
                sources[existingIdx] = newSource;
              } else {
                sources.push(newSource);
              }
              await base44.asServiceRole.entities.CharacterFinancial.update(fin.id, { income_sources: sources });
            }
          }
        }
      }
    }

    return Response.json({ success: true, ...results });
  } catch (error) {
    console.error('[syncLocationJobsToProfiles]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});