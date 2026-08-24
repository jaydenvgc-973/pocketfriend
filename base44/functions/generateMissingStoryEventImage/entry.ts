import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── PARTICIPANT NAME REFERENCE KEY (inlined — Deno sandbox cannot import local files) ──
function buildParticipantNameReferenceKeyBlock(participants) {
  if (!participants || participants.length === 0) return '';
  const lines = [];
  lines.push(`[NAME REFERENCE KEY — SELECTED PARTICIPANTS]`);
  lines.push(`Every name in the scene prompt maps to exactly one visual identity bundle below.`);
  lines.push(`Do NOT infer any appearance, gender, outfit, or body from a name alone.`);
  lines.push(`Do NOT assign any subject's attributes to a different subject.`);
  lines.push(``);
  for (const p of participants) {
    const displayName = p.display_name || 'Unknown';
    const promptName = p.matched_prompt_name || displayName.split(/\s+/)[0];
    if (p.participant_type === 'user') {
      const userIdValue = p.user_id || 'authenticated_user';
      lines.push(`"${promptName}" = ${displayName} (User ID: ${userIdValue}) — use their visual identity references`);
    } else {
      const charIdValue = p.character_id || 'character';
      lines.push(`"${promptName}" = ${displayName} (Character ID: ${charIdValue}) — use their visual identity references`);
    }
  }
  lines.push(`[END NAME REFERENCE KEY]`);
  return `\n════════════════════════════════════════════════════════════\n${lines.join('\n')}\n════════════════════════════════════════════════════════════\n`;
}

// ── URL UTILITIES (inlined) ───────────────────────────────────────────────────
function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

function cdnFilter(urls) {
  return (urls || []).map(toPublicCDN).filter(isAccessible);
}

function resolveCharacterRefImages(charRecord) {
  if (!charRecord) return [];
  const allRefs = cdnFilter(charRecord.reference_image_urls || []);
  const validRefs = allRefs.filter(url => !url.includes('generated_image'));
  if (validRefs.length > 0) return validRefs.slice(0, 3);
  if (charRecord.avatar_url) {
    const avatarPublic = toPublicCDN(charRecord.avatar_url);
    const isCDN = avatarPublic.startsWith('https://media.base44.com/');
    if (isAccessible(avatarPublic) && (isCDN || !avatarPublic.includes('generated_image'))) {
      return [avatarPublic];
    }
  }
  if (charRecord.image_avatar_url) {
    const imgAvatar = toPublicCDN(charRecord.image_avatar_url);
    if (isAccessible(imgAvatar)) return [imgAvatar];
  }
  return [];
}

