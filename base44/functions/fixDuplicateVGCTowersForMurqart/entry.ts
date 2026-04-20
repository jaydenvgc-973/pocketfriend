import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // CRITICAL: Only process murqart@gmail.com
    const TARGET_EMAIL = 'murqart@gmail.com';
    if (user.email !== TARGET_EMAIL) {
      return Response.json({
        error: `Access denied. This function only operates on ${TARGET_EMAIL}. Current user: ${user.email}`,
      }, { status: 403 });
    }

    console.log(`[fixDuplicateVGCTowersForMurqart] Operating ONLY on ${TARGET_EMAIL}`);

    // ── STEP 1: FIND ALL VGC TOWERS FOR THIS ACCOUNT ONLY ──────────────────
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: TARGET_EMAIL },
      '-created_date',
      200
    );

    const vgcInstances = allLocations.filter(l => 
      l.name && l.name.toLowerCase().includes('vgc towers')
    );

    console.log(`Found ${vgcInstances.length} VGC Towers instances for ${TARGET_EMAIL}`);

    if (vgcInstances.length <= 1) {
      return Response.json({
        success: true,
        message: 'No duplicates found',
        target_email: TARGET_EMAIL,
        vgc_count: vgcInstances.length,
        canonical_vgc: vgcInstances[0]?.id || null,
        duplicates_removed: 0,
        characters_updated: 0,
      });
    }

    // ── STEP 2: CANONICAL IS THE OLDEST ──────────────────────────────────
    const canonicalVGC = vgcInstances.sort((a, b) => 
      new Date(a.created_date) - new Date(b.created_date)
    )[0];

    const duplicateVGCs = vgcInstances.filter(v => v.id !== canonicalVGC.id);

    console.log(`Canonical: ${canonicalVGC.id}`);
    console.log(`Duplicates to remove: ${duplicateVGCs.map(d => d.id).join(', ')}`);

    // ── STEP 3: MIGRATE RESIDENTS TO CANONICAL ──────────────────────────
    let totalCharactersUpdated = 0;

    for (const dupVGC of duplicateVGCs) {
      const residents = dupVGC.residents || [];
      const canResidents = canonicalVGC.residents || [];
      const mergedResidents = [...canResidents];

      for (const resident of residents) {
        const alreadyExists = mergedResidents.find(r => r.character_id === resident.character_id);
        if (!alreadyExists) {
          mergedResidents.push(resident);
        }
      }

      await base44.asServiceRole.entities.LocationReference.update(canonicalVGC.id, {
        residents: mergedResidents,
      });

      // Delete duplicate
      await base44.asServiceRole.entities.LocationReference.delete(dupVGC.id);
      console.log(`Deleted duplicate VGC: ${dupVGC.id}`);
    }

    // ── STEP 4: REASSIGN ALL CHARACTERS TO CANONICAL ──────────────────────
    const allCharacters = await base44.asServiceRole.entities.Character.filter(
      { created_by: TARGET_EMAIL },
      '-created_date',
      200
    );

    for (const char of allCharacters) {
      const pointsToDuplicate = duplicateVGCs.some(d => 
        d.id === char.current_home_location_id || 
        d.id === char.resolved_current_location_id
      );

      if (pointsToDuplicate) {
        await base44.asServiceRole.entities.Character.update(char.id, {
          current_home_location_id: canonicalVGC.id,
          resolved_current_location_id: canonicalVGC.id,
          resolved_current_location_name: canonicalVGC.name,
        });
        totalCharactersUpdated++;
      }
    }

    return Response.json({
      success: true,
      target_email: TARGET_EMAIL,
      vgc_consolidation: {
        total_instances_found: vgcInstances.length,
        canonical_vgc_id: canonicalVGC.id,
        canonical_vgc_name: canonicalVGC.name,
        duplicates_deleted: duplicateVGCs.length,
        duplicate_ids: duplicateVGCs.map(d => d.id),
      },
      characters_updated: totalCharactersUpdated,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[fixDuplicateVGCTowersForMurqart]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});