/**
 * identityDirectives — character identity + hairstyle fidelity text for generateImageAsync.
 *
 * These are PROMPT instructions only. They never write to character records, avatars,
 * relationships, memories or canon — they only change how existing appearance data is
 * interpreted during a generation.
 */

// ── HAIRSTYLE FIDELITY ────────────────────────────────────────────────────────
// Cornrows, box braids and locs share visual characteristics but are three
// different hairstyles. They are never interchangeable, so each one is named by
// its own construction and the others are explicitly rejected.
export const HAIRSTYLE_DEFINITIONS: Record<string, string> = {
  cornrows: 'cornrows — braids built close to the scalp, following visible rows or deliberate patterns along the head',
  box_braids: 'box braids — individual braids growing from separately sectioned portions of hair, usually with square or box-shaped parts; these are NOT scalp-attached cornrows',
  locs: 'locs (dreadlocks) — individual sections of hair formed into locked structures; locs are NOT braids and must not be rendered as cornrows or box braids',
};

const HAIRSTYLE_LABELS: Record<string, string> = {
  cornrows: 'cornrows',
  box_braids: 'box braids',
  locs: 'locs',
};

export function resolveHairstyleFamily(value: any): string | null {
  const v = String(value || '').toLowerCase();
  if (!v) return null;
  if (/\bcornrows?\b|\bcanerows?\b/.test(v)) return 'cornrows';
  if (/\bbox\s*braids?\b|\bknotless\b|\bindividual braids?\b|\bpoetic justice\b/.test(v)) return 'box_braids';
  if (/\bdreadlocks?\b|\bdreads?\b|\blocs?\b|\bsisterlocs?\b/.test(v)) return 'locs';
  return null;
}

export function buildHairstyleFidelityText(hairstyleValue: any): string {
  const family = resolveHairstyleFamily(hairstyleValue);
  if (!family) return '';
  const others = Object.keys(HAIRSTYLE_DEFINITIONS)
    .filter(k => k !== family)
    .map(k => HAIRSTYLE_LABELS[k])
    .join(' or ');
  return `HAIRSTYLE FIDELITY — ${HAIRSTYLE_DEFINITIONS[family]}.
Preserve its established length, thickness, volume, parting, direction and texture exactly as described above.
⛔ NEVER substitute ${others} — these are different hairstyles, not variations of this one.
These distinctions apply regardless of gender, ethnicity, age or overall appearance.`;
}

// ── FACIAL IDENTITY AUTHORITY ─────────────────────────────────────────────────
// The established avatar/reference photographs define WHO this person is.
// The face is not a loose aesthetic suggestion.
export const FACE_IDENTITY_TEXT = `FACE IDENTITY — THE ESTABLISHED REFERENCES ARE THE AUTHORITY
The reference/avatar photographs establish WHO this person is. Preserve their identifiable facial characteristics: overall facial structure and proportions, eye shape/size/positioning, nose shape and proportions, mouth and lip structure, jawline, chin and cheek structure, complexion and skin tone, distinctive facial characteristics, and established facial hair.
⛔ Do NOT genericize, idealize, average, beautify or replace the face with a random or template facial structure.
✅ Expression, facial angle, pose, lighting and natural variation are allowed — the person must stay recognizable.
✅ Current-day depictions use the established current appearance as-is — do NOT age it up or down.
HISTORICAL DEPICTION: age-appropriate changes (smoother skin, different facial hair, period hairstyle) are allowed, but the underlying facial identity must remain the same person at that age — never a different face presented as this character.`;

export const MULTI_IDENTITY_TEXT = `INDIVIDUAL IDENTITY IN GROUP IMAGES — EVERY SUBJECT STAYS THEMSELVES
⛔ Do NOT blend facial characteristics between subjects.
⛔ Do NOT swap one subject's face with another's.
⛔ Do NOT reuse one generic face for different subjects.
⛔ Do NOT make unrelated subjects look nearly identical.
⛔ Do NOT replace a distinctive hairstyle with a generic alternative.
✅ A person familiar with these characters must be able to tell who is who without captions, names or descriptions — however many subjects are in frame.
IDENTICAL APPEARANCE vs RESEMBLANCE: when subjects share the same established avatar/reference, they are intended to look identical — matching facial structure is correct, do not invent differences, and shared appearance does NOT imply any family or biological relationship. Subjects with different established references remain individually authoritative even when they resemble each other.`;

