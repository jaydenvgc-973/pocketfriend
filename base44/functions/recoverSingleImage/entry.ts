/**
 * recoverSingleImage — "Load Photo" button handler for autonomous character images that failed to render.
 *
 * SUBJECT RESOLUTION RULES (strict priority order):
 *   1. Parse the stored prompt for an EXPLICITLY NAMED CHARACTER — that person is the subject.
 *      If the prompt says "Ethan at the gym", Ethan is the subject regardless of who sent the message.
 *   2. Fall back to generation_context.character_id (photo subject, not necessarily sender).
 *   3. Fall back to message.character_id (the sender — last resort).
 *
 * LOCATION RESOLUTION:
 *   - generation_context.location_id → fresh DB fetch → zone images
 *   - Character's resolved_current_location_id → LocationReference → zone images
 *
 * CRITICAL: Character B must NOT appear in an image where only Character A is named in the prompt.
 * The prompt is the AUTHORITY on who is in the photo.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

const ZONE_KEYWORD_MAP = [
  { keywords: ['bedroom', 'in bed', 'on the bed', 'sleeping', 'woke up', 'waking up', 'nightstand', 'pillow', 'mattress'], zone: 'bedroom' },
  { keywords: ['kitchen', 'cooking', 'stove', 'fridge', 'oven', 'microwave', 'counter', 'breakfast', 'making food'], zone: 'kitchen' },
  { keywords: ['bathroom', 'shower', 'bathtub', 'toilet', 'vanity', 'brushing teeth', 'getting ready'], zone: 'bathroom' },
  { keywords: ['living room', 'couch', 'sofa', 'tv ', 'on the couch', 'lounge', 'sectional', 'watching tv'], zone: 'living room' },
  { keywords: ['backyard', 'patio', 'deck', 'yard', 'garden', 'grill', 'outside at home'], zone: 'backyard' },
  { keywords: ['dining room', 'dining table', 'dinner table'], zone: 'dining room' },
  { keywords: ['office', 'desk', 'home office', 'workspace'], zone: 'office' },
  { keywords: ['gym', 'workout', 'weights', 'treadmill', 'lifting', 'training'], zone: 'gym' },
  { keywords: ['vip', 'vip section', 'vip lounge'], zone: 'vip' },
  { keywords: ['bar area', 'behind the bar', 'bartending'], zone: 'bar area' },
  { keywords: ['dance floor', 'main floor', 'dancefloor'], zone: 'main floor' },
  { keywords: ['rooftop', 'roof deck', 'rooftop bar'], zone: 'rooftop' },
  { keywords: ['hallway', 'corridor', 'entryway', 'front door', 'foyer'], zone: 'hallway' },
  { keywords: ['balcony', 'on the balcony'], zone: 'balcony' },
];

function resolveZoneImages(location, promptLower) {
  const zones = (location.zones || []).filter(z => cdnFilter(z.image_urls || []).length > 0);
  if (zones.length === 0) return cdnFilter(location.image_urls || []).slice(0, 4);

  // 1. Exact zone name in prompt
  for (const zone of zones) {
    if (zone.zone_name && promptLower.includes(zone.zone_name.toLowerCase())) {
      const imgs = cdnFilter(zone.image_urls).slice(0, 4);
      if (imgs.length > 0) return imgs;
    }
  }

  // 2. Keyword match
  for (const entry of ZONE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      const matched = zones.find(z => z.zone_name && z.zone_name.toLowerCase().includes(entry.zone));
      if (matched) {
        const imgs = cdnFilter(matched.image_urls).slice(0, 4);
        if (imgs.length > 0) return imgs;
      }
    }
  }

  // 3. Single zone — unambiguous
  if (zones.length === 1) return cdnFilter(zones[0].image_urls).slice(0, 4);

  // 4. Multiple zones no match — use first zone
  return cdnFilter(zones[0].image_urls).slice(0, 4);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, forceRegenerate = false } = await req.json();
    if (!messageId) return Response.json({ error: 'messageId required' }, { status: 400 });

    const requestingUser = user.email;

    // CRITICAL: use .get() not .filter() — filter can return wrong message if ID lookup is fuzzy
    const message = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 });
    if (message.id !== messageId) {
      console.error(`[recoverSingleImage] ⛔ ID MISMATCH: requested=${messageId} got=${message.id}`);
      return Response.json({ error: 'Message ID mismatch — wrong asset would be loaded' }, { status: 400 });
    }

    // If already has a valid image URL, return it (unless force regenerating)
    if (message.image_url && message.image_url.startsWith('http') && !forceRegenerate) {
      return Response.json({ success: true, image_url: message.image_url, source: 'existing' });
    }

    const ctx = message.generation_context || {};

    // ── STEP 1: DETERMINE THE IMAGE PROMPT ───────────────────────────────────
    let imagePrompt = ctx.prompt || ctx.scene_prompt || ctx.original_raw_prompt || null;
    if (!imagePrompt) {
      const imageTagMatch = message.content?.match(/\[IMAGE:\s*([\s\S]+?)\]/i);
      if (imageTagMatch) imagePrompt = imageTagMatch[1].trim();
    }
    if (!imagePrompt) imagePrompt = null;

    console.log(`[recoverSingleImage] messageId=${messageId} | prompt="${(imagePrompt || '').substring(0, 100)}" | forceRegenerate=${forceRegenerate}`);

    // ── STEP 2: RESOLVE THE SUBJECT CHARACTER ────────────────────────────────
    // RULE: The prompt is the AUTHORITY on who is in this photo.
    // If the prompt names Character A, render Character A — even if Character B sent the message.
    // NEVER default to the sender if the prompt names a different person.

    let subjectCharId = ctx.character_id || message.character_id || null;
    let subjectCharRecord = null;

    // Parse prompt for explicitly named character — highest priority
    if (imagePrompt) {
      try {
        const allChars = await base44.asServiceRole.entities.Character.filter(
          { owner_email: requestingUser }, null, 100
        ).catch(() => []);

        const promptLowerForSubject = imagePrompt.toLowerCase();
        // Sort by name length descending: "Jordan Smith" before "Jordan"
        const sortedChars = [...allChars].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

        for (const c of sortedChars) {
          if (!c.name || c.status === 'deleted' || c.status === 'soft_deleted') continue;
          const firstName = c.name.split(' ')[0].toLowerCase();
          if (firstName.length >= 3 && promptLowerForSubject.includes(firstName)) {
            subjectCharId = c.id;
            subjectCharRecord = c;
            console.log(`[recoverSingleImage] ✅ Prompt names subject: "${c.name}" (id=${c.id})`);
            break;
          }
        }
      } catch (nameErr) {
        console.warn(`[recoverSingleImage] Name scan failed (non-blocking): ${nameErr?.message}`);
      }
    }

    // Load character record if not already loaded from name scan
    if (!subjectCharRecord && subjectCharId) {
      subjectCharRecord = await base44.asServiceRole.entities.Character.get(subjectCharId).catch(() => null);
      if (!subjectCharRecord) {
        const charList = await base44.asServiceRole.entities.Character.filter({ id: subjectCharId }, null, 1).catch(() => []);
        subjectCharRecord = charList?.[0] || null;
      }
    }

    const charName = subjectCharRecord?.name || 'the character';
    console.log(`[recoverSingleImage] Subject: "${charName}" (id=${subjectCharId || 'none'})`);

    // ── STEP 3: BUILD CHARACTER IDENTITY REFS ────────────────────────────────
    // Use reference_image_urls first (face-only, no background contamination).
    // Fall back to avatar_url as controlled identity anchor (face extraction enforced in prompt).
    const referenceImages = [];
    let charDesc = '';

    if (subjectCharRecord) {
      const refUrls = cdnFilter(subjectCharRecord.reference_image_urls || [])
        .filter(u => !u.includes('generated_image'))
        .slice(0, 2);

      if (refUrls.length > 0) {
        referenceImages.push(...refUrls);
        console.log(`[recoverSingleImage] Using ${refUrls.length} reference_image_urls for "${charName}"`);
      } else if (subjectCharRecord.avatar_url) {
        const avatarPublic = toPublicCDN(subjectCharRecord.avatar_url);
        if (isAccessible(avatarPublic) && !avatarPublic.includes('generated_image')) {
          referenceImages.push(avatarPublic);
          console.log(`[recoverSingleImage] Using avatar_url as face identity anchor for "${charName}"`);
        }
      }

      // Build text description for identity lock
      const descParts = [
        subjectCharRecord.age_range ? `${subjectCharRecord.age_range} years old` : null,
        subjectCharRecord.gender,
        subjectCharRecord.ethnicities?.length > 0 ? subjectCharRecord.ethnicities.join('/') + ' ethnicity' : null,
        subjectCharRecord.appearance_lock?.skin_tone ? `${subjectCharRecord.appearance_lock.skin_tone} skin tone` : null,
        subjectCharRecord.appearance_lock?.hairstyle ? `${subjectCharRecord.appearance_lock.hairstyle} hairstyle` : null,
        subjectCharRecord.appearance_lock?.hair_type ? `${subjectCharRecord.appearance_lock.hair_type} hair` : null,
        subjectCharRecord.appearance_lock?.facial_hair || null,
        subjectCharRecord.appearance_notes || null,
        subjectCharRecord.avatar_description_text || null,
      ].filter(Boolean);
      charDesc = descParts.join(', ');
    }

    // ── STEP 4: RESOLVE LOCATION REFERENCE PHOTOS ────────────────────────────
    const envRefsBefore = referenceImages.length;
    let resolvedLocationName = ctx.location_name || null;
    let resolvedZoneName = ctx.zone_name || null;

    const locationId = ctx.location_id
      || subjectCharRecord?.resolved_current_location_id
      || subjectCharRecord?.current_home_location_id
      || null;

    if (locationId) {
      const locRecord = await base44.asServiceRole.entities.LocationReference.filter(
        { id: locationId }, null, 1
      ).catch(() => [])?.[0] || null;

      if (locRecord) {
        const locOwner = locRecord.owner_email;
        const isShared = locRecord.scope === 'shared' || locRecord.location_type === 'shared';
        if (!locOwner || locOwner === requestingUser || isShared) {
          const promptLowerEnv = (imagePrompt || '').toLowerCase();
          const envImages = resolveZoneImages(locRecord, promptLowerEnv);
          if (envImages.length > 0) {
            // Insert env images at the FRONT (env must come before identity refs)
            referenceImages.unshift(...envImages);
            resolvedLocationName = locRecord.name;
            console.log(`[recoverSingleImage] ✅ Location refs: "${locRecord.name}" → ${envImages.length} images (inserted at front)`);
          }
        }
      }
    } else if (ctx.location_reference_images?.length > 0) {
      const storedEnv = cdnFilter(ctx.location_reference_images).slice(0, 4);
      referenceImages.unshift(...storedEnv);
      console.log(`[recoverSingleImage] Using stored location_reference_images: ${storedEnv.length}`);
    }

    const envCount = referenceImages.length - envRefsBefore;
    console.log(`[recoverSingleImage] Refs assembled: env=${envCount} identity=${Math.min(envRefsBefore, 2)} total=${referenceImages.length}`);

    // ── STEP 5: BUILD GENERATION PROMPT ──────────────────────────────────────
    // If no stored prompt, generate one from context using LLM
    if (!imagePrompt && message.conversation_id) {
      const nearbyMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: message.conversation_id }, '-created_date', 20
      ).catch(() => []);

      const recentContext = nearbyMsgs.slice(0, 8).reverse().map(m =>
        `${m.sender_type === 'user' ? 'User' : charName}: ${(m.content || '').substring(0, 200)}`
      ).filter(t => t.trim()).join('\n');

      const promptGuess = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `A character named "${charName}" was about to send a photo in a chat conversation.

Character description: ${charDesc || subjectCharRecord?.appearance_notes || subjectCharRecord?.personality_summary || 'No description available'}

Recent conversation context:
${recentContext}

Based on this context, write a vivid image generation prompt (1-3 sentences) describing what photo "${charName}" would have sent. Focus on: their exact appearance, setting/environment, expression and pose. Return ONLY the image prompt, nothing else.`,
      });

      imagePrompt = (typeof promptGuess === 'string' ? promptGuess : promptGuess?.text || '').trim() || null;
      console.log(`[recoverSingleImage] LLM-generated prompt: "${(imagePrompt || '').substring(0, 80)}"`);
    }

    if (!imagePrompt) {
      imagePrompt = `A realistic photo of ${charName}${charDesc ? ` (${charDesc})` : ''}, candid shot, natural lighting.`;
      console.log(`[recoverSingleImage] Using fallback prompt`);
    }

    // ── STEP 6: BUILD STRUCTURED PROMPT WITH IDENTITY + LOCATION LOCKS ───────
    const hasEnv = referenceImages.length > envRefsBefore; // env refs are at front
    const envSlots = referenceImages.length - (subjectCharRecord ? Math.min(referenceImages.length, 2) : 0);
    const charRefStart = hasEnv ? envSlots + 1 : 1;
    const charRefEnd = referenceImages.length;

    const structuredPrompt = `════════════════════════════════════════════════════════════
PHOTO RECOVERY — STRICT SUBJECT AND LOCATION ENFORCEMENT
════════════════════════════════════════════════════════════

PRIMARY SUBJECT: "${charName}"
⛔ ONLY "${charName}" may appear as the subject of this photo.
⛔ Do NOT render any other named character from the conversation context.
⛔ The subject is determined by the PROMPT below — not by who sent the message.
⛔ If another person was mentioned in conversation, they are NOT in this photo unless the prompt below explicitly names them.

${referenceImages.length > 0 ? `REFERENCE IMAGES:
${hasEnv ? `Images 1–${envSlots}: LOCATION/ENVIRONMENT reference photos. Use for spatial layout, materials, furniture only. Do NOT use as character identity.
` : ''}Images ${charRefStart}–${charRefEnd}: FACE IDENTITY PHOTOS for "${charName}". Match ONLY: face structure, skin tone, eyes, hair color/length/style, body type.
⛔ DO NOT copy pose, background, or clothing from identity photos — face extraction ONLY.
` : `No reference photos. Generate "${charName}" from text description: ${charDesc || 'a realistic human'}.`}
${charDesc ? `CHARACTER APPEARANCE LOCK (ABSOLUTE — NON-NEGOTIABLE):
${charDesc}
Every trait above is immutable. Do NOT substitute any appearance trait.

` : ''}${hasEnv ? `LOCATION LOCK: "${resolvedLocationName}${resolvedZoneName ? ' → ' + resolvedZoneName : ''}"
The environment reference images define the physical space. Render the character INSIDE this space.
⛔ Do NOT invent a generic room — use the reference photos as the spatial blueprint.

` : ''}════════════════════════════════════════════════════════════
SCENE PROMPT — EVERY WORD IS A MANDATORY VISUAL REQUIREMENT
════════════════════════════════════════════════════════════
${imagePrompt}

Photorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.
The character must be physically integrated into the scene — same lighting, same perspective, same floor plane. NOT cut out or composited.`;

    // ── STEP 7: GENERATE ─────────────────────────────────────────────────────
    console.log(`[recoverSingleImage] Generating image | subject="${charName}" | env_refs=${hasEnv ? 'yes' : 'none'} | char_refs=${referenceImages.length - (hasEnv ? envSlots : 0)}`);
    const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: structuredPrompt,
      existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
    });

    if (!genRes?.url) {
      return Response.json({ success: false, error: 'Image generation returned no URL' }, { status: 500 });
    }

    // ── STEP 8: SAVE ─────────────────────────────────────────────────────────
    const cleanedContent = (message.content || '')
      .replace(/\[IMAGE:\s*[\s\S]+?\]/gi, '')
      .replace(/\[IMAGE_FAILED\]/gi, '')
      .trim();

    await base44.asServiceRole.entities.Message.update(messageId, {
      image_url: genRes.url,
      content: cleanedContent,
    });

    console.log(`[recoverSingleImage] ✓ Image recovered for message ${messageId} | subject="${charName}"`);
    return Response.json({ success: true, image_url: genRes.url, source: forceRegenerate ? 'regenerated' : 'recovered' });

  } catch (error) {
    console.error('[recoverSingleImage]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});