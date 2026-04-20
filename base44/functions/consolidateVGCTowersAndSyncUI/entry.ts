import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── STEP 1: FIND ALL VGC TOWERS INSTANCES FOR THIS USER ──────────────────
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email },
      '-created_date',
      200
    );

    const vgcInstances = allLocations.filter(l => 
      l.name && l.name.toLowerCase().includes('vgc towers')
    );

    console.log(`Found ${vgcInstances.length} VGC Towers instances`);

    // If only one or zero, no consolidation needed
    if (vgcInstances.length <= 1) {
      return Response.json({
        success: true,
        message: 'Only one VGC Towers instance exists (correct state)',
        vgc_count: vgcInstances.length,
        canonical_vgc: vgcInstances[0]?.id || null,
        duplicates_removed: 0,
        npcs_resynced: 0,
      });
    }

    // ── STEP 2: IDENTIFY CANONICAL VGC TOWERS (oldest/first created) ──────────
    const canonicalVGC = vgcInstances.sort((a, b) => 
      new Date(a.created_date) - new Date(b.created_date)
    )[0];

    const duplicateVGCs = vgcInstances.filter(v => v.id !== canonicalVGC.id);

    console.log(`Canonical VGC: ${canonicalVGC.id} (${canonicalVGC.name})`);
    console.log(`Duplicates to remove: ${duplicateVGCs.length}`);

    // ── STEP 3: MIGRATE ALL RESIDENTS FROM DUPLICATES TO CANONICAL ────────────
    let totalNPCsMigrated = 0;

    for (const dupVGC of duplicateVGCs) {
      // Get all residents of this duplicate
      const residents = dupVGC.residents || [];
      
      // Merge into canonical
      const canResidents = canonicalVGC.residents || [];
      const mergedResidents = [...canResidents];
      
      for (const resident of residents) {
        const alreadyExists = mergedResidents.find(r => r.character_id === resident.character_id);
        if (!alreadyExists) {
          mergedResidents.push(resident);
          totalNPCsMigrated++;
        }
      }

      // Update canonical with merged residents
      await base44.asServiceRole.entities.LocationReference.update(canonicalVGC.id, {
        residents: mergedResidents,
      });

      // Delete duplicate VGC Towers
      await base44.asServiceRole.entities.LocationReference.delete(dupVGC.id);
      console.log(`Deleted duplicate VGC: ${dupVGC.id}`);
    }

    // ── STEP 4: UPDATE ALL CHARACTERS TO POINT TO CANONICAL VGC ──────────────
    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      200
    );

    let charactersUpdated = 0;

    for (const char of characters) {
      // If they point to any duplicate VGC, reassign to canonical
      const pointsToDuplicate = duplicateVGCs.some(d => 
        d.id === char.current_home_location_id || 
        d.id === char.resolved_current_location_id
      );

      if (pointsToDuplicate) {
        await base44.asServiceRole.entities.Character.update(char.id, {
          current_home_location_id: canonicalVGC.id,
          resolved_current_location_id: canonicalVGC.id,
          resolved_current_location_name: canonicalVGC.name,
          resolved_presence_status: 'home',
        });
        charactersUpdated++;
      }
    }

    // ── STEP 5: VERIFY UI SYNC BY RETURNING UPDATED STATE ───────────────────
    const updatedCharacters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      200
    );

    const npcLocationSummary = updatedCharacters
      .filter(c => c.character_type === 'npc' || c.character_type === 'promoted_npc')
      .map(c => ({
        id: c.id,
        name: c.name,
        location_id: c.resolved_current_location_id,
        location_name: c.resolved_current_location_name,
        status: c.resolved_presence_status,
      }));

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      vgc_consolidation: {
        total_instances: vgcInstances.length,
        canonical_vgc_id: canonicalVGC.id,
        canonical_vgc_name: canonicalVGC.name,
        duplicates_removed: duplicateVGCs.length,
        npcs_migrated: totalNPCsMigrated,
      },
      character_updates: {
        total_characters_scanned: characters.length,
        characters_reassigned_to_canonical: charactersUpdated,
      },
      npc_location_state: npcLocationSummary,
    });
  } catch (error) {
    console.error('[consolidateVGCTowersAndSyncUI]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});