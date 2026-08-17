/**
 * SEALED SUBJECT BUNDLES — Scene multi-person identity enforcement.
 *
 * Reuses the sealed-bundle structure from generateImageAsync's multi-subject
 * path (the _buildSubjectBundle helper). Each named participant gets an
 * isolated identity / reference-range / appearance-lock / role / outfit
 * bundle. A global cross-assignment prohibition and an explicit subject
 * count + exactly-once constraint are appended.
 *
 * Pure prompt-text builder — no DB queries, no persistence, no side effects.
 * Reads already-resolved values from the caller:
 *   - person records (appearance_lock, ethnicities, gender, resolved_presence_status)
 *   - ref ranges (from buildParticipantReferenceKey in Scene.jsx)
 *   - outfit text (from outfitMap, resolved by existing backend authorities)
 *   - role (from resolveSceneRole in sceneRoleResolver.js)
 *
 * The intended result: one isolated identity bundle per named participant.
 * participant → own reference range → own stored appearance → own role → own outfit.
 * One participant's identity/refs/appearance/outfit must never be applied to another.
 */
import { resolveSceneRole } from './sceneRoleResolver.js';

function formatRefRange(start, end) {
  if (start === null || start === undefined) return null;
  return start === end ? `Image ${start}` : `Images ${start}–${end}`;
}

function buildSubjectAppearanceLock(person) {
  if (!person) return '';
  const lock = person.appearance_lock || {};
  const ethnicities = (person.ethnicities || []).filter(Boolean);
  // User participants may carry race on user_race instead of ethnicities[]
  const userRace = person.isUser ? (person.user_race || null) : null;
  const skinTone = lock.skin_tone || null;
  const hairstyle = lock.hairstyle || lock.hair_type || null;
  const hairColor = lock.hair_color || null;
  const facialHair = lock.facial_hair || null;
  const bodyType = lock.body_type || lock.overall_aesthetic || null;
  const distinguishing = lock.distinguishing_features || null;
  const gender = person.gender || null;

  const lines = [];
  if (ethnicities.length > 0) {
    lines.push(`  • Ethnicity: ${ethnicities.join(', ')} — render EXACTLY. ⛔ No Caucasian default.`);
  } else if (userRace) {
    lines.push(`  • Ethnicity: ${userRace} — render EXACTLY. ⛔ No Caucasian default.`);
  }
  if (skinTone) lines.push(`  • Skin tone: ${skinTone} — do not alter, lighten, or shift.`);
  if (hairstyle) lines.push(`  • Hair: ${hairstyle}`);
  if (hairColor) lines.push(`  • Hair color: ${hairColor}`);
  if (facialHair) lines.push(`  • Facial hair: ${facialHair}`);
  if (bodyType) lines.push(`  • Body type: ${bodyType} — do not slim, bulk, or alter.`);
  if (distinguishing) lines.push(`  • Distinguishing features: ${distinguishing} — must be visible.`);
  if (gender) lines.push(`  • Gender: ${gender.toUpperCase()} — established identity. ⛔ DO NOT infer from name.`);

  return lines.length > 0 ? lines.join('\n') : '';
}

function buildSealedSubjectBundle(person, refRange, outfitText, role) {
  if (!person || !person.name) return '';
  const name = person.name;
  const subjectId = person.id || (person.isUser ? 'authenticated_user' : 'unknown');
  const lines = [];

  lines.push(`╔══════════════════════════════════════════════════════════╗`);
  lines.push(`║ SUBJECT BUNDLE — SEALED — DO NOT MIX WITH OTHER SUBJECTS ║`);
  lines.push(`╚══════════════════════════════════════════════════════════╝`);
  lines.push(`DISPLAY NAME:  "${name}"`);
  lines.push(`SUBJECT ID:    ${subjectId}`);
  lines.push(`IDENTITY NOTE: "${name}" is a specific person with a locked visual identity.`);
  lines.push(`  ⛔ Do NOT substitute a generic person for "${name}".`);
  lines.push(`  ⛔ Do NOT render "${name}" more than once.`);
  lines.push(`  ⛔ Do NOT omit "${name}" and fill their position with another subject, the user, or a background person.`);
  lines.push(`  ⛔ Do NOT apply any other subject's reference images, face, skin tone, hair, body, outfit, or role to "${name}".`);
  lines.push('');

  if (refRange) {
    lines.push(`REFERENCE IMAGES: ${refRange}`);
    lines.push(`  Use ONLY for: face structure, skin tone, hair, body type of "${name}".`);
    lines.push(`  ⛔ IGNORE background, pose, clothing in these reference photos.`);
    lines.push(`  ⛔ Reference photos establish IDENTITY ONLY (face, skin, hair, body).`);
    lines.push(`  ⛔ Clothing visible in reference photos is IRRELEVANT — the OUTFIT LOCK below is the sole clothing authority.`);
    lines.push(`  ⛔ These refs belong EXCLUSIVELY to "${name}" — do NOT apply to any other subject.`);
  } else {
    lines.push(`REFERENCE IMAGES: None — generate "${name}" from appearance lock below only.`);
  }
  lines.push('');

  const appearanceLock = buildSubjectAppearanceLock(person);
  if (appearanceLock) {
    lines.push(`APPEARANCE LOCK (for "${name}" ONLY — immutable):`);
    lines.push(appearanceLock);
  } else {
    lines.push(`APPEARANCE LOCK: No structured appearance data — render from reference images only.`);
  }
  lines.push('');

  if (role) {
    lines.push(`ROLE: ${role}`);
  }

  if (outfitText) {
    lines.push(`OUTFIT LOCK (for "${name}" ONLY — canonical law):`);
    outfitText.split(',').map(s => s.trim()).filter(Boolean).forEach(item => lines.push(`  • ${item}`));
    lines.push(`  ⛔ This outfit belongs EXCLUSIVELY to "${name}". Do NOT apply to any other subject.`);
  } else {
    lines.push(`OUTFIT: No outfit on file — use contextually appropriate attire.`);
  }
  lines.push('');
  lines.push(`CROSS-ASSIGNMENT PROHIBITION (absolute):`);
  lines.push(`  ⛔ "${name}"'s outfit MUST NOT be rendered on any other subject.`);
  lines.push(`  ⛔ "${name}"'s appearance MUST NOT be applied to any other subject.`);
  lines.push(`  ⛔ "${name}"'s reference images MUST NOT be used to render any other subject.`);

  return lines.join('\n');
}

