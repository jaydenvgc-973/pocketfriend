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
    const { messageId, forceRegenerate = false, ownerEmail: callerOwnerEmail } = await req.json();
    if (!messageId) return Response.json({ error: 'messageId required' }, { status: 400 });

    // Support both user-session callers (Chat page) and service-role callers (autonomous/scheduled).
    // For service-role callers, ownerEmail must be passed in the payload.
    const user = await base44.auth.me().catch(() => null);
    const requestingUser = user?.email || callerOwnerEmail || null;

    if (!requestingUser) return Response.json({ error: 'Unauthorized — no user session or ownerEmail provided' }, { status: 401 });

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

    // RESOLUTION HIERARCHY:
    // 1. Prompt name-scan (full name first, then first-name ≥4 chars) — HIGHEST PRIORITY
    // 2. generation_context.subjects[0].subject_id (new structured format from generateImageAsync)
    // 3. generation_context.character_id (legacy field)
    // 4. message.character_id (sender — last resort)

    // Read structured subjects first — new format written by generateImageAsync
    const firstStructuredSubjectId = ctx.subjects?.length > 0
      ? (ctx.subjects.find(s => s.role === 'primary')?.subject_id || ctx.subjects[0]?.subject_id)
      : null;

    let subjectCharId = firstStructuredSubjectId || ctx.character_id || message.character_id || null;

    if (firstStructuredSubjectId && firstStructuredSubjectId !== ctx.character_id) {
      console.log(`[recoverSingleImage] Using structured subjects[0].subject_id=${firstStructuredSubjectId} (overrides legacy ctx.character_id=${ctx.character_id || 'null'})`);
    }
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

        // Phase 1: exact full-name match (most specific — prevents false first-name collisions)
        let nameMatchChar = null;
        for (const c of sortedChars) {
          if (!c.name || c.status === 'deleted' || c.status === 'soft_deleted') continue;
          if (promptLowerForSubject.includes(c.name.toLowerCase())) {
            nameMatchChar = c;
            console.log(`[recoverSingleImage] ✅ Full name match: "${c.name}" (id=${c.id})`);
            break;
          }
        }
        // Phase 2: first-name match (fallback — only when no full-name matched)
        // Require 4+ char first names to avoid matching short names like "Sam", "Kim", "Ana" incorrectly.
        if (!nameMatchChar) {
          for (const c of sortedChars) {
            if (!c.name || c.status === 'deleted' || c.status === 'soft_deleted') continue;
            const firstName = c.name.split(' ')[0].toLowerCase();
            if (firstName.length >= 4 && promptLowerForSubject.includes(firstName)) {
              nameMatchChar = c;
              console.log(`[recoverSingleImage] ✅ First-name match (4+ chars): "${c.name}" via "${firstName}" (id=${c.id})`);
              break;
            }
          }
        }
        if (nameMatchChar) {
          subjectCharId = nameMatchChar.id;
          subjectCharRecord = nameMatchChar;
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
    const identityRefs = [];
    let charDesc = '';

    if (subjectCharRecord) {
      const refUrls = cdnFilter(subjectCharRecord.reference_image_urls || [])
        .filter(u => !u.includes('generated_image'))
        .slice(0, 2);

      if (refUrls.length > 0) {
        identityRefs.push(...refUrls);
        console.log(`[recoverSingleImage] Using ${refUrls.length} reference_image_urls for "${charName}"`);
      } else if (subjectCharRecord.avatar_url) {
        const avatarPublic = toPublicCDN(subjectCharRecord.avatar_url);
        if (isAccessible(avatarPublic) && !avatarPublic.includes('generated_image')) {
          identityRefs.push(avatarPublic);
          console.log(`[recoverSingleImage] Using avatar_url as face identity anchor for "${charName}"`);
        }
      }

      // Build text description for identity lock
      // SYNC: charDesc building must match generateImageAsync and regenerateImageWithReason exactly.
      // All three functions use the same field set so text-only identity is consistent.
      const descParts = [
        subjectCharRecord.age_range ? `${subjectCharRecord.age_range} years old` : null,
        subjectCharRecord.gender || null,
        subjectCharRecord.ethnicities?.length > 0 ? subjectCharRecord.ethnicities.join('/') + ' ethnicity' : null,
        subjectCharRecord.appearance_lock?.skin_tone ? `${subjectCharRecord.appearance_lock.skin_tone} skin tone` : null,
        subjectCharRecord.appearance_lock?.hairstyle ? `${subjectCharRecord.appearance_lock.hairstyle} hairstyle` : null,
        subjectCharRecord.appearance_lock?.hair_type ? `${subjectCharRecord.appearance_lock.hair_type} hair` : null,
        subjectCharRecord.appearance_lock?.facial_hair || null,
        subjectCharRecord.appearance_notes || null,
        subjectCharRecord.avatar_description_text || null, // vision-analyzed description
      ].filter(Boolean);
      charDesc = descParts.join(', ');
    }

    // ── STEP 4: RESOLVE LOCATION REFERENCE PHOTOS ────────────────────────────
    const envRefs = [];
    let resolvedLocationName = ctx.location_name || null;
    let resolvedZoneName = ctx.zone_name || null;

    const locationId = ctx.location_id
      || subjectCharRecord?.resolved_current_location_id
      || subjectCharRecord?.current_home_location_id
      || null;

    if (locationId) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter(
        { id: locationId }, null, 1
      ).catch(() => []);
      const locRecord = locList?.[0] || null;

      if (locRecord) {
        const locOwner = locRecord.owner_email;
        const isShared = locRecord.scope === 'shared' || locRecord.location_type === 'shared';
        if (!locOwner || locOwner === requestingUser || isShared) {
          const promptLowerEnv = (imagePrompt || '').toLowerCase();
          const envImages = resolveZoneImages(locRecord, promptLowerEnv);
          if (envImages.length > 0) {
            envRefs.push(...envImages);
            resolvedLocationName = locRecord.name;
            console.log(`[recoverSingleImage] ✅ Location refs: "${locRecord.name}" → ${envImages.length} images`);
          }
        }
      }
    } else if (ctx.location_reference_images?.length > 0) {
      const storedEnv = cdnFilter(ctx.location_reference_images).slice(0, 4);
      envRefs.push(...storedEnv);
      console.log(`[recoverSingleImage] Using stored location_reference_images: ${storedEnv.length}`);
    }

    // Assemble: env refs FIRST, then identity refs
    const referenceImages = [...envRefs, ...identityRefs];
    const envCount = envRefs.length;

    // ── IDENTITY DISPATCH DIAGNOSTICS ─────────────────────────────────────────
    // Matches [IdentityAudit] format from generateImageAsync for consistent log tracing.
    console.log(`[IdentityAudit][recover] ══════════════════════════════════════════════`);
    console.log(`[IdentityAudit][recover] message_id:              ${messageId}`);
    console.log(`[IdentityAudit][recover] subject_char_id:         ${subjectCharId || 'null'}`);
    console.log(`[IdentityAudit][recover] subject_char_name:       ${charName}`);
    console.log(`[IdentityAudit][recover] identity_ref_count:      ${identityRefs.length}`);
    console.log(`[IdentityAudit][recover] identity_ref_source:     ${
      identityRefs.length > 0 && subjectCharRecord?.reference_image_urls?.filter(u => !u.includes('generated_image')).length > 0
        ? 'reference_image_urls'
        : identityRefs.length > 0 ? 'avatar_url_fallback' : 'none'
    }`);
    console.log(`[IdentityAudit][recover] env_ref_count:           ${envCount}`);
    console.log(`[IdentityAudit][recover] ctx_structured_subj_id: ${firstStructuredSubjectId || 'none'}`);
    console.log(`[IdentityAudit][recover] ctx_char_id_legacy:      ${ctx.character_id || 'null'}`);
    console.log(`[IdentityAudit][recover] msg_char_id_fallback:    ${message.character_id || 'null'}`);
    console.log(`[IdentityAudit][recover] subject_source:          ${
      subjectCharRecord && imagePrompt
        ? 'prompt_name_scan' : firstStructuredSubjectId ? 'structured_subjects_array'
        : ctx.character_id ? 'ctx_character_id_legacy' : 'message_character_id_fallback'
    }`);
    console.log(`[IdentityAudit][recover] char_desc_built:         ${!!charDesc}`);
    console.log(`[IdentityAudit][recover] location_resolved:       ${resolvedLocationName || 'none'}`);
    console.log(`[IdentityAudit][recover] ══════════════════════════════════════════════`);

    console.log(`[recoverSingleImage] Refs assembled: env=${envCount} identity=${identityRefs.length} total=${referenceImages.length}`);

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

      imagePrompt = String(promptGuess || '').trim();
    }

    // CAUCASIAN-DEFAULT GUARD: If no prompt is stored AND no character identity data exists,
    // block recovery rather than generating a Caucasian default person.
    if (!imagePrompt) {
      if (!subjectCharRecord && !subjectCharId) {
        console.error(`[recoverSingleImage] ❌ CAUCASIAN-DEFAULT GUARD: no stored prompt, no character record, no subject ID. Blocking recovery.`);
        return Response.json({
          success: false,
          error: 'The original image prompt is missing and no character identity is linked to this message. Recovery is blocked — the app will not generate a default person.',
          identity_missing: true,
          caucasian_default_blocked: true,
        });
      }
      // Character record exists but no stored prompt — use minimal neutral fallback.
      // The identity will be locked by charDesc and reference images, so this is safe.
      imagePrompt = `${charName} in a candid everyday moment.`;
    }

    // CAUCASIAN-DEFAULT GUARD INJECTION: Always inject the no-default rule into the prompt.
    const caucasianGuardRecover = `
⛔ IDENTITY DEFAULT PROHIBITION: Unknown identity DOES NOT equal Caucasian/white.
DO NOT default to Caucasian, white, or any assumed ethnicity, gender, age, or body type.
Use ONLY the reference images and character description below for appearance. No exceptions.
`;
    imagePrompt = caucasianGuardRecover + imagePrompt;

    // ── STEP 6: BUILD STRUCTURED PROMPT ──────────────────────────────────────
    const finalPrompt = `
STRICT SUBJECT RULE:
The ONLY required subject is "${charName}".
If the prompt mentions another person only as context, do NOT include that other person unless the prompt explicitly says they are physically present in the image.

USER/STORED PHOTO PROMPT:
${imagePrompt}

CHARACTER IDENTITY LOCK:
${charDesc || `Use the reference image(s) to preserve ${charName}'s face, age, body type, hair, skin tone, and overall identity.`}

