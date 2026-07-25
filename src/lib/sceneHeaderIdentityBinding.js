/**
 * Scene Header Identity + Outfit Binding
 *
 * HEADER-IMAGE-ONLY helper. Builds an explicit per-participant owned unit for the
 * Scene page header image so identity references, appearance descriptors, and
 * resolved outfits stay bound to the same person — and cannot be redistributed
 * across participants by the image model.
 *
 * Scope:
 *   - Used ONLY by the Scene page header image pathway (src/pages/Scene.jsx,
 *     generateSceneImage). Does NOT touch the Scene Photo / send-out pathway
 *     (scenePhotoIdentityLock.js / ScenePhotoModal.jsx).
 *   - Reuses the existing appearance-lock authority (appearanceLockValidator.js).
 *   - Outfit preview / closet images are NEVER used as identity references here.
 *     Only avatar/face images are identity references; outfit text is clothing
 *     evidence bound to its owner by name.
 *
 * Binding model (per participant):
 *   PARTICIPANT N (USER|CHARACTER): <name>
 *   Identity reference image: reference image #N (this person's avatar — face/body ONLY)
 *   Appearance: <appearance lock descriptors>
 *   Outfit (belongs EXCLUSIVELY to <name>): <resolved outfit text>
 *
 * Reference images are ordered to match the participant numbering, and the order
 * is declared explicitly so the model can map image[N] → participant[N].
 */

import { buildAppearanceLockBlock } from './appearanceLockValidator.js';

/**
 * Build an ordered participant list for the header image.
 * The user is ALWAYS first (primary identity anchor). Canonical characters follow
 * in the order they appear in `characters`. Pseudo-constructs without a real
 * Character id are still included (so they are named in the "who may appear" set)
 * but carry no outfit and no avatar identity reference.
 *
 * @param {{userParticipant?:object, characters?:object[], outfitByName?:Record<string,string>}} input
 * @returns {Array<{key:string, name:string, isUser:boolean, avatarUrl:(string|null), appearanceBlock:string, outfitText:(string|null)}>}
 */
