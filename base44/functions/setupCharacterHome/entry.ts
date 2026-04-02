import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let characterId, characterName;
    const body = await req.json();
    
    // Support both direct params and automation payload format
    if (body.event) {
      // Automation trigger format
      characterId = body.data?.id;
      characterName = body.data?.name;
    } else {
      // Direct function call format
      characterId = body.characterId;
      characterName = body.characterName;
    }

    if (!characterId || !characterName) {
      return Response.json({ error: 'characterId and characterName required' }, { status: 400 });
    }

    // Check if character already has a financial record
    const existingFinancial = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    );
    if (existingFinancial.length > 0) {
      return Response.json({ success: false, message: 'Financial record already exists' });
    }

    // CRITICAL: No auto-creation of home locations
    // Users must explicitly create locations via the Locations page
    // This function no longer generates generic homes
    
    return Response.json({
      success: false,
      error: 'No home location assigned. User must create a location explicitly via the Locations page.',
      characterId,
      characterName,
    }, { status: 400 });
  } catch (error) {
    console.error('[setupCharacterHome]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});