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

    // ── ROLE PREAMBLE — first thing the model reads ───────────────────────────
    let rolePreamble = '════════════════════════════════════════════════════════════\nREFERENCE IMAGE ROLE ASSIGNMENT — READ THIS FIRST, APPLY STRICTLY\n════════════════════════════════════════════════════════════\n';
    if (hasEnv) {
      rolePreamble += `Images 1–${envEnd}: ROOM ENVIRONMENT — 90% AUTHORITY\nThese are PHOTOGRAPHS of the actual room: "${locationName}${zoneName ? ` → ${zoneName}` : ''}"\nUse EXCLUSIVELY for: walls, floor, ceiling, furniture, rug, curtains, lighting fixtures, wall art, shelving, decor objects, room layout.\nYou MUST replicate this room with exact fidelity. This is not a style reference. This is the room itself.\n\n`;
    }
    if (hasChar) {
      rolePreamble += `Images ${charStart}–${charEnd}: CHARACTER IDENTITY — 90-100% AUTHORITY ON THE PERSON ONLY\n"${characterName}" — Use ONLY for: face, skin tone, hair, body type, markings. Nothing else.\n\n`;
    }
    if (hasUser) {
      rolePreamble += `Images ${userStart}–${userEnd}: USER IDENTITY — 90-100% AUTHORITY ON THIS PERSON ONLY\n"${userName}" — Use ONLY for: face, skin tone, hair, body type. Nothing else.\n\n`;
    }
    rolePreamble += `⛔ AVATAR/IDENTITY BACKGROUND = 0% AUTHORITY: Any room, wall, furniture, or scenery visible BEHIND a person in images ${hasEnv ? charStart : 1}–${hasChar ? charEnd : (hasUser ? userEnd : 1)} is COMPLETELY IRRELEVANT. Do NOT use it. Do NOT replicate it. The room comes from environment images ONLY.\n⛔ DO NOT blend these image sets. Each set has one exclusive, non-overlapping role.\n════════════════════════════════════════════════════════════\n\n`;

    // ── ENVIRONMENT LOCK — 90% AUTHORITY, ZERO OBJECT DRIFT ─────────────────
    let envLock = '';
    if (hasEnv) {
      const place = [locationName, zoneName].filter(Boolean).join(' → ');
      envLock = `

════════════════════════════════════════════════════════════
ENVIRONMENT LOCK — "${place}" — 90% VISUAL AUTHORITY
════════════════════════════════════════════════════════════
The environment reference images are PHOTOGRAPHS of this exact room.
This is NOT inspiration. This is NOT a mood board. This IS the room.
You must REPLICATE it. Insert the character into it. Do NOT redesign it.

MANDATORY — every element below MUST match the reference photographs exactly:
  ✅ Furniture types — same sofa, chairs, tables (exact models, not similar)
  ✅ Furniture colors and materials — exact match, no recoloring
  ✅ Furniture shapes and proportions — exact match
  ✅ Furniture placement — same positions relative to walls and each other
  ✅ Wall color and finish — exact match
  ✅ Flooring type — same material (wood, tile, carpet, etc.), same color/pattern
  ✅ Rug — same presence, same color, same pattern, same placement
  ✅ Curtains and window treatments — same style, same color, same position
  ✅ Ceiling lights and lamps — same fixtures, same positions
  ✅ Wall art — same pieces, same frames, same positions on the wall
  ✅ Shelves and shelving layout — same type, same placement
  ✅ All decor objects — same items, same placement, same density
  ✅ Room layout and spatial structure — same arrangement, same proportions
  ✅ Visual identity of the room — must be unmistakably the SAME room

ZERO OBJECT DRIFT — no object may be:
  ⛔ Replaced with a different object
  ⛔ Restyled or recolored
  ⛔ Removed
  ⛔ Added (do not invent new items)
  ⛔ Repositioned (unless strictly required by camera angle perspective)

STRICT ZONE ISOLATION — CROSS-ZONE CONTAMINATION IS FORBIDDEN:
  ⛔ This is the "${zoneName || 'selected zone'}" only. No objects from any other room may appear.
  ⛔ Do NOT pull furniture, decor, art, rugs, lighting, or shelves from any other zone
  ⛔ A sofa from the living room must NOT appear in the bedroom
  ⛔ A shelf from the office must NOT appear in the kitchen
  ⛔ Wall art from the hallway must NOT appear in the living room
  ⛔ Every object in the output must come exclusively from the reference images 1–${ENV_SLOTS} — nothing else

WHAT 10% FLEXIBILITY ALLOWS (ONLY):
  ✓ Camera angle and framing
  ✓ Natural lighting intensity and softness
  ✓ Depth of field and focal distance
  ✓ Photorealistic rendering quality

THE 10% DOES NOT ALLOW:
  ⛔ Different furniture
  ⛔ Different decor
  ⛔ Different colors
  ⛔ "Similar looking" substitutions
  ⛔ Generic room generation of this room type
  ⛔ Objects from other rooms or zones

FAILURE CONDITION: If ANY environmental element differs from the reference photos, OR if any object appears that is not in images 1–${ENV_SLOTS}, the generation is a FAILURE.
SUCCESS CONDITION: A viewer doing a side-by-side comparison of the reference photo and the output must immediately recognize them as THE IDENTICAL ROOM with the IDENTICAL objects.`;
    }

    // ── IDENTITY LOCK ─────────────────────────────────────────────────────────
    let identityLock = '';
    if (hasChar) {
      identityLock += `

CHARACTER IDENTITY LOCK — "${characterName}":
Reference images ${charStart}–${charEnd} are photographs of this exact person.
Match precisely: face structure, eyes, nose, mouth, skin tone, hair color/length/texture/style, body type.
⛔ Do NOT generate a generic or approximate person. This is a specific individual.`;
    }
    if (hasUser) {
      identityLock += `

USER IDENTITY LOCK — "${userName}":
Reference images ${userStart}–${userEnd} are photographs of this exact person.
Match precisely: face structure, eyes, nose, mouth, skin tone, hair color/length/texture/style, body type.
⛔ Do NOT generate a generic or approximate person. This is a specific individual.`;
    }

    const finalPrompt = `${rolePreamble}${prompt}\n\nPhotorealistic photograph. Ultra-detailed. Real human proportions. No illustration, no painting, no render — photograph only.${envLock}${identityLock}`;

    // ── 6. ASSEMBLE REFERENCE IMAGES ─────────────────────────────────────────
    // Order: env first (scene anchor), then char, then user
    const referenceImages = [...envRefs, ...charRefs, ...userRefs].filter(Boolean);

    console.log(`[mediaGridGenerate] DISPATCH: env=${envRefs.length} (90% authority) char=${charRefs.length} user=${userRefs.length} total=${referenceImages.length}`);
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