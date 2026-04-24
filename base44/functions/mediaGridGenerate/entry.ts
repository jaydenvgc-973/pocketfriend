/**
 * mediaGridGenerate — Clean, simple image generation for the Media Grid.
 *
 * SOURCE OF TRUTH MODEL:
 *   - characterId     → identity only (face, hair, skin, body)
 *   - locationId      → environment only (room, furniture, layout)
 *   - zoneName        → which zone of the location
 *   - zoneImageUrls   → the exact zone images already resolved by the UI — used as-is
 *   - prompt          → action, pose, camera, expression, clothing
 *
 * FAILURE RULES:
 *   - No character refs → fail, explain
 *   - No zone images when location selected → fail, explain
 *   - Never guess rooms, never use avatar backgrounds, never cross accounts
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      messageId,
      prompt,
      subjectType,           // "character" | "user" | "joint"
      // Character identity
      characterId,
      characterName,
      characterRefImages,    // already CDN-converted by frontend, just verify
      // User identity (for "user" / "joint")
      userRefImages,
      userName,
      // Environment — UI-resolved, used as-is
      locationId,
      locationName,
      zoneName,
      zoneImageUrls,         // the exact zone images selected in the UI
    } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt are required' }, { status: 400 });
    }

    // ── 1. VERIFY MESSAGE BELONGS TO THIS USER ────────────────────────────────
    const msgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    const message = msgList?.[0];
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 });

    // ── 2. RESOLVE CHARACTER IDENTITY REFS ───────────────────────────────────
    // Only needed for character/joint subjects.
    let charRefs = [];
    if ((subjectType === 'character' || subjectType === 'joint') && characterId) {
      // Fetch from DB to get latest refs — scope to this user's account only
      const charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      const char = charList?.[0];

      if (char) {
        // ACCOUNT ISOLATION: verify ownership
        const owner = char.owner_email || char.created_by;
        if (owner && owner !== user.email) {
          console.error(`[mediaGridGenerate] Cross-account character rejected: ${characterId} owned by ${owner}, request from ${user.email}`);
          return Response.json({ error: 'Character does not belong to your account.' }, { status: 403 });
        }

        // Build refs from DB record: avatar first, then reference_image_urls
        const allUrls = [char.avatar_url, ...(char.reference_image_urls || [])].filter(Boolean);
        charRefs = cdnFilter(allUrls).slice(0, 3);
        console.log(`[mediaGridGenerate] Character "${char.name}" — DB refs found: ${charRefs.length}`);
      }

      // Fallback: use UI-provided refs if DB had none
      if (charRefs.length === 0 && characterRefImages?.length > 0) {
        charRefs = cdnFilter(characterRefImages).slice(0, 3);
        console.log(`[mediaGridGenerate] Using UI-provided charRefs (DB had none): ${charRefs.length}`);
      }

      // HARD FAIL: no usable identity refs
      if (charRefs.length === 0) {
        return Response.json({
          success: false,
          error: `No usable identity photos found for "${characterName || characterId}". Upload an avatar photo for this character first.`,
        }, { status: 422 });
      }
    }

    // ── 3. RESOLVE USER IDENTITY REFS (for user/joint) ───────────────────────
    let userRefs = [];
    if (subjectType === 'user' || subjectType === 'joint') {
      userRefs = cdnFilter(userRefImages || []).slice(0, 3);
      console.log(`[mediaGridGenerate] User refs: ${userRefs.length}`);
    }

    // ── 4. RESOLVE ENVIRONMENT REFS ───────────────────────────────────────────
    // UI passes zoneImageUrls directly — these are already the correct images.
    // No re-lookup, no keyword matching, no guessing. Use them as-is.
    let envRefs = cdnFilter(zoneImageUrls || []).slice(0, 4);
    console.log(`[mediaGridGenerate] Zone "${zoneName}" in "${locationName}" — env refs: ${envRefs.length}`);

    // If location was selected but zone has no accessible images → hard fail
    if (locationId && zoneImageUrls?.length > 0 && envRefs.length === 0) {
      return Response.json({
        success: false,
        error: `The selected zone "${zoneName || 'zone'}" in "${locationName}" has photos but none are accessible by the image provider. Re-upload the zone photos to fix this.`,
      }, { status: 422 });
    }

    if (locationId && !zoneImageUrls?.length) {
      return Response.json({
        success: false,
        error: `The selected location "${locationName}" has no zone photos. Add photos to a zone before generating from this location.`,
      }, { status: 422 });
    }

    // ── 5. BUILD PROMPT ───────────────────────────────────────────────────────
    const hasEnv = envRefs.length > 0;
    const hasChar = charRefs.length > 0;
    const hasUser = userRefs.length > 0;

    // Slot counts
    const ENV_SLOTS  = envRefs.length;
    const CHAR_SLOTS = charRefs.length;
    const USER_SLOTS = userRefs.length;

    const envEnd    = ENV_SLOTS;
    const charStart = ENV_SLOTS + 1;
    const charEnd   = ENV_SLOTS + CHAR_SLOTS;
    const userStart = ENV_SLOTS + CHAR_SLOTS + 1;
    const userEnd   = ENV_SLOTS + CHAR_SLOTS + USER_SLOTS;

    // Role preamble — first thing the model reads
    let rolePreamble = 'REFERENCE IMAGE ROLES — READ THIS FIRST:\n';
    if (hasEnv) {
      rolePreamble += `Images 1–${envEnd}: ENVIRONMENT ONLY — the actual room/location "${locationName}${zoneName ? ` → ${zoneName}` : ''}". Use ONLY for: walls, floor, furniture, layout, lighting, decor. Authority: 80% on the room.\n`;
    }
    if (hasChar) {
      rolePreamble += `Images ${charStart}–${charEnd}: CHARACTER IDENTITY ONLY — "${characterName}". Use ONLY for: face, skin, hair, body type, markings. Authority: 90-100% on the person.\n`;
    }
    if (hasUser) {
      rolePreamble += `Images ${userStart}–${userEnd}: USER IDENTITY ONLY — "${userName}". Use ONLY for: face, skin, hair, body type. Authority: 90-100% on this person.\n`;
    }
    rolePreamble += '⛔ AVATAR BACKGROUND = 0%: Any background visible behind a person in identity images is IRRELEVANT — ignore it completely. The room comes from environment images only.\n⛔ DO NOT blend image sets. Each set has one exclusive role.\n\n';

    // Environment lock
    let envLock = '';
    if (hasEnv) {
      const place = [locationName, zoneName].filter(Boolean).join(' → ');
      envLock = `\n\nENVIRONMENT LOCK — "${place}":
The environment images are photographs of this exact room. Reproduce it exactly:
✅ Same furniture (color, shape, placement)
✅ Same decor (art, shelving, lamps, rugs, curtains)
✅ Same layout and proportions
⛔ Do NOT redesign, substitute, or generically recreate this room
⛔ Do NOT use any background from character photos as the room
SUCCESS: A viewer must recognize the output and the reference as the SAME ROOM.`;
    }

    // Identity lock
    let identityLock = '';
    if (hasChar) {
      identityLock += `\n\nCHARACTER IDENTITY LOCK — "${characterName}":
Reference images ${charStart}–${charEnd} define this person's exact appearance.
Match: face structure, eyes, nose, skin tone, hair color/length/texture, body type.
⛔ Do NOT generate a generic or random person.`;
    }
    if (hasUser) {
      identityLock += `\n\nUSER IDENTITY LOCK — "${userName}":
Reference images ${userStart}–${userEnd} define this person's exact appearance.
Match: face structure, eyes, nose, skin tone, hair color/length/texture, body type.
⛔ Do NOT generate a generic or random person.`;
    }

    const finalPrompt = `${rolePreamble}${prompt}\n\nPhotorealistic photograph. Ultra-detailed. Natural lighting. Real human proportions. Not an illustration.${envLock}${identityLock}`;

    // ── 6. ASSEMBLE REFERENCE IMAGES ─────────────────────────────────────────
    // Order: env first (scene anchor), then char, then user
    const referenceImages = [...envRefs, ...charRefs, ...userRefs].filter(Boolean);

    console.log(`[mediaGridGenerate] DISPATCH: env=${envRefs.length} char=${charRefs.length} user=${userRefs.length} total=${referenceImages.length}`);
    console.log(`[mediaGridGenerate] Prompt (first 200): ${finalPrompt.substring(0, 200)}`);

    // ── 7. GENERATE ───────────────────────────────────────────────────────────
    let genRes;
    try {
      genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
        prompt: finalPrompt,
        existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
      });
    } catch (genErr) {
      const msg = genErr?.message || '';
      if (/filter|guideline|block|violat/i.test(msg)) {
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({ success: false, filtered: true, error: 'Image blocked by content filter. Try rephrasing.' });
      }
      throw genErr;
    }

    if (!genRes?.url) {
      await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
    }

    // ── 8. SAVE TO MESSAGE ────────────────────────────────────────────────────
    const generationContext = {
      prompt,
      character_id: characterId || null,
      character_reference_images: charRefs,
      location_id: locationId || null,
      zone_name: zoneName || null,
      location_name: locationName || null,
      location_reference_images: envRefs,
      subject_type: subjectType,
      generated_at: new Date().toISOString(),
    };

    await base44.asServiceRole.entities.Message.update(messageId, {
      image_url: genRes.url,
      generation_context: generationContext,
    });

    console.log(`[mediaGridGenerate] ✓ SUCCESS: message ${messageId} — ${genRes.url.substring(0, 60)}`);

    return Response.json({
      success: true,
      imageUrl: genRes.url,
      messageId,
    });

  } catch (error) {
    console.error('[mediaGridGenerate] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});