/**
 * mediaGridGenerate — Multi-person image generation with hard identity lock.
 * 
 * CRITICAL CONTRACT:
 * When multiple people are selected, EVERY selected person MUST be visually locked
 * to their stored reference images. No substitutes. No generic people. No placeholder humans.
 * 
 * If any selected person cannot be visually resolved, generation STOPS.
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      messageId,
      prompt,
      subjectType,
      characterId,
      characterName,
      characterRefImages,
      userRefImages,
      userName,
      locationId,
      locationName,
      zoneName,
      zoneImageUrls,
      multiPersonSelection,
      referenceImageUrl,
      referenceImageMode,   // 'prompt_only' | 'image_only' | 'prompt_plus_image'
      referenceImagePurpose, // 'pose' | 'placement' | 'background' | 'lighting' | 'composition' | 'general'
    } = await req.json();

    if (!messageId) {
      return Response.json({ error: 'messageId required' }, { status: 400 });
    }
    // prompt is required — even image_only mode sends a minimal fallback prompt from the frontend
    if (!prompt) {
      return Response.json({ error: 'prompt required' }, { status: 400 });
    }

    console.log(`[mediaGridGenerate] ▶ messageId=${messageId} | multiPerson=${!!multiPersonSelection}`);

    // ── CLASSIFICATION-FIRST SANITIZER — synced with generateImageAsync ────
    // SYNC NOTE: This logic must stay identical to generateImageAsync's classifySceneContext
    // + sanitizePrompt. Multi-person mode uses this directly (not delegated). Single-character
    // mode delegates to generateImageAsync which has its own copy.
    function classifySceneContext(p) {
      const lower = p.toLowerCase();
      const explicitSignals = [
        /\bsex(ual)?\b/, /\bporn\b/, /\berotic\b/, /\bgenitals?\b/, /\bpenis\b/, /\bvagina\b/,
        /\bnipples?\b/, /\bsexually\b/, /\barouse[d]?\b/, /\borgasm\b/, /\bintercourse\b/,
        /\bprivate parts?\b/, /\bexplicit(ly)?\b/, /\bsuggestive pose\b/, /\bseductive\b/,
        /\bsex act\b/, /\bsexualize[d]?\b/,
      ];
      const isExplicit = explicitSignals.some(r => r.test(lower));
      const isSleepContext = /\b(sleep(ing)?|asleep|woke up|waking up|bed|bedroom|lying|laid down|resting|nap(ping)?|pillow|duvet|blanket|sheets?)\b/.test(lower);
      const isComfortContext = /\b(comfort(ing)?|support(ing|ive)?|emotional|vulnerable|safe|holding|hugging|close|beside|next to|shoulder|arms? around|snuggle|cuddle|warm|peaceful|quiet moment|calming|soothing|affection(ate)?|tender(ness)?|intimate|love)\b/.test(lower);
      const isLifestyleContext = /\b(beach|gym|workout|fitness|pool|vacation|home|apartment|mirror|selfie|casual|morning|routine|everyday|relaxing|chill(ing)?|hanging out)\b/.test(lower);
      const isNonSexualBodyContext = /\b(no shirt|without (a )?shirt|shirtless|without (a )?top|no top)\b/.test(lower) && !isExplicit;
      if (isExplicit) return 'explicit';
      if (isSleepContext && isComfortContext) return 'emotional_comfort';
      if (isSleepContext) return 'sleep_lifestyle';
      if (isComfortContext) return 'comfort';
      if (isLifestyleContext) return 'lifestyle';
      if (isNonSexualBodyContext) return 'casual_body';
      return 'neutral';
    }

    function sanitizeImagePrompt(p) {
      if (!p) return p;
      let s = p;
      const sceneClass = classifySceneContext(s);
      const isSafeScene = ['emotional_comfort', 'sleep_lifestyle', 'comfort', 'lifestyle', 'casual_body', 'neutral'].includes(sceneClass);
      if (isSafeScene) {
        s = s.replace(/\bnaked\b/gi, 'not fully dressed');
        s = s.replace(/\bnude\b/gi, 'not fully dressed');
        s = s.replace(/\bfully nude\b/gi, 'not fully dressed');
        s = s.replace(/\bfully naked\b/gi, 'not fully dressed');
        s = s.replace(/\bin lingerie\b/gi, 'in comfortable sleepwear');
        s = s.replace(/\blingerie\b/gi, 'sleepwear');
        s = s.replace(/\bin a bra( and panties)?\b/gi, 'getting dressed at home');
        s = s.replace(/\bpanties\b/gi, 'underwear');
        s = s.replace(/\bthong\b/gi, 'underwear');
        return s.trim();
      }
      // Explicit scenes: full sanitization
      s = s.replace(/\bshirtless\b/gi, 'with no shirt on');
      s = s.replace(/\btopless\b/gi, 'with no shirt on');
      s = s.replace(/\bbarechested\b/gi, 'with no shirt on');
      s = s.replace(/\bbare[- ]?chest(ed)?\b/gi, 'with no shirt on');
      s = s.replace(/\bin lingerie\b/gi, 'in comfortable sleepwear');
      s = s.replace(/\blingerie\b/gi, 'sleepwear');
      s = s.replace(/\bin a bra( and panties)?\b/gi, 'getting dressed at home');
      s = s.replace(/\bpanties\b/gi, 'underwear');
      s = s.replace(/\bthong\b/gi, 'underwear');
      s = s.replace(/\bexposed (chest|abs|torso|stomach|midriff)\b/gi, 'no shirt on');
      s = s.replace(/\b(his|her|their) (bare )?(chest|abs|torso)\b/gi, '$1 relaxed build');
      s = s.replace(/\bnaked\b/gi, 'not fully dressed');
      s = s.replace(/\bnude\b/gi, 'not fully dressed');
      s = s.replace(/\bfully nude\b/gi, 'not fully dressed');
      s = s.replace(/\bfully naked\b/gi, 'not fully dressed');
      return s.trim();
    }

    let sanitizedPrompt = sanitizeImagePrompt(prompt);

    // ── TIME-OF-DAY AUTHORITY CHECK ─────────────────────────────────────────
    // If the prompt explicitly states a time/lighting, that is the scene authority.
    // Log so we can trace if nighttime prompts are producing daylight images.
    const promptHasExplicitTime = /nighttime|night time|middle of the night|midnight|late night|daytime|broad daylight|morning|afternoon|evening|golden hour|sunset|sunrise|dusk|dawn|dark room|dim light|low light/i.test(sanitizedPrompt);
    if (promptHasExplicitTime) {
      const detectedMatch = sanitizedPrompt.match(/nighttime|night time|middle of the night|midnight|late night|daytime|broad daylight|morning|afternoon|evening|golden hour|sunset|sunrise|dusk|dawn|dark room|dim light|low light/i);
      console.log(`[mediaGridGenerate] TIME AUTHORITY: prompt explicitly declares time-of-day → "${detectedMatch?.[0]}" — this OVERRIDES all reference image lighting`);
      console.log(`[mediaGridGenerate] Raw prompt: ${prompt.substring(0, 150)}`);
      console.log(`[mediaGridGenerate] Sanitized prompt: ${sanitizedPrompt.substring(0, 150)}`);
    } else {
      console.log(`[mediaGridGenerate] TIME AUTHORITY: no explicit time in prompt — will use server time-of-day`);
    }

    // ── USER-UPLOADED REFERENCE IMAGE GUIDANCE ─────────────────────────────
    // If the user uploaded a reference image, inject purpose-specific guidance into the prompt.
    // The written prompt still defines intent — the uploaded image defines visual guidance only.
    const hasUserRef = referenceImageUrl && isAccessible(toPublicCDN(referenceImageUrl));
    if (hasUserRef && referenceImageMode !== 'prompt_only') {
      const purposeInstructions = {
        pose:        'Use the uploaded reference image to match the pose, body position, and physical stance of the subject.',
        placement:   'Use the uploaded reference image to match the placement and positioning of people and objects in the scene.',
        background:  'Use the uploaded reference image to match the background environment, setting, and spatial layout.',
        lighting:    'Use the uploaded reference image to match the lighting direction, quality, and color temperature.',
        composition: 'Use the uploaded reference image to match the overall framing, camera angle, and compositional structure.',
        general:     'Use the uploaded reference image as visual guidance for the overall look, feel, and style of the scene.',
      };
      const purposeText = purposeInstructions[referenceImagePurpose] || purposeInstructions.general;
      if (referenceImageMode === 'image_only') {
        // Image is the primary source — prompt is supplemental
        sanitizedPrompt = `${purposeText} The reference image is the primary visual source. ${sanitizedPrompt}`;
      } else {
        // prompt_plus_image — written prompt defines intent, image guides visuals
        sanitizedPrompt = `${sanitizedPrompt} [VISUAL GUIDANCE] ${purposeText} The written prompt takes priority for intent and subject; the reference image guides the visual execution.`;
      }
    }

    // ── MULTI-PERSON IDENTITY LOCK ─────────────────────────────────────────
    if (multiPersonSelection) {
      console.log(`[mediaGridGenerate] MULTI-PERSON MODE: validating ${multiPersonSelection.selectedCharacters.length} selected people`);

      const validation = {
        totalSelected: multiPersonSelection.selectedCharacters.length,
        withRefs: 0,
        missingRefs: [],
      };

      for (const person of multiPersonSelection.selectedCharacters) {
        if (!person.referenceImages || person.referenceImages.length === 0) {
          validation.missingRefs.push(`${person.role} (${person.id})`);
        } else {
          validation.withRefs++;
          console.log(`[mediaGridGenerate] ✓ ${person.role} (${person.id}): ${person.referenceImages.length} refs`);
        }
      }

      if (multiPersonSelection.includeUser && multiPersonSelection.userReferenceImages) {
        if (multiPersonSelection.userReferenceImages.length === 0) {
          validation.missingRefs.push('user');
        } else {
          validation.withRefs++;
          console.log(`[mediaGridGenerate] ✓ user: ${multiPersonSelection.userReferenceImages.length} refs`);
        }
      }

      console.log(`[mediaGridGenerate] Identity validation: ${validation.withRefs}/${validation.totalSelected} with refs`);

      if (validation.missingRefs.length > 0) {
        const errorMsg = `IDENTITY LOCK FAILED: Cannot generate image. Missing visual references for: ${validation.missingRefs.join(', ')}.`;
        console.error(`[mediaGridGenerate] ⛔ ${errorMsg}`);
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({ success: false, error: errorMsg }, { status: 400 });
      }

      // ── BUILD MULTI-PERSON PROMPT ──────────────────────────────────────
      // Assemble all reference images with strict labeling
      const allRefs = [];
      let refIndex = 1;
      const refMap = {};

      for (const person of multiPersonSelection.selectedCharacters) {
        const refs = (person.referenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        refs.forEach(url => {
          allRefs.push(url);
          refMap[refIndex] = { role: person.role, id: person.id };
          refIndex++;
        });
      }

      if (multiPersonSelection.includeUser && multiPersonSelection.userReferenceImages) {
        const refs = (multiPersonSelection.userReferenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        refs.forEach(url => {
          allRefs.push(url);
          refMap[refIndex] = { role: 'user', id: 'user' };
          refIndex++;
        });
      }

      const identityRefs = [];
      const people = [];
      refIndex = 1;
      for (const person of multiPersonSelection.selectedCharacters) {
        const refs = (person.referenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        identityRefs.push(...refs);
        people.push({
          role: person.role,
          id: person.id,
          // displayName and firstName come from frontend enrichment (buildSelectedIdentityMap)
          // These ensure the prompt labels subjects by real name ("Henry Billion") not role ("additional_0")
          displayName: person.displayName || null,
          firstName: person.firstName || null,
          refStart: refIndex,
          refCount: refs.length,
        });
        refIndex += refs.length;
      }

      if (multiPersonSelection.includeUser && multiPersonSelection.userReferenceImages) {
        const refs = (multiPersonSelection.userReferenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        identityRefs.push(...refs);
        people.push({
          role: 'user',
          id: 'user',
          displayName: null,
          firstName: null,
          refStart: refIndex,
          refCount: refs.length,
        });
      }

      const envRefs = (zoneImageUrls || []).map(toPublicCDN).filter(isAccessible).slice(0, 4);

      // ── MULTI-PERSON CLOSET OUTFIT LOCK ──────────────────────────────────
      function normalizeOutfitFieldMG(val) {
        if (!val) return null;
        const t = val.trim();
        if (/^(n\/?a|none|-)$/i.test(t)) return null;
        const s = t.replace(/^n\/?a[,\-–]\s*/i, '').trim();
        if (/^(shirtless|no top|no shirt)$/i.test(s)) return 'No shirt / bare torso';
        return s || null;
      }
      function buildMGOutfitText(outfit) {
        if (!outfit) return null;
        const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
          .map(normalizeOutfitFieldMG).filter(Boolean);
        if (parts.length > 0) return parts.join(', ');
        if (outfit.full_description) return outfit.full_description.trim();
        return null;
      }

      // ── Resolve outfits for ALL subjects — characters AND user/persona ────
      // Each subject's closet is the canonical wardrobe truth.
      // Event/theme in prompt MUST NOT override closet unless prompt explicitly describes clothing.
      const multiOutfitLines = [];

      // 1. Character outfits — resolve from closet hierarchy (current_outfit → closet rotation)
      for (const person of multiPersonSelection.selectedCharacters) {
        if (!person.id || person.id === 'user') continue;
        try {
          // Two-step lookup: user-scoped first (RLS), then service-role with ownership check
          let charRec = null;
          const charListUser = await base44.entities.Character.filter({ id: person.id }, null, 1).catch(() => []);
          charRec = charListUser?.[0] || null;
          if (!charRec) {
            const charListSR = await base44.asServiceRole.entities.Character.filter({ id: person.id }, null, 1).catch(() => []);
            charRec = charListSR?.[0] || null;
          }
          if (charRec) {
            const co = charRec.current_outfit;
            let outfitText = (co?.outfit_id || co?.label) ? buildMGOutfitText(co) : null;
            if (!outfitText) {
              const closet = (charRec.character_closet || []).filter(o => o.outfit_id);
              if (closet.length > 0) outfitText = buildMGOutfitText(closet[0]);
            }
            const outfitSource = (co?.outfit_id || co?.label) ? 'current_outfit' : (charRec.character_closet?.length > 0 ? 'closet_rotation' : 'no_closet');
            console.log(`[mediaGridGenerate] Character outfit: "${charRec.name}" source="${outfitSource}" text="${(outfitText||'none').substring(0,80)}"`);
            if (outfitText) multiOutfitLines.push({ subjectType: 'character', name: charRec.name, text: outfitText, source: outfitSource });
          }
        } catch (charErr) {
          console.warn(`[mediaGridGenerate] Character outfit resolution failed for ${person.id}: ${charErr?.message}`);
        }
      }

      // 2. User/persona outfit — resolve from UserSettings.user_current_outfit
      // This is the user-side equivalent of the character closet. It MUST be resolved here
      // for multi-person mode — the event/theme (e.g. "AIDS Walk") must NOT invent clothing.
      if (multiPersonSelection.includeUser) {
        try {
          const requestingUserEmail = user?.email;
          if (requestingUserEmail) {
            const settingsList = await base44.asServiceRole.entities.UserSettings.filter(
              { owner_email: requestingUserEmail }, null, 1
            ).catch(() => []);
            const sett = settingsList?.[0] || null;
            const uco = sett?.user_current_outfit;
            const userOutfitText = uco ? buildMGOutfitText(uco) || uco.full_description?.trim() || null : null;
            const userPersonaName = sett?.fictional_world_name || 'User / My Persona';
            const userOutfitSource = uco ? 'user_current_outfit' : 'no_outfit';
            console.log(`[mediaGridGenerate] User outfit: name="${userPersonaName}" source="${userOutfitSource}" text="${(userOutfitText||'none').substring(0,80)}"`);
            if (userOutfitText) {
              multiOutfitLines.push({ subjectType: 'user', name: userPersonaName, text: userOutfitText, source: userOutfitSource });
            } else {
              console.warn(`[mediaGridGenerate] ⚠️ No user_current_outfit in UserSettings for ${requestingUserEmail} — user subject renders without wardrobe constraint`);
            }
          }
        } catch (userOutfitErr) {
          console.warn(`[mediaGridGenerate] User outfit resolution failed: ${userOutfitErr?.message}`);
        }
      }
      let multiClosetLock = '';
      if (multiOutfitLines.length > 0) {
        const lockLines = ['', '🔒 CLOSET OUTFIT LOCK — CANONICAL LAW. OVERRIDES ALL SCENE STYLING.', '════════════════════════════════════════════════════════════'];
        for (const { name, text } of multiOutfitLines) {
          const isBareTorso = /no shirt \/ bare torso/i.test(text);
          const hasBottoms = /sweatpants|pants|jeans|shorts|joggers|leggings|trousers/i.test(text);
          const hasShoes = /sneakers|shoes|boots|sandals|loafers|heels/i.test(text);
          lockLines.push(`${name} OUTFIT — RENDER EXACTLY:`);
          text.split(',').map(s => s.trim()).filter(Boolean).forEach(item => lockLines.push(`  • ${item}`));
          lockLines.push('NON-NEGOTIABLE:');
          if (isBareTorso) { lockLines.push('⛔ BARE TORSO — NO shirt, tank top, hoodie, jacket, robe, or any upper-body clothing.'); lockLines.push('✅ Torso must be completely bare and clearly visible.'); }
          if (hasBottoms) lockLines.push('✅ BOTTOMS VISIBLE — frame mid-thigh or lower.');
          if (hasShoes) lockLines.push('✅ SHOES VISIBLE — full-body or 3/4-body framing required.');
          lockLines.push('⛔ Do NOT add or invent any clothing item not listed above.'); lockLines.push('');
        }
        lockLines.push('════════════════════════════════════════════════════════════');
        lockLines.push('FAIL: shirt on bare torso | wrong bottoms | shoes cropped | invented outfit');
        multiClosetLock = lockLines.join('\n');
        console.log(`[mediaGridGenerate] Multi-person closet lock built for ${multiOutfitLines.length} people`);
      }

      // Use generateImageAsync's unified rules for consistency across all paths
      // Multi-person images must still obey: camera flexibility, selfie rules, time-of-day lighting,
      // zone truth, reference balance (70-80% structure / 20-30% flexibility)
      const multiPersonPrompt = `
════════════════════════════════════════════════════════════
IMAGE GENERATION PRIORITY STACK (GOVERNING LAW)
════════════════════════════════════════════════════════════
Priority 1: SCENE INTENT — user prompt meaning, emotion, action
Priority 2: CHARACTER PRESENCE — who is there and what they are doing
Priority 3: CAMERA POSITION — angle, distance, framing
Priority 4: ZONE IDENTITY — room type and style
Priority 5: REFERENCE IMAGE — guidance only, not replication

Lower priority NEVER overrides higher priority.
ANTI-FLAT RULE: slightly imperfect room + correct emotion/camera = VALID. Perfect room + static camera = FAILED.

INTENSITY BALANCING:
When closeness + nighttime + private setting + minimal clothing co-occur, do NOT maximize all signals at once.
Balance by: reducing camera proximity slightly, softening physical contact wording, implying environment instead of naming it directly, keeping emotional tone without labeling it "intimate".
Goal: preserve the visual moment while keeping overall intensity below filter threshold.

════════════════════════════════════════════════════════════
MULTI-PERSON IMAGE GENERATION — SHARED RULES + IDENTITY LOCK
════════════════════════════════════════════════════════════

CORE SCENE PROMPT:
${sanitizedPrompt}

════════════════════════════════════════════════════════════
REFERENCE IMAGE BALANCE (applies to ALL image generation)
════════════════════════════════════════════════════════════

${envRefs.length > 0 ? `ENVIRONMENT (70–80% structural truth, 20–30% dynamic flexibility):
  Images 1–${envRefs.length}: ROOM/ZONE STRUCTURE
  ✅ PRESERVE: walls, floor, furniture, fixtures, objects, architecture, layout
  ✓ REGENERATE: lighting (time-of-day), camera angle, framing, perspective
  ⛔ Do NOT treat as static background — recompose from new camera viewpoint
  ⛔ Do NOT invent replacement furniture
  ⛔ Zone structure stays TRUE while camera and lighting CHANGE

