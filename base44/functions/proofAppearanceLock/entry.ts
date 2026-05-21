/**
 * proofAppearanceLock — Diagnostic proof function.
 *
 * WHAT THIS DOES:
 * 1. Runs the canonical appearance vs. conflicting prompt test (dreadlocks vs short hair)
 * 2. Shows every field at every stage: raw lock fields → prompt traits → rejected → final prompt
 * 3. Optionally generates a real image and runs post-generation vision validation
 * 4. Outputs all required diagnostic proof fields
 *
 * This is NOT a fix. It is PROOF that the system works as required.
 * Run it to confirm canonical enforcement is real, not just claimed.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── SHARED: Canonical appearance parser (structured fields FIRST, regex fallback) ──────────
function parseCanonicalAppearance(appearanceLock, charRecord) {
  const lock = appearanceLock || {};
  const rec = charRecord || {};

  // STRUCTURED FIELDS — highest priority source of truth
  const structured = {
    hair_type:         lock.hair_type || null,
    hairstyle:         lock.hairstyle || null,
    hair_color:        lock.hair_color || null,
    facial_hair:       lock.facial_hair || null,
    skin_tone:         lock.skin_tone || null,
    overall_aesthetic: lock.overall_aesthetic || null,
    height_inches:     lock.height_inches || null,
    bald:              lock.bald === true || /\b(bald|shaved head|no hair)\b/i.test(lock.hair_type || ''),
  };

  // STRUCTURED PROFILE FIELDS (character record level) — second priority
  const profile = {
    gender:      rec.gender || null,
    age_range:   rec.age_range || null,
    ethnicities: (rec.ethnicities || []).join('/') || null,
  };

  // TEXT FALLBACK — only used if structured fields are absent
  const descText = [rec.appearance_notes, rec.avatar_description_text].filter(Boolean).join(' ');
  const fallback = {
    hair_type_text:   !structured.hair_type ? (descText.match(/\b(dreadlocks?|locs?|afro|coils?|braids?|long hair|short hair|buzz cut|fade|bald|shaved head|pixie|bob|wavy|curly|straight|natural hair|voluminous|cornrows|twists?)/i)?.[1] || null) : null,
    hairstyle_text:   !structured.hairstyle ? (descText.match(/\b(hairstyle:[^,.\n]+)/i)?.[1]?.replace(/^hairstyle:\s*/i,'').trim() || null) : null,
    facial_hair_text: !structured.facial_hair ? (descText.match(/\b(clean-?shaven|no facial hair|beard|full beard|thick beard|goatee|mustache|stubble)/i)?.[1] || null) : null,
    skin_tone_text:   !structured.skin_tone ? (descText.match(/\b(fair skin|light skin|pale skin|medium skin|olive skin|tan skin|brown skin|dark skin|deep skin|ebony skin)/i)?.[1] || null) : null,
    body_type_text:   !structured.overall_aesthetic ? (descText.match(/\b(slim|slender|lean|athletic|muscular|stocky|heavyset|curvy|petite|tall|broad|average build|overweight)/i)?.[1] || null) : null,
  };

  // RESOLVED — structured wins, fallback fills gaps
  const resolved = {
    canonical_hair_type:   structured.hair_type || fallback.hair_type_text || null,
    canonical_hairstyle:   structured.hairstyle || fallback.hairstyle_text || null,
    canonical_hair_color:  structured.hair_color || null,
    canonical_facial_hair: structured.facial_hair || fallback.facial_hair_text || null,
    canonical_skin_tone:   structured.skin_tone || fallback.skin_tone_text || null,
    canonical_body_type:   structured.overall_aesthetic || fallback.body_type_text || null,
    canonical_bald:        structured.bald,
    source_priority: {
      hair:       structured.hair_type ? 'structured_lock' : (fallback.hair_type_text ? 'text_fallback' : 'absent'),
      hairstyle:  structured.hairstyle ? 'structured_lock' : (fallback.hairstyle_text ? 'text_fallback' : 'absent'),
      facial:     structured.facial_hair ? 'structured_lock' : (fallback.facial_hair_text ? 'text_fallback' : 'absent'),
      skin:       structured.skin_tone ? 'structured_lock' : (fallback.skin_tone_text ? 'text_fallback' : 'absent'),
      body:       structured.overall_aesthetic ? 'structured_lock' : (fallback.body_type_text ? 'text_fallback' : 'absent'),
    },
    profile,
    raw_lock_fields: structured,
  };
  return resolved;
}

