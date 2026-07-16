/**
 * processScheduledRelocations — PROMISED TELEPORT ONLY
 *
 * This caller is the staged relocation processor. When the pending relocation
 * becomes due, it sends the relocation request to enforceCharacterLocationPresence
 * (the sole canonical writer). It does NOT directly write canonical location
 * or presence. It handles the returned disposition exactly:
 *
 *   accepted:           complete the committed relocation and clear only fulfilled pending data
 *   modified:           update pending information and CommunicationCommitment to actual committed result
 *   redirected:         update destination and commitment to actual resolved result
 *   deferred:           retain or reschedule the pending request
 *   rejected:           close or mark failure without claiming movement occurred
 *   no longer applicable: close the stale request without creating a false relocation record
 *
 * Deferred and rejected are different results and must not be combined.
 * Pending fields are NOT automatically cleared — only fulfilled data is cleared.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const nowIso = now.toISOString();

    // Foreground yield check (preserved)
    let userActiveSessionUntil = 0;
    try {
      const activeFlag = await base44.asServiceRole.entities.AppWorldState.filter(
        { key: 'user_active_session' }, null, 1
      );
      if (activeFlag?.[0]?.value) {
        userActiveSessionUntil = new Date(activeFlag[0].value).getTime();
      }
    } catch { /* non-fatal */ }
    const isForegroundActive = now.getTime() < userActiveSessionUntil;

    // Load characters with pending relocations only
    let commitmentChars = [];
    try {
      commitmentChars = await base44.asServiceRole.entities.Character.filter(
        { status: 'active' }, '-updated_date', 200
      );
      commitmentChars = commitmentChars.filter(c =>
        c.owner_email && c.pending_scheduled_relocation_at && c.next_location_id
      );
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }

    console.log(`[processScheduledRelocations] Processing ${commitmentChars.length} pending relocations (foreground=${isForegroundActive})`);

    const relocated = [];
    const deferred = [];
    const rejected = [];
    const stale = [];
    const modified = [];

    for (const char of commitmentChars) {
      if (!char.owner_email) continue;

      // PROMISE TELEPORT: instant relocation at scheduled time
      const scheduledTime = new Date(char.pending_scheduled_relocation_at);
      if (now < scheduledTime) continue; // not due yet

      const fromLocation = char.resolved_current_location_name || 'Previous Location';
      const toLocation = char.next_location_name || 'Destination';

      // ── ROUTE THROUGH THE SOLE CANONICAL WRITER ──────────────────────────────
      // Send the due relocation request to enforceCharacterLocationPresence.
      // Do NOT directly write canonical location or presence.
      let authorityResponse = null;
      try {
        const invokeResult = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
          character_id: char.id,
          owner_email: char.owner_email,
          requested_presence_status: 'visiting',
          requested_location_id: char.next_location_id,
          requested_location_type: 'visit',
          requested_source_reason: 'scheduled_user_confirmed_relocation',
          requested_relocation: true,
          clear_stay_lock: true,
        });
        authorityResponse = invokeResult?.data || invokeResult;
      } catch (invokeErr) {
        console.error(`[processScheduledRelocations] Authority invoke FAILED for ${char.name}: ${invokeErr.message}`);
        rejected.push({ character_name: char.name, reason: `authority_invoke_failed: ${invokeErr.message}` });
        continue;
      }

      const disposition = authorityResponse?.disposition || 'rejected';
      const committed = authorityResponse?.committed_result || null;

      // ── HANDLE EACH DISPOSITION SEPARATELY ───────────────────────────────────
      switch (disposition) {
        case 'accepted': {
          // Complete the committed relocation and clear only fulfilled pending data.
          // The authority already wrote the canonical location/presence.
          // This caller clears only the pending relocation fields that were fulfilled.
          await base44.asServiceRole.entities.Character.update(char.id, {
            pending_scheduled_relocation_at: null,
            pending_relocation_from: null,
            pending_relocation_from_name: null,
            pending_relocation_source: null,
            pending_relocation_message_id: null,
            pending_relocation_confirmed_at: null,
            next_location_id: null,
            next_location_name: null,
            // Clear stale travel fields (noncanonical — this caller owns these)
            travel_status: 'not_traveling',
            travel_destination_location_id: null,
            traveling_to_location_id: null,
            traveling_to_location_name: null,
          });

          // Write LocationHistory proof from the committed result (not the original request)
          try {
            const openRecords = await base44.asServiceRole.entities.LocationHistory.filter(
              { character_id: char.id, owner_email: char.owner_email, is_current: true }, null, 20
            );
            for (const open of openRecords) {
              if (committed && open.location_id === committed.resolved_current_location_id) continue;
              const arrivalMs = new Date(open.arrival_time).getTime();
              const durationMinutes = Math.round((Date.now() - arrivalMs) / 60000);
              await base44.asServiceRole.entities.LocationHistory.update(open.id, {
                is_current: false,
                departure_time: nowIso,
                duration_minutes: durationMinutes > 0 ? durationMinutes : null,
              });
            }
            if (committed) {
              const alreadyCurrent = openRecords.find(o => o.location_id === committed.resolved_current_location_id);
              if (!alreadyCurrent) {
                let destLoc = null;
                try {
                  const [dl] = await base44.asServiceRole.entities.LocationReference.filter(
                    { id: committed.resolved_current_location_id }, null, 1
                  );
                  destLoc = dl;
                } catch { /* non-fatal */ }
                await base44.asServiceRole.entities.LocationHistory.create({
                  character_id: char.id,
                  character_name: char.name || 'Unknown',
                  owner_email: char.owner_email,
                  location_id: committed.resolved_current_location_id,
                  location_name: committed.resolved_current_location_name || destLoc?.name || toLocation,
                  location_category: destLoc?.category || 'other',
                  event_type: 'arrival',
                  arrival_time: nowIso,
                  travel_source: 'promise',
                  travel_reason: 'scheduled_user_confirmed_relocation',
                  is_current: true,
                });
              }
            }
          } catch (proofErr) {
            console.error(`[processScheduledRelocations] LocationHistory proof failed for ${char.name}: ${proofErr.message}`);
          }

          // Mark matching CommunicationCommitment records as arrived
          const commitments = await base44.asServiceRole.entities.CharacterCommitment.filter(
            { character_id: char.id, status: 'active', destination_location_id: committed?.resolved_current_location_id || char.next_location_id },
            null, 5
          ).catch(() => []);
          for (const c of commitments) {
            try {
              await base44.asServiceRole.entities.CharacterCommitment.update(c.id, {
                status: 'arrived',
                completed_at: nowIso,
              });
            } catch (commitErr) {
              console.error(`[processScheduledRelocations] CharacterCommitment update FAILED for ${c.id}: ${commitErr.message}`);
            }
          }

          relocated.push({
            character_name: char.name,
            from: fromLocation,
            to: committed?.resolved_current_location_name || toLocation,
            reason: 'user_confirmed_commitment',
            disposition: 'accepted',
          });
          break;
        }

        case 'modified': {
          // Update pending information and CommunicationCommitment to the actual committed result.
          // The authority committed a different location than requested.
          if (committed) {
            await base44.asServiceRole.entities.Character.update(char.id, {
              next_location_id: committed.resolved_current_location_id,
              next_location_name: committed.resolved_current_location_name,
              // Clear the pending relocation timing since it was processed
              pending_scheduled_relocation_at: null,
              pending_relocation_confirmed_at: nowIso,
            });
            const commitments = await base44.asServiceRole.entities.CharacterCommitment.filter(
              { character_id: char.id, status: 'active' }, null, 5
            ).catch(() => []);
            for (const c of commitments) {
              try {
                await base44.asServiceRole.entities.CharacterCommitment.update(c.id, {
                  status: 'arrived',
                  completed_at: nowIso,
                  destination_location_id: committed.resolved_current_location_id,
                });
              } catch { /* non-fatal */ }
            }
            modified.push({
              character_name: char.name,
              original_destination: toLocation,
              actual_destination: committed.resolved_current_location_name,
            });
          }
          break;
        }

        case 'redirected': {
          // Update destination and commitment to the actual resolved result.
          // The authority redirected to a different destination.
          if (committed) {
            await base44.asServiceRole.entities.Character.update(char.id, {
              next_location_id: committed.resolved_current_location_id,
              next_location_name: committed.resolved_current_location_name,
              pending_scheduled_relocation_at: null,
            });
            const commitments = await base44.asServiceRole.entities.CharacterCommitment.filter(
              { character_id: char.id, status: 'active' }, null, 5
            ).catch(() => []);
            for (const c of commitments) {
              try {
                await base44.asServiceRole.entities.CharacterCommitment.update(c.id, {
                  destination_location_id: committed.resolved_current_location_id,
                  status: 'arrived',
                  completed_at: nowIso,
                });
              } catch { /* non-fatal */ }
            }
            relocated.push({
              character_name: char.name,
              from: fromLocation,
              to: committed.resolved_current_location_name,
              reason: 'redirected_by_authority',
              disposition: 'redirected',
            });
          }
          break;
        }

        case 'deferred': {
          // Retain or reschedule the pending request. Do NOT clear pending fields.
          // The authority determined the relocation cannot be committed yet.
          deferred.push({
            character_name: char.name,
            reason: authorityResponse?.reason || 'deferred',
          });
          break;
        }

        case 'rejected': {
          // Close or mark failure without claiming movement occurred.
          // Do NOT create a false relocation record.
          await base44.asServiceRole.entities.Character.update(char.id, {
            pending_scheduled_relocation_at: null,
            next_location_id: null,
            next_location_name: null,
          });
          const commitments = await base44.asServiceRole.entities.CharacterCommitment.filter(
            { character_id: char.id, status: 'active' }, null, 5
          ).catch(() => []);
          for (const c of commitments) {
            try {
              await base44.asServiceRole.entities.CharacterCommitment.update(c.id, {
                status: 'failed',
                cancellation_reason: `relocation_rejected: ${authorityResponse?.reason || 'unknown'}`,
              });
            } catch { /* non-fatal */ }
          }
          rejected.push({
            character_name: char.name,
            reason: authorityResponse?.reason || 'rejected',
          });
          break;
        }

        case 'no_change': {
          // The authority determined no transition was needed — the character is
          // already at the destination or no canonical change is required.
          // Clear pending fields only if the committed result matches the destination.
          if (committed && committed.resolved_current_location_id === char.next_location_id) {
            await base44.asServiceRole.entities.Character.update(char.id, {
              pending_scheduled_relocation_at: null,
              pending_relocation_from: null,
              pending_relocation_from_name: null,
              pending_relocation_source: null,
              pending_relocation_message_id: null,
              pending_relocation_confirmed_at: null,
              next_location_id: null,
              next_location_name: null,
            });
            relocated.push({
              character_name: char.name,
              to: committed.resolved_current_location_name,
              reason: 'already_at_destination',
              disposition: 'no_change',
            });
          } else {
            stale.push({
              character_name: char.name,
              reason: 'no_change_destination_mismatch',
            });
          }
          break;
        }

        default: {
          // Unknown disposition — treat as no longer applicable
          // Close the stale request without creating a false relocation record.
          await base44.asServiceRole.entities.Character.update(char.id, {
            pending_scheduled_relocation_at: null,
            next_location_id: null,
            next_location_name: null,
          });
          stale.push({ character_name: char.name, reason: `unknown_disposition: ${disposition}` });
          break;
        }
      }
    }

    return Response.json({
      success: true,
      relocated: relocated.length,
      deferred: deferred.length,
      rejected: rejected.length,
      stale: stale.length,
      modified: modified.length,
      characters: relocated,
      deferred_characters: deferred,
      rejected_characters: rejected,
      stale_characters: stale,
      modified_characters: modified,
      note: 'Routed through enforceCharacterLocationPresence — sole canonical writer.',
    });

  } catch (error) {
    console.error('[processScheduledRelocations]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});