/**
 * Residential Scene Image Generation with Strict Identity Enforcement
 * 
 * Ensures avatar images are treated as HARD identity references, not style suggestions.
 * Each selected person must be rendered exactly as shown in their avatar.
 */

export function buildResidentialImagePrompt(location, zoneSuffix, timeOfDay, residentialPeople, outfitSuffix, envNote) {
  if (residentialPeople.length === 0) {
    return `${envNote} Scene: ${location.name}${zoneSuffix}, ${timeOfDay} lighting.
MANDATORY RULE: This space is completely empty — nobody is present. Do not render any people, no silhouettes, no background figures. Empty room only. Photorealistic.`;
  }

  // Build character breakdown with ages and visual requirements
  const characterBreakdown = residentialPeople
    .map(p => `${p.name}${p.age ? ` (age ${p.age})` : ''}`)
    .join(', ');

  // Build strict identity lock instructions
  const identityLockInstructions = `
════════════════════════════════════════════════════════════════
AVATAR REFERENCE LOCK — 100% STRICT ENFORCEMENT (NON-NEGOTIABLE)
════════════════════════════════════════════════════════════════
The provided reference images DEFINE EXACT IDENTITIES:

${residentialPeople.map((p, idx) => `${idx + 1}. ${p.name}: Use reference image ${idx + 1} EXACTLY.
   - Face: Match precisely. Do NOT alter or reinterpret.
   - Age: ${p.age || 'as shown in reference'}. Do NOT change age.
   - Body: Match type and build exactly.
   - Hair: Match texture, length, style, color exactly.
   - Skin tone: Match exactly.
   - Distinctive features: Preserve all.
   - Overall identity: Instantly recognizable from reference.`).join('\n')}

MANDATORY RULES:
- Each reference image = one distinct person
- Do NOT substitute any face with a different person
- Do NOT age any character up or down
- Do NOT change body types or structures
- Do NOT reinterpret, approximate, or blend identities
- Do NOT use generic or random people

VALIDATION:
- Success: Each person instantly recognizable from their reference image
- Failure: Any person does not match their reference
════════════════════════════════════════════════════════════════`;

  const atmosphereSuffix = " The home is clearly lived-in: warm, fully furnished, decorated with personal belongings.";

  const strictPeopleRule = `MANDATORY IDENTITY LOCK: The ONLY people who may appear are: ${characterBreakdown}.
Use ONLY the provided reference images to determine exact appearance, age, and identity.
Do NOT:
- substitute any face with a different person
- age any character up or down
- change body types or structures
- reinterpret identities
- blend or average features
Each reference image defines ONE distinct person who must be rendered exactly as shown.
If reference images are provided, they are the SOLE authority for identity.`;

  return `${envNote} Scene: ${location.name}${zoneSuffix}, ${timeOfDay} lighting.${atmosphereSuffix}

${strictPeopleRule}

${identityLockInstructions}

${outfitSuffix}

Photorealistic, authentic, exact identity matching.`;
}

export function extractResidentialAvatarUrls(residentialPeople) {
  return residentialPeople
    .map(c => c.avatar_url || c.image_avatar_url)
    .filter(url => url && url.trim().length > 0);
}

export function validateResidentialGenerationInput(residentialPeople, selectedNpcIds, allPossibleNpcs) {
  // Check for missing avatars
  const missingAvatars = residentialPeople.filter(p => !p.avatar_url && !p.image_avatar_url);
  if (missingAvatars.length > 0) {
    console.error(
      '[Residential Scene] MISSING AVATARS — Generation will fail:',
      missingAvatars.map(p => `${p.name} (id: ${p.id})`).join(', ')
    );
    return {
      valid: false,
      error: `Missing avatars for: ${missingAvatars.map(p => p.name).join(', ')}`
    };
  }

  // Verify selectedNpcIds match residentialPeople (no silent drops)
  const selectedCount = selectedNpcIds?.length || 0;
  const renderedCount = residentialPeople.length;
  
  if (selectedCount > 0 && renderedCount !== selectedCount) {
    console.warn(
      '[Residential Scene] SELECTION MISMATCH:',
      `selected: ${selectedCount}, rendering: ${renderedCount}`
    );
  }

  return { valid: true };
}

export function logResidentialGenerationState(allPossibleNpcs, selectedNpcIds, broughtCharacters, residentialPeople) {
  console.log(
    '[Residential Scene] GENERATION STATE:',
    `allPossibleNpcs: ${allPossibleNpcs.length} total |`,
    `selectedNpcIds: ${(selectedNpcIds || []).length} |`,
    `broughtCharacters: ${broughtCharacters.length} |`,
    `residentialPeople for render: ${residentialPeople.length} |`,
    `people: ${residentialPeople.map(p => `${p.name}(id:${p.id},age:${p.age || '?'},avatar:${!!(p.avatar_url || p.image_avatar_url)})`).join(', ')}`
  );
}