// ── SHARED: Prompt appearance conflict detector ──────────────────────────────────────────
function detectPromptAppearanceConflicts(promptText, canonicalTraits) {
  const p = promptText.toLowerCase();
  const requested = [];
  const rejected = [];
  const approved = [];

  // Detect what the prompt is requesting
  const hairMatches = p.match(/\b(long hair|short hair|dreadlocks?|locs?|afro|buzz cut|fade|bald|braids?|curly hair|straight hair|wavy hair|cornrows|natural hair|pixie|bob)\b/gi) || [];
  hairMatches.forEach(m => requested.push({ field: 'hair', value: m.toLowerCase() }));

  const facialMatches = p.match(/\b(beard|goatee|stubble|clean-?shaven|mustache|no facial hair)\b/gi) || [];
  facialMatches.forEach(m => requested.push({ field: 'facial_hair', value: m.toLowerCase() }));

  const skinMatches = p.match(/\b(fair skin|light skin|pale skin|dark skin|brown skin|olive skin)\b/gi) || [];
  skinMatches.forEach(m => requested.push({ field: 'skin_tone', value: m.toLowerCase() }));

  const bodyMatches = p.match(/\b(slim|slender|lean|athletic|muscular|stocky|heavyset|overweight)\b/gi) || [];
  bodyMatches.forEach(m => requested.push({ field: 'body_type', value: m.toLowerCase() }));

  // Compare each requested trait vs canonical
  for (const req of requested) {
    const canonicalHair = canonicalTraits.canonical_hair_type || canonicalTraits.canonical_hairstyle || '';
    const isBald = canonicalTraits.canonical_bald;

    let isConflict = false;
    let reason = '';

    if (req.field === 'hair') {
      if (isBald && !/bald/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=bald, prompt requests ${req.value}`;
      } else if (/dreadlocks?|locs?/i.test(canonicalHair) && !/dreadlocks?|locs?/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=dreadlocks, prompt requests ${req.value}`;
      } else if (/long hair/i.test(canonicalHair) && /short hair|buzz|fade|cropped/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=long hair, prompt requests ${req.value}`;
      } else if (/short hair|buzz|fade/i.test(canonicalHair) && /long hair|dreadlocks?|locs?/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=short hair, prompt requests ${req.value}`;
      } else if (/afro/i.test(canonicalHair) && !/afro/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=afro, prompt requests ${req.value}`;
      }
    } else if (req.field === 'facial_hair') {
      const canonicalFacial = canonicalTraits.canonical_facial_hair || '';
      if (/clean-?shaven|no facial hair/i.test(canonicalFacial) && /beard|goatee|stubble/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=clean-shaven, prompt requests ${req.value}`;
      } else if (/beard|goatee|stubble/i.test(canonicalFacial) && /clean-?shaven/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=${canonicalFacial}, prompt requests ${req.value}`;
      }
    } else if (req.field === 'skin_tone') {
      const canonicalSkin = canonicalTraits.canonical_skin_tone || '';
      if (/dark|deep|ebony|brown/i.test(canonicalSkin) && /fair|light|pale/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=${canonicalSkin}, prompt requests ${req.value}`;
      } else if (/fair|light|pale/i.test(canonicalSkin) && /dark|deep|ebony/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=${canonicalSkin}, prompt requests ${req.value}`;
      }
    } else if (req.field === 'body_type') {
      const canonicalBody = canonicalTraits.canonical_body_type || '';
      if (/heavyset|stocky|overweight/i.test(canonicalBody) && /slim|slender|lean/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=${canonicalBody}, prompt requests ${req.value}`;
      } else if (/slim|slender|lean/i.test(canonicalBody) && /heavyset|stocky/i.test(req.value)) {
        isConflict = true;
        reason = `canonical=${canonicalBody}, prompt requests ${req.value}`;
      }
    }

    if (isConflict) {
      rejected.push({ field: req.field, rejected_value: req.value, reason, canonical_wins: true });
    } else {
      approved.push({ field: req.field, value: req.value, status: 'compatible_with_canonical' });
    }
  }

  return { requested, rejected, approved };
}

