import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * onCharacterCreated
 * 
 * Entity automation trigger: fires when a new Character is created.
 * Immediately charges VGC Mobile bill for the new character.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { data: character } = await req.json();

    if (!character || !character.id) {
      return Response.json({ error: 'No character data in payload' }, { status: 400 });
    }

    // Skip if not an active created character
    if (character.character_type !== 'active' || character.status !== 'active') {
      return Response.json({ success: true, skipped: true, reason: 'Not an active character' });
    }

    // Charge VGC Mobile immediately
    try {
      await base44.asServiceRole.functions.invoke('chargeVGCMobileBill', {
        characterId: character.id,
        billingMonth: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      });
    } catch (chargeErr) {
      console.error('[onCharacterCreated] Failed to charge VGC Mobile:', chargeErr.message);
      // Don't fail the entire hook if billing fails — character still created
    }

    return Response.json({ success: true, characterId: character.id });
  } catch (error) {
    console.error('[onCharacterCreated]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});