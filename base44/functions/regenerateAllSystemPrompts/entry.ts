import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * regenerateAllSystemPrompts
 * 
 * IMPORTANT: System prompts are now user-specific (they include the user's fictional_world_name).
 * Storing them as cached files (system_prompt_url) is WRONG because:
 * 1. The user's name would be baked into a file accessible to all users
 * 2. The cached name becomes stale when the user changes their world name
 * 
 * This function now CLEARS all system_prompt_url fields, forcing every character
 * to build their prompt live (in buildSystemPrompt) with the correct user's name each time.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const characters = await base44.asServiceRole.entities.Character.list();
    const active = characters.filter(c => c.status !== 'deleted' && c.system_prompt_url);

    let cleared = 0;
    for (const char of active) {
      await base44.asServiceRole.entities.Character.update(char.id, { system_prompt_url: null });
      cleared++;
    }

    return Response.json({ 
      success: true, 
      cleared,
      message: `Cleared ${cleared} cached system_prompt_url fields. Prompts will now build live with correct user identity on each chat turn.`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});