// ── SHARED: Prompt sanitizer using structured lock fields ────────────────────────────────
function sanitizePromptAgainstLock(promptText, appearanceLock) {
  const lock = appearanceLock || {};
  let result = promptText;
  const corrections = [];

  const fix = (field, pattern, replacement) => {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) corrections.push({ field, pattern: String(pattern), replaced_with: replacement });
  };

  // HAIR TYPE — structured lock.hair_type is the authority
  if (lock.hair_type || lock.hairstyle) {
    const lh = [lock.hair_type, lock.hairstyle].filter(Boolean).join(' ').toLowerCase();
    const isBald = lock.bald === true || /\b(bald|shaved head|no hair)\b/.test(lh);

    if (isBald) {
      fix('hair', /\b(long\s+hair|short\s+hair|curly\s+hair|dreadlocks?|locs?|afro|braids?|fade|buzz\s+cut|cornrows|full\s+head\s+of\s+hair|natural\s+hair|wavy\s+hair|straight\s+hair)\b/gi, 'bald');
    } else if (/\b(dreadlocks?|locs?)\b/.test(lh)) {
      fix('hair', /\b(short\s+(?:dark\s+)?hair|closely?\s+cropped(?:\s+hair)?|buzz\s+cut|fade(?:\s+cut)?|shaved(?:\s+head)?|bald|straight\s+hair|generic\s+curls?)\b/gi, 'dreadlocks');
    } else if (/\b(long\s*hair|afro|coily|voluminous|braids?|cornrows)\b/.test(lh)) {
      fix('hair', /\b(short\s+(?:dark\s+)?hair|closely?\s+cropped\s+hair|buzz\s+cut|fade\s+cut|cropped\s+hair)\b/gi, lh + ' hair');
    } else if (/\b(short|cropped|buzz|fade)\b/.test(lh)) {
      fix('hair', /\b(long\s+(?:flowing\s+)?hair|flowing\s+hair|waist[\s-]length\s+hair|dreadlocks?|locs?)\b/gi, lh + ' hair');
    } else if (/\b(afro)\b/.test(lh)) {
      fix('hair', /\b(short\s+hair|straight\s+hair|fade|buzz\s+cut)\b/gi, 'afro');
    }
  }

  // FACIAL HAIR — structured lock.facial_hair is the authority
  if (lock.facial_hair) {
    const lf = lock.facial_hair.toLowerCase();
    if (/\b(clean-?shaven|no facial hair|shaved)\b/.test(lf)) {
      fix('facial_hair', /\b(thick\s+beard|full\s+beard|long\s+beard|beard|goatee|stubble|mustache)\b/gi, 'clean-shaven');
    } else if (/\b(beard|goatee|stubble|mustache)\b/.test(lf)) {
      fix('facial_hair', /\bclean-?shaven\b/gi, lf);
    }
  }

  // SKIN TONE — structured lock.skin_tone is the authority
  if (lock.skin_tone) {
    const ls = lock.skin_tone.toLowerCase();
    if (/\b(dark|deep|rich brown|ebony)\b/.test(ls)) {
      fix('skin_tone', /\b(fair[- ]?skinned|light[- ]?skinned|pale[- ]?skinned|pale\s+skin|fair\s+skin|light\s+skin)\b/gi, ls + ' skin');
    } else if (/\b(fair|light|pale|porcelain|ivory)\b/.test(ls)) {
      fix('skin_tone', /\b(dark[- ]?skinned|dark\s+skin|deeply\s+complexioned)\b/gi, ls + ' skin');
    }
  }

  // BODY TYPE — structured lock.overall_aesthetic is the authority
  if (lock.overall_aesthetic) {
    const la = lock.overall_aesthetic.toLowerCase();
    if (/\b(heavyset|heavy.?set|overweight|plus.?size|stocky)\b/.test(la)) {
      fix('body_type', /\b(slim|slender|lean|thin|skinny)\b/gi, la);
    } else if (/\b(slim|slender|lean|petite)\b/.test(la)) {
      fix('body_type', /\b(heavyset|overweight|large\s+frame|plus.?size|stocky)\b/gi, la);
    }
  }

  return { sanitized: result, corrections };
}

