/**
 * validateOutfitLock — Post-generation visual validation for closet outfit enforcement.
 *
 * Analyzes a generated image against the character's closet outfit requirements.
 * REJECTS the image if it violates the outfit (e.g., shirt when bare torso required).
 *
 * Returns { valid: boolean, reason: string, violations: string[] }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { imageUrl, charOutfitText, charName } = await req.json();

  if (!imageUrl || !charOutfitText || !charName) {
    return Response.json({ error: 'Missing required fields: imageUrl, charOutfitText, charName' }, { status: 400 });
  }

  try {
    // Extract outfit requirements
    const isBareTorso = /no shirt \/ bare torso|shirtless|no top|no shirt/i.test(charOutfitText);
    const needsBottoms = /sweatpants|pants|jeans|shorts|joggers|leggings|trousers/i.test(charOutfitText);
    const needsShoes = /sneakers|shoes|boots|sandals|loafers|heels/i.test(charOutfitText);

    if (!isBareTorso && !needsBottoms && !needsShoes) {
      return Response.json({ valid: true, reason: 'no strict outfit requirements detected' });
    }

    // Vision analysis of the generated image
    const analysisPrompt = `OUTFIT VALIDATION TASK

Analyze this generated photo of "${charName}" and evaluate it against the REQUIRED outfit.

REQUIRED OUTFIT:
${charOutfitText}

VALIDATION CHECKLIST:
${isBareTorso ? `1. BARE TORSO: Is the torso COMPLETELY bare with NO shirt, tank top, hoodie, jacket, robe, or any upper-body clothing? (Critical requirement)` : ''}
${needsBottoms ? `2. BOTTOMS: Are the pants/sweatpants fully visible (at least mid-thigh to ankle)? Not cropped.` : ''}
${needsShoes ? `3. SHOES: Are the shoes and feet visible in the frame? Not cropped or hidden.` : ''}

RESPOND WITH ONLY valid JSON:
{
  "bare_torso_valid": ${isBareTorso ? 'MUST be true if torso is bare, false if ANY shirt/tank/clothing visible' : 'null'},
  "bottoms_valid": ${needsBottoms ? 'true if pants fully visible, false if missing or cropped' : 'null'},
  "shoes_valid": ${needsShoes ? 'true if shoes visible, false if cropped or missing' : 'null'},
  "overall_pass": "true ONLY if all required items match AND no forbidden items appear, false otherwise",
  "violations": ["list specific violations, e.g. 'shirt visible when bare torso required', 'pants cropped at knee', 'shoes out of frame'"]
}`;

    const visionRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      file_urls: [imageUrl],
      response_json_schema: {
        type: 'object',
        properties: {
          bare_torso_valid: { type: ['boolean', 'null'] },
          bottoms_valid: { type: ['boolean', 'null'] },
          shoes_valid: { type: ['boolean', 'null'] },
          overall_pass: { type: 'boolean' },
          violations: { type: 'array', items: { type: 'string' } },
        },
      },
    });

    const violations = visionRes.violations || [];
    let isValid = visionRes.overall_pass === true;

    // CRITICAL: If bare torso was required, DEMAND explicit confirmation it's actually bare.
    // The LLM sometimes hallucinates and says "bare" when there's a shirt.
    // Force a re-check with confidence scoring.
    if (isBareTorso && isValid) {
      console.warn(`[validateOutfitLock] ⚠️ DOUBLE-CHECK: bare torso required. Re-verifying with stricter criteria...`);

      const strictCheckRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `STRICT BARE TORSO VERIFICATION

Look at this image VERY CAREFULLY.

Question: Is the character's torso completely bare with NO shirt, NO tank top, NO hoodie, NO jacket, NO robe?
Answer with ONLY one word: YES or NO

If you see ANY upper body clothing (even partial tank top or thin shirt), answer NO.
If the torso is completely bare with no fabric covering it, answer YES.`,
        file_urls: [imageUrl],
      });

      const bareTorsoConfirmed = strictCheckRes?.toLowerCase?.()?.includes('yes') || false;
      console.log(`[validateOutfitLock] Strict bare-torso check: ${bareTorsoConfirmed ? 'YES (bare)' : 'NO (clothed)'}`);

      if (!bareTorsoConfirmed) {
        isValid = false;
        violations.push('Strict check: torso is NOT bare — clothing detected');
      }
    }

    console.log(`[validateOutfitLock] ${charName}: ${isValid ? '✅ PASS' : '❌ FAIL'}`);
    if (violations.length > 0) {
      console.log(`  Violations: ${violations.join(' | ')}`);
    }

    return Response.json({
      valid: isValid,
      reason: isValid ? 'outfit matches requirements' : violations.join('; '),
      violations,
      analysisDetail: visionRes,
      imageUrl,
      charOutfitText,
    });

  } catch (error) {
    console.error('[validateOutfitLock] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});