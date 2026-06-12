import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { story_event_id, image_id, visible_character_ids, reasons } = body;
    if (!story_event_id || !image_id) {
      return Response.json({ error: 'story_event_id and image_id required' }, { status: 400 });
    }
    if (!visible_character_ids || !Array.isArray(visible_character_ids) || visible_character_ids.length === 0) {
      return Response.json({ error: 'visible_character_ids required — at least one character must be visible' }, { status: 400 });
    }

    const allReasons = Array.isArray(reasons) && reasons.length > 0 ? reasons : [];

    // Fetch StoryEvent
    const events = await base44.asServiceRole.entities.StoryEvent.filter({ id: story_event_id }, null, 1);
    const event = events[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    // Fetch existing image
    const existingImages = await base44.asServiceRole.entities.StoryEventImage.filter({ id: image_id }, null, 1);
    const existingImage = existingImages[0];
    if (!existingImage) return Response.json({ error: 'StoryEventImage not found' }, { status: 404 });

    const momentType = existingImage.moment_type;
    const originalPrompt = existingImage.prompt || '';
    const venueName = event.venue_name || 'the event venue';

    // Load ONLY the selected visible characters
    const charById = {};
    const refImages = [];
    const visibleNames = [];

    const ownerEmail = event.owner_email;
    for (const cid of visible_character_ids) {
      try {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid, owner_email: ownerEmail }, null, 1);
        if (chars[0]) {
          const c = chars[0];
          charById[cid] = c;
          visibleNames.push(c.name || c.display_name || cid);

          // Collect reference images
          if (c.avatar_url && typeof c.avatar_url === 'string') refImages.push(c.avatar_url);
          if (c.image_avatar_url && typeof c.image_avatar_url === 'string') refImages.push(c.image_avatar_url);
          if (Array.isArray(c.reference_image_urls)) {
            c.reference_image_urls.forEach(url => {
              if (url && typeof url === 'string') refImages.push(url);
            });
          }
        }
      } catch (_) {}
    }

    // Build appearance context ONLY from selected characters
    const appearanceParts = visible_character_ids.map(cid => {
      const c = charById[cid];
      if (!c) return '';
      const parts = [];
      if (c.appearance_notes) parts.push(c.appearance_notes);
      if (c.avatar_description_text) parts.push(c.avatar_description_text);
      if (c.appearance_lock && typeof c.appearance_lock === 'object') {
        const al = c.appearance_lock;
        if (al.skin_tone) parts.push(`skin: ${al.skin_tone}`);
        if (al.hair_type) parts.push(`hair: ${al.hair_type}`);
        if (al.hairstyle) parts.push(`hairstyle: ${al.hairstyle}`);
        if (al.facial_hair) parts.push(`facial hair: ${al.facial_hair}`);
        if (al.clothing_style) parts.push(`clothing: ${al.clothing_style}`);
        if (al.overall_aesthetic) parts.push(`aesthetic: ${al.overall_aesthetic}`);
      }
      if (c.style_identity && !parts.some(p => p.includes(c.style_identity))) {
        parts.push(`style: ${c.style_identity}`);
      }
      return `${c.name || cid}: ${parts.join(', ')}`;
    }).filter(Boolean).join(' | ');

    // Deduplicate ref images
    const dedupedRefs = refImages.filter((url, i, arr) => arr.indexOf(url) === i).slice(0, 10);

    // Build regeneration prompt
    const reasonText = allReasons.length > 0
      ? `REGENERATION REASONS: ${allReasons.join(', ')}.`
      : 'Regenerating with selected characters.';

    const regenPrompt = [
      originalPrompt,
      '',
      reasonText,
      '',
      `VISIBLE CHARACTERS (ONLY THESE — NO GENERIC STRANGERS OR SUBSTITUTES):`,
      visibleNames.join(', '),
      '',
      `CHARACTER APPEARANCE (MUST MATCH EXACTLY — USE REFERENCE IMAGES):`,
      appearanceParts || 'Use reference images for character identity.',
      '',
      `VENUE: ${venueName}`,
      `MOMENT: ${momentType.replace('_', ' ')}`,
      `EVENT: ${event.title}`,
      `DATE: ${event.event_date}`,
    ].join('\n');

    // Generate image
    const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: regenPrompt,
      existing_image_urls: dedupedRefs.length > 0 ? dedupedRefs : undefined,
    });

    if (!imageRes?.url) {
      return Response.json({ error: 'Image generation failed — no URL returned' }, { status: 500 });
    }

    // Update the StoryEventImage record
    await base44.asServiceRole.entities.StoryEventImage.update(image_id, {
      image_url: imageRes.url,
      prompt: regenPrompt,
      visible_character_ids: visible_character_ids,
      visible_character_names: visibleNames,
      reference_image_urls: dedupedRefs,
      regeneration_reason: allReasons.join(', ') || 'character_selection_update',
    });

    // Create Message for Media Gallery
    await base44.asServiceRole.entities.Message.create({
      conversation_id: `story_event_${story_event_id}`,
      sender_type: 'user',
      content: '',
      image_url: imageRes.url,
      image_description: regenPrompt,
      image_analysis_status: 'complete',
      generation_context: {
        source: 'story_event_regen',
        story_event_id,
        event_title: event.title,
        event_date: event.event_date,
        moment_type: momentType,
        visible_character_ids,
        visible_character_names: visibleNames,
        venue_id: event.venue_id,
        venue_name: venueName,
        regeneration_parent_image_id: image_id,
        regeneration_reasons: allReasons,
        scene_prompt: regenPrompt,
        character_reference_images: dedupedRefs.slice(0, 5),
        subjects: visible_character_ids.map(cid => ({
          subject_type: 'character',
          subject_id: cid,
          subject_name: charById[cid]?.name || cid,
        })),
      },
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      image_id,
      new_url: imageRes.url,
      visible_character_ids,
      visible_character_names: visibleNames,
      reference_image_urls: dedupedRefs,
    });
  } catch (error) {
    console.error('[regenerateStoryEventImageWithCharacters]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});