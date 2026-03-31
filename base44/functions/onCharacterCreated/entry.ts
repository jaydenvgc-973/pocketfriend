import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Automation trigger: when a new Character is created.
 * Initializes financials with $6,000 starting balance.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const character = payload.data;
    if (!character?.id || !character?.name) {
      return Response.json({ error: 'Invalid character data' }, { status: 400 });
    }

    // Initialize financial record
    const financialResult = await base44.functions.invoke('initializeCharacterFinancials', {
      characterId: character.id,
      characterName: character.name,
      isNpc: false,
      homeLocationId: null,
      homeLocationName: null,
    });

    console.log(`[onCharacterCreated] Financial record initialized for ${character.name}:`, financialResult);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[onCharacterCreated]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});