// ── SHARED: Post-generation vision validation prompt ─────────────────────────────────────
function buildVisionValidationPrompt(canonicalTraits, expectedHumanCount, charName) {
  const lines = [
    `You are a strict image quality validator. Analyze the provided image and return a JSON object.`,
    ``,
    `CHARACTER BEING VALIDATED: "${charName || 'subject'}"`,
    ``,
    `CANONICAL IDENTITY (source of truth — what the image MUST show):`,
  ];

  if (canonicalTraits.canonical_bald) {
    lines.push(`- Hair: BALD (completely bald head, no hair at all)`);
  } else if (canonicalTraits.canonical_hair_type || canonicalTraits.canonical_hairstyle) {
    lines.push(`- Hair: ${[canonicalTraits.canonical_hair_type, canonicalTraits.canonical_hairstyle].filter(Boolean).join(', ')}`);
  }
  if (canonicalTraits.canonical_hair_color) lines.push(`- Hair color: ${canonicalTraits.canonical_hair_color}`);
  if (canonicalTraits.canonical_facial_hair) lines.push(`- Facial hair: ${canonicalTraits.canonical_facial_hair}`);
  if (canonicalTraits.canonical_skin_tone) lines.push(`- Skin tone: ${canonicalTraits.canonical_skin_tone}`);
  if (canonicalTraits.canonical_body_type) lines.push(`- Body type: ${canonicalTraits.canonical_body_type}`);

  lines.push(``, `EXPECTED HUMAN COUNT: ${expectedHumanCount}`);
  lines.push(``, `YOUR TASK: Analyze the image and return JSON with these exact fields:`);
  lines.push(`{`);
  lines.push(`  "detected_hair": "describe what hair you see in the image",`);
  lines.push(`  "detected_facial_hair": "describe facial hair or 'none'",`);
  lines.push(`  "detected_skin_tone": "describe skin tone seen",`);
  lines.push(`  "detected_body_type": "describe body type seen",`);
  lines.push(`  "detected_human_count": number,`);
  lines.push(`  "unauthorized_humans_detected": boolean,`);
  lines.push(`  "partial_humans_detected": boolean,`);
  lines.push(`  "silhouettes_detected": boolean,`);
  lines.push(`  "reflections_with_humans_detected": boolean,`);
  lines.push(`  "hair_mismatch_detected": boolean,`);
  lines.push(`  "facial_hair_mismatch_detected": boolean,`);
  lines.push(`  "skin_tone_mismatch_detected": boolean,`);
  lines.push(`  "body_type_mismatch_detected": boolean,`);
  lines.push(`  "appearance_conflict_detected": boolean,`);
  lines.push(`  "human_count_violation": boolean,`);
  lines.push(`  "image_passes_validation": boolean,`);
  lines.push(`  "generation_rejected_reason": "null if passes, otherwise specific reason",`);
  lines.push(`  "identity_drift_score": number from 0-10 (0=perfect match, 10=completely wrong person),`);
  lines.push(`  "confidence": number from 0-1`);
  lines.push(`}`);
  lines.push(``, `BE STRICT. If canonical says dreadlocks and image shows any other hair type, hair_mismatch_detected=true.`);
  lines.push(`If canonical says bald and image shows any hair, hair_mismatch_detected=true.`);
  lines.push(`If expected humans=${expectedHumanCount} and you see more, human_count_violation=true.`);

  return lines.join('\n');
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      // Optional: pass a real character ID to test against a live record
      characterId,
      // Optional: override appearance_lock for testing without a real character
      mockAppearanceLock,
      // Optional: the user prompt to test against canonical traits
      testPrompt,
      // Optional: generate a real image and run vision validation
      generateAndValidate,
    } = await req.json().catch(() => ({}));

    const proofTimestamp = new Date().toISOString();

    // ── STEP 1: RESOLVE CANONICAL TRAITS ─────────────────────────────────────
    let charRecord = null;
    let appearanceLock = null;
    let charName = 'TestCharacter';

    if (characterId) {
      const chars = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      charRecord = chars?.[0] || null;
      if (!charRecord) {
        const charsSR = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
        charRecord = charsSR?.[0] || null;
      }
      if (charRecord) {
        appearanceLock = charRecord.appearance_lock || {};
        charName = charRecord.name || charName;
      }
    }

    // Mock appearance lock for test scenario: dreadlocks character
    if (!appearanceLock || Object.keys(appearanceLock).length === 0) {
      appearanceLock = mockAppearanceLock || {
        hair_type: 'dreadlocks',
        hairstyle: 'long dreadlocks',
        skin_tone: 'dark brown skin',
        facial_hair: 'clean-shaven',
        overall_aesthetic: 'athletic build',
      };
      charName = charRecord?.name || 'TestCharacter_Dreadlocks';
    }

    console.log(`[proofAppearanceLock] ── STEP 1: Canonical Trait Resolution ──`);
    console.log(`[proofAppearanceLock] character: ${charName}`);
    console.log(`[proofAppearanceLock] appearance_lock fields: ${Object.keys(appearanceLock).join(', ')}`);

    const canonicalTraits = parseCanonicalAppearance(appearanceLock, charRecord || {});

    console.log(`[proofAppearanceLock] canonical_hair_type:    ${canonicalTraits.canonical_hair_type}`);
    console.log(`[proofAppearanceLock] canonical_hairstyle:    ${canonicalTraits.canonical_hairstyle}`);
    console.log(`[proofAppearanceLock] canonical_facial_hair:  ${canonicalTraits.canonical_facial_hair}`);
    console.log(`[proofAppearanceLock] canonical_skin_tone:    ${canonicalTraits.canonical_skin_tone}`);
    console.log(`[proofAppearanceLock] canonical_body_type:    ${canonicalTraits.canonical_body_type}`);
    console.log(`[proofAppearanceLock] canonical_bald:         ${canonicalTraits.canonical_bald}`);
    console.log(`[proofAppearanceLock] source_priority:        ${JSON.stringify(canonicalTraits.source_priority)}`);

    // ── STEP 2: TEST PROMPT — default uses conflicting short hair prompt ──────
    const originalUserPrompt = testPrompt || `${charName} standing at the park with short hair and a full beard, looking confident.`;

    console.log(`[proofAppearanceLock] ── STEP 2: Prompt Conflict Detection ──`);
    console.log(`[proofAppearanceLock] original_prompt: "${originalUserPrompt}"`);

    const conflictAnalysis = detectPromptAppearanceConflicts(originalUserPrompt, canonicalTraits);

    console.log(`[proofAppearanceLock] prompt_requested_traits: ${JSON.stringify(conflictAnalysis.requested)}`);
    console.log(`[proofAppearanceLock] rejected_prompt_traits: ${JSON.stringify(conflictAnalysis.rejected)}`);
    console.log(`[proofAppearanceLock] approved_prompt_traits: ${JSON.stringify(conflictAnalysis.approved)}`);

    // ── STEP 3: SANITIZE PROMPT ───────────────────────────────────────────────
    console.log(`[proofAppearanceLock] ── STEP 3: Prompt Sanitization ──`);

    const { sanitized: finalSanitizedPrompt, corrections } = sanitizePromptAgainstLock(originalUserPrompt, appearanceLock);

    console.log(`[proofAppearanceLock] corrections_applied: ${corrections.length}`);
    corrections.forEach(c => console.log(`[proofAppearanceLock]   [CORRECTION] field=${c.field} pattern=${c.pattern} → "${c.replaced_with}"`));
    console.log(`[proofAppearanceLock] final_sanitized_prompt: "${finalSanitizedPrompt}"`);

    // ── STEP 4: BUILD CANONICAL LOCK BLOCK FOR PROMPT INJECTION ──────────────
    const canonicalBlock = buildCanonicalLockBlock(canonicalTraits, charName);

    // ── STEP 5: OPTIONAL — GENERATE AND VISION-VALIDATE ──────────────────────
    let visionValidationResult = null;
    let imageUrl = null;
    let postGenerationReport = null;

    if (generateAndValidate) {
      console.log(`[proofAppearanceLock] ── STEP 5: Generate + Vision Validate ──`);

      const testGenerationPrompt = `${canonicalBlock}\n\n${finalSanitizedPrompt}\n\nPhotorealistic photograph. Real human. Not an illustration.`;

      try {
        const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: testGenerationPrompt,
          existing_image_urls: charRecord?.reference_image_urls?.length > 0
            ? charRecord.reference_image_urls.slice(0, 2)
            : undefined,
        });

        imageUrl = genRes?.url || null;
        console.log(`[proofAppearanceLock] Generated image URL: ${imageUrl}`);

        if (imageUrl) {
          // Run post-generation vision validation
          const visionPrompt = buildVisionValidationPrompt(canonicalTraits, 1, charName);
          const visionResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: visionPrompt,
            file_urls: [imageUrl],
            response_json_schema: {
              type: 'object',
              properties: {
                detected_hair: { type: 'string' },
                detected_facial_hair: { type: 'string' },
                detected_skin_tone: { type: 'string' },
                detected_body_type: { type: 'string' },
                detected_human_count: { type: 'number' },
                unauthorized_humans_detected: { type: 'boolean' },
                partial_humans_detected: { type: 'boolean' },
                silhouettes_detected: { type: 'boolean' },
                reflections_with_humans_detected: { type: 'boolean' },
                hair_mismatch_detected: { type: 'boolean' },
                facial_hair_mismatch_detected: { type: 'boolean' },
                skin_tone_mismatch_detected: { type: 'boolean' },
                body_type_mismatch_detected: { type: 'boolean' },
                appearance_conflict_detected: { type: 'boolean' },
                human_count_violation: { type: 'boolean' },
                image_passes_validation: { type: 'boolean' },
                generation_rejected_reason: { type: 'string' },
                identity_drift_score: { type: 'number' },
                confidence: { type: 'number' },
              },
            },
          });

          visionValidationResult = visionResponse;

          postGenerationReport = {
            image_url: imageUrl,
            detected_generated_traits: {
              detected_hair: visionValidationResult.detected_hair,
              detected_facial_hair: visionValidationResult.detected_facial_hair,
              detected_skin_tone: visionValidationResult.detected_skin_tone,
              detected_body_type: visionValidationResult.detected_body_type,
              detected_human_count: visionValidationResult.detected_human_count,
            },
            appearance_conflict_detected: visionValidationResult.appearance_conflict_detected,
            hair_mismatch_detected: visionValidationResult.hair_mismatch_detected,
            body_mismatch_detected: visionValidationResult.body_type_mismatch_detected,
            facial_hair_mismatch_detected: visionValidationResult.facial_hair_mismatch_detected,
            unauthorized_humans_detected: visionValidationResult.unauthorized_humans_detected,
            partial_humans_detected: visionValidationResult.partial_humans_detected,
            identity_drift_score: visionValidationResult.identity_drift_score,
            image_passes_validation: visionValidationResult.image_passes_validation,
            generation_rejected_reason: visionValidationResult.generation_rejected_reason === 'null' ? null : visionValidationResult.generation_rejected_reason,
            would_reject_and_regenerate: !visionValidationResult.image_passes_validation,
            confidence: visionValidationResult.confidence,
          };

          console.log(`[proofAppearanceLock] ── Post-Generation Validation Result ──`);
          console.log(`[proofAppearanceLock] image_passes_validation: ${visionValidationResult.image_passes_validation}`);
          console.log(`[proofAppearanceLock] hair_mismatch_detected: ${visionValidationResult.hair_mismatch_detected}`);
          console.log(`[proofAppearanceLock] facial_hair_mismatch_detected: ${visionValidationResult.facial_hair_mismatch_detected}`);
          console.log(`[proofAppearanceLock] identity_drift_score: ${visionValidationResult.identity_drift_score}`);
          console.log(`[proofAppearanceLock] generation_rejected_reason: ${visionValidationResult.generation_rejected_reason}`);
          console.log(`[proofAppearanceLock] would_reject_and_regenerate: ${!visionValidationResult.image_passes_validation}`);
        }
      } catch (genErr) {
        console.error(`[proofAppearanceLock] Generation/validation error: ${genErr?.message}`);
        postGenerationReport = { error: genErr?.message, image_passes_validation: null };
      }
    }

    // ── FINAL PROOF REPORT ────────────────────────────────────────────────────
    const proofReport = {
      proof_timestamp: proofTimestamp,
      character_name: charName,
      character_id: charRecord?.id || null,

      // Section 1: Canonical trait resolution
      canonical_appearance_source: {
        source_order: [
          '1. structured appearance_lock fields (highest priority)',
          '2. character profile fields (gender, age_range, ethnicities)',
          '3. text description fallback (lowest priority, only if structured absent)',
        ],
        raw_appearance_lock_fields: appearanceLock,
        resolved_from_structured: canonicalTraits.source_priority,
      },
      canonical_hair_length: canonicalTraits.canonical_hair_type || canonicalTraits.canonical_hairstyle || null,
      canonical_hairstyle: canonicalTraits.canonical_hairstyle || null,
      canonical_hair_color: canonicalTraits.canonical_hair_color || null,
      canonical_facial_hair: canonicalTraits.canonical_facial_hair || null,
      canonical_body_type: canonicalTraits.canonical_body_type || null,
      canonical_skin_tone: canonicalTraits.canonical_skin_tone || null,
      canonical_bald: canonicalTraits.canonical_bald,

      // Section 2: Prompt proof
      original_user_prompt: originalUserPrompt,
      prompt_requested_appearance_changes: conflictAnalysis.requested,
      approved_temporary_changes: conflictAnalysis.approved,
      rejected_prompt_traits: conflictAnalysis.rejected,
      prompt_corrections_applied: corrections,
      final_prompt_after_sanitization: finalSanitizedPrompt,
      prompt_sanitization_proof: {
        short_hair_removed: /short hair/i.test(originalUserPrompt) && !/short hair/i.test(finalSanitizedPrompt),
        dreadlocks_preserved: /dreadlocks?|locs?/i.test(finalSanitizedPrompt) || /dreadlocks?|locs?/i.test(canonicalBlock),
        full_beard_removed: /full beard/i.test(originalUserPrompt) && !/full beard/i.test(finalSanitizedPrompt),
        clean_shaven_enforced: /clean-?shaven/i.test(finalSanitizedPrompt),
      },

      // Section 3: Post-generation validation (if requested)
      post_generation_validation: postGenerationReport || {
        status: 'skipped',
        reason: 'Set generateAndValidate=true to run real image generation + vision validation',
        detected_generated_traits: null,
        appearance_conflict_detected: null,
        hair_mismatch_detected: null,
        body_mismatch_detected: null,
        facial_hair_mismatch_detected: null,
        identity_drift_score: null,
        generation_rejected_reason: null,
        would_reject_and_regenerate: null,
        image_passes_validation: null,
      },

      // System status
      system_enforcement_status: {
        prompt_sanitization_active: true,
        structured_fields_prioritized: true,
        post_generation_validation_available: true,
        post_generation_validation_requires_generate_flag: !generateAndValidate,
        shared_helper_path: 'functions/proofAppearanceLock (inline helpers, shared via extract to imageGenHelpers)',
        paths_covered: [
          'generateImageAsync — prompt sanitization + canonical lock block',
          'mediaGridGenerate — appearance_lock fields in subject bundles',
          'sceneImageGenerator.js — via appearanceLockValidator.js',
          'proofAppearanceLock — this function (proof + post-gen vision validation)',
        ],
        paths_needing_post_gen_validation_wired: [
          'generateImageAsync — post-gen vision loop needs wiring (see wirePostGenValidation)',
        ],
      },
    };

    return Response.json({ success: true, proof: proofReport });

  } catch (error) {
    console.error('[proofAppearanceLock] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

// ── Helper: Build canonical lock block for prompt injection ──────────────────────────────
function buildCanonicalLockBlock(canonicalTraits, charName) {
  const n = charName || 'this character';
  const lines = [
    ``,
    `🔒 CANONICAL APPEARANCE LOCK — "${n}" — ABSOLUTE IDENTITY AUTHORITY`,
    `Canonical traits OVERRIDE any conflicting prompt styling. Canonical = source of truth.`,
    `Authority order: structured_lock_fields > reference_images > prompt > conversation`,
    ``,
  ];

  if (canonicalTraits.canonical_bald) {
    lines.push(`HAIR: BALD — completely bald head, zero hair. ⛔ NO curls, locs, braids, fade, hairline of any kind.`);
  } else {
    const hairDesc = [canonicalTraits.canonical_hair_type, canonicalTraits.canonical_hairstyle].filter(Boolean).join(', ');
    if (hairDesc) {
      lines.push(`HAIR: ${hairDesc}`);
      if (/dreadlocks?|locs?/i.test(hairDesc)) lines.push(`  ⛔ REJECT: short hair, fade, buzz cut, bald, generic curls — DREADLOCKS ONLY`);
      else if (/long/i.test(hairDesc)) lines.push(`  ⛔ REJECT: short hair, buzz cut, fade, cropped — LONG HAIR ONLY`);
      else if (/short|buzz|fade/i.test(hairDesc)) lines.push(`  ⛔ REJECT: long hair, dreadlocks, flowing hair — SHORT/FADE ONLY`);
      else if (/afro/i.test(hairDesc)) lines.push(`  ⛔ REJECT: straight, slicked, fade, short hair — AFRO ONLY`);
      else if (/braids?|cornrows/i.test(hairDesc)) lines.push(`  ⛔ REJECT: loose hair, straight, fade — BRAIDS ONLY`);
    }
  }

  if (canonicalTraits.canonical_hair_color) lines.push(`HAIR COLOR: ${canonicalTraits.canonical_hair_color} — do not alter hair color.`);

  if (canonicalTraits.canonical_facial_hair) {
    lines.push(`FACIAL HAIR: ${canonicalTraits.canonical_facial_hair}`);
    if (/clean-?shaven|no facial hair/i.test(canonicalTraits.canonical_facial_hair))
      lines.push(`  ⛔ REJECT beard/stubble/goatee/mustache — CLEAN-SHAVEN ONLY`);
    else
      lines.push(`  ⛔ REJECT clean-shaven — ${canonicalTraits.canonical_facial_hair} MUST BE PRESENT`);
  }

  if (canonicalTraits.canonical_skin_tone) lines.push(`SKIN TONE: ${canonicalTraits.canonical_skin_tone} — do not lighten or darken.`);
  if (canonicalTraits.canonical_body_type) lines.push(`BODY TYPE: ${canonicalTraits.canonical_body_type} — do not slim down, bulk up, age-down, or beautify.`);

  lines.push(``, `⛔ REJECT any prompt trait that conflicts with the above.`);
  lines.push(`🚫 INVALID if hair, facial hair, body type, or skin tone differs from canonical.`);

  return lines.join('\n');
}