export const RESEMBLANCE_TEXT = `RESEMBLANCE LANGUAGE DETECTED — INTERPRET AS PHYSICAL RESEMBLANCE ONLY
The scene describes one person as resembling another. Render the intended resemblance using only that subject's own authorized references.
⛔ This is NOT a relationship fact: do not declare twins, siblings, family or any relationship, and do not treat the comparison as canon.
⛔ Do not permanently assign another character's identity or avatar to this subject — their own established identity stays theirs.
✅ Wording that explicitly establishes identical appearance is respected; resemblance alone does not make two people the same person.`;

export function detectsResemblanceLanguage(text: any): boolean {
  const t = String(text || '');
  if (!t) return false;
  return /\blook(s|ed|ing)?\b[^.\n]{0,30}\b(like|alike|identical)\b|\bresembl(e|es|ing|ance)\b|\bcould be\b[^.\n]{0,40}\btwins?\b|\bidentical twins?\b|\btwins?\b|\bsame facial features\b|\bsame face\b|\bpeople confuse\b|\bmistaken for\b|\bdouble\b/i.test(t);
}

/**
 * Characters whose established avatar / first reference image is the same are
 * intended to look identical. This states the visual match without inventing a
 * relationship.
 */
export function buildSharedAppearanceBlock(records: any[]): string {
  const list = (records || []).filter(Boolean);
  if (list.length < 2) return '';
  const keyOf = (r: any) => String(r.avatar_url || r.image_avatar_url || (r.reference_image_urls || [])[0] || '').trim();
  const groups: Record<string, string[]> = {};
  for (const r of list) {
    const k = keyOf(r);
    if (!k) continue;
    (groups[k] = groups[k] || []).push(r.name || 'subject');
  }
  const shared = Object.values(groups).filter(names => names.length > 1);
  if (shared.length === 0) return '';
  return `SHARED ESTABLISHED APPEARANCE — IDENTICAL FACIAL STRUCTURE IS INTENDED
${shared.map(names => `• ${names.join(' and ')} share the same established avatar reference.`).join('\n')}
✅ Render their underlying facial structure as matching or nearly identical, while keeping each person's own styling, grooming, expression and any established distinguishing features.
⛔ Do NOT invent facial differences that their shared reference does not support.
⛔ Shared appearance does NOT establish a biological or family relationship — do not create or imply one.`;
}