` : ''}
SELECTED PEOPLE (100% identity lock from reference photos):

${people.map(p => {
const nameLabel = p.displayName || (p.role === 'user' ? 'User' : p.role.replace(/_/g, ' ').toUpperCase());
const firstName = p.firstName || nameLabel.split(/\s+/)[0];
const startIdx = envRefs.length + p.refStart;
const endIdx = envRefs.length + p.refStart + p.refCount - 1;
// Look up resolved outfit for this subject
const subjectOutfitEntry = multiOutfitLines.find(o =>
o.subjectType === (p.role === 'user' ? 'user' : 'character') &&
(p.role === 'user' ? true : o.name === (p.displayName || ''))
);
const outfitLockLine = subjectOutfitEntry?.text
? `\n  🔒 OUTFIT LOCK (CANONICAL LAW — OVERRIDES EVENT/THEME STYLING): "${subjectOutfitEntry.text}"\n  ⛔ Do NOT invent clothing from the event name or scene theme. Use ONLY what is listed above.\n  ⛔ Do NOT modify, add to, or substitute this outfit — render it exactly.`
: `\n  ⚠️ No closet outfit resolved — event/theme must NOT invent clothing. Use contextually neutral attire.`;
return `${nameLabel} (ID: ${p.id}): Images ${startIdx}–${endIdx}
When this scene refers to "${firstName}" or "${nameLabel}", this IS that person — use these reference images.
✅ MATCH EXACTLY: face structure, skin tone, hair, body type, age
⛔ Do NOT: substitute a generic person, distort, or invent a new body${outfitLockLine}`;
}).join('\n\n')}

════════════════════════════════════════════════════════════
UNIFIED COMPOSITION RULE (all paths)
════════════════════════════════════════════════════════════
The image is ONE COHESIVE SCENE. All people are naturally integrated inside the zone.
Do NOT:
  🚫 Paste or enlarge any person over a static background
  🚫 Disconnect person from room perspective
  🚫 Change zone structure or replace furniture
  🚫 Invent mirrors, counters, or other props
  🚫 Create floating objects

DO:
  ✓ Move camera closer/farther if needed
  ✓ Change camera angle for new viewpoint
  ✓ Apply time-of-day lighting and fresh shadows
  ✓ Reframe entire scene from new camera position
${multiClosetLock}
`;


      console.log(`[mediaGridGenerate] Multi-person prompt built for ${people.length} people with ${identityRefs.length} identity refs + ${envRefs.length} env refs`);

      const allReferences = [
        ...envRefs,
        ...identityRefs,
      ];

      if (allReferences.length === 0) {
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({ success: false, error: 'No reference images available for any selected person.' }, { status: 400 });
      }

      // Append user-uploaded reference image to the end (after identity refs, before generation)
      if (hasUserRef) {
        allReferences.push(toPublicCDN(referenceImageUrl));
      }

      try {
        const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: multiPersonPrompt,
          existing_image_urls: allReferences,
        });

        if (!genRes?.url) {
          await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
          return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
        }

        // Build structured subjects array — matches generateImageAsync format.
        // This allows recoverSingleImage and regenerateImageWithReason to recover
        // per-person identity for multi-person images using the same resolution path.
        const structuredSubjects = people.map(p => ({
          subject_type: p.role === 'user' ? 'user' : 'character',
          subject_id: p.id,
          subject_name: p.displayName || null,
          role: p.role,
          reference_image_count: p.refCount,
          reference_images: identityRefs.slice(p.refStart - 1, p.refStart - 1 + p.refCount),
        }));

        const generationContext = {
          // New structured format — read by recoverSingleImage and regenerateImageWithReason
          image_type: 'multi',
          subject_count: structuredSubjects.length,
          subjects: structuredSubjects,
          scene_prompt: prompt,
          original_raw_prompt: prompt,

          // Outfit metadata — stored for audit and regeneration
          // Each entry: { subjectType: 'character'|'user', name, text, source }
          resolved_outfit_metadata: multiOutfitLines,
          user_outfit_text: multiOutfitLines.find(o => o.subjectType === 'user')?.text || null,
          user_outfit_source: multiOutfitLines.find(o => o.subjectType === 'user')?.source || null,

          // Legacy fields — kept for backward compat
          prompt,
          subjectType: 'multi',
          character_id: people.find(p => p.role === 'primary')?.id || null,
          selectedPeople: people.map(p => ({ role: p.role, id: p.id, displayName: p.displayName || null })),
          characterReferenceImages: identityRefs,
          locationName,
          zoneName,
          location_name: locationName,
          zone_name: zoneName,
          locationReferenceImages: envRefs,
          location_reference_images: envRefs,
          generatedAt: new Date().toISOString(),
        };

        await base44.asServiceRole.entities.Message.update(messageId, {
          image_url: genRes.url,
          generation_context: generationContext,
        });

        console.log(`[mediaGridGenerate] ✓ Multi-person SUCCESS: ${messageId}`);

        return Response.json({
          success: true,
          imageUrl: genRes.url,
          messageId,
          subjectType: 'multi',
          selectedPeopleCount: people.length,
        });
      } catch (genErr) {
        const msg = genErr?.message || '';
        if (/filter|guideline|block|violat/i.test(msg)) {
          await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
          return Response.json({ success: false, filtered: true, error: 'Image blocked by content filter. Try rephrasing.' });
        }
        throw genErr;
      }
    }

    // ── SINGLE-CHARACTER MODE (use shared generateImageAsync) ──────────────────
    // SUBJECT AUDIT LOG — always log what is being sent to catch leaks early
    const resolvedSubjectType = subjectType || 'character';
    const isUserOnly = resolvedSubjectType === 'user';
    console.log(`[mediaGridGenerate] ── SUBJECT AUDIT ──`);
    console.log(`[mediaGridGenerate]   subjectType:           ${resolvedSubjectType}`);
    console.log(`[mediaGridGenerate]   characterId passed:    ${characterId || 'null'}`);
    console.log(`[mediaGridGenerate]   characterName passed:  ${characterName || 'null'}`);
    console.log(`[mediaGridGenerate]   charRefImages count:   ${(characterRefImages || []).length}`);
    console.log(`[mediaGridGenerate]   userRefImages count:   ${(userRefImages || []).length}`);
    console.log(`[mediaGridGenerate]   user_only_guard:       ${isUserOnly}`);

    // BACKEND USER-ONLY GUARD: Even if frontend accidentally passes character data,
    // we enforce the contract here. User-only images must never include any character identity.
    if (isUserOnly && (characterId || characterName || (characterRefImages || []).length > 0)) {
      console.warn(`[mediaGridGenerate] ⛔ USER-ONLY GUARD: character identity fields present but subjectType=user — CLEARED`);
      console.warn(`[mediaGridGenerate]   cleared characterId: ${characterId}, characterName: ${characterName}, refs: ${(characterRefImages || []).length}`);
    }

    const effectiveCharacterId     = isUserOnly ? null : characterId;
    const effectiveCharacterName   = isUserOnly ? null : characterName;
    const effectiveCharacterRefs   = isUserOnly ? [] : (characterRefImages || []).map(toPublicCDN).filter(isAccessible);
    const effectiveSenderCharId    = isUserOnly ? null : characterId;

    console.log(`[mediaGridGenerate] Single-character mode: delegating to generateImageAsync`);
    console.log(`[mediaGridGenerate]   final characterId:     ${effectiveCharacterId || 'null'}`);
    console.log(`[mediaGridGenerate]   final senderCharId:    ${effectiveSenderCharId || 'null'}`);
    console.log(`[mediaGridGenerate]   final charRefs count:  ${effectiveCharacterRefs.length}`);

    // User-only images must not include any character identity prompt injection
    const userOnlyExclusionNote = isUserOnly
      ? '\n\n⛔ USER-ONLY IMAGE: Do NOT include any app characters, fictional persons, or named individuals in this image unless they are explicitly described in the scene prompt. The person in this image is only the user. No character identity refs were provided.'
      : '';

    // CRITICAL: Must use base44.functions.invoke (user-scoped), NOT asServiceRole.
    // generateImageAsync calls base44.auth.me() — if called via asServiceRole, the user context
    // is stripped and auth.me() returns null/service-role, causing 403 cross-account failures.
    const singleCharRes = await base44.functions.invoke('generateImageAsync', {
      messageId,
      prompt: sanitizedPrompt + userOnlyExclusionNote,
      characterId: effectiveCharacterId,
      characterName: effectiveCharacterName,
      // senderCharacterId: only set when character IS the subject (not user-only mode)
      senderCharacterId: effectiveSenderCharId,
      characterReferenceImages: effectiveCharacterRefs,
      userReferenceImages: userRefImages ? (userRefImages || []).map(toPublicCDN).filter(isAccessible) : [],
      userWorldName: userName || null,
      subjectType: resolvedSubjectType,
      characterEmotionalState: 'calm',
      // User-uploaded reference image for visual guidance
      userUploadedReferenceUrl: hasUserRef ? toPublicCDN(referenceImageUrl) : null,
      // NO manualLocationId — generateImageAsync resolves from character record
    });

    if (!singleCharRes?.data?.success) {
      const errorMsg = singleCharRes?.data?.error || 'Image generation failed';
      await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({ success: false, error: errorMsg }, { status: singleCharRes?.status || 500 });
    }

    console.log(`[mediaGridGenerate] ✓ Single-character SUCCESS via generateImageAsync: ${messageId}`);
    return Response.json({
      success: true,
      imageUrl: singleCharRes.data.imageUrl,
      messageId,
      subjectType: 'character',
    });

  } catch (error) {
    console.error('[mediaGridGenerate] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});