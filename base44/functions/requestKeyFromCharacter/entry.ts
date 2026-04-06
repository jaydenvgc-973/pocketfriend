import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Request a home key from a character.
 * Decision is based on their relationship with the user.
 * Requires: characterId
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Get the character
    const character = await base44.entities.Character.get(characterId);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Get relationship state with user
    const relState = await base44.entities.RelationshipState.get(characterId).catch(() => null);
    
    if (!relState) {
      return Response.json({ 
        success: false, 
        agreed: false,
        message: `${character.name} doesn't know you well enough yet.` 
      });
    }

    // Evaluate key granting based on relationship scores
    // If friendship + trust > 120, character agrees
    // If friendship + trust < 80, character refuses
    // Otherwise 60/40 chance
    const friendship = relState.friendship_score || 50;
    const trust = relState.trust_score || 50;
    const combined = friendship + trust;

    let agreed = false;
    let response = "";

    if (combined > 120) {
      agreed = true;
      response = `"Of course! I trust you completely. Here's my key."`;
    } else if (combined < 80) {
      agreed = false;
      response = `"I appreciate the thought, but I'm not ready for that yet."`;
    } else {
      // Random chance between 40-60%
      agreed = Math.random() < 0.5;
      response = agreed 
        ? `"You know what? I think I'm ready to trust you with this. Here you go."`
        : `"I'm not quite there yet. Maybe later."`;
    }

    // If agreed, actually grant the key
    if (agreed) {
      await base44.functions.invoke('grantHomeKey', {
        action: 'grant',
        characterId: characterId,
        locationId: character.current_home_location_id,
      });
    }

    return Response.json({
      success: true,
      agreed,
      message: response,
      characterName: character.name,
    });
  } catch (error) {
    console.error('[requestKeyFromCharacter]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});