// ── CANONICAL APPEARANCE LOCK ─────────────────────────────────────────────────
// buildAppearanceLockText — reads structured charRecord fields directly; charDesc is secondary.
export function buildAppearanceLockText(rec: any, n?: string): string {
  const name = n || rec?.name || 'this character';
  if (!rec) return `render from refs — do not redesign\n${FACE_IDENTITY_TEXT}`;

  const lock = rec.appearance_lock || {};

  // ── ETHNICITY / RACE — always at top, explicit, prevents Caucasian default ──
  const ethnicities = (rec.ethnicities || []).filter(Boolean);
  const ethnicityFallback = rec.ethnicity || rec.race || null;
  const allEthnicities = ethnicities.length > 0
    ? ethnicities
    : (ethnicityFallback ? [ethnicityFallback] : []);

  // ── STRUCTURED APPEARANCE FIELDS ── read directly, no regex ────────────────
  const skinTone = lock.skin_tone || null;
  const hairstyle = lock.hairstyle || null;
  const hairType = lock.hair_type || null;
  const hairColor = lock.hair_color || null;
  const facialHair = lock.facial_hair || null;
  // body_type and overall_aesthetic are both valid field names depending on schema version
  const bodyType = lock.body_type || lock.overall_aesthetic || null;
  const distinguishing = lock.distinguishing_features || null;
  const isBald = lock.bald === true || /\b(bald|shaved head|no hair)\b/i.test(hairType || hairstyle || '');
  const htDisplay = hairstyle || hairType || null;

  const hasAnyData = allEthnicities.length > 0 || skinTone || htDisplay || hairColor || facialHair || bodyType || isBald;
  if (!hasAnyData) {
    console.log(`[CanonicalAppearance] ${name}: no structured lock data — render from refs only`);
    return `render from refs — do not redesign\n${FACE_IDENTITY_TEXT}`;
  }

  console.log(`[CanonicalAppearance] ${name}: ethnicities=[${allEthnicities.join(',')}] skin=${skinTone||'n/a'} hair=${htDisplay||'n/a'} bald=${isBald} facial=${facialHair||'n/a'} body=${bodyType||'n/a'}`);

  const r = [`\n🔒 CANONICAL APPEARANCE LOCK — "${name}" — ABSOLUTE IDENTITY AUTHORITY\nThese traits come directly from the character's structured data. OVERRIDE any conflicting prompt styling.\n`];

  // ETHNICITY FIRST — this is the primary defense against Caucasian defaulting
  if (allEthnicities.length > 0) {
    r.push(`ETHNICITY / RACE: ${allEthnicities.join(', ')} — render EXACTLY this ethnicity. ⛔ DO NOT default to Caucasian/white/European. ⛔ DO NOT soften, lighten, or alter ethnic features toward any other baseline.`);
  }
  if (skinTone) {
    // Add explicit anti-whitewashing guard when skin tone contains "light" or "caramel"
    // because the model can misread "light caramel" as "light-skinned/fair" and ignore ethnicity.
    const skinLower = skinTone.toLowerCase();
    const hasAmbiguousLight = /\b(light|caramel|honey|tan|medium)\b/.test(skinLower);
    const hasBlackOrAfricanAmerican = allEthnicities.some((e: string) => /\b(black|african american|afro)\b/i.test(e));
    if (hasAmbiguousLight && hasBlackOrAfricanAmerican) {
      r.push(`SKIN TONE: ${skinTone} — this is a warm brown melanated skin tone consistent with Black / African American heritage. ⛔ DO NOT render as pale, fair, or Caucasian-light. ⛔ DO NOT interpret "light" as white or European. Render warm melanated brown, rich caramel — clearly a person of color.`);
    } else {
      r.push(`SKIN TONE: ${skinTone} — do not lighten, soften, or alter in any direction.`);
    }
  }

  // HAIR — the named style is the authority, never a related style
  if (isBald) {
    r.push(`HAIR: BALD — zero hair on top. ⛔ NO curls, locs, braids, fade, hairline, or any hair.`);
  } else if (htDisplay) {
    r.push(`HAIR: ${htDisplay}`);
    const fidelity = buildHairstyleFidelityText(htDisplay);
    if (fidelity) r.push(fidelity);
    else if (/long hair/i.test(htDisplay)) r.push(`⛔ REJECT: short, buzz, fade, cropped — LONG HAIR ONLY`);
    else if (/short|buzz|fade/i.test(htDisplay)) r.push(`⛔ REJECT: long, flowing — SHORT/FADE ONLY`);
    else if (/braids?/i.test(htDisplay)) r.push(`⛔ REJECT: loose/straight/fade — BRAIDS ONLY`);
    else if (/afro/i.test(htDisplay)) r.push(`⛔ REJECT: straight, slicked, fade — AFRO ONLY`);
  }
  if (hairColor) r.push(`HAIR COLOR: ${hairColor} — do not alter.`);

  // FACIAL HAIR
  if (facialHair) {
    r.push(`FACIAL HAIR: ${facialHair}`);
    if (/clean-?shaven|no facial hair/i.test(facialHair)) r.push(`⛔ REJECT beard/stubble — CLEAN-SHAVEN ONLY`);
    else r.push(`⛔ REJECT clean-shaven — ${facialHair} MUST EXIST`);
  }

  // BODY TYPE
  if (bodyType) r.push(`BODY TYPE: ${bodyType} — do not slim, bulk, age-down, or beautify beyond what is described.`);

  // DISTINGUISHING FEATURES
  if (distinguishing) r.push(`DISTINGUISHING FEATURES: ${distinguishing} — must be visible and accurate.`);

  r.push(FACE_IDENTITY_TEXT);
  r.push(`\nCANONICAL > REFS > PROMPT. Prompt controls pose/scene ONLY — NOT ethnicity/hair/face/skin/body.\n⛔ REJECT any prompt trait conflicting with the above.\n🚫 GENERATION INVALID if ethnicity, skin tone, hair, facial hair, or body type differs from canonical.`);
  return r.join('\n');
}