// ── USER IDENTITY LOCK (inlined) ──────────────────────────────────────────────
function buildUserIdentityLockBlock(userBundle) {
  if (!userBundle || userBundle.participant_type !== 'user') return '';
  const lines = [];
  const worldName = userBundle.display_name || 'the User';
  const promptName = userBundle.matched_prompt_name || 'User';
  const userId = userBundle.user_id || 'authenticated_user';

  lines.push(`════════════════════════════════════════════════════════════`);
  lines.push(`🔒 USER IDENTITY LOCK — ZERO-DRIFT ENFORCEMENT`);
  lines.push(`════════════════════════════════════════════════════════════`);
  lines.push(`The participant "${promptName}" is the AUTHENTICATED USER of this world.`);
  lines.push(`They are a real visual subject in this scene — NOT a generic bystander.`);
  lines.push(`Their likeness MUST appear in this image with the EXACT identity profile below.`);
  lines.push(``);
  lines.push(`USER IDENTITY ANCHOR:`);
  lines.push(`  World Name: ${worldName}`);
  lines.push(`  User ID: ${userId}`);
  if (userBundle.gender) lines.push(`  Gender: ${userBundle.gender}`);
  if (userBundle.culture) lines.push(`  Culture: ${userBundle.culture}`);
  if (userBundle.race) lines.push(`  Race: ${userBundle.race}`);

  const al = userBundle.appearance_lock;
  if (al && typeof al === 'object') {
    lines.push(``);
    lines.push(`USER APPEARANCE LOCK (render these EXACT attributes):`);
    if (al.height_display) lines.push(`  Height: ${al.height_display}`);
    else if (al.height_inches) lines.push(`  Height: ${al.height_inches} inches`);
    if (al.skin_tone) lines.push(`  Skin tone: ${al.skin_tone}`);
    if (al.hair_type) lines.push(`  Hair type: ${al.hair_type}`);
    if (al.hairstyle) lines.push(`  Hairstyle: ${al.hairstyle}`);
    if (al.facial_hair) lines.push(`  Facial hair: ${al.facial_hair}`);
    if (al.clothing_style) lines.push(`  Clothing style: ${al.clothing_style}`);
    if (al.overall_aesthetic) lines.push(`  Overall aesthetic: ${al.overall_aesthetic}`);
  }

  if (userBundle.ref_images && userBundle.ref_images.length > 0) {
    lines.push(``);
    lines.push(`USER VISUAL REFERENCE: ${userBundle.ref_images.length} avatar/reference image(s) attached.`);
    lines.push(`The person "${promptName}" MUST match the face, body, skin color, and hairstyle shown in those reference images.`);
  }

  lines.push(``);
  lines.push(`ENFORCEMENT:`);
  lines.push(`- "${promptName}" MUST be visibly present in this image as a real, rendered person.`);
  lines.push(`- Do NOT omit, replace, or genericize "${promptName}".`);
  lines.push(`════════════════════════════════════════════════════════════`);
  return `\n${lines.join('\n')}\n`;
}