REFERENCE IMAGE RULES:
${envCount > 0 ? `Images 1-${envCount}: environment/location reference only. Use for room layout, lighting, furniture, architecture, and spatial logic.` : ''}
${identityRefs.length > 0 ? `Remaining image(s): ${charName}'s identity reference. Use for face/body identity only. Do not copy background from avatar/reference portraits.` : ''}

LOCATION:
${resolvedLocationName || ctx.location_name || 'Use the setting described in the prompt.'}
${resolvedZoneName ? `Zone: ${resolvedZoneName}` : ''}

OUTPUT REQUIREMENTS:
Photorealistic image. Correct named subject. Correct location. Natural candid composition. No duplicate people. No wrong character substitution. No sender-character contamination.
`.trim();

    console.log(`[recoverSingleImage] Generating image for "${charName}" with ${referenceImages.length} refs (env=${envCount} identity=${identityRefs.length})`);

    // ── STEP 7: GENERATE ─────────────────────────────────────────────────────
    const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: finalPrompt,
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
      generation_context: {
        ...ctx,
        recovered_at: new Date().toISOString(),
        resolved_subject_character_id: subjectCharId,
        resolved_subject_name: charName,
        resolved_location_name: resolvedLocationName,
        recovery_reference_count: referenceImages.length,
        recovery_environment_reference_count: envCount,
        recovery_identity_reference_count: identityRefs.length,
        prompt_used_for_recovery: imagePrompt,
      },
    });

    console.log(`[recoverSingleImage] ✓ Image recovered for message ${messageId} | subject="${charName}"`);
    return Response.json({
      success: true,
      image_url: genRes.url,
      source: forceRegenerate ? 'regenerated' : 'recovered',
      subject: charName,
      subject_character_id: subjectCharId,
      location: resolvedLocationName,
      reference_count: referenceImages.length,
      environment_reference_count: envCount,
    });

  } catch (err) {
    console.error('[recoverSingleImage] Fatal error:', err);
    return Response.json({
      success: false,
      error: err?.message || 'recoverSingleImage failed',
    }, { status: 500 });
  }
});