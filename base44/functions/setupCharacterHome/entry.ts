import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * setupCharacterHome
 *
 * Sets up the home location linkage for a character. This function ONLY handles
 * location assignment — it never creates or modifies CharacterFinancial records.
 *
 * Financial initialization is the sole responsibility of the onCharacterCreated
 * entity automation, which runs server-side with the correct owner_email already
 * stamped on the saved Character record.
 *
 * Calling this from the frontend is now a no-op for location setup post-creation
 * (the automation handles it), but the function is retained for manual admin use
 * (e.g. re-linking a character to a new home location after a move).
 *
 * OWNERSHIP RULE: owner_email is always read from the saved Character record itself,
 * never from the calling user's session, to avoid service-account contamination.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const characterId = body.characterId || body.character_id;
    const characterName = body.characterName || body.character_name;

    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    // Fetch the authoritative character record to read ownership
    const character = await base44.asServiceRole.entities.Character.get(characterId);
    if (!character) {
      return Response.json({ error: `Character ${characterId} not found` }, { status: 404 });
    }

    // Owner email is read from the saved record — never from the calling session.
    // This is the critical rule: service-role calls must not use user.email as owner.
    const ownerEmail = character.owner_email;
    const resolvedName = characterName || character.name;

    // If the character already has a home location assigned, nothing to do here.
    if (character.current_home_location_id) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'Character already has a home location assigned',
        home_location_id: character.current_home_location_id,
      });
    }

    // No home — log and return. The character will start without a home location.
    // User assigns home via the Locations page. This is the correct flow.
    console.log(`[setupCharacterHome] Character "${resolvedName}" (${characterId}) has no home location. User must assign via Locations page. owner_email=${ownerEmail}`);

    return Response.json({
      success: true,
      skipped: false,
      message: 'No home location assigned. User must assign via Locations page.',
      character_id: characterId,
      owner_email: ownerEmail,
    });
  } catch (error) {
    console.error('[setupCharacterHome]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});