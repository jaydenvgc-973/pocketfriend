/**
 * regenerateImageWithReason — "Why Regenerate" handler.
 *
 * PIPELINE:
 *   - Reads generation_context saved on the message (set by generateImageAsync / mediaGridGenerate)
 *   - Uses that context as the source of truth: same character, same location, same zone
 *   - User corrections (wrong_location) update ONLY the environment refs
 *   - User corrections (dont_like, custom_prompt) update ONLY the prompt
 *   - Identity is NEVER discarded unless there are no refs
 *
 * RULES:
 *   - Never generate a random person
 *   - Never redesign the room
 *   - Never cross accounts
 *   - Avatar background = 0% influence on environment
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── URL UTILITIES ─────────────────────────────────────────────────────────────

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

// ── CAMERA POSITION DETECTION ─────────────────────────────────────────────────
// MUST stay in sync with selectCameraPosition in generateImageAsync.js
// Both generation and regeneration paths share the same camera logic.

function selectCameraPosition(prompt = '') {
  const promptLower = (prompt || '').toLowerCase();

  const isSelfie = /selfie|self-?portrait|phone selfie|smartphone selfie|cell phone|taken.*phone|phone.*photo/.test(promptLower);
  const isSittingAtTable = /sitting at.*table|at.*table.*eating|seated at.*table|at the table|dining.*table|wooden.*table/.test(promptLower);
  const isSittingOnCouch = /sitting on.*couch|on the couch|lounging on.*sofa|couch/.test(promptLower);
  const isStandingAtCounter = /standing at.*counter|at the counter/.test(promptLower);

  if (isSelfie) {
    // Compound: selfie + seated — character holds phone at face level while seated
    if (isSittingAtTable) {
      return 'selfie perspective — character is SEATED at the table holding the phone at arm\'s length toward the camera. Face and upper chest dominate the frame. The table and any food are partially visible below. Character is NOT standing. Phone is in the character\'s hand extended toward viewer.';
    }
    return 'extreme close-up selfie — character holds phone at arm\'s length directly toward camera. Face fills most of the frame. Personal and intimate framing. Character is NOT standing in a wide shot.';
  }

  if (isSittingAtTable) {
    return 'tight medium shot, seated eye-level at the table, character is the primary subject, table surface and food in frame';
  }

  if (isSittingOnCouch) {
    return 'seated eye-level from the couch, character is the primary subject, close and personal framing';
  }

  if (isStandingAtCounter) {
    return 'close-up at counter-level, character and counter are the primary subjects';
  }

  return 'from a closer standing position';
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────────────

function buildRegenPrompt({ scenePrompt, charName, locationName, zoneName, envRefs, charRefs, reason }) {
  const hasEnv  = envRefs.length > 0;
  const hasChar = charRefs.length > 0;

  const ENV_SLOTS  = Math.min(envRefs.length, 4);
  const CHAR_SLOTS = Math.min(charRefs.length, 2);

  const envEnd    = ENV_SLOTS;
  const charStart = ENV_SLOTS + 1;
  const charEnd   = ENV_SLOTS + CHAR_SLOTS;

  const cameraPos = selectCameraPosition(scenePrompt);

  let preamble = `════════════════════════════════════════════════════════════
STRUCTURAL TRUTH & DYNAMIC FLEXIBILITY
════════════════════════════════════════════════════════════

CAMERA POSITION (MANDATORY):
${cameraPos}
This camera angle MUST be visibly different from reference images.

REFERENCE HIERARCHY:
- 70–80% STRUCTURAL TRUTH: room layout, furniture, materials, zone identity
- 20–30% DYNAMIC FLEXIBILITY: camera angle, framing, lighting

`;

  if (hasEnv) {
    const place = [locationName, zoneName].filter(Boolean).join(' → ');
    preamble += `Images 1–${envEnd}: ROOM ENVIRONMENT — 70–80% STRUCTURAL TRUTH
Photographs of "${place}". PRESERVE: walls, floor, furniture identity, rug, curtains, lighting fixtures, decor, layout.
The room structure is TRUE — the viewpoint and lighting will change with new camera position.

`;
  }
  if (hasChar) {
    preamble += `Images ${charStart}–${charEnd}: CHARACTER IDENTITY — 100% AUTHORITY
"${charName}" — Match: face structure, skin tone, hair, body type.
⛔ Avatar background = 0%. Ignore any room/wall/furniture in these photos completely.

`;
  }
  preamble += '════════════════════════════════════════════════════════════\n\n';

  let envLock = '';
  if (hasEnv) {
    const place = [locationName, zoneName].filter(Boolean).join(' → ');
    envLock = `

  ════════════════════════════════════════════════════════════
  STRUCTURAL TRUTH — "${place}" — 70–80% IDENTITY, 20–30% DYNAMIC
  ════════════════════════════════════════════════════════════

  PRESERVE (70–80% structural truth):
   ✅ Furniture types, colors, shapes, structural placement
   ✅ Wall color, floor type, rug, curtains
   ✅ All lighting fixtures and lamps
   ✅ Wall art and shelves in relative positions
   ✅ Room layout, windows, doors, architecture

  REGENERATE (20–30% dynamic flexibility):
   ✓ Camera position (MUST differ from reference image viewpoint)
   ✓ Camera angle (MUST be new perspective)
   ✓ Lighting (NO light source from reference images — generate fresh)
   ✓ Composition (MUST be reframed from new camera viewpoint)
   ✓ Depth of field and focus

  ════════════════════════════════════════════════════════════
  EXISTING OBJECTS FIRST — NO DUPLICATION
  ════════════════════════════════════════════════════════════
  CRITICAL: Use EXISTING furniture from images 1–${envEnd} FIRST.
  If an object needs framing, MOVE THE CAMERA — do NOT invent or duplicate.
  NEVER create a second table, couch, bed, stove, or counter when one exists.
  If unframed, adjust camera angle/placement/position. Room truth stays fixed.

  NO OBJECT INVENTION — Every object must come from images 1–${envEnd}.
  NO STATIC BACKGROUND LOCK — Recompose the entire scene from the new camera position.`;
  }

  // Reason-specific enforcement
  let reasonBlock = '';
  if (reason === 'flawed') {
    reasonBlock = `

  FLAWED IMAGE CORRECTION:
  The previous image had rendering failures (body morphing, wrong room, furniture errors, texture glitches, object duplication).
  Re-render with MAXIMUM fidelity. Every constraint above is non-negotiable.
  Correct: body proportions, furniture exact match (no duplication), correct face/hair/skin tone, anatomically correct hands/fingers, existing objects only.`;
  } else if (reason === 'no_avatar') {
    reasonBlock = `

  IDENTITY CORRECTION — "${charName}":
  The previous image did not look like the character. Fix identity with MAXIMUM PRECISION.
  Reference images ${charStart}–${charEnd} are photographs of this exact person.
  Match PRECISELY: face bone structure, skin tone, eye shape, nose, mouth, hair color/length/style, body type.
  These appearance traits are ABSOLUTE TRUTH — NEVER approximate or substitute.
  ⛔ Do NOT generate an approximate or generic person.`;
  } else if (reason === 'wrong_location') {
    reasonBlock = `

  LOCATION CORRECTION:
  The environment has been corrected. Reference images 1–${envEnd} show the CORRECT room.
  Reproduce this room with EXACT fidelity. Use EXISTING furniture only — NO DUPLICATION or INVENTION.
  The previous room was wrong — do NOT replicate it. Preserve all furniture from images 1–${envEnd}.`;
  }

  let identityLock = '';
  if (hasChar) {
    identityLock = `

  CHARACTER IDENTITY — "${charName}":
  Images ${charStart}–${charEnd} are photographs of this exact person.
  Match PRECISELY: face structure, eyes, skin tone, hair color/length/style, body type.

  APPEARANCE LOCK (100% ABSOLUTE TRUTH):
  ✅ Hair: Match the hairstyle, length, texture, and color from reference images exactly
  ✅ Facial hair: Match the exact facial hair state (clean-shaven, stubble, beard, etc.)
  ✅ Skin tone: Match the exact skin tone from reference images
  ✅ Body type: Match the exact body structure and proportions from reference images

  ⛔ Do NOT generate a generic, approximate, or random person
  ⛔ Do NOT override appearance traits from the character record
  ⛔ THESE ARE NON-NEGOTIABLE IMMUTABLE TRUTHS`;
  }

  return `${preamble}${scenePrompt}\n\nPhotorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.${envLock}${reasonBlock}${identityLock}`;
}

// ── ZONE RESOLUTION — STRICT ZONE ISOLATION ────────────────────────────────────
// Only the exact matched zone's images are returned.
// No cross-zone fallback. Multiple zones with no match → no images (prevents contamination).

const ZONE_KEYWORD_MAP = [
  { keywords: ['bedroom', 'in bed', 'on the bed', 'sleeping', 'woke up', 'waking up', 'nightstand', 'duvet', 'pillow', 'mattress', 'my room', 'her room', 'his room'], zone: 'bedroom' },
  { keywords: ['kitchen', 'cooking', 'stove', 'fridge', 'oven', 'microwave', 'counter', 'pancake', 'breakfast', 'making food'], zone: 'kitchen' },
  { keywords: ['bathroom', 'shower', 'bathtub', 'toilet', 'vanity', 'brushing teeth', 'getting ready'], zone: 'bathroom' },
  { keywords: ['living room', 'couch', 'sofa', 'tv ', 'on the couch', 'lounge', 'sectional', 'watching tv'], zone: 'living room' },
  { keywords: ['backyard', 'patio', 'deck', 'yard', 'garden', 'grill', 'outside at home'], zone: 'backyard' },
  { keywords: ['dining room', 'dining table', 'dinner table', 'eating at the table'], zone: 'dining room' },
  { keywords: ['office', 'desk', 'home office', 'workspace', 'working from home'], zone: 'office' },
  { keywords: ['gym', 'workout', 'weights', 'treadmill', 'lifting', 'training'], zone: 'gym' },
  { keywords: ['vip', 'vip section', 'vip lounge'], zone: 'vip' },
  { keywords: ['bar area', 'behind the bar', 'bartending'], zone: 'bar area' },
  { keywords: ['dance floor', 'main floor', 'dancefloor'], zone: 'main floor' },
  { keywords: ['rooftop', 'roof deck', 'rooftop bar'], zone: 'rooftop' },
  { keywords: ['hallway', 'corridor', 'entryway', 'front door', 'foyer'], zone: 'hallway' },
  { keywords: ['balcony', 'on the balcony'], zone: 'balcony' },
];

function resolveZoneFromLocation(location, promptLower, preferredZoneName) {
  const zones = (location.zones || []).filter(z => cdnFilter(z.image_urls || []).length > 0);
  if (zones.length === 0) {
    return { images: cdnFilter(location.image_urls || []).slice(0, 4), zoneName: null };
  }

  // 0. Preferred zone name (from stored generation_context.zone_name) — highest priority
  if (preferredZoneName) {
    const preferred = zones.find(z => z.zone_name && z.zone_name.toLowerCase() === preferredZoneName.toLowerCase());
    if (preferred) {
      const imgs = cdnFilter(preferred.image_urls).slice(0, 4);
      if (imgs.length > 0) {
        console.log(`[resolveZone] Preferred zone match: "${preferred.zone_name}"`);
        return { images: imgs, zoneName: preferred.zone_name };
      }
    }
  }

  // 1. Exact zone name in prompt
  for (const zone of zones) {
    if (zone.zone_name && promptLower.includes(zone.zone_name.toLowerCase())) {
      const imgs = cdnFilter(zone.image_urls).slice(0, 4);
      if (imgs.length > 0) {
        console.log(`[resolveZone] Exact name match: "${zone.zone_name}"`);
        return { images: imgs, zoneName: zone.zone_name };
      }
    }
  }

  // 2. Keyword match
  for (const entry of ZONE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      const matched = zones.find(z => z.zone_name && z.zone_name.toLowerCase().includes(entry.zone));
      if (matched) {
        const imgs = cdnFilter(matched.image_urls).slice(0, 4);
        if (imgs.length > 0) {
          console.log(`[resolveZone] Keyword match: "${matched.zone_name}"`);
          return { images: imgs, zoneName: matched.zone_name };
        }
      }
    }
  }

  // 3. Only one zone — use it (unambiguous)
  if (zones.length === 1) {
    console.log(`[resolveZone] Single zone — using "${zones[0].zone_name}"`);
    return { images: cdnFilter(zones[0].image_urls).slice(0, 4), zoneName: zones[0].zone_name };
  }

  // 4. Multiple zones, no match — no images to avoid cross-zone contamination
  console.warn(`[resolveZone] Multiple zones, no match — returning no env refs`);
  return { images: [], zoneName: null };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      messageId,
      reason,          // 'flawed' | 'no_avatar' | 'wrong_location' | 'dont_like' | 'custom_prompt'
      customPrompt,    // for dont_like / custom_prompt
      manualLocationId, // for wrong_location
      manualZoneId,     // for wrong_location
      directLocationImages, // pre-resolved zone images from UI (optional)
      directZoneName,
      directLocationName,
    } = await req.json();

    if (!messageId || !reason) {
      return Response.json({ error: 'messageId and reason are required' }, { status: 400 });
    }

    console.log(`[regenerateImageWithReason] ▶ messageId=${messageId} | reason=${reason} | manualLocationId=${manualLocationId || 'none'}`);

    // ── 1. LOAD MESSAGE AND CONTEXT ───────────────────────────────────────────
    const msgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    const message = msgList?.[0];
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 });

    const requestingUser = message.created_by || user.email;
    const ctx = message.generation_context || {};

    const originalCharId    = ctx.character_id || message.character_id || null;
    const originalPrompt    = ctx.prompt || '';
    const originalLocId     = ctx.location_id || null;
    const originalZoneName  = ctx.zone_name || null;
    const originalLocName   = ctx.location_name || null;
    const originalLocRefs   = ctx.location_reference_images || [];

    // ── 2. RESOLVE CHARACTER IDENTITY REFS ───────────────────────────────────
    let charRefs = [];
    let charName = ctx.character_name || 'the character';

    if (originalCharId) {
      const charListUser = await base44.entities.Character.filter({ id: originalCharId }, null, 1).catch(() => []);
      let charRecord = charListUser?.[0] || null;

      if (!charRecord) {
        const charListSR = await base44.asServiceRole.entities.Character.filter({ id: originalCharId }, null, 1).catch(() => []);
        const candidate = charListSR?.[0] || null;
        if (candidate) {
          const owner = candidate.owner_email || candidate.created_by;
          if (owner && owner !== requestingUser) {
            console.error(`[regenerateImageWithReason] ⛔ Cross-account: char ${originalCharId} owned by ${owner}`);
            return Response.json({ success: false, error: 'Character does not belong to your account.' }, { status: 403 });
          }
          charRecord = candidate;
        }
      }

      if (charRecord) {
        charName = charRecord.name;
        // CRITICAL: Only use reference_image_urls, NOT avatar.
        // Avatar is typically a raw selfie/mirror shot — when passed as a reference, the AI copies its entire visual context
        // (background, pose, props, lighting), causing scene contamination. This is the ROOT CAUSE of "pasted character" failures.
        // If no reference images exist, generate from text description only.
        const refUrls = cdnFilter(charRecord.reference_image_urls || []);
        charRefs = refUrls.slice(0, 3);
        console.log(`[regenerateImageWithReason] Character "${charName}" — identity refs from reference_image_urls only: ${charRefs.length} (NOT using avatar to prevent scene contamination)`);
      }

      // Fallback: use refs stored in generation_context (which should also be reference images only, not avatar)
      if (charRefs.length === 0 && ctx.character_reference_images?.length > 0) {
        charRefs = cdnFilter(ctx.character_reference_images).slice(0, 3);
        console.log(`[regenerateImageWithReason] Using stored charRefs: ${charRefs.length}`);
      }

      // If still no refs, continue with text-only identity (do NOT fall back to avatar)
      if (charRefs.length === 0) {
        console.log(`[regenerateImageWithReason] ℹ️ No reference images for "${charName}" — will generate from text description only (no avatar fallback to prevent contamination)`);
      }
    }

    // ── 3a. DETERMINE SCENE PROMPT (needed for zone resolution) ──────────────
    let scenePrompt = originalPrompt;
    if (reason === 'dont_like' && customPrompt?.trim()) {
      scenePrompt = customPrompt.trim();
    } else if (reason === 'custom_prompt' && customPrompt?.trim()) {
      scenePrompt = customPrompt.trim();
    }
    if (!scenePrompt) scenePrompt = 'candid natural moment, everyday life';

    // ── 3b. RESOLVE ENVIRONMENT REFS ─────────────────────────────────────────
    let envRefs = [];
    let resolvedLocationName = originalLocName;
    let resolvedZoneName = originalZoneName;

    if (reason === 'wrong_location' && manualLocationId) {
      // USER SELECTED A NEW LOCATION — use it as the new environment
      if (directLocationImages?.length > 0) {
        // UI already resolved the zone images — use directly
        envRefs = cdnFilter(directLocationImages).slice(0, 4);
        resolvedZoneName = directZoneName || manualZoneId || null;
        resolvedLocationName = directLocationName || null;
        console.log(`[regenerateImageWithReason] wrong_location: using direct zone images — ${envRefs.length} refs`);
      } else {
        // Fetch location from DB
        const locListSR = await base44.asServiceRole.entities.LocationReference.filter({ id: manualLocationId }, null, 1).catch(() => []);
        const locRecord = locListSR?.[0] || null;

        if (locRecord) {
          const locOwner = locRecord.owner_email || locRecord.created_by;
          const isShared = locRecord.scope === 'shared' || locRecord.location_type === 'shared';
          if (locOwner && locOwner !== requestingUser && !isShared) {
            return Response.json({ success: false, error: 'Location does not belong to your account.' }, { status: 403 });
          }
          resolvedLocationName = locRecord.name;
          const { images, zoneName } = resolveZoneFromLocation(locRecord, originalPrompt.toLowerCase());
          envRefs = images;
          resolvedZoneName = manualZoneId || zoneName;
          console.log(`[regenerateImageWithReason] wrong_location DB: "${locRecord.name}" → zone "${resolvedZoneName}" → ${envRefs.length} refs`);
        }
      }

      if (envRefs.length === 0) {
        return Response.json({
          success: false,
          error: `The selected location "${resolvedLocationName || 'location'}" has no zone photos. Add photos to a zone first.`,
        }, { status: 422 });
      }

    } else {
      // ALL OTHER REASONS — always re-fetch fresh zone images from DB first.
      // Do NOT re-use stale stored refs from generation_context — those came from the failed image
      // and may have caused the problem. Fresh DB fetch guarantees current zone truth.
      if (originalLocId) {
        const locListSR = await base44.asServiceRole.entities.LocationReference.filter({ id: originalLocId }, null, 1).catch(() => []);
        const locRecord = locListSR?.[0] || null;
        if (locRecord) {
          const { images, zoneName } = resolveZoneFromLocation(locRecord, scenePrompt.toLowerCase(), originalZoneName);
          envRefs = images;
          resolvedZoneName = zoneName || originalZoneName;
          console.log(`[regenerateImageWithReason] Fresh DB fetch: "${locRecord.name}" → zone "${resolvedZoneName}" → ${envRefs.length} refs`);
        }
      }

      // Only fall back to stored refs if DB fetch returned nothing (location deleted/inaccessible)
      if (envRefs.length === 0 && originalLocRefs.length > 0) {
        envRefs = cdnFilter(originalLocRefs).slice(0, 4);
        console.log(`[regenerateImageWithReason] Fallback to stored location refs: ${envRefs.length}`);
      }
    }

    // ── 5. ASSEMBLE REFS — env first, then identity ───────────────────────────
    const ENV_SLOTS  = Math.min(envRefs.length, 4);
    const CHAR_SLOTS = Math.min(charRefs.length, 2);

    const referenceImages = [
      ...envRefs.slice(0, ENV_SLOTS),
      ...charRefs.slice(0, CHAR_SLOTS),
    ].filter(Boolean);

    console.log(`[regenerateImageWithReason] DISPATCH: env=${ENV_SLOTS} char=${CHAR_SLOTS} total=${referenceImages.length} | reason=${reason}`);

    // ── 6. BUILD PROMPT ───────────────────────────────────────────────────────
    const finalPrompt = buildRegenPrompt({
      scenePrompt,
      charName,
      locationName: resolvedLocationName,
      zoneName: resolvedZoneName,
      envRefs: envRefs.slice(0, ENV_SLOTS),
      charRefs: charRefs.slice(0, CHAR_SLOTS),
      reason,
    });

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
        return Response.json({ success: false, filtered: true, error: 'Image blocked by content filter. Try rephrasing.' });
      }
      throw genErr;
    }

    if (!genRes?.url) {
      return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
    }

    // ── 8. VERIFY AND SAVE ────────────────────────────────────────────────────
    const targetMsg = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!targetMsg || targetMsg.id !== messageId) {
      console.error(`[regenerateImageWithReason] ⛔ ID mismatch: requested=${messageId} got=${targetMsg?.id}`);
      return Response.json({ success: false, error: 'Message ID mismatch — aborting write.' }, { status: 400 });
    }

    await base44.asServiceRole.entities.Message.update(messageId, { image_url: genRes.url });
    console.log(`[regenerateImageWithReason] ✓ SUCCESS: ${messageId}`);

    return Response.json({
      success: true,
      image_url: genRes.url,
      messageId,
      reason,
    });

  } catch (error) {
    console.error('[regenerateImageWithReason] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});