export function buildSceneHeaderParticipants({ userParticipant, characters = [], outfitByName = {} }) {
  const participants = [];
  const seen = new Set();

  const add = (p, forceUser = false) => {
    if (!p) return;
    const isUser = forceUser || !!p.isUser;
    const id = p.id || (isUser ? 'user' : null);
    if (!id) return;
    const key = isUser ? `USER:${id}` : `CHAR:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const name = p.name || p.display_name || (isUser ? 'You' : 'Participant');
    const avatarUrl = p.avatar_url || p.image_avatar_url || null;
    participants.push({
      key,
      name,
      isUser,
      avatarUrl,
      appearanceBlock: buildAppearanceLockBlock(p) || '',
      outfitText: outfitByName ? (outfitByName[name] || null) : null,
    });
  };

  // User first — the user is the primary identity anchor for the header image.
  if (userParticipant) add(userParticipant, true);
  // Then every other visible participant in the caller's order.
  (characters || []).forEach((c) => add(c));
  return participants;
}

/**
 * Per-participant binding block. Each participant is a single owned unit:
 * identity reference + appearance + outfit + exclusive ownership.
 */
export function buildSceneHeaderParticipantBindings(participants) {
  if (!participants || participants.length === 0) return '';

  const blocks = participants.map((p, idx) => {
    const role = p.isUser ? 'USER' : 'CHARACTER';
    const lines = [
      `PARTICIPANT ${idx + 1} (${role}): ${p.name}`,
      p.avatarUrl
        ? `Identity reference: reference image #${idx + 1} is ${p.name}'s avatar — the SOLE visual source for ${p.name}'s face, skin, hair, body type, age, and gender. Use it for identity ONLY, never for clothing.`
        : `Identity reference: no avatar image provided — use the appearance descriptors below only.`,
    ];
    if (p.appearanceBlock) {
      // Inline the appearance lock without the heavy box decoration to keep the
      // per-participant unit compact and unambiguous.
      const compact = p.appearanceBlock
        .replace(/═/g, '')
        .replace(/APPEARANCE LOCK — CHARACTER IDENTITY \(MANDATORY\)/g, 'Appearance (locked)')
        .replace(/This character has a locked visual identity\. Use ONLY these exact descriptors:/g, 'Locked descriptors:')
        .replace(/CRITICAL RULES:[\s\S]*$/g, '')
        .replace(/HEIGHT \+ BODY PROPORTION LOCK \(MANDATORY\)/g, 'Body proportions (locked)')
        .replace(/Character height:/g, 'Height:')
        .replace(/Head unit ratio:/g, 'Head ratio:')
        .replace(/Proportion class:/g, 'Proportion:')
        .replace(/BODY STRUCTURE RULES:[\s\S]*$/g, '')
        .replace(/ENVIRONMENT ALIGNMENT[\s\S]*$/g, '')
        .replace(/CONTEXT RULES:[\s\S]*$/g, '')
        .trim();
      if (compact) lines.push(compact);
    }
    lines.push(
      p.outfitText
        ? `Outfit (belongs EXCLUSIVELY to ${p.name}, no one else): ${p.outfitText}`
        : `Outfit: not specified for ${p.name} — use plain natural clothing. Do NOT copy any other participant's outfit onto ${p.name}.`
    );
    lines.push(
      `BINDING: This identity AND this outfit are one owned unit. ${p.name} is the ONLY person wearing ${p.name}'s outfit. ${p.name}'s outfit must NOT appear on any other participant, any background extra, or any generic substitute. ${p.name}'s face must NOT be replaced by a generic face, the outfit preview model, or another participant's face.`
    );
    return lines.join('\n');
  }).join('\n\n');

  return `\n\n════════════════════════════════════════════════════════════════════════════════
SCENE HEADER — PER-PARTICIPANT IDENTITY + OUTFIT BINDING (NON-NEGOTIABLE)
════════════════════════════════════════════════════════════════════════════════
${participants.length} named participant(s) appear in this image. Each is bound below as a single owned unit.

${blocks}

GLOBAL BINDING RULES (NO EXCEPTIONS):
- Reference image #N is the IDENTITY reference for participant N above (face/body only, never clothing). The user is participant 1.
- Each outfit is owned by exactly one participant. No swapping, blending, averaging, or transferring clothing between participants.
- Do NOT use an outfit preview / closet image model as any participant's face or body. Outfit text is clothing evidence only.
- Do NOT generate a generic substitute for a named participant. If a participant's identity cannot be preserved, render fewer people rather than a wrong face.
- Background extras are generic environment population only. They must NOT wear any named participant's outfit, must NOT resemble a named participant closely enough to compete, and must NOT replace a named participant.
- The user appears exactly once, wearing the user's outfit, with the user's established identity.
════════════════════════════════════════════════════════════════════════════════\n`;
}

/**
 * Ordered, deduped reference image stack.
 * Participant avatars FIRST, in participant order (user first), then environment
 * images. No silent slicing — every participant with an avatar is included.
 * Outfit preview / closet images are never added here (callers must not pass them).
 */
export function buildSceneHeaderReferenceStack(participants = [], envRefs = []) {
  const out = [];
  const seen = new Set();
  for (const p of participants) {
    const url = p.avatarUrl;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  for (const url of envRefs || []) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Explicit declaration of reference-image order so the model can map images to
 * participants by index.
 */
export function buildSceneHeaderReferenceOrderDeclaration(participants = []) {
  const withAvatars = (participants || []).filter((p) => p.avatarUrl);
  if (withAvatars.length === 0) return '';
  const lines = withAvatars.map((p, idx) => {
    return `Reference image #${idx + 1}: ${p.name}${p.isUser ? ' (the user)' : ''} — face/body identity ONLY (not clothing).`;
  });
  return `\nREFERENCE IMAGE ORDER (identity first, environment after):\n${lines.join('\n')}\n`;
}

/**
 * One-call helper: build everything the header pathway needs for a given people list.
 * @returns {{participants, bindings, referenceStack, orderDeclaration}}
 */
export function buildSceneHeaderBinding({ userParticipant, characters, outfitByName, envRefs }) {
  const participants = buildSceneHeaderParticipants({ userParticipant, characters, outfitByName });
  return {
    participants,
    bindings: buildSceneHeaderParticipantBindings(participants),
    referenceStack: buildSceneHeaderReferenceStack(participants, envRefs),
    orderDeclaration: buildSceneHeaderReferenceOrderDeclaration(participants),
  };
}