import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── FIND ALL LOCATIONS WITH "VGC TOWERS" IN THE NAME ──────────────────────
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email },
      '-created_date',
      200
    );

    const vgcMatches = allLocations.filter(l => {
      const name = (l.name || '').trim().toUpperCase();
      return name === 'VGC TOWERS' || name.startsWith('VGC TOWERS');
    });

    console.log(`Found ${vgcMatches.length} VGC Towers instances:`, vgcMatches.map(v => ({ id: v.id, name: v.name, created: v.created_date })));

    if (vgcMatches.length <= 1) {
      return Response.json({
        success: true,
        message: 'No duplicates found',
        instance_count: vgcMatches.length,
        canonical_id: vgcMatches[0]?.id || null,
      });
    }

    // ── IDENTIFY CANONICAL (OLDEST) ────────────────────────────────────────────
    const canonical = vgcMatches.sort((a, b) => 
      new Date(a.created_date) - new Date(b.created_date)
    )[0];

    const duplicates = vgcMatches.filter(v => v.id !== canonical.id);

    console.log(`Canonical VGC: ${canonical.id} (${canonical.name}, created ${canonical.created_date})`);
    console.log(`Deleting ${duplicates.length} duplicates`);

    // ── MIGRATE ALL DATA FROM DUPLICATES TO CANONICAL ──────────────────────────
    // 1. Merge residents
    let canonicalResidents = canonical.residents || [];
    let totalResidentsMigrated = 0;

    for (const dup of duplicates) {
      const dupResidents = dup.residents || [];
      for (const resident of dupResidents) {
        if (!canonicalResidents.find(r => r.character_id === resident.character_id)) {
          canonicalResidents.push(resident);
          totalResidentsMigrated++;
        }
      }
    }

    // 2. Merge workers
    let canonicalWorkers = canonical.worker_character_ids || [];
    let canonicalWorkerPayRates = canonical.worker_pay_rates || {};
    let canonicalWorkerPayTypes = canonical.worker_pay_type || {};
    let canonicalWorkerJobTitles = canonical.worker_job_titles || {};
    let canonicalWorkerShifts = canonical.worker_shifts || {};
    let totalWorkersMigrated = 0;

    for (const dup of duplicates) {
      const dupWorkers = dup.worker_character_ids || [];
      for (const workerId of dupWorkers) {
        if (!canonicalWorkers.includes(workerId)) {
          canonicalWorkers.push(workerId);
          if (dup.worker_pay_rates?.[workerId]) {
            canonicalWorkerPayRates[workerId] = dup.worker_pay_rates[workerId];
          }
          if (dup.worker_pay_type?.[workerId]) {
            canonicalWorkerPayTypes[workerId] = dup.worker_pay_type[workerId];
          }
          if (dup.worker_job_titles?.[workerId]) {
            canonicalWorkerJobTitles[workerId] = dup.worker_job_titles[workerId];
          }
          if (dup.worker_shifts?.[workerId]) {
            canonicalWorkerShifts[workerId] = dup.worker_shifts[workerId];
          }
          totalWorkersMigrated++;
        }
      }
    }

    // ── UPDATE CANONICAL WITH MERGED DATA ──────────────────────────────────────
    await base44.asServiceRole.entities.LocationReference.update(canonical.id, {
      residents: canonicalResidents,
      worker_character_ids: canonicalWorkers,
      worker_pay_rates: canonicalWorkerPayRates,
      worker_pay_type: canonicalWorkerPayTypes,
      worker_job_titles: canonicalWorkerJobTitles,
      worker_shifts: canonicalWorkerShifts,
    });

    console.log(`Updated canonical: ${totalResidentsMigrated} residents, ${totalWorkersMigrated} workers merged`);

    // ── DELETE ALL DUPLICATE INSTANCES ─────────────────────────────────────────
    for (const dup of duplicates) {
      await base44.asServiceRole.entities.LocationReference.delete(dup.id);
      console.log(`Deleted duplicate: ${dup.id} (${dup.name})`);
    }

    // ── UPDATE ALL CHARACTERS POINTING TO DUPLICATES ────────────────────────────
    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      300
    );

    let charactersFixed = 0;

    for (const char of characters) {
      let needsUpdate = false;
      const updates = {};

      // Check home location
      if (char.current_home_location_id && duplicates.some(d => d.id === char.current_home_location_id)) {
        updates.current_home_location_id = canonical.id;
        needsUpdate = true;
      }

      // Check resolved location
      if (char.resolved_current_location_id && duplicates.some(d => d.id === char.resolved_current_location_id)) {
        updates.resolved_current_location_id = canonical.id;
        updates.resolved_current_location_name = canonical.name;
        needsUpdate = true;
      }

      // Check occupation location
      if (char.occupation_location_id && duplicates.some(d => d.id === char.occupation_location_id)) {
        updates.occupation_location_id = canonical.id;
        updates.occupation_location_name = canonical.name;
        needsUpdate = true;
      }

      // Check education location
      if (char.education_location_id && duplicates.some(d => d.id === char.education_location_id)) {
        updates.education_location_id = canonical.id;
        updates.education_location_name = canonical.name;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await base44.asServiceRole.entities.Character.update(char.id, updates);
        charactersFixed++;
      }
    }

    console.log(`Fixed ${charactersFixed} characters pointing to duplicate VGC instances`);

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      consolidation: {
        duplicate_instances_deleted: duplicates.length,
        canonical_vgc_id: canonical.id,
        canonical_vgc_name: canonical.name,
        residents_merged: totalResidentsMigrated,
        workers_merged: totalWorkersMigrated,
      },
      characters_fixed: charactersFixed,
    });
  } catch (error) {
    console.error('[auditAndForceConsolidateVGC]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});