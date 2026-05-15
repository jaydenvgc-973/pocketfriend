/**
 * validateOutfitLockStrict — Post-generation outfit validation with mandatory rejection.
 *
 * REQUIREMENT: Do not accept images that violate closet outfit locks.
 *
 * This validation is NOT optional or advisory.
 * If validation fails, the caller MUST regenerate.
 * If max retries fail, the caller MUST reject the image with error.
 *
 * Returns: { valid: boolean, violations: string[], passes: object }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { imageUrl, charOutfitText, charName } = await req.json();
  if (!imageUrl || !charOutfitText) {
    return Response.json({ error: 'Missing imageUrl or charOutfitText' }, { status: 400 });
  }

  console.log(`[validateStrict] START: ${charName} | outfit="${charOutfitText.substring(0, 80)}"`);

  const violations = [];
  const passes = {};

  // Parse outfit requirements from text
  const isBareTorso = /no shirt \/ bare torso|shirtless|no top|no shirt/i.test(charOutfitText);
  const hasBottoms = /sweatpants|pants|jeans|shorts|joggers|leggings|trousers|slacks/i.test(charOutfitText);
  const hasShoes = /sneakers|shoes|boots|sandals|loafers|heels|slides/i.test(charOutfitText);

  // 1. BARE TORSO CHECK
  if (isBareTorso) {
    console.log(`[validateStrict] BARE TORSO required — running vision check...`);

    const bareCheckRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `CRITICAL BARE TORSO CHECK

You must answer with ONLY YES or NO.

Question: Is the character's entire torso completely and obviously bare with zero upper-body clothing visible?

YES = Torso is bare, no shirt, no tank top, no hoodie, no jacket, no robe, no fabric.
NO = Any upper-body clothing exists (shirt, tank top, hoodie, jacket, undershirt, bra, vest, etc.).

Answer: `,
      file_urls: [imageUrl],
    });

    const barePassed = bareCheckRes?.toLowerCase?.()?.startsWith('yes') || false;
    passes.bare_torso = barePassed;

    if (!barePassed) {
      violations.push('BARE TORSO VIOLATION: Upper-body clothing detected when torso must be bare');
      console.error(`[validateStrict] ❌ BARE TORSO CHECK FAILED`);
    } else {
      console.log(`[validateStrict] ✅ Bare torso confirmed`);
    }
  }

  // 2. BOTTOMS CHECK
  if (hasBottoms) {
    const bottomsCheckRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `CHECK: Are pants/sweatpants clearly visible and not cropped?

YES = Pants are visible from waist to at least mid-thigh.
NO = Pants are cropped, partially hidden, or missing.

Answer: `,
      file_urls: [imageUrl],
    });

    const bottomsPassed = bottomsCheckRes?.toLowerCase?.()?.startsWith('yes') || false;
    passes.bottoms = bottomsPassed;

    if (!bottomsPassed) {
      violations.push('BOTTOMS VIOLATION: Pants cropped, hidden, or missing');
      console.error(`[validateStrict] ❌ BOTTOMS CHECK FAILED`);
    }
  }

  // 3. SHOES CHECK
  if (hasShoes) {
    const shoesCheckRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `CHECK: Are shoes and feet clearly visible and not cropped?

YES = Shoes and feet are visible in the frame.
NO = Shoes or feet are cropped out or missing.

Answer: `,
      file_urls: [imageUrl],
    });

    const shoesPassed = shoesCheckRes?.toLowerCase?.()?.startsWith('yes') || false;
    passes.shoes = shoesPassed;

    if (!shoesPassed) {
      violations.push('SHOES VIOLATION: Shoes or feet cropped or missing');
      console.error(`[validateStrict] ❌ SHOES CHECK FAILED`);
    }
  }

  // 4. FRAMING CHECK - full or 3/4 body required if outfit is detailed
  const needsFullFraming = isBareTorso || hasBottoms || hasShoes;
  if (needsFullFraming) {
    const framingCheckRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `CHECK: Is the character shown in full-body or 3/4-body framing?

YES = Character is visible from head to at least mid-calf (full body or 3/4 body).
NO = Character is cropped (close-up only, from waist up, etc.).

Answer: `,
      file_urls: [imageUrl],
    });

    const framingPassed = framingCheckRes?.toLowerCase?.()?.startsWith('yes') || false;
    passes.framing = framingPassed;

    if (!framingPassed) {
      violations.push('FRAMING VIOLATION: Image is too cropped to verify full outfit');
      console.error(`[validateStrict] ❌ FRAMING CHECK FAILED`);
    }
  }

  // FINAL RESULT
  const isValid = violations.length === 0;

  console.log(`[validateStrict] RESULT: ${isValid ? '✅ VALID' : '❌ INVALID (violations: ' + violations.length + ')'}`);
  violations.forEach(v => console.log(`  - ${v}`));

  return Response.json({
    valid: isValid,
    violations: violations.length > 0 ? violations : null,
    passes,
    charName,
    charOutfitText,
    imageUrl,
    requiresBare: isBareTorso,
    requiresBottoms: hasBottoms,
    requiresShoes: hasShoes,
  });
});