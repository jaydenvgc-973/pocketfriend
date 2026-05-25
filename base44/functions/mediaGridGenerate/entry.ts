/**
 * mediaGridGenerate — Multi-subject image generation with hard identity lock.
 *
 * ARCHITECTURAL CONTRACT:
 * - Characters/user are required visual subjects ONLY when selected in subject dropdowns
 *   OR when the prompt explicitly describes them as visually present.
 * - Character "mention" (possessive/context: "Sarah's lease", "James's car") is NOT a visual subject.
 * - Non-character images (objects, documents, locations, crowds, scenery) are fully supported.
 * - If required visual subjects exist, they MUST appear — no silent downgrade to scenery.
 * - If NO subjects are selected and prompt describes no visual person, generate the non-character image.
 * - All repair/regeneration routes through regenerateImageWithReason only.
 *
 * PERMANENT BAN — DO NOT VIOLATE:
 * imageVisualSourceValidator is permanently deleted and banned from this codebase.
 * Do NOT import it, recreate it, rename it, wrap it, or introduce any near-duplicate replacement.
 * This ban covers all files in lib/, functions/, components/, and pages/.
 * It is separate from appearanceLockValidator, which is a different system and is NOT banned.
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

/**
 * classifyPromptSubjectPresence — determines whether a named person is a VISUAL SUBJECT
 * or merely a contextual reference (possessive, ownership, sender, story mention).
 *
 * VISUAL SUBJECT indicators (person is in the image):
 *   - action verbs: standing, sitting, holding, taking, looking, walking, posing, smiling, etc.
 *   - body language: arms, hands, face, expression, smile, standing next to
 *   - selfie/portrait language: selfie, photo of them, portrait, photo with
 *   - co-subject language: "and [name]", "[name] and [name]"
 *   - first-person presence: "in the image", "in the photo", "visible", "appears"
 *
 * CONTEXT-ONLY indicators (person is NOT visually in the image):
 *   - possessive: "[name]'s [object/place/document]"
 *   - sends/shows a photo OF something: "sends a photo of", "shows [object]"
 *   - object/doc subject: lease, receipt, menu, contract, screenshot, car, apartment
 *   - location subject only: "[name]'s kitchen", "[name]'s apartment"
 *
 * Returns: 'visual_subject' | 'context_only' | 'ambiguous'
 */
