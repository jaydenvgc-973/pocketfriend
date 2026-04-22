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

    const updateData = {};
    if (avatarUrl) updateData.avatar_url = avatarUrl;
    if (referenceImageUrls) updateData.reference_image_urls = referenceImageUrls;
    if (avatarGenerationPrompt) updateData.avatar_generation_prompt = avatarGenerationPrompt;
    if (avatarDescriptionText !== undefined) updateData.avatar_description_text = avatarDescriptionText;
    if (voiceEnabled !== undefined) updateData.voice_enabled = voiceEnabled;
    if (voiceName) updateData.voice_name = voiceName;
    if (voiceStyleNote) updateData.voice_style_note = voiceStyleNote;

    // Update with service role to bypass RLS for system-created NPCs
    const updated = await base44.asServiceRole.entities.Character.update(characterId, updateData);

    return Response.json({ success: true, character: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});