/**
 * generateMissingStoryEventImage
 *
 * Generates a SINGLE missing image moment for an existing COMPLETE Story Event.
 *
 * This is NOT a second image system. It uses the same production pipeline as
 * generateStoryEvent (GenerateImage integration, Name Reference Key, User
 * Identity Lock, diversity law, reference image resolution). The difference:
 * it targets ONE missing moment without touching the parent Story Event status
 * or rerunning any continuity effects (memories, LifeEvents, LocationHistory,
 * participation, narrative injection).
 *
 * Use case: StoryEvent.status === 'complete' but a StoryEventImage record was
 * never created for an intended moment (opening, key_moment, closing).
 *
 * Contract:
 *   - Does NOT change StoryEvent.status (stays 'complete')
 *   - Does NOT rerun memories, LifeEvents, LocationHistory, participation
 *   - Does NOT rerun narrative injection
 *   - Creates a NEW StoryEventImage record for the specified moment
 *   - Creates a Media Gallery Message record (same as generateStoryEvent)
 *   - Uses InvokeLLM to generate a moment-specific image prompt from the
 *     existing narrative (same approach as generateStoryEvent, but focused
 *     on one moment)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { story_event_id, moment_type, visible_character_ids } = body;

    if (!story_event_id || !moment_type) {
      return Response.json({ error: 'story_event_id and moment_type are required' }, { status: 400 });
    }

    const VALID_MOMENTS = ['opening', 'key_moment', 'closing'];
    if (!VALID_MOMENTS.includes(moment_type)) {
      return Response.json({ error: `moment_type must be one of: ${VALID_MOMENTS.join(', ')}` }, { status: 400 });
    }

    // ── LOAD STORY EVENT ──────────────────────────────────────────────────────
    const events = await base44.asServiceRole.entities.StoryEvent.filter({ id: story_event_id }, null, 1);
    const event = events[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    // Verify the event is complete — missing image generation is for complete events only
    if (event.status !== 'complete') {
      return Response.json({
        error: `StoryEvent must be 'complete' to generate missing images (current: ${event.status})`,
      }, { status: 409 });
    }

    // ── IDEMPOTENCY: Check if a StoryEventImage already exists for this moment ──
    const existingImgs = await base44.asServiceRole.entities.StoryEventImage.filter(
      { story_event_id, moment_type }, null, 5
    ).catch(() => []);

    // If a SUCCESSFUL image exists (has image_url), refuse — use regenerate instead
    const existingSuccessful = existingImgs.find(img => img.image_url);
    if (existingSuccessful) {
      return Response.json({
        error: 'Image already exists for this moment. Use regenerateStoryEventImageWithCharacters instead.',
        existing_image_id: existingSuccessful.id,
      }, { status: 409 });
    }

    // If a FAILED record exists (no image_url), we can update it instead of creating a new one
    const existingFailed = existingImgs.find(img => !img.image_url);
    const updateExistingId = existingFailed?.id || null;

    // ── LOAD PARTICIPANT DATA ─────────────────────────────────────────────────
    const ownerEmail = event.owner_email || user.email;
    const focusIds = event.focus_character_ids || [];
    const participantIds = event.participant_character_ids || [];
    const allIds = [...new Set([...focusIds, ...participantIds])];

    const charById = {};
    for (const cid of allIds) {
      try {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) charById[cid] = chars[0];
      } catch (_) {}
    }

    // ── RESOLVE CHARACTER BUNDLES ─────────────────────────────────────────────
    const participantBundles = [];
    for (const cid of allIds) {
      const c = charById[cid];
      if (!c) continue;
      const displayName = c.name || c.display_name || cid;
      const firstName = displayName.split(/\s+/)[0];
      const refImages = resolveCharacterRefImages(c);

      const appearanceParts = [];
      if (c.appearance_notes) appearanceParts.push(c.appearance_notes);
      if (c.avatar_description_text) appearanceParts.push(c.avatar_description_text);
      if (c.appearance_lock && typeof c.appearance_lock === 'object') {
        const al = c.appearance_lock;
        const lockParts = [];
        if (al.skin_tone) lockParts.push(`skin: ${al.skin_tone}`);
        if (al.hair_type) lockParts.push(`hair: ${al.hair_type}`);
        if (al.hairstyle) lockParts.push(`hairstyle: ${al.hairstyle}`);
        if (al.facial_hair) lockParts.push(`facial hair: ${al.facial_hair}`);
        if (al.clothing_style) lockParts.push(`clothing: ${al.clothing_style}`);
        if (al.overall_aesthetic) lockParts.push(`aesthetic: ${al.overall_aesthetic}`);
        if (lockParts.length > 0) appearanceParts.push(lockParts.join(', '));
      }
      if (c.style_identity && !appearanceParts.some(p => p.includes(c.style_identity))) {
        appearanceParts.push(`style: ${c.style_identity}`);
      }

      // ── OUTFIT AUTHORITY: resolveCharacterOutfitContext ────────────────────
      // Story Event images must honor the same Character Closet authority as
      // Chat and Scene. Pass venue_id as locationId so facility uniforms
      // (work/school/jail/hospital patient) resolve correctly.
      let outfitText = null;
      let outfitSource = 'no_closet';
      try {
        const outfitRes = await base44.asServiceRole.functions.invoke('resolveCharacterOutfitContext', {
          characterId: c.id,
          locationId: event.venue_id || null,
          locationCategory: null,
          ownerEmail: ownerEmail,
        });
        outfitText = outfitRes?.text || null;
        outfitSource = outfitRes?.source || 'not_called';
      } catch (outfitErr) {
        console.warn(`[generateMissingStoryEventImage] Outfit resolve failed for ${c.id}: ${outfitErr?.message}`);
      }

      participantBundles.push({
        participant_type: 'character',
        character_id: c.id,
        user_id: null,
        display_name: displayName,
        matched_prompt_name: firstName,
        ref_images: refImages,
        appearance_notes: appearanceParts.join(' | ') || null,
        outfit_text: outfitText,
        outfit_source: outfitSource,
        is_focus: focusIds.includes(cid),
        char_record: c,
      });
    }

    // ── RESOLVE USER BUNDLE (if user was a participant) ───────────────────────
    const includeUser = !!event.user_participant;
    let userBundle = null;
    if (includeUser) {
      try {
        const userEntityList = await base44.asServiceRole.entities.User.filter({ email: ownerEmail }, null, 1).catch(() => []);
        const userEntityRecord = userEntityList?.[0] || null;
        const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: ownerEmail }, null, 1).catch(() => []);
        const settingsRecord = settingsList?.[0] || null;

        if (userEntityRecord || settingsRecord) {
          const userEntityRefs = cdnFilter(userEntityRecord?.reference_image_urls || []);
          const userEntityAvatars = cdnFilter(userEntityRecord?.generated_avatar_urls || []);
          const settingsAvatar = cdnFilter([settingsRecord?.avatar_url, settingsRecord?.image_avatar_url].filter(Boolean));
          const userRefImages = [...userEntityRefs.slice(0, 3), ...userEntityAvatars.slice(0, 2), ...settingsAvatar.slice(0, 2)].filter(Boolean);

          const worldName = userEntityRecord?.world_name || settingsRecord?.fictional_world_name || null;
          const platformUserId = userEntityRecord?.id || ownerEmail;

          // ── USER OUTFIT AUTHORITY: resolveUserOutfitContext ──────────────────
          let userOutfitText = null;
          let userOutfitSource = 'no_outfit';
          try {
            const userOutfitRes = await base44.asServiceRole.functions.invoke('resolveUserOutfitContext', {
              ownerEmail: ownerEmail,
              locationCategory: null,
              locationId: event.venue_id || null,
            });
            userOutfitText = userOutfitRes?.text || null;
            userOutfitSource = userOutfitRes?.source || 'no_outfit';
          } catch (userOutfitErr) {
            console.warn(`[generateMissingStoryEventImage] User outfit resolve failed: ${userOutfitErr?.message}`);
          }

          userBundle = {
            participant_type: 'user',
            character_id: null,
            user_id: platformUserId,
            display_name: worldName || 'User / My Persona',
            matched_prompt_name: (worldName || 'User').split(/\s+/)[0],
            ref_images: userRefImages,
            appearance_lock: settingsRecord?.appearance_lock || null,
            gender: userEntityRecord?.gender || settingsRecord?.user_gender || null,
            culture: settingsRecord?.user_culture || null,
            race: settingsRecord?.user_race || null,
            outfit_text: userOutfitText,
            outfit_source: userOutfitSource,
            is_focus: event.user_participant?.is_focus || false,
          };
        }
      } catch (_) {}
    }

    // ── DETERMINE VISIBLE CHARACTERS FOR THIS MOMENT ──────────────────────────
    // Use provided visible_character_ids if given, otherwise derive from moment type
    let visibleCharIds = [];
    if (visible_character_ids && Array.isArray(visible_character_ids) && visible_character_ids.length > 0) {
      // Filter to only IDs that are actual event participants
      visibleCharIds = visible_character_ids.filter(id => allIds.includes(id));
    } else {
      visibleCharIds = moment_type === 'opening' ? participantIds.slice(0, 3)
        : moment_type === 'key_moment' ? (focusIds.length > 0 ? focusIds : participantIds.slice(0, 2))
        : participantIds.slice(0, 2);
    }

    const visibleBundles = participantBundles.filter(b => visibleCharIds.includes(b.character_id));
    const visibleCharNames = visibleBundles.map(b => b.display_name);
    const visibleCharTypes = visibleBundles.map(b => b.char_record?.character_type || 'active_created_character');

    // ── BUILD NAME REFERENCE KEY ──────────────────────────────────────────────
    const allBundles = [...participantBundles, ...(userBundle ? [userBundle] : [])];
    const nameReferenceKeyBlock = buildParticipantNameReferenceKeyBlock(
      allBundles.map(b => ({
        participant_type: b.participant_type,
        character_id: b.character_id,
        user_id: b.user_id,
        display_name: b.display_name,
        matched_prompt_name: b.matched_prompt_name,
      }))
    );

    const userIdentityLockBlock = buildUserIdentityLockBlock(userBundle);

    // ── GENERATE MOMENT-SPECIFIC IMAGE PROMPT VIA LLM ──────────────────────────
    // Uses the existing narrative to generate a focused image prompt for this
    // specific moment — same approach as generateStoryEvent, but for one moment.
    const venueName = event.venue_name || 'the event venue';
    const eventDate = event.event_date;
    const title = event.title || 'Untitled Event';
    const narrative = event.generated_narrative || '';
    const participantNames = event.participant_character_names || [];
    const focusNames = event.focus_character_names || [];
    const userParticipantName = event.user_participant?.display_name || null;
    const allParticipantNames = userParticipantName
      ? [...participantNames, userParticipantName]
      : participantNames;

    // Character appearance context for the LLM
    const characterAppearanceContext = visibleBundles.map(b => {
      const c = b.char_record;
      const appearanceBlock = b.appearance_notes
        ? `  APPEARANCE: ${b.appearance_notes}`
        : '';
      const outfitBlock = b.outfit_text
        ? `  OUTFIT (authoritative — from Character Closet): ${b.outfit_text}`
        : '';
      return [
        `- ${b.display_name} ${b.is_focus ? '★ FOCUS' : ''}`,
        c.personality_summary ? `  Personality: ${c.personality_summary}` : '',
        c.gender ? `  Gender: ${c.gender}` : '',
        appearanceBlock,
        outfitBlock,
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    const momentDescription = moment_type === 'opening'
      ? 'the opening scene — arrival, setting the atmosphere, first interactions'
      : moment_type === 'key_moment'
      ? 'the peak/key moment — the most dramatic or emotionally significant moment'
      : 'the closing scene — winding down, departure, final impressions';

    const llmPrompt = [
      `You are generating an image prompt for a specific moment in a story event.`,
      ``,
      `EVENT: ${title}`,
      `VENUE: ${venueName}`,
      `DATE: ${eventDate}`,
      `MOMENT: ${moment_type.replace('_', ' ')} — ${momentDescription}`,
      ``,
      `NARRATIVE (for context):`,
      narrative.substring(0, 2000),
      ``,
      `PARTICIPANTS: ${allParticipantNames.join(', ')}`,
      `FOCUS: ${focusNames.length > 0 ? focusNames.join(', ') : 'None'}`,
      ``,
      `VISIBLE IN THIS MOMENT: ${visibleCharNames.join(', ') || 'No specific characters'}`,
      ``,
      `CHARACTER APPEARANCE (use for image — DO NOT invent generic strangers):`,
      characterAppearanceContext || 'Use reference images.',
      ...(userBundle?.outfit_text ? [``, `USER OUTFIT (authoritative — from User Closet): ${userBundle.outfit_text}`] : []),
      ``,
      `Generate a single image prompt for the ${moment_type.replace('_', ' ')} moment.`,
      `Describe the scene at ${venueName}, the visible characters using their documented appearance,`,
      `their actions, the lighting, and the mood. Do NOT describe generic strangers.`,
      `Every person must match a participant's documented appearance.`,
      ...(userBundle ? [
        `The user participant "${userBundle.display_name}" MUST appear in this image by name.`,
      ] : []),
      ``,
      `Return JSON: { "prompt": "the image generation prompt", "description": "what the image shows" }`,
    ].join('\n');

    const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: llmPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          description: { type: 'string' },
        },
      },
      model: 'gemini_3_1_pro',
    });

    const momentPrompt = llmRes?.prompt || `Scene at ${venueName} during the ${moment_type.replace('_', ' ')} moment of ${title}.`;
    const momentDescriptionText = llmRes?.description || `${moment_type.replace('_', ' ')} moment at ${venueName}`;

    // ── BUILD FINAL IMAGE PROMPT (same structure as generateStoryEvent) ───────
    const finalImagePrompt = [
      `════════════════════════════════════════════════════════════`,
      `⚠️ CRITICAL: FICTIONAL CHARACTER NOTICE`,
      `════════════════════════════════════════════════════════════`,
      `ALL subjects are 100% FICTIONAL CHARACTERS for a storytelling app. Not real people.`,
      `Treat as characters in a novel or video game. Render from descriptions and reference photos only.`,
      `════════════════════════════════════════════════════════════`,
      ``,
      nameReferenceKeyBlock,
      ``,
      ...(userIdentityLockBlock ? [userIdentityLockBlock, ``] : []),
      `════════════════════════════════════════════════════════════`,
      `STORY EVENT: "${title}"`,
      `MOMENT: ${moment_type.replace('_', ' ')}`,
      `VENUE: ${venueName}`,
      `EVENT DATE: ${eventDate || 'unspecified'}`,
      `════════════════════════════════════════════════════════════`,
      ``,
      momentPrompt,
      ``,
      `VISIBLE PARTICIPANTS (ALL listed must appear — NO OMISSIONS, NO STAND-INS):`,
      visibleCharNames.length > 0 ? visibleCharNames.map(n => `- ${n}`).join('\n') : '- No specific characters',
      ...(userBundle ? [`- ${userBundle.display_name} (User)`] : []),
      ``,
      // ── CLOSET OUTFIT LOCK — honor the same wardrobe authority as Chat/Scene ──
      ...(() => {
        const lines = [`CLOSET OUTFIT LOCK — AUTHORITY: resolveCharacterOutfitContext / resolveUserOutfitContext`];
        lines.push(`Each person's clothing below is the AUTHORITATIVE outfit from their Character/User Closet.`);
        lines.push(`Do NOT invent, substitute, or genericize clothing. Render exactly what is described.`);
        let anyOutfit = false;
        for (const b of visibleBundles) {
          if (b.outfit_text) {
            anyOutfit = true;
            lines.push(`- ${b.display_name}: ${b.outfit_text}`);
          }
        }
        if (userBundle?.outfit_text) {
          anyOutfit = true;
          lines.push(`- ${userBundle.display_name} (User): ${userBundle.outfit_text}`);
        }
        if (!anyOutfit) lines.push(`(No closet outfits resolved — use reference images for clothing.)`);
        return [lines.join('\n'), ``];
      })(),
      `Photorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.`,
      ``,
      `IDENTITY ENFORCEMENT:`,
      `- Every person must match a participant in the Name Reference Key.`,
      `- Do NOT generate generic strangers or stand-ins.`,
      `- Use ONLY the visual identity references provided.`,
      ``,
      `BACKGROUND POPULATION DIVERSITY LAW — ABSOLUTE OVERRIDE:`,
      `Caucasian/White is NEVER the default appearance for any automatically generated, unspecified, or background person.`,
      `✅ Distribute across diverse backgrounds: Black, Hispanic/Latino, Indian, Jamaican, African, Asian, Middle Eastern, Haitian, Mixed heritage, Indigenous, Pacific Islander, South Asian.`,
      `✅ Vary skin tones, facial features, hair textures, and body types.`,
      `⛔ DO NOT collapse all background people to a single ethnicity.`,
      `⛔ DO NOT use training-data "generic person" defaults.`,
      `Explicitly defined characters are NOT affected — their locked appearance is always preserved exactly.`,
    ].join('\n');

    // ── RESOLVE REFERENCE IMAGES ─────────────────────────────────────────────
    const focusRefImages = participantBundles.filter(b => b.is_focus).flatMap(b => b.ref_images);
    const visibleCharRefImages = visibleBundles.flatMap(b => b.ref_images);
    const userRefImages = userBundle?.ref_images || [];
    const refImages = [...focusRefImages, ...visibleCharRefImages, ...userRefImages]
      .filter((url, i, arr) => arr.indexOf(url) === i)
      .filter(Boolean)
      .slice(0, 10);

    // ── GENERATE IMAGE ────────────────────────────────────────────────────────
    const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: finalImagePrompt,
      existing_image_urls: refImages.length > 0 ? refImages : undefined,
    });

    if (!imageRes?.url) {
      return Response.json({ error: 'Image generation failed — no URL returned' }, { status: 500 });
    }

    // ── CREATE OR UPDATE StoryEventImage RECORD ───────────────────────────────
    const momentOrder = { opening: 0, key_moment: 1, closing: 2 };
    const imageRecordData = {
      story_event_id,
      moment_type,
      image_url: imageRes.url,
      description: momentDescriptionText,
      prompt: finalImagePrompt,
      order: momentOrder[moment_type] ?? 0,
      visible_character_ids: visibleCharIds,
      visible_character_names: visibleCharNames,
      visible_character_types: visibleCharTypes,
      reference_image_urls: refImages.slice(0, 5),
      reference_lookup_status_by_character: Object.fromEntries(
        visibleBundles.map(b => [b.character_id, b.ref_images.length > 0 ? 'resolved' : 'reference_lookup_failed'])
      ),
    };

    let imageRecordId = null;
    if (updateExistingId) {
      // Update the existing failed record
      await base44.asServiceRole.entities.StoryEventImage.update(updateExistingId, imageRecordData);
      imageRecordId = updateExistingId;
    } else {
      // Create a new record
      const newRecord = await base44.asServiceRole.entities.StoryEventImage.create(imageRecordData);
      imageRecordId = newRecord?.id || null;
    }

    // ── FIND OR CREATE CONVERSATION FOR MEDIA GALLERY ────────────────────────
    let storyEventConversationId = `story_event_${story_event_id}`;
    try {
      const existingConvos = await base44.asServiceRole.entities.Conversation.filter(
        { title: `story_event::${story_event_id}`, channel: 'story_event' },
        '-created_date', 5
      ).catch(() => []);

      if (existingConvos?.length > 0 && existingConvos[0]?.id) {
        storyEventConversationId = existingConvos[0].id;
      } else {
        const storyConvo = await base44.asServiceRole.entities.Conversation.create({
          title: `story_event::${story_event_id}`,
          type: 'direct',
          character_ids: allIds,
          channel: 'story_event',
          owner_email: ownerEmail,
        }).catch(() => null);
        if (storyConvo?.id) storyEventConversationId = storyConvo.id;
      }
    } catch (_) {}

    // ── CREATE MEDIA GALLERY MESSAGE ─────────────────────────────────────────
    await base44.asServiceRole.entities.Message.create({
      conversation_id: storyEventConversationId,
      sender_type: 'user',
      content: '',
      image_url: imageRes.url,
      image_description: `${momentDescriptionText}${userBundle ? ` — Featuring: ${userBundle.display_name}` : ''}`,
      image_analysis_status: 'complete',
      generation_context: {
        generation_context_version: 2,
        context_origin: 'story_event_missing_image',
        name_reference_key_injected: true,
        source: 'story_event',
        story_event_id,
        story_event_image_id: imageRecordId,
        event_title: title,
        event_date: eventDate,
        moment_type,
        participant_character_ids: participantIds,
        focus_character_ids: focusIds,
        visible_character_ids: visibleCharIds,
        visible_character_names: visibleCharNames,
        venue_id: event.venue_id || null,
        venue_name: venueName,
        scene_prompt: finalImagePrompt,
        original_raw_prompt: momentPrompt,
        character_reference_images: refImages.slice(0, 5),
        subjects: visibleCharIds.map(cid => {
          const bundle = participantBundles.find(b => b.character_id === cid);
          return {
            subject_type: 'character',
            subject_id: cid,
            subject_name: bundle?.display_name || charById[cid]?.name || cid,
            reference_images: bundle?.ref_images || [],
            reference_image_count: bundle?.ref_images.length || 0,
          };
        }),
      },
      timestamp: new Date().toISOString(),
      owner_email: ownerEmail,
    });

    return Response.json({
      success: true,
      image_id: imageRecordId,
      moment_type,
      new_url: imageRes.url,
      description: momentDescriptionText,
      visible_character_ids: visibleCharIds,
      visible_character_names: visibleCharNames,
      created_new_record: !updateExistingId,
      updated_existing_record: !!updateExistingId,
    });
  } catch (error) {
    console.error('[generateMissingStoryEventImage]', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});