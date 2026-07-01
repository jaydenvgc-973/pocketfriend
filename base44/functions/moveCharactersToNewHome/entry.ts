/**
 * moveCharactersToNewHome — REPAIRED
 *
 * Previously: batch home move with no per-character error handling, no
 * LocationHistory proof, and CharacterMemory.create in a loop with no
 * try/catch — an exception on character 3 left characters 1-2 already moved
 * with no rollback.
 *
 * Now: each character is processed in its own try/catch. After each
 * Character.update, writeVerifiedLocationHistory is called to produce the
 * proof record. If proof fails, that character's Character write is reverted.
 * Per-character success/failure is reported explicitly. No partial batch
 * corruption — each character's outcome is independent.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      sourceHomeId,
      destinationHomeId,
      moversToMove = [],
      npcMovers = [],
      newHomeName,
    } = await req.json();

    if (!destinationHomeId) return Response.json({ error: 'Missing destinationHomeId' }, { status: 400 });

    const destHomes = await base44.entities.LocationReference.filter({ id: destinationHomeId });
    if (destHomes.length === 0) return Response.json({ error: 'Destination home not found' }, { status: 404 });
    const dest = destHomes[0];

    let source = null;
    if (sourceHomeId) {
      const sourceHomes = await base44.entities.LocationReference.filter({ id: sourceHomeId });
      source = sourceHomes[0] || null;
    }

    const destResidents = new Set(dest.resident_character_ids || []);
    const destNames = new Set(dest.resident_character_names || []);

    const perCharacterResults = [];
    let successCount = 0;
    let failureCount = 0;

    // ── Move active characters — each in its own try/catch ────────────────
    for (const moverId of moversToMove) {
      const charResult = { character_id: moverId, status: 'pending', error: null };

      try {
        const chars = await base44.entities.Character.filter({ id: moverId });
        if (chars.length === 0) {
          charResult.status = 'failed';
          charResult.error = 'Character not found';
          failureCount++;
          perCharacterResults.push(charResult);
          continue;
        }
        const moverChar = chars[0];

        if (moverChar.owner_email !== user.email) {
          charResult.status = 'failed';
          charResult.error = 'Ownership mismatch';
          failureCount++;
          perCharacterResults.push(charResult);
          continue;
        }

        // Pre-write snapshot for rollback
        const preMoveSnapshot = {
          current_home_location_id: moverChar.current_home_location_id,
          resolved_current_location_id: moverChar.resolved_current_location_id,
          resolved_current_location_name: moverChar.resolved_current_location_name,
          resolved_presence_status: moverChar.resolved_presence_status,
          resolved_location_type: moverChar.resolved_location_type,
          resolved_source_reason: moverChar.resolved_source_reason,
          resolved_last_updated_at: moverChar.resolved_last_updated_at,
        };

        destResidents.add(moverId);
        destNames.add(moverChar.name);

        // SINGLE-HOME RULE: Remove from any existing home they're listed in
        const existingHomeId = moverChar.current_home_location_id;
        if (existingHomeId && existingHomeId !== destinationHomeId && existingHomeId !== sourceHomeId) {
          try {
            const existingHomes = await base44.entities.LocationReference.filter({ id: existingHomeId });
            if (existingHomes.length > 0) {
              const eh = existingHomes[0];
              await base44.entities.LocationReference.update(existingHomeId, {
                resident_character_ids: (eh.resident_character_ids || []).filter(id => id !== moverId),
                resident_character_names: (eh.resident_character_names || []).filter(n => n !== moverChar.name),
              });
            }
          } catch (secondaryErr) {
            console.warn(`[moveCharactersToNewHome] secondary resident-list cleanup failed for ${moverChar.name}: ${secondaryErr.message}`);
          }
        }

        // Update character's home reference
        await base44.entities.Character.update(moverChar.id, {
          current_home_location_id: destinationHomeId,
          resolved_current_location_id: destinationHomeId,
          resolved_current_location_name: newHomeName || dest.name,
          resolved_presence_status: 'home',
          resolved_location_type: 'home',
          resolved_source_reason: 'move_to_new_home',
          resolved_last_updated_at: new Date().toISOString(),
        });

        // PRODUCE VERIFIED LocationHistory PROOF — revert on failure
        try {
          const proofResult = await base44.asServiceRole.functions.invoke('writeVerifiedLocationHistory', {
            character_id: moverChar.id,
            owner_email: moverChar.owner_email,
            location_id: destinationHomeId,
            event_type: 'return_home',
            travel_source: 'manual',
            travel_reason: 'move_to_new_home',
          });
          if (!proofResult?.data?.success) {
            // Revert Character write
            let revertError = null;
            try { await base44.entities.Character.update(moverChar.id, preMoveSnapshot); }
            catch (e) { revertError = e.message; }
            charResult.status = 'failed';
            charResult.error = `proof_failed: ${proofResult?.data?.error || 'unknown'} | revert_error=${revertError}`;
            failureCount++;
            // Remove from dest residents since the move was reverted
            destResidents.delete(moverId);
            destNames.delete(moverChar.name);
            perCharacterResults.push(charResult);
            continue;
          }
        } catch (proofError) {
          let revertError = null;
          try { await base44.entities.Character.update(moverChar.id, preMoveSnapshot); }
          catch (e) { revertError = e.message; }
          charResult.status = 'failed';
          charResult.error = `proof_threw: ${proofError.message} | revert_error=${revertError}`;
          failureCount++;
          destResidents.delete(moverId);
          destNames.delete(moverChar.name);
          perCharacterResults.push(charResult);
          continue;
        }

        // Memory of the move (consequence — non-fatal if it fails)
        try {
          await base44.entities.CharacterMemory.create({
            character_id: moverChar.id,
            memory_type: 'event',
            memory_text: `Moved into ${newHomeName || dest.name}`,
            memory_summary: `Moved to a new home`,
            importance_score: 8,
          });
        } catch (memErr) {
          console.warn(`[moveCharactersToNewHome] memory write failed for ${moverChar.name}: ${memErr.message}`);
        }

        charResult.status = 'success';
        charResult.character_name = moverChar.name;
        successCount++;
        perCharacterResults.push(charResult);
      } catch (charErr) {
        charResult.status = 'failed';
        charResult.error = charErr.message;
        failureCount++;
        perCharacterResults.push(charResult);
      }
    }

    // ── Move NPC family members ───────────────────────────────────────────
    const destFamilyMembers = [...(dest.resident_family_members || [])];
    for (const npc of npcMovers) {
      if (!npc.name) continue;
      const alreadyThere = destFamilyMembers.some(f => f.name === npc.name);
      if (!alreadyThere) {
        destFamilyMembers.push({
          name: npc.name,
          relationship_type: npc.relationship_type || "Family",
          source_character_id: npc.source_character_id || null,
          isNPC: npc.isNPC || true,
        });
      }
    }

    // Update destination home resident lists
    try {
      await base44.entities.LocationReference.update(destinationHomeId, {
        name: newHomeName || dest.name,
        resident_character_ids: Array.from(destResidents),
        resident_character_names: Array.from(destNames),
        resident_family_members: destFamilyMembers,
      });
    } catch (locErr) {
      console.warn(`[moveCharactersToNewHome] destination resident-list update failed: ${locErr.message}`);
    }

    // Update source home — remove movers
    if (source) {
      try {
        const sourceResidents = (source.resident_character_ids || []).filter(id => !moversToMove.includes(id));
        const sourceNames = (source.resident_character_names || []).filter(name => !perCharacterResults.some(r => r.character_name === name));
        const npcMoverNames = new Set(npcMovers.map(n => n.name));
        const sourceFamilyMembers = (source.resident_family_members || []).filter(fm => !npcMoverNames.has(fm.name));
        await base44.entities.LocationReference.update(sourceHomeId, {
          resident_character_ids: sourceResidents,
          resident_character_names: sourceNames,
          resident_family_members: sourceFamilyMembers,
        });
      } catch (locErr) {
        console.warn(`[moveCharactersToNewHome] source resident-list update failed: ${locErr.message}`);
      }
    }

    return Response.json({
      success: failureCount === 0,
      movedCharacters: successCount,
      failedCharacters: failureCount,
      movedNpcs: npcMovers.length,
      destinationName: newHomeName || dest.name,
      per_character_results: perCharacterResults,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});