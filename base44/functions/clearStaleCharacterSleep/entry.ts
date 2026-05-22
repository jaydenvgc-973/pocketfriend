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
        if (!dry_run) {
          await base44.asServiceRole.entities.Character.update(charId, {
            resolved_presence_status: 'home',
            location_status: 'home',
            current_activity: 'awake',
            emotional_state: char.emotional_state || 'neutral',
            resolved_last_updated_at: nowEtIso,
            sleep_interrupted_at: nowEtIso,
          });

          console.log(`[clearStaleCharacterSleep] WOKE ${char.name} (${charId})`);
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