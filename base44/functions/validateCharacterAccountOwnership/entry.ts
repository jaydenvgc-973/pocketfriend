import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const characterId = body.characterId;

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Fetch the character
    const chars = await base44.entities.Character.filter({ id: characterId });
    const character = chars[0];

    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // STRICT: Character must be owned by the authenticated user
    const isOwned = character.created_by === user.email || character.owner_email === user.email;

    if (!isOwned) {
      // This is a CRITICAL security violation—log and reject
      console.error(`ACCOUNT ISOLATION BREACH ATTEMPT: User ${user.email} tried to access character ${characterId} owned by ${character.created_by}`);
      return Response.json({ 
        error: 'Character does not belong to your account',
        blocked: true
      }, { status: 403 });
    }

    // Character is owned by user—safe to serve
    return Response.json({
      success: true,
      verified: true,
      characterId,
      characterName: character.name,
      ownerEmail: character.created_by
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});