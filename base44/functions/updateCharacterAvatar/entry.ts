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

    // AUTHORIZATION: Fetch character with service role to bypass RLS read issues
    const character = await base44.asServiceRole.entities.Character.read(characterId);
    if (!character) {
      console.log(`[updateCharacterAvatar] Character not found: ${characterId}`);
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // OWNERSHIP RULE: Edit rights follow ownership, NOT created_by.
    // created_by is creator metadata only. A service account may create records on
    // behalf of a user — that does not strip the user of edit rights over their own character.
    //
    // Priority order:
    //   1. owner_email match  — explicit ownership field (primary)
    //   2. owner_user_id match — explicit ownership by user ID (primary)
    //   3. created_by match   — user created it themselves (fallback for legacy records)
    const ownerEmail = character.owner_email;
    const ownerUserId = character.owner_user_id;
    const createdBy = character.created_by;

    const ownsViaEmail = ownerEmail && ownerEmail === user.email;
    const ownsViaUserId = ownerUserId && ownerUserId === user.id;
    const ownsViaCreatedBy = createdBy && createdBy === user.email;
    const ownsCharacter = ownsViaEmail || ownsViaUserId || ownsViaCreatedBy;

    console.log(`[updateCharacterAvatar] AuthCheck — User: ${user.email} (id: ${user.id})`);
    console.log(`[updateCharacterAvatar] Character: ${characterId} | owner_email: ${ownerEmail} | owner_user_id: ${ownerUserId} | created_by: ${createdBy}`);
    console.log(`[updateCharacterAvatar] Ownership match — via owner_email: ${ownsViaEmail}, via owner_user_id: ${ownsViaUserId}, via created_by: ${ownsViaCreatedBy}`);
    console.log(`[updateCharacterAvatar] Decision: ${ownsCharacter ? 'ALLOWED (ownership confirmed)' : 'DENIED (no ownership match)'}`);

    if (!ownsCharacter) {
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