function classifyPromptSubjectPresence(prompt, personName) {
  if (!prompt || !personName) return 'ambiguous';
  const p = prompt.toLowerCase();
  const name = personName.toLowerCase();
  const firstName = name.split(/\s+/)[0];

  // Check if the name appears at all
  const nameInPrompt = p.includes(name) || (firstName.length >= 4 && p.includes(firstName));
  if (!nameInPrompt) return 'context_only'; // not mentioned = not a visual subject from prompt

  // CONTEXT-ONLY patterns: possessive + object/document/location subject
  const possessivePattern = new RegExp(`\\b${firstName}['']?s?\\b.*?\\b(lease|receipt|menu|contract|screenshot|car|apartment|room|kitchen|bathroom|office|document|agreement|letter|text|message|photo of|picture of|image of|phone|wallet|bag|keys|id card|id)\\b`, 'i');
  const sendsPhotoOf = new RegExp(`\\b${firstName}\\b.*?\\b(sends?|shows?|took|taking|shares?|shared)\\b.*?\\b(photo|picture|image|pic|shot)\\b.*?\\bof\\b`, 'i');
  const locationPossessive = new RegExp(`\\b${firstName}['']?s?\\b.*?\\b(home|house|place|crib|spot|hangout|bar|club|room|bedroom|living room|kitchen|bathroom|backyard)\\b`, 'i');

  const isContextOnly = possessivePattern.test(p) || sendsPhotoOf.test(p) || locationPossessive.test(p);

  // VISUAL SUBJECT patterns: person is physically in the frame
  const visualVerbs = new RegExp(`\\b${firstName}\\b.*?\\b(standing|sitting|sat|holding|taking|smiling|laughing|looking|walking|running|leaning|reaching|eating|drinking|posing|lying|sleeping|waking|cooking|reading|typing|hugging|kissing|facing|near|beside|next to|pointing|gesturing|kneeling|crouching)\\b`, 'i');
  const visualWithUser = new RegExp(`\\b(and|with|\\+)\\s*${firstName}\\b|\\b${firstName}\\s*(and|with)\\b`, 'i');
  const selfieOrPortrait = new RegExp(`\\b${firstName}\\b.*?\\b(selfie|portrait|headshot|photo of (him|her|them|${firstName})|picture of (him|her|them|${firstName})|mirror shot)\\b`, 'i');
  const explicitlyVisible = new RegExp(`\\b${firstName}\\b.*?\\b(visible|in the (image|photo|picture|frame)|appears|shown|shown in|featured|in frame)\\b`, 'i');
  const subjectAtLocation = new RegExp(`\\b${firstName}\\b.*?\\b(at the|in the|inside|outside|by the|on the|at a|in a)\\b`, 'i');

  const isVisual = visualVerbs.test(p) || visualWithUser.test(p) || selfieOrPortrait.test(p) || explicitlyVisible.test(p);

  if (isVisual && !isContextOnly) return 'visual_subject';
  if (isContextOnly && !isVisual) return 'context_only';
  if (isContextOnly && isVisual) return 'visual_subject'; // explicit visual action wins over possessive context
  // subjectAtLocation is weakly visual (ambiguous) — only counts if not already context-only
  if (subjectAtLocation.test(p) && !isContextOnly) return 'visual_subject';
  return 'ambiguous';
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
    if (!prompt) {
      return Response.json({ error: 'prompt required' }, { status: 400 });
    }

    console.log(`[mediaGridGenerate] ▶ messageId=${messageId} | multiPerson=${!!multiPersonSelection}`);

    // ── CLASSIFICATION-FIRST SANITIZER — synced with generateImageAsync ────
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
    const promptHasExplicitTime = /nighttime|night time|middle of the night|midnight|late night|daytime|broad daylight|morning|afternoon|evening|golden hour|sunset|sunrise|dusk|dawn|dark room|dim light|low light/i.test(sanitizedPrompt);
    if (promptHasExplicitTime) {
      const detectedMatch = sanitizedPrompt.match(/nighttime|night time|middle of the night|midnight|late night|daytime|broad daylight|morning|afternoon|evening|golden hour|sunset|sunrise|dusk|dawn|dark room|dim light|low light/i);
      console.log(`[mediaGridGenerate] TIME AUTHORITY: prompt explicitly declares time-of-day → "${detectedMatch?.[0]}"`);
    }

    // ── USER-UPLOADED REFERENCE IMAGE GUIDANCE ─────────────────────────────
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
        sanitizedPrompt = `${purposeText} The reference image is the primary visual source. ${sanitizedPrompt}`;
      } else {
        sanitizedPrompt = `${sanitizedPrompt} [VISUAL GUIDANCE] ${purposeText} The written prompt takes priority for intent and subject; the reference image guides the visual execution.`;
      }
    }

    // ── MULTI-PERSON IDENTITY LOCK ─────────────────────────────────────────
    if (multiPersonSelection) {
      const selectedCount = multiPersonSelection.selectedCharacters.length;
      const includesUser = !!(multiPersonSelection.includeUser && multiPersonSelection.userReferenceImages);
      console.log(`[mediaGridGenerate] MULTI-PERSON MODE: ${selectedCount} characters + user=${includesUser}`);

      // ── SUBJECT CLASSIFICATION: filter out context-only references ────────
      // For each selected person, determine whether they are a true visual subject
      // based on the prompt. Context-only mentions (possessive/ownership) are not visual subjects.
      // SAFEGUARD: selected subjects in the dropdown ARE required visual participants by contract.
      // The classification below is only for LOGGING — selected subjects are always visual.
      // The spec states: "If a character/user is selected in the subject dropdown, they are a required visual subject."
      for (const person of multiPersonSelection.selectedCharacters) {
        const name = person.displayName || person.role || 'character';
        const presence = classifyPromptSubjectPresence(sanitizedPrompt, name);
        console.log(`[mediaGridGenerate] Subject classification: "${name}" → ${presence} (selected in dropdown = required visual subject regardless)`);
      }

      // ── VALIDATE IDENTITY REFS FOR REQUIRED VISUAL SUBJECTS ───────────────
      // Every selected person is a required visual participant — identity refs are required.
      const missingRefs = [];
      for (const person of multiPersonSelection.selectedCharacters) {
        if (!person.referenceImages || person.referenceImages.length === 0) {
          missingRefs.push(`${person.displayName || person.role} (${person.id})`);
        } else {
          console.log(`[mediaGridGenerate] ✓ ${person.displayName || person.role}: ${person.referenceImages.length} refs`);
        }
      }
      if (includesUser && (!multiPersonSelection.userReferenceImages || multiPersonSelection.userReferenceImages.length === 0)) {
        missingRefs.push('user/persona');
      }

      if (missingRefs.length > 0) {
        const errorMsg = `IDENTITY LOCK FAILED: Missing visual references for required subjects: ${missingRefs.join(', ')}. Add reference photos before generating.`;
        console.error(`[mediaGridGenerate] ⛔ ${errorMsg}`);
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({ success: false, error: errorMsg }, { status: 400 });
      }

      // ── BUILD MULTI-PERSON PROMPT ──────────────────────────────────────
      const allRefs = [];
      let refIndex = 1;

      for (const person of multiPersonSelection.selectedCharacters) {
        const refs = (person.referenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        refs.forEach(url => allRefs.push(url));
      }
      if (includesUser) {
        const refs = (multiPersonSelection.userReferenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        refs.forEach(url => allRefs.push(url));
      }

      const identityRefs = [];
      const people = [];
      refIndex = 1;

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

      const multiOutfitLines = [];

      for (const person of multiPersonSelection.selectedCharacters) {
        const refs = (person.referenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        identityRefs.push(...refs);

        let outfitText = null;
        let outfitSource = 'no_closet';
        let appearanceLock = null;

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
              const co = charRec.current_outfit;
              outfitText = (co?.outfit_id || co?.label) ? buildMGOutfitText(co) : null;
              if (!outfitText) {
                const closet = (charRec.character_closet || []).filter(o => o.outfit_id);
                if (closet.length > 0) outfitText = buildMGOutfitText(closet[0]);
              }
              outfitSource = (co?.outfit_id || co?.label) ? 'current_outfit' : (charRec.character_closet?.length > 0 ? 'closet_rotation' : 'no_closet');
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

      // ── RESOLVE USER BUNDLE ────────────────────────────────────────────────
      if (includesUser) {
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
            const ual = sett?.appearance_lock || {};
            userAppearanceLock = {
              gender: sett?.user_gender || null,
              skinTone: ual.skin_tone || null,
              hairStyle: ual.hairstyle || ual.hair_type || null,
              bodyType: ual.overall_aesthetic || null,
              height: ual.height_display || null,
              customKeywords: (ual.custom_keywords || []).join(', ') || null,
            };
            if (userOutfitText) multiOutfitLines.push({ subjectType: 'user', name: userPersonaName, text: userOutfitText, source: userOutfitSource });
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
        if (p.refCount > 0) {
          lines.push(`REFERENCE IMAGES: Images ${startIdx}–${endIdx}`);
          lines.push(`  These images show THIS SUBJECT'S FACE AND BODY ONLY.`);
          lines.push(`  ✅ Use ONLY for: face structure, skin tone, hair, body type`);
          lines.push(`  ⛔ IGNORE: background, pose, clothing, lighting in these photos`);
          lines.push(`  ⛔ These reference images belong EXCLUSIVELY to "${nameDisplay}" — do NOT apply to any other subject`);
        } else {
          lines.push(`REFERENCE IMAGES: None — generate "${nameDisplay}" from appearance lock and text description only.`);
          lines.push(`  ⛔ Do NOT substitute a generic or random person.`);
        }

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

      // Build mandatory subjects list — every dropdown-selected person MUST appear
      const mandatorySubjectsList = people.map(p => {
        const isUser = p.subjectRole === 'user';
        const nameDisplay = p.displayName || (isUser ? 'the user' : p.role);
        return `  • "${nameDisplay}" — ${isUser ? 'user/persona' : `character ID: ${p.id}`} — MUST be physically visible in the image`;
      }).join('\n');

      // Build mandatory location lock — if location/zone selected in dropdown, it is law
      const locationLock = (locationName || zoneName) ? `
════════════════════════════════════════════════════════════
⛔ MANDATORY LOCATION LOCK — SELECTED IN UI DROPDOWN — NON-NEGOTIABLE
════════════════════════════════════════════════════════════
The user selected this location from the dropdown. It is LOCKED. Do NOT substitute, invent, or ignore it.
Location: "${locationName || 'selected location'}"${zoneName ? `\nZone: "${zoneName}"` : ''}
${envRefs.length > 0 ? `Environment reference images: Images 1–${envRefs.length}
✅ PRESERVE: walls, floor, furniture, fixtures, objects, architecture, layout
✓ REGENERATE: lighting (time-of-day), camera angle, framing
⛔ Do NOT invent replacement furniture or use a different location` : '⛔ No reference images — render the named location faithfully based on its name and type.'}
════════════════════════════════════════════════════════════
` : (envRefs.length > 0 ? `
════════════════════════════════════════════════════════════
ENVIRONMENT — IMAGES 1–${envRefs.length}
════════════════════════════════════════════════════════════
✅ PRESERVE: walls, floor, furniture, fixtures, objects, architecture, layout
✓ REGENERATE: lighting (time-of-day), camera angle, framing, perspective
⛔ Do NOT invent replacement furniture or duplicate existing objects
════════════════════════════════════════════════════════════
` : '');

      const multiPersonPrompt = `
════════════════════════════════════════════════════════════
⛔ MANDATORY SUBJECTS — SELECTED IN UI DROPDOWN — ABSOLUTE LAW
════════════════════════════════════════════════════════════
The following subjects were explicitly selected by the user. They are REQUIRED to physically appear in this image.
Do NOT omit, replace, or substitute any of them with a generic person, stock photo subject, or crowd member.
Do NOT let the scene prompt override who must be in the image — the dropdown selection is the authority.

${mandatorySubjectsList}

GENERATION IS INVALID if any of the above subjects is absent from the final image.
════════════════════════════════════════════════════════════

${locationLock}
════════════════════════════════════════════════════════════
${nameRefKey}
════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════
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
SCENE PROMPT (describes action/emotion/setting — does NOT override mandatory subjects or location)
════════════════════════════════════════════════════════════
${sanitizedPrompt}

════════════════════════════════════════════════════════════
UNIFIED COMPOSITION RULE
════════════════════════════════════════════════════════════
The image is ONE COHESIVE SCENE. All mandatory subjects are naturally integrated into the locked location.
Do NOT: omit any mandatory subject | paste subjects over background | invent a different location
DO: move camera | change angle | apply time-of-day lighting | reframe from new camera position

INTENSITY BALANCING:
When closeness + nighttime + private setting + minimal clothing co-occur, do NOT maximize all signals at once.
`;

      console.log(`[mediaGridGenerate] Multi-person prompt built for ${people.length} people with ${identityRefs.length} identity refs + ${envRefs.length} env refs`);

      const allReferences = [
        ...envRefs,
        ...identityRefs,
      ];

      if (hasUserRef) {
        allReferences.push(toPublicCDN(referenceImageUrl));
      }

      try {
        const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: multiPersonPrompt,
          existing_image_urls: allReferences.length > 0 ? allReferences : undefined,
        });

        if (!genRes?.url) {
          await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
          return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
        }

        // Build structured subjects array — matches generateImageAsync format for regen/recovery
        const structuredSubjects = people.map(p => ({
          subject_type: p.role === 'user' ? 'user' : 'character',
          subject_id: p.id,
          subject_name: p.displayName || null,
          role: p.role,
          reference_image_count: p.refCount,
          reference_images: identityRefs.slice(p.refStart - 1, p.refStart - 1 + p.refCount),
          subject_fingerprint: `${p.id}:${p.refCount}`,
        }));

        const generationContext = {
          generation_context_version: 2,
          context_origin: 'media_grid',
          schema_written_at: new Date().toISOString(),

          // New structured format — read by recoverSingleImage and regenerateImageWithReason
          image_type: 'multi',
          subject_count: structuredSubjects.length,
          subjects: structuredSubjects,
          scene_prompt: prompt,
          original_raw_prompt: prompt,
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

        // ── SAFEGUARD: Runtime persistence validation ────────────────────────
        await new Promise(r => setTimeout(r, 800));
        try {
          const savedMsg = await base44.asServiceRole.entities.Message.get(messageId);
          const savedCtx = savedMsg?.generation_context || {};
          const savedSubjects = savedCtx.subjects;
          const persistenceValid = (
            Array.isArray(savedSubjects) &&
            savedSubjects.length === structuredSubjects.length &&
            savedCtx.image_type === 'multi' &&
            savedCtx.generation_context_version === 2
          );
          if (!persistenceValid) {
            console.error(`[mediaGridGenerate] ⛔ [ImageContextCorruption] generation_context persistence FAILED after write!`, {
              messageId,
              expectedSubjects: structuredSubjects.length,
              actualSubjects: Array.isArray(savedSubjects) ? savedSubjects.length : 'not_array',
            });
            await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_CONTEXT_CORRUPTED]' }).catch(() => {});
            return Response.json({
              success: false,
              error: 'generation_context persistence failed — subjects stripped after DB write. Run verifyImageContextSchema to diagnose.',
              persistence_validation_failed: true,
            }, { status: 500 });
          }
          console.log(`[mediaGridGenerate] ✅ Persistence validation PASSED: subjects=${savedSubjects.length}`);
        } catch (verifyErr) {
          console.warn(`[mediaGridGenerate] Persistence validation read failed (non-blocking): ${verifyErr?.message}`);
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

    // ── SINGLE-SUBJECT / NON-CHARACTER MODE ────────────────────────────────
    // This path handles:
    //   1. Single character subject (subjectType='character')
    //   2. User-only subject (subjectType='user')
    //   3. NO subject selected — non-character image (location, object, document, scenery, crowd)
    //
    // CRITICAL: "no subject selected" is valid when the image is about a location, object,
    // document, crowd, or other non-character visual. The prompt is the source of truth.

    const resolvedSubjectType = subjectType || 'character';
    const isUserOnly = resolvedSubjectType === 'user';
    const isNoSubject = !characterId && !isUserOnly && resolvedSubjectType !== 'character';

    console.log(`[mediaGridGenerate] ── SUBJECT AUDIT ──`);
    console.log(`[mediaGridGenerate]   subjectType:           ${resolvedSubjectType}`);
    console.log(`[mediaGridGenerate]   characterId passed:    ${characterId || 'null'}`);
    console.log(`[mediaGridGenerate]   isUserOnly:            ${isUserOnly}`);
    console.log(`[mediaGridGenerate]   isNoSubject:           ${isNoSubject}`);
    console.log(`[mediaGridGenerate]   charRefImages count:   ${(characterRefImages || []).length}`);
    console.log(`[mediaGridGenerate]   userRefImages count:   ${(userRefImages || []).length}`);

    // Subject classification for logging — "character mention" vs "visual subject"
    if (characterId && characterName) {
      const presence = classifyPromptSubjectPresence(sanitizedPrompt, characterName);
      console.log(`[mediaGridGenerate] Prompt subject classification for "${characterName}": ${presence}`);
      if (presence === 'context_only') {
        console.log(`[mediaGridGenerate] ⚠️ "${characterName}" appears context-only in prompt (possessive/sender) — but IS selected as subject, so identity lock still applies`);
      }
    }

    // Backend USER-ONLY GUARD
    if (isUserOnly && (characterId || characterName || (characterRefImages || []).length > 0)) {
      console.warn(`[mediaGridGenerate] ⛔ USER-ONLY GUARD: character identity fields present but subjectType=user — CLEARED`);
    }

    const effectiveCharacterId   = isUserOnly ? null : characterId;
    const effectiveCharacterName = isUserOnly ? null : characterName;
    const effectiveCharacterRefs = isUserOnly ? [] : (characterRefImages || []).map(toPublicCDN).filter(isAccessible);
    const effectiveSenderCharId  = isUserOnly ? null : characterId;

    // ── NON-CHARACTER IMAGE PATH ───────────────────────────────────────────
    // When no visual subject is selected, generate directly from prompt + environment.
    // This supports: locations, objects, documents, crowds, scenery, atmosphere, story props.
    if (isNoSubject && !characterId) {
      console.log(`[mediaGridGenerate] NON-CHARACTER IMAGE PATH: no visual subjects — generating from prompt + environment`);

      const envRefs = (zoneImageUrls || []).map(toPublicCDN).filter(isAccessible).slice(0, 4);
      const allRefs = [...envRefs];
      if (hasUserRef) allRefs.push(toPublicCDN(referenceImageUrl));

      const nonCharPrompt = `
${envRefs.length > 0 ? `════════════════════════════════════════════════════════════
ENVIRONMENT REFERENCE — IMAGES 1–${envRefs.length}
════════════════════════════════════════════════════════════
These are reference photos of the location: "${locationName || 'selected location'}"${zoneName ? ` → zone: "${zoneName}"` : ''}.
Use them to understand the physical space, layout, materials, and style.
✅ Extract: architecture, furniture types, colors, spatial structure
⛔ Do NOT copy camera angle or lighting from references — re-render from a natural camera position
⛔ Do NOT place any specific named character in the scene unless described in the prompt

════════════════════════════════════════════════════════════
` : ''}════════════════════════════════════════════════════════════
SCENE PROMPT:
════════════════════════════════════════════════════════════
${sanitizedPrompt}

Photorealistic photograph. Ultra-detailed. Not an illustration.
${envRefs.length > 0 ? `Render the scene faithfully using the reference environment as a spatial guide.` : ''}

IMPORTANT: This image does NOT require a specific named character to appear.
Generate exactly what the prompt describes — object, document, location, crowd, scenery, or atmosphere.
Do NOT insert a random person or generic individual as a visual filler.
If the prompt mentions a crowd or background people, render them as generic, indistinct background figures only.
`;

      try {
        const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: nonCharPrompt,
          existing_image_urls: allRefs.length > 0 ? allRefs : undefined,
        });

        if (!genRes?.url) {
          await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
          return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
        }

        const generationContext = {
          generation_context_version: 2,
          context_origin: 'media_grid',
          schema_written_at: new Date().toISOString(),
          image_type: 'non_character',
          subject_count: 0,
          subjects: [],
          scene_prompt: prompt,
          original_raw_prompt: prompt,
          prompt,
          subjectType: resolvedSubjectType,
          character_id: null,
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

        console.log(`[mediaGridGenerate] ✓ Non-character image SUCCESS: ${messageId}`);
        return Response.json({
          success: true,
          imageUrl: genRes.url,
          messageId,
          subjectType: 'non_character',
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

    // ── SINGLE CHARACTER / USER MODE — delegate to generateImageAsync ──────
    console.log(`[mediaGridGenerate] Single-character mode: delegating to generateImageAsync`);
    console.log(`[mediaGridGenerate]   final characterId:     ${effectiveCharacterId || 'null'}`);
    console.log(`[mediaGridGenerate]   final senderCharId:    ${effectiveSenderCharId || 'null'}`);
    console.log(`[mediaGridGenerate]   final charRefs count:  ${effectiveCharacterRefs.length}`);

    const userOnlyExclusionNote = isUserOnly
      ? '\n\n⛔ USER-ONLY IMAGE: Do NOT include any app characters, fictional persons, or named individuals in this image unless they are explicitly described in the scene prompt. The person in this image is only the user. No character identity refs were provided.'
      : '';

    // MANDATORY SUBJECT LOCK for single-subject path
    const singleSubjectLock = effectiveCharacterName
      ? `\n\n⛔ MANDATORY SUBJECT — SELECTED IN UI DROPDOWN: "${effectiveCharacterName}" (character ID: ${effectiveCharacterId}) MUST physically appear in this image. Do NOT omit or substitute them.`
      : isUserOnly
      ? `\n\n⛔ MANDATORY SUBJECT — SELECTED IN UI DROPDOWN: The user/persona MUST physically appear in this image. Do NOT omit or substitute them.`
      : '';

    // MANDATORY LOCATION LOCK for single-subject path — UI dropdown selection overrides auto-resolve
    const singleLocationLock = (locationName || zoneName)
      ? `\n\n⛔ MANDATORY LOCATION — SELECTED IN UI DROPDOWN: Location="${locationName || 'selected location'}"${zoneName ? ` Zone="${zoneName}"` : ''}. This location is LOCKED. Do NOT substitute or invent a different setting. Render the scene at this exact location.`
      : '';

    const singleCharRes = await base44.functions.invoke('generateImageAsync', {
      messageId,
      prompt: sanitizedPrompt + singleSubjectLock + singleLocationLock + userOnlyExclusionNote,
      characterId: effectiveCharacterId,
      characterName: effectiveCharacterName,
      senderCharacterId: effectiveSenderCharId,
      characterReferenceImages: effectiveCharacterRefs,
      userReferenceImages: userRefImages ? (userRefImages || []).map(toPublicCDN).filter(isAccessible) : [],
      userWorldName: userName || null,
      subjectType: resolvedSubjectType,
      characterEmotionalState: 'calm',
      userUploadedReferenceUrl: hasUserRef ? toPublicCDN(referenceImageUrl) : null,
      // Pass the UI-selected location so generateImageAsync uses it instead of auto-resolving
      // from the character's DB record (which may point to a different location than selected)
      manualLocationId: locationId || null,
      manualZoneName: zoneName || null,
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
      subjectType: resolvedSubjectType,
    });

  } catch (error) {
    console.error('[mediaGridGenerate] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});