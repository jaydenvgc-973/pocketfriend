import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { story_event_id, image_id, reason } = body;
    if (!story_event_id || !image_id) {
      return Response.json({ error: 'story_event_id and image_id are required' }, { status: 400 });
    }

    // Fetch the StoryEvent
    const events = await base44.asServiceRole.entities.StoryEvent.filter({ id: story_event_id }, null, 1);
    const event = events[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    // Fetch the existing image record
    const existingImages = await base44.asServiceRole.entities.StoryEventImage.filter({ id: image_id }, null, 1);
    const existingImage = existingImages[0];
    if (!existingImage) return Response.json({ error: 'StoryEventImage not found' }, { status: 404 });

    const momentType = existingImage.moment_type;
    const originalPrompt = existingImage.prompt || '';
    const originalDescription = existingImage.description || '';

    // Load character identity data from the StoryEvent participants
    const participantIds = event.participant_character_ids || [];
    const focusIds = event.focus_character_ids || [];
    const allIds = [...new Set([...focusIds, ...participantIds])];

    const characterRefImages = [];
    const charById = {};

    for (const cid of allIds) {
      try {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) {
          charById[cid] = chars[0];
          const c = chars[0];
          if (c.avatar_url) characterRefImages.push(c.avatar_url);
          if (c.image_avatar_url) characterRefImages.push(c.image_avatar_url);
          if (Array.isArray(c.reference_image_urls)) {
            c.reference_image_urls.forEach(url => { if (url) characterRefImages.push(url); });
          }
        }
      } catch (_) {}
    }

    // Focus character refs first
    const focusRefImages = [];
    for (const cid of focusIds) {
      const c = charById[cid];
      if (!c) continue;
      if (c.avatar_url) focusRefImages.push(c.avatar_url);
      if (c.image_avatar_url) focusRefImages.push(c.image_avatar_url);
      if (Array.isArray(c.reference_image_urls)) {
        c.reference_image_urls.forEach(url => { if (url) focusRefImages.push(url); });
      }
    }

    // Build the regeneration prompt — enhanced for better identity
    const venueName = event.venue_name || 'the event venue';
    const reasonNote = reason === 'flawed' ? 'Fix image flaws — body morphing, layout errors, distortions.'
      : reason === 'does_not_look_like_them' ? 'Strengthen character likeness — use reference images more strictly.'
      : reason === 'location_incorrect' ? 'Adjust venue/background to better match the actual setting.'
      : 'Regenerate with improved quality.';

    // Build character appearance context for the image prompt
    const visibleCharIds = momentType === 'opening' ? allIds.slice(0, 3)
      : momentType === 'key_moment' ? focusIds.length > 0 ? focusIds : allIds.slice(0, 2)
      : allIds.slice(0, 2);

    const appearanceContext = visibleCharIds.map(cid => {
      const c = charById[cid];
      if (!c) return '';
      const parts = [];
      if (c.appearance_notes) parts.push(c.appearance_notes);
      if (c.appearance_lock && typeof c.appearance_lock === 'object') {
        const al = c.appearance_lock;
        if (al.skin_tone) parts.push(`skin: ${al.skin_tone}`);
        if (al.hair_type) parts.push(`hair: ${al.hair_type}`);
        if (al.hairstyle) parts.push(`hairstyle: ${al.hairstyle}`);
        if (al.clothing_style) parts.push(`clothing: ${al.clothing_style}`);
        if (al.overall_aesthetic) parts.push(`aesthetic: ${al.overall_aesthetic}`);
      }
      return `${c.name}: ${parts.join(', ')}`;
    }).filter(Boolean).join(' | ');

    const regenPrompt = [
      originalPrompt,
      '',
      `REGENERATION REASON: ${reasonNote}`,
      '',
      `CHARACTER APPEARANCE (MUST MATCH — NO GENERIC PEOPLE):`,
      appearanceContext || 'Use reference images for character identity.',
      '',
      `VENUE: ${venueName}`,
      `MOMENT: ${momentType.replace('_', ' ')}`,
      `EVENT: ${event.title}`,
    ].join('\n');

    // Deduplicate and limit reference images
    const refImages = [...focusRefImages, ...characterRefImages]
      .filter((url, i, arr) => arr.indexOf(url) === i)
      .slice(0, 10);

    // Regenerate the image
    const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: regenPrompt,
      existing_image_urls: refImages.length > 0 ? refImages : undefined,
    });

    if (!imageRes?.url) {
      return Response.json({ error: 'Image generation failed — no URL returned' }, { status: 500 });
    }

    // Update the StoryEventImage record with new URL
    await base44.asServiceRole.entities.StoryEventImage.update(image_id, {
      image_url: imageRes.url,
      prompt: regenPrompt,
      description: originalDescription,
    });

    // Create a new Message record for Media Gallery visibility
    const messageRecord = await base44.asServiceRole.entities.Message.create({
      conversation_id: `story_event_${story_event_id}`,
      sender_type: 'user',
      content: '',
      image_url: imageRes.url,
      image_description: regenPrompt,
      image_analysis_status: 'complete',
      generation_context: {
        source: 'story_event',
        story_event_id,
        event_title: event.title,
        event_date: event.event_date,
        moment_type: momentType,
        participant_character_ids: participantIds,
        focus_character_ids: focusIds,
        venue_id: event.venue_id,
        venue_name: venueName,
        regeneration_parent_image_id: image_id,
        regeneration_reason: reason,
        scene_prompt: regenPrompt,
        original_raw_prompt: originalPrompt,
        subjects: visibleCharIds.map(cid => ({
          subject_type: 'character',
          subject_id: cid,
          subject_name: charById[cid]?.name || cid,
        })),
        character_reference_images: refImages.slice(0, 5),
      },
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      image_id,
      new_url: imageRes.url,
      message_id: messageRecord?.id || null,
    });
  } catch (error) {
    console.error('[regenerateStoryEventImage]', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});