/**
 * Build the full sealed-subject-bundles block for a Scene image prompt.
 *
 * @param {Array} people            - Named participants (Character records + userParticipant)
 * @param {Object} refKey           - { ranges, envStart, envEnd } from buildParticipantReferenceKey
 * @param {Object} outfitMap        - { [personId]: outfitText } resolved by existing backend
 * @param {Set}   onShiftIds        - IDs of characters employed + on-shift at THIS location
 * @param {Set}   homeResidentIds   - IDs of characters who are home residents here
 * @param {Object} location         - Current location record (unused directly, passed for parity)
 * @returns {string} Prompt text block with sealed bundles + global prohibition + subject count
 */
export function buildSealedSubjectBundles(people, refKey, outfitMap, onShiftIds, homeResidentIds, location) {
  if (!people || people.length === 0) return '';

  const onShiftSet = onShiftIds || new Set();
  const homeResidentSet = homeResidentIds || new Set();
  const ranges = refKey?.ranges || [];

  const bundles = people
    .filter(p => p && p.name)
    .map((p) => {
      const range = ranges.find(r => r.id === p.id);
      const refRange = range && range.start !== null ? formatRefRange(range.start, range.end) : null;
      const role = p.isUser ? 'visitor' : resolveSceneRole(p, { onShiftAtLocationIds: onShiftSet, homeResidentIds: homeResidentSet });
      const outfit = outfitMap[p.id] || null;
      return buildSealedSubjectBundle(p, refRange, outfit, role);
    })
    .filter(Boolean);

  if (bundles.length === 0) return '';

  const subjectCount = bundles.length;
  const envStart = refKey?.envStart || null;
  const envEnd = refKey?.envEnd || null;
  const envRange = (envStart !== null && envEnd !== null && envEnd >= envStart) ? formatRefRange(envStart, envEnd) : null;

  let block = `\n═══════════════════════════════════════════════════════════\n`;
  block += `SEALED SUBJECT BUNDLES — READ EACH BUNDLE INDEPENDENTLY\n`;
  block += `ATTRIBUTES FROM ONE BUNDLE MUST NEVER BE APPLIED TO ANOTHER BUNDLE\n`;
  block += `═══════════════════════════════════════════════════════════\n\n`;
  block += bundles.join('\n\n');
  block += `\n\n═══════════════════════════════════════════════════════════\n`;
  block += `GLOBAL CROSS-ASSIGNMENT PROHIBITION — ABSOLUTE LAW\n`;
  block += `═══════════════════════════════════════════════════════════\n`;
  block += `This scene contains ${subjectCount} distinct named subjects. Each has a sealed bundle above.\n`;
  block += `⛔ NEVER swap outfits between subjects.\n`;
  block += `⛔ NEVER swap appearance between subjects.\n`;
  block += `⛔ NEVER apply one subject's reference images to render a different subject.\n`;
  block += `⛔ NEVER replace any named subject with a generic person, the user, or a background person.\n`;
  block += `⛔ NEVER render any named subject more than once.\n`;
  block += `⛔ NEVER omit a named subject and fill their position with another subject.\n`;
  block += `✅ Each subject must be rendered using ONLY their own sealed bundle.\n`;
  block += `✅ Each named subject must appear EXACTLY ONCE.\n\n`;
  block += `EXPECTED NAMED SUBJECTS: ${subjectCount}\n`;
  block += `→ EXACTLY ${subjectCount} named subjects must appear. No more, no less.\n`;
  block += `⛔ No undeclared people in the foreground competing with the declared subjects.\n`;
  block += `⛔ No partial people — arms, legs, hands of undeclared persons in the foreground.\n`;
  block += `⛔ Location owners/workers/residents may NOT appear as foreground subjects unless explicitly named above.\n`;
  if (envRange) {
    block += `\n${envRange} → ENVIRONMENT spatial data only. NOT face identity. Use for room/layout/furniture only.\n`;
  }
  block += `═══════════════════════════════════════════════════════════\n`;

  return block;
}