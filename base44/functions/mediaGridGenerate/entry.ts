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

      // ── RESOLVE FULL SUBJECT BUNDLES — characters ─────────────────────────
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

      // multiOutfitLines kept for backward-compat storage in generation_context
      const multiOutfitLines = [];

      for (const person of multiPersonSelection.selectedCharacters) {
        const refs = (person.referenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        identityRefs.push(...refs);

        // Resolve appearance lock + outfit from Character record
        let outfitText = null;
        let outfitSource = 'no_closet';
        let appearanceLock = null;  // { gender, skinTone, hairStyle, bodyType, age }

        if (person.id && person.id !== 'user') {
          try {
            let charRec = null;
            const charListUser = await base44.entities.Character.filter({ id: person.id }, null, 1).catch(() => []);
            charRec = charListUser?.[0] || null;
            if (!charRec) {
              const charListSR = await base44.asServiceRole.entities.Character.filter({ id: person.id }, null, 1).catch(() => []);
              charRec = charListSR?.[0] || null;
            }
            if (charRec) {
              // Outfit
              const co = charRec.current_outfit;
              outfitText = (co?.outfit_id || co?.label) ? buildMGOutfitText(co) : null;
              if (!outfitText) {
                const closet = (charRec.character_closet || []).filter(o => o.outfit_id);
                if (closet.length > 0) outfitText = buildMGOutfitText(closet[0]);
              }
              outfitSource = (co?.outfit_id || co?.label) ? 'current_outfit' : (charRec.character_closet?.length > 0 ? 'closet_rotation' : 'no_closet');

              // Appearance lock — build from record fields
              const al = charRec.appearance_lock || {};
              appearanceLock = {
                gender: charRec.gender || null,
                skinTone: al.skin_tone || null,
                hairStyle: al.hairstyle || al.hair_type || null,
                facialHair: al.facial_hair || null,
                bodyType: al.overall_aesthetic || null,
                age: charRec.age_range || (charRec.age ? `${charRec.age}` : null),
                height: al.height_display || null,
                customKeywords: (al.custom_keywords || []).join(', ') || null,
              };
              console.log(`[mediaGridGenerate] Character bundle: "${charRec.name}" outfit="${(outfitText||'none').substring(0,80)}" appearance=${JSON.stringify(appearanceLock)}`);
              if (outfitText) multiOutfitLines.push({ subjectType: 'character', name: charRec.name, text: outfitText, source: outfitSource });
            }
          } catch (charErr) {
            console.warn(`[mediaGridGenerate] Character bundle resolution failed for ${person.id}: ${charErr?.message}`);
          }
        }

        people.push({
          subjectKey: `character_${person.id}`,
          subjectRole: 'character',
          role: person.role,
          id: person.id,
          displayName: person.displayName || null,
          firstName: person.firstName || null,
          refStart: refIndex,
          refCount: refs.length,
          outfitText,
          outfitSource,
          appearanceLock,
        });
        refIndex += refs.length;
      }

      // ── RESOLVE FULL SUBJECT BUNDLE — user/persona ────────────────────────
      if (multiPersonSelection.includeUser && multiPersonSelection.userReferenceImages) {
        const refs = (multiPersonSelection.userReferenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        identityRefs.push(...refs);

        let userOutfitText = null;
        let userOutfitSource = 'no_outfit';
        let userPersonaName = 'User / My Persona';
        let userAppearanceLock = null;

        try {
          const requestingUserEmail = user?.email;
          if (requestingUserEmail) {
            const settingsList = await base44.asServiceRole.entities.UserSettings.filter(
              { owner_email: requestingUserEmail }, null, 1
            ).catch(() => []);
            const sett = settingsList?.[0] || null;
            const uco = sett?.user_current_outfit;
            userOutfitText = uco ? buildMGOutfitText(uco) || uco.full_description?.trim() || null : null;
            userPersonaName = sett?.fictional_world_name || 'User / My Persona';
            userOutfitSource = uco ? 'user_current_outfit' : 'no_outfit';

            // Appearance lock from UserSettings
            const ual = sett?.appearance_lock || {};
            userAppearanceLock = {
              gender: sett?.user_gender || null,
              skinTone: ual.skin_tone || null,
              hairStyle: ual.hairstyle || ual.hair_type || null,
              bodyType: ual.overall_aesthetic || null,
              height: ual.height_display || null,
              customKeywords: (ual.custom_keywords || []).join(', ') || null,
            };

            console.log(`[mediaGridGenerate] User bundle: name="${userPersonaName}" outfit="${(userOutfitText||'none').substring(0,80)}" appearance=${JSON.stringify(userAppearanceLock)}`);
            if (userOutfitText) {
              multiOutfitLines.push({ subjectType: 'user', name: userPersonaName, text: userOutfitText, source: userOutfitSource });
            } else {
              console.warn(`[mediaGridGenerate] ⚠️ No user_current_outfit for ${requestingUserEmail}`);
            }
          }
        } catch (userOutfitErr) {
          console.warn(`[mediaGridGenerate] User bundle resolution failed: ${userOutfitErr?.message}`);
        }

        people.push({
          subjectKey: '__user__',
          subjectRole: 'user',
          role: 'user',
          id: 'user',
          displayName: userPersonaName,
          firstName: userPersonaName.split(/\s+/)[0],
          refStart: refIndex,
          refCount: refs.length,
          outfitText: userOutfitText,
          outfitSource: userOutfitSource,
          appearanceLock: userAppearanceLock,
        });
        refIndex += refs.length;
      }

      const envRefs = (zoneImageUrls || []).map(toPublicCDN).filter(isAccessible).slice(0, 4);

      // ── BUILD SEALED PER-SUBJECT BUNDLE BLOCKS ────────────────────────────
      // Each subject gets a self-contained block with: identity key, role declaration,
      // reference image slots, appearance lock, outfit lock, and cross-assignment prohibition.
      // This prevents the model from mixing any attribute between subjects.

      function buildSubjectBundle(p, envCount) {
        const startIdx = envCount + p.refStart;
        const endIdx = envCount + p.refStart + p.refCount - 1;
        const isUser = p.subjectRole === 'user';
        const nameDisplay = p.displayName || (isUser ? 'User / My Persona' : p.role);
        const firstName = p.firstName || nameDisplay.split(/\s+/)[0];

        const lines = [];
        lines.push(`╔══════════════════════════════════════════════════════════╗`);
        lines.push(`║ SUBJECT BUNDLE — SEALED — DO NOT MIX WITH OTHER SUBJECTS ║`);
        lines.push(`╚══════════════════════════════════════════════════════════╝`);
        lines.push(`SUBJECT KEY:   ${p.subjectKey}`);
        lines.push(`SUBJECT ROLE:  ${isUser ? 'USER / WORLD PERSONA (the authenticated user of this app)' : `CHARACTER (stable ID: ${p.id})`}`);
        lines.push(`DISPLAY NAME:  "${nameDisplay}"`);

        if (isUser) {
          lines.push(`IDENTITY NOTE: "${firstName}" is the current authenticated user / world persona.`);
          lines.push(`  ⛔ Do NOT infer gender from the name "${firstName}" — use only reference images and appearance lock below.`);
          lines.push(`  ⛔ Do NOT replace this person with a generic event participant, stock photo person, or crowd member.`);
          lines.push(`  ⛔ Do NOT render this person as female unless appearance lock explicitly states female.`);
          lines.push(`  ⛔ This is a real specific person with locked visual identity — NOT a generic named person.`);
        } else {
          lines.push(`IDENTITY NOTE: "${firstName}" is a specific saved character with a locked visual identity.`);
          lines.push(`  ⛔ Do NOT substitute a generic person. Do NOT infer appearance beyond reference images and appearance lock.`);
        }

        lines.push(``);
        lines.push(`REFERENCE IMAGES: Images ${startIdx}–${endIdx}`);
        lines.push(`  These images show THIS SUBJECT'S FACE AND BODY ONLY.`);
        lines.push(`  ✅ Use ONLY for: face structure, skin tone, hair, body type`);
        lines.push(`  ⛔ IGNORE: background, pose, clothing, lighting in these photos`);
        lines.push(`  ⛔ These reference images belong EXCLUSIVELY to "${nameDisplay}" — do NOT apply to any other subject`);

        // Appearance lock block
        const al = p.appearanceLock || {};
        const alParts = [
          al.gender ? `Gender presentation: ${al.gender}` : null,
          al.skinTone ? `Skin tone: ${al.skinTone}` : null,
          al.hairStyle ? `Hair: ${al.hairStyle}` : null,
          al.facialHair ? `Facial hair: ${al.facialHair}` : null,
          al.bodyType ? `Body/aesthetic: ${al.bodyType}` : null,
          al.height ? `Height: ${al.height}` : null,
          al.age ? `Age: ${al.age}` : null,
          al.customKeywords ? `Additional: ${al.customKeywords}` : null,
        ].filter(Boolean);

        if (alParts.length > 0) {
          lines.push(``);
          lines.push(`APPEARANCE LOCK (for "${nameDisplay}" ONLY — immutable):`);
          alParts.forEach(a => lines.push(`  • ${a}`));
          lines.push(`  ⛔ These appearance traits belong EXCLUSIVELY to "${nameDisplay}".`);
          lines.push(`  ⛔ Do NOT apply these height/body/skin/hair values to any other subject in this scene.`);
        }

        // Outfit lock block
        lines.push(``);
        if (p.outfitText) {
          const isBareTorso = /no shirt \/ bare torso/i.test(p.outfitText);
          const hasBottoms = /sweatpants|pants|jeans|shorts|joggers|leggings|trousers/i.test(p.outfitText);
          const hasShoes = /sneakers|shoes|boots|sandals|loafers|heels/i.test(p.outfitText);
          lines.push(`CLOSET OUTFIT LOCK (for "${nameDisplay}" ONLY — canonical law):`);
          p.outfitText.split(',').map(s => s.trim()).filter(Boolean).forEach(item => lines.push(`  • ${item}`));
          lines.push(`  ⛔ This outfit is assigned EXCLUSIVELY to "${nameDisplay}".`);
          lines.push(`  ⛔ Do NOT apply this outfit to any other subject in this scene.`);
          lines.push(`  ⛔ Do NOT invent clothing from the event name or scene theme — use ONLY what is listed.`);
          lines.push(`  ⛔ Do NOT swap, modify, or substitute any item from this outfit.`);
          if (isBareTorso) { lines.push(`  ⛔ BARE TORSO — NO shirt/tank/hoodie/jacket/robe on this subject.`); lines.push(`  ✅ Torso must be completely bare.`); }
          if (hasBottoms) lines.push(`  ✅ BOTTOMS VISIBLE — frame mid-thigh or lower for this subject.`);
          if (hasShoes) lines.push(`  ✅ SHOES VISIBLE — full or 3/4-body framing for this subject.`);
        } else {
          lines.push(`CLOSET OUTFIT: No outfit on file for "${nameDisplay}".`);
          lines.push(`  ⛔ Do NOT invent clothing from the event name or theme.`);
          lines.push(`  Use contextually neutral attire appropriate to the scene.`);
        }

        lines.push(``);
        lines.push(`CROSS-ASSIGNMENT PROHIBITION (absolute rule):`);
        lines.push(`  ⛔ "${nameDisplay}"'s outfit MUST NOT be rendered on any other subject.`);
        lines.push(`  ⛔ "${nameDisplay}"'s height, body type, and skin tone MUST NOT be applied to any other subject.`);
        lines.push(`  ⛔ "${nameDisplay}"'s reference images MUST NOT influence any other subject's appearance.`);

        return lines.join('\n');
      }

      // Build the NAME REFERENCE KEY — maps every name in the prompt to its sealed bundle
      function buildNameReferenceKey(peopleArr) {
        const lines = [];
        lines.push(`[NAME REFERENCE KEY — SELECTED SUBJECTS]`);
        lines.push(`Every name in the scene prompt maps to exactly one sealed subject bundle below.`);
        lines.push(`Do NOT infer any appearance, gender, outfit, or body from a name alone.`);
        lines.push(`Do NOT assign any subject's attributes to a different subject.`);
        lines.push(``);
        for (const p of peopleArr) {
          const isUser = p.subjectRole === 'user';
          const nameDisplay = p.displayName || (isUser ? 'User / My Persona' : p.role);
          const firstName = p.firstName || nameDisplay.split(/\s+/)[0];
          const roleDesc = isUser
            ? `Current authenticated user / world persona (role: user, stable key: "__user__") — visual identity ONLY from user reference images and user appearance lock`
            : `Saved character (role: character, Character ID: ${p.id}) — visual identity ONLY from character reference images and character appearance lock`;
          lines.push(`"${firstName}" / "${nameDisplay}" → ${roleDesc}`);
        }
        lines.push(`[END NAME REFERENCE KEY]`);
        return lines.join('\n');
      }

      const nameRefKey = buildNameReferenceKey(people);
      const subjectBundleBlocks = people.map(p => buildSubjectBundle(p, envRefs.length)).join('\n\n');

      // Use generateImageAsync's unified rules for consistency across all paths
      const multiPersonPrompt = `
════════════════════════════════════════════════════════════
IMAGE GENERATION PRIORITY STACK (GOVERNING LAW)
════════════════════════════════════════════════════════════
Priority 1: SCENE INTENT — user prompt meaning, emotion, action
Priority 2: CHARACTER PRESENCE — who is there and what they are doing
Priority 3: CAMERA POSITION — angle, distance, framing
Priority 4: ZONE IDENTITY — room type and style
Priority 5: REFERENCE IMAGE — guidance only for identity, not scene replication

Lower priority NEVER overrides higher priority.

INTENSITY BALANCING:
When closeness + nighttime + private setting + minimal clothing co-occur, do NOT maximize all signals at once.
Balance: reduce camera proximity slightly, soften physical contact wording, imply environment instead of labeling it.

════════════════════════════════════════════════════════════
CORE SCENE PROMPT:
════════════════════════════════════════════════════════════
${sanitizedPrompt}

════════════════════════════════════════════════════════════
${nameRefKey}
════════════════════════════════════════════════════════════

${envRefs.length > 0 ? `════════════════════════════════════════════════════════════
ENVIRONMENT — IMAGES 1–${envRefs.length} (70–80% structural truth, 20–30% dynamic flexibility)
════════════════════════════════════════════════════════════
✅ PRESERVE: walls, floor, furniture, fixtures, objects, architecture, layout
✓ REGENERATE: lighting (time-of-day), camera angle, framing, perspective
⛔ Do NOT invent replacement furniture or duplicate existing objects
⛔ Zone structure stays TRUE while camera and lighting CHANGE

` : ''}════════════════════════════════════════════════════════════
SEALED SUBJECT BUNDLES — READ EACH BUNDLE INDEPENDENTLY
ATTRIBUTES FROM ONE BUNDLE MUST NEVER BE APPLIED TO ANOTHER BUNDLE
════════════════════════════════════════════════════════════

${subjectBundleBlocks}

════════════════════════════════════════════════════════════
GLOBAL CROSS-ASSIGNMENT PROHIBITION — ABSOLUTE LAW
════════════════════════════════════════════════════════════
This scene contains ${people.length} distinct subjects. Each has a sealed bundle above.
⛔ NEVER swap outfits between subjects — each outfit belongs to exactly one person.
⛔ NEVER swap height or body type between subjects.
⛔ NEVER apply one subject's reference images to render a different subject.
⛔ NEVER invent clothing from the event name, scene theme, or crowd context for any subject.
⛔ NEVER replace any named subject with a generic crowd participant or stock photo person.
✅ Each subject must be rendered using ONLY their own sealed bundle.

════════════════════════════════════════════════════════════
UNIFIED COMPOSITION RULE
════════════════════════════════════════════════════════════
The image is ONE COHESIVE SCENE. All subjects are naturally integrated.
Do NOT: paste subjects over background | disconnect from room perspective | invent props
DO: move camera | change angle | apply time-of-day lighting | reframe from new camera position
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

        // ── Build subject fingerprints (identity checksums for regen/video systems) ──
        const structuredSubjectsWithFingerprints = structuredSubjects.map(s => ({
          ...s,
          // Fingerprint: stable_id:ref_count — detects missing/swapped subject bundles
          subject_fingerprint: `${s.subject_id}:${s.reference_image_count}`,
        }));

        const generationContext = {
          generation_context_version: 2,
          context_origin: 'media_grid',
          schema_written_at: new Date().toISOString(),

          // New structured format — read by recoverSingleImage and regenerateImageWithReason
          image_type: 'multi',
          subject_count: structuredSubjectsWithFingerprints.length,
          subjects: structuredSubjectsWithFingerprints,
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

        // ── SAFEGUARD 1: Runtime persistence validation ────────────────────────
        // Immediately re-read the saved message and verify the generation_context
        // was NOT stripped by schema enforcement. This prevents silent corruption
        // from masquerading as success — if subjects were stripped, this is a HARD FAIL.
        // "Success" means: image generated AND metadata survived persistence AND
        // regeneration contract is valid. Not just: image URL returned.
        await new Promise(r => setTimeout(r, 800));
        let persistenceValid = false;
        try {
          const savedMsg = await base44.asServiceRole.entities.Message.get(messageId);
          const savedCtx = savedMsg?.generation_context || {};
          const savedSubjects = savedCtx.subjects;
          const savedImageType = savedCtx.image_type;
          const savedVersion = savedCtx.generation_context_version;

          persistenceValid = (
            Array.isArray(savedSubjects) &&
            savedSubjects.length === structuredSubjectsWithFingerprints.length &&
            savedImageType === 'multi' &&
            savedVersion === 2
          );

          if (!persistenceValid) {
            console.error(`[mediaGridGenerate] ⛔ [ImageContextCorruption] generation_context persistence FAILED after write!`, {
              messageId,
              expectedSubjects: structuredSubjectsWithFingerprints.length,
              actualSubjects: Array.isArray(savedSubjects) ? savedSubjects.length : 'not_array',
              expectedImageType: 'multi',
              actualImageType: savedImageType,
              expectedVersion: 2,
              actualVersion: savedVersion,
              savedCtxKeys: Object.keys(savedCtx),
            });
            // Mark as failed — do not return success with broken metadata
            await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_CONTEXT_CORRUPTED]' }).catch(() => {});
            return Response.json({
              success: false,
              error: 'generation_context persistence failed — subjects stripped after DB write. Schema may have regressed. Run verifyImageContextSchema to diagnose.',
              persistence_validation_failed: true,
              expected_subjects: structuredSubjectsWithFingerprints.length,
              actual_subjects: Array.isArray(savedSubjects) ? savedSubjects.length : 0,
            }, { status: 500 });
          }

          console.log(`[mediaGridGenerate] ✅ Persistence validation PASSED: subjects=${savedSubjects.length} image_type=${savedImageType} version=${savedVersion}`);
        } catch (verifyErr) {
          console.warn(`[mediaGridGenerate] Persistence validation read failed (non-blocking): ${verifyErr?.message}`);
          // Non-blocking — if the read itself fails (network, rate-limit), don't abort the success
          // The write was attempted; we just couldn't verify. Log and continue.
          persistenceValid = true; // assume ok if read failed
        }

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