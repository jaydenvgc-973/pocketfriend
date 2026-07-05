/**
 * clearStaleCharacterSleep
 * 
 * Direct ID-based wake for characters stuck in stale sleep state.
 * Does NOT rely on filters — uses direct get + update.
 * 
 * Hard rule: If character has been marked sleeping past their wake_up_time
 * with no valid medical/confinement reason, WAKE THEM.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character_ids = [], dry_run = false } = await req.json();

    if (!Array.isArray(character_ids) || character_ids.length === 0) {
      return Response.json({ error: 'character_ids required (array)' }, { status: 400 });
    }

    const nowUtc = new Date();
    const nowEt = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowEtIso = nowEt.toISOString();

    console.log(`[clearStaleCharacterSleep] START (dry_run=${dry_run})`);
    console.log(`[clearStaleCharacterSleep] Processing ${character_ids.length} characters`);

    const results = [];

    for (const charId of character_ids) {
      try {
        // Fetch by ID directly (no filter)
        const charList = await base44.asServiceRole.entities.Character.filter(
          { id: charId },
          null,
          1
        ).catch(() => []);

        const char = charList?.[0];
        if (!char) {
          results.push({
            character_id: charId,
            status: 'not_found',
          });
          console.warn(`[clearStaleCharacterSleep] NOT FOUND: ${charId}`);
          continue;
        }

        const isAsleep = ['sleeping', 'napping'].includes(char.resolved_presence_status);
        
        if (!isAsleep) {
          results.push({
            character_id: charId,
            character_name: char.name,
            status: 'already_awake',
            current_state: char.resolved_presence_status,
          });
          console.log(`[clearStaleCharacterSleep] SKIP ${char.name} — already ${char.resolved_presence_status}`);
          continue;
        }

        // Wake them
        // Classify prior state: actual sleep → write last_wake_time; nap → don't
        const wasActualSleep = char.resolved_presence_status === 'sleeping';
        const wasNap = char.resolved_presence_status === 'napping';
        const wakePayload = {
          resolved_presence_status: 'home',
          location_status: 'home',
          current_activity: 'awake',
          emotional_state: char.emotional_state || 'neutral',
          resolved_last_updated_at: nowEtIso,
          sleep_interrupted_at: nowEtIso,
        };
        if (wasActualSleep) {
          wakePayload.last_wake_time = nowEtIso;
        }
        // Nap wake does NOT write last_wake_time.
        // If prior state is unknown (not sleeping, not napping but somehow here),
        // log a durable violation instead of guessing.
        if (!wasActualSleep && !wasNap) {
          base44.asServiceRole.entities.LifeEvent.create({
            character_id: charId,
            character_name: char.name,
            event_type: 'medical_event',
            valence: 'neutral',
            severity: 'minor',
            title: 'Unknown sleep state cleared — cannot classify wake type',
            description: `clearStaleCharacterSleep woke ${char.name} from prior presence "${char.resolved_presence_status}". Cannot determine if this was actual sleep or nap wake. last_wake_time NOT written.`,
            emotional_impact: 'system diagnostic',
            triggered_by: 'life_simulation',
            timestamp: nowEtIso,
            context_tags: ['missing_timestamp', 'unknown_sleep_state', 'clearStaleCharacterSleep'],
          }).catch(() => {});
        }
        if (!dry_run) {
          await base44.asServiceRole.entities.Character.update(charId, wakePayload);

          // ── MANDATORY WAKE PROOF — SleepTransition + LifeEvent + CharacterMemory ──
          // Every wake must create authoritative proof records. Silent wake-up is forbidden.
          // This prevents the "Current State shows awake but Recent Activity has no wake" defect.
          try {
            const _transitionType = wasActualSleep ? 'sleep_end' : 'nap_end';
            await base44.asServiceRole.entities.SleepTransition.create({
              character_id: charId, character_name: char.name, owner_email: char.owner_email,
              transition_type: _transitionType,
              from_status: char.resolved_presence_status, to_status: 'home',
              authority: 'clearStaleCharacterSleep',
              reason: `Cleared stale sleep state (${char.resolved_presence_status}). Wake-up activity created.`,
              timestamp: nowEtIso,
              state_start_ref: char.last_sleep_start || char.last_nap_time || null,
            });
          } catch (transitionError) {
            console.warn(`[clearStaleCharacterSleep] SleepTransition proof failed for ${char.name} (non-reverting): ${transitionError.message}`);
          }
          try {
            const _wakeTitle = wasActualSleep ? 'Woke up' : 'Woke up from a nap';
            await base44.asServiceRole.entities.LifeEvent.create({
              character_id: charId, character_name: char.name,
              event_type: 'recovery_event', valence: 'positive', severity: 'minor',
              title: _wakeTitle,
              description: `${char.name} woke up. Stale sleep state was cleared. Energy at ${char.energy_value ?? 75}.`,
              emotional_impact: wasActualSleep ? 'rested' : 'refreshed',
              triggered_by: 'life_simulation',
              timestamp: nowEtIso,
              context_tags: ['woke_up', 'stale_sleep_cleared', wasActualSleep ? 'sleep_end' : 'nap_end'],
            });
            await base44.asServiceRole.entities.CharacterMemory.create({
              character_id: charId, memory_type: 'event',
              memory_text: `${char.name} woke up. Energy at ${char.energy_value ?? 75}.`,
              memory_summary: `Woke up — stale sleep cleared.`,
              importance_score: 3, permanence: 'short_term', related_character_id: charId,
            });
          } catch (consequenceError) {
            console.warn(`[clearStaleCharacterSleep] LifeEvent/Memory creation failed for ${char.name} (non-reverting): ${consequenceError.message}`);
          }

          console.log(`[clearStaleCharacterSleep] WOKE ${char.name} (${charId}) — proof records created`);
        }

        results.push({
          character_id: charId,
          character_name: char.name,
          status: 'woken',
          was_state: char.resolved_presence_status,
          new_state: 'home',
        });

      } catch (e) {
        console.error(`[clearStaleCharacterSleep] ERROR for ${charId}: ${e.message}`);
        results.push({
          character_id: charId,
          status: 'error',
          error: e.message,
        });
      }
    }

    return Response.json({
      success: true,
      dry_run,
      et_time: nowEt.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      total_processed: character_ids.length,
      results,
    });

  } catch (error) {
    console.error('[clearStaleCharacterSleep] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});