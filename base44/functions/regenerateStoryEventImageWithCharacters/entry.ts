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

    // ── LOAD ALL VISIBLE CHARACTERS (NO TYPE RESTRICTION) ──────────────────
    // Service role lookup by ID only — no owner_email filter.
    // NPC family members, NPC fictitious, and world service characters
    // may have different owner_emails than the event owner.
    const charById = {};
    const refImages = [];
    const visibleNames = [];
    const visibleTypes = [];
    const lookupStatusByChar = {};

    for (const cid of visible_character_ids) {
      try {
        // Direct ID lookup — service role can see all characters
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) {
          const c = chars[0];
          charById[cid] = c;
          visibleNames.push(c.name || c.display_name || cid);
          visibleTypes.push(c.character_type || 'active_created_character');

          // Collect all reference image sources
          const charRefImages = [];
          if (c.avatar_url && typeof c.avatar_url === 'string') charRefImages.push(c.avatar_url);
          if (c.image_avatar_url && typeof c.image_avatar_url === 'string') charRefImages.push(c.image_avatar_url);
          if (Array.isArray(c.reference_image_urls)) {
            c.reference_image_urls.forEach(url => {
              if (url && typeof url === 'string') charRefImages.push(url);
            });
          }

          // Per-character reference lookup status
          if (charRefImages.length > 0) {
            refImages.push(...charRefImages);
            lookupStatusByChar[cid] = 'resolved';
          } else {
            lookupStatusByChar[cid] = 'reference_lookup_failed';
          }
        } else {
          // Character ID from StoryEvent but not found in Character records
          visibleNames.push(cid);
          visibleTypes.push('unknown');
          lookupStatusByChar[cid] = 'character_not_found';
        }
      } catch (_) {
        visibleNames.push(cid);
        visibleTypes.push('unknown');
        lookupStatusByChar[cid] = 'character_not_found';
      }
    }

    // Build appearance context ONLY from resolved characters
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

    // Honest lookup tracking
    const anyReferenceLookupFailed = Object.values(lookupStatusByChar).some(s => s === 'reference_lookup_failed');
    const anyCharacterNotFound = Object.values(lookupStatusByChar).some(s => s === 'character_not_found');
    const allResolved = !anyReferenceLookupFailed && !anyCharacterNotFound;

    const lookupDiagnostic = !allResolved
      ? `partial_lookup: ${Object.entries(lookupStatusByChar).filter(([,s]) => s !== 'resolved').map(([cid, s]) => `${cid}=${s}`).join(', ')}`
      : 'all_characters_resolved_with_references';

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

    // Update the StoryEventImage record with all required fields
    await base44.asServiceRole.entities.StoryEventImage.update(image_id, {
      image_url: imageRes.url,
      prompt: regenPrompt,
      visible_character_ids: visible_character_ids,
      visible_character_names: visibleNames,
      visible_character_types: visibleTypes,
      reference_image_urls: dedupedRefs,
      reference_lookup_status_by_character: lookupStatusByChar,
      regeneration_reason: allReasons.join(', ') || 'character_selection_update',
      description: lookupDiagnostic,
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
        visible_character_types: visibleTypes,
        venue_id: event.venue_id,
        venue_name: venueName,
        regeneration_parent_image_id: image_id,
        regeneration_reasons: allReasons,
        scene_prompt: regenPrompt,
        character_reference_images: dedupedRefs.slice(0, 5),
        reference_lookup_status_by_character: lookupStatusByChar,
        subjects: visible_character_ids.map(cid => ({
          subject_type: 'character',
          subject_id: cid,
          subject_name: charById[cid]?.name || cid,
          subject_character_type: charById[cid]?.character_type || 'unknown',
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
      visible_character_types: visibleTypes,
      reference_image_urls: dedupedRefs,
      reference_lookup_status_by_character: lookupStatusByChar,
      lookup_diagnostic: lookupDiagnostic,
      reference_lookup_failed_count: Object.values(lookupStatusByChar).filter(s => s === 'reference_lookup_failed').length,
      character_not_found_count: Object.values(lookupStatusByChar).filter(s => s === 'character_not_found').length,
    });
  } catch (error) {
    console.error('[regenerateStoryEventImageWithCharacters]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});