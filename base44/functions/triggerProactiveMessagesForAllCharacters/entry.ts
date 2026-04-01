import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * triggerProactiveMessagesForAllCharacters
 * 
 * Orchestrator: calls sendProactiveMessageForCharacter for each active character
 * with staggered random timing (not synchronized).
 * 
 * Called every 30 minutes by automation.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all active characters
    const characters = await base44.entities.Character.filter({
      status: 'active',
    });

    const results = [];

    // Randomly pick 1-2 characters to message this cycle (staggered, not synchronized)
    const numToMessage = Math.random() < 0.7 ? 1 : 2;
    const shuffled = characters.sort(() => Math.random() - 0.5);
    const toMessage = shuffled.slice(0, numToMessage);

    for (const char of toMessage) {
      const res = await base44.functions.invoke('sendProactiveMessageForCharacter', {
        characterId: char.id,
      });

      results.push({
        characterId: char.id,
        characterName: char.name,
        status: res?.data?.success ? 'sent' : 'skipped',
        reason: res?.data?.reason || 'unknown',
        content: res?.data?.content,
      });
    }

    return Response.json({
      success: true,
      cycle: new Date().toISOString(),
      messagesAttempted: toMessage.length,
      results,
    });
  } catch (error) {
    console.error('[triggerProactiveMessagesForAllCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});