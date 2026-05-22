/**
 * wakeStaleCharactersByName
 * 
 * WORKAROUND for characters stuck in query visibility limbo.
 * Uses owner_email + name lookup instead of ID lookup.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_names = [], dry_run = false } = await req.json();
    const nowEtIso = new Date().toISOString();

    console.log(`[wakeStaleCharactersByName] START (dry_run=${dry_run}, owner=${user.email})`);

    // Fetch ALL characters for this owner
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email },
      null,
      500
    ).catch(err => {
      console.error(`Fetch failed: ${err.message}`);
      return [];
    });

    console.log(`[wakeStaleCharactersByName] Fetched ${allChars.length} characters for ${user.email}`);

    const results = [];

    for (const name of character_names) {
      const char = allChars.find(c => c.name === name || c.display_name === name);

      if (!char) {
        results.push({ name, status: 'not_found' });
        console.warn(`[wakeStaleCharactersByName] NOT FOUND: ${name}`);
        continue;
      }

      const isAsleep = ['sleeping', 'napping'].includes(char.resolved_presence_status);

      if (!isAsleep) {
        results.push({
          name,
          character_id: char.id,
          status: 'already_awake',
          current_state: char.resolved_presence_status,
        });
        console.log(`[wakeStaleCharactersByName] SKIP ${name} — already ${char.resolved_presence_status}`);
        continue;
      }

      if (!dry_run) {
        await base44.asServiceRole.entities.Character.update(char.id, {
          resolved_presence_status: 'home',
          location_status: 'home',
          current_activity: 'awake',
          resolved_last_updated_at: nowEtIso,
          sleep_interrupted_at: nowEtIso,
        });
        console.log(`[wakeStaleCharactersByName] WOKE ${name} (${char.id})`);
      }

      results.push({
        name,
        character_id: char.id,
        status: 'woken',
        was_state: char.resolved_presence_status,
      });
    }

    return Response.json({
      success: true,
      dry_run,
      user_email: user.email,
      total_processed: character_names.length,
      results,
    });

  } catch (error) {
    console.error('[wakeStaleCharactersByName] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});