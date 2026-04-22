import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, avatarUrl, referenceImageUrls, avatarGenerationPrompt, avatarDescriptionText, voiceEnabled, voiceName, voiceStyleNote } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    // AUTHORIZATION: Fetch character and verify ownership
    const character = await base44.asServiceRole.entities.Character.read(characterId);
    if (!character) {
      console.log(`[updateCharacterAvatar] Character not found: ${characterId}`);
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Ownership check: user must own the character
    const ownsCharacter = 
      character.owner_email === user.email || 
      character.created_by === user.email ||
      character.owner_user_id === user.id;

    console.log(`[updateCharacterAvatar] Authorization check - User: ${user.email}, CharID: ${characterId}, OwnerEmail: ${character.owner_email}, CreatedBy: ${character.created_by}, Owns: ${ownsCharacter}`);

    if (!ownsCharacter) {
      console.log(`[updateCharacterAvatar] DENIED - User does not own character`);
      return Response.json({ error: 'Forbidden: You do not own this character' }, { status: 403 });
    }

    // Build update payload
    const updateData = {};
    if (avatarUrl) updateData.avatar_url = avatarUrl;
    if (referenceImageUrls) updateData.reference_image_urls = referenceImageUrls;
    if (avatarGenerationPrompt) updateData.avatar_generation_prompt = avatarGenerationPrompt;
    if (avatarDescriptionText !== undefined) updateData.avatar_description_text = avatarDescriptionText;
    if (voiceEnabled !== undefined) updateData.voice_enabled = voiceEnabled;
    if (voiceName) updateData.voice_name = voiceName;
    if (voiceStyleNote) updateData.voice_style_note = voiceStyleNote;

    // Ensure owner_email is set (fixes legacy records)
    if (!character.owner_email) {
      updateData.owner_email = user.email;
      console.log(`[updateCharacterAvatar] Setting owner_email for legacy character: ${user.email}`);
    }

    // Update with service role to support user-owned service-created records
    const updated = await base44.asServiceRole.entities.Character.update(characterId, updateData);
    console.log(`[updateCharacterAvatar] SUCCESS - Updated character ${characterId} for user ${user.email}`);

    return Response.json({ success: true, character: updated });
  } catch (error) {
    console.error(`[updateCharacterAvatar] ERROR: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});