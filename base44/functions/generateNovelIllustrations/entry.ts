import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─────────────────────────────────────────────────────────────────────────────
// NOVEL ILLUSTRATIONS
//
// Draws the plates for one already-saved chapter — and redraws a single plate when
// the reader uses Why Regenerate. This runs in its own request because writing prose
// and then drawing three images inside a single request ran past the platform's
// request limit, and the timeout discarded a chapter that had already been written.
//
// READ-ONLY on every Pocketfriend record: it reads only the people and places the
// chapter's own illustration notes name (cross-account people and users resolved by
// exact ID or by their registered world name), and writes only the NovelChapter's
// illustration fields and the Novel cover. Chapter prose, titles and every other
// record are never touched — a redraw of one plate never rewrites a chapter.
// ─────────────────────────────────────────────────────────────────────────────

const clip = (value, max) => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim().slice(0, max || 400));
const asArray = (value) => (Array.isArray(value) ? value : (value && value.items) || []);
const names = (list) => (Array.isArray(list) ? list : []).filter(Boolean);
const NOVEL_DEAD_STATUS = ['deleted', 'soft_deleted', 'merged'];
const usableCharacter = (c) => !!c && !!c.id && !!c.name
  && !NOVEL_DEAD_STATUS.includes(c.status)
  && c.life_status !== 'deceased'
  && c.is_test_character !== true;

const statusOf = (error) => {
  const value = Number(error?.status || error?.response?.status);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const readableText = (value, max) => {
  const text = String(value || '').replace(/[*#_`>]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^(here are|here is|below are|sure[,!]|certainly|of course)\b/i.test(text)) return '';
  return text.slice(0, max || 400);
};

function ageFromBirthDate(c, on) {
  const when = on instanceof Date ? on : new Date();
  const birthday = c?.birthday ? new Date(c.birthday) : null;
  if (birthday && !Number.isNaN(birthday.getTime())) {
    let years = when.getFullYear() - birthday.getFullYear();
    const month = when.getMonth() - birthday.getMonth();
    if (month < 0 || (month === 0 && when.getDate() < birthday.getDate())) years -= 1;
    if (years >= 0) return years;
  }
  const birthYear = Number(c?.birth_year);
  if (Number.isFinite(birthYear) && birthYear > 1900) {
    const years = when.getFullYear() - birthYear;
    if (years >= 0) return years;
  }
  return null;
}

function currentAgeOf(c) {
  const recorded = Number(c?.age);
  if (Number.isFinite(recorded) && recorded > 0) return Math.round(recorded);
  return ageFromBirthDate(c);
}

const normalizeText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── WHO THE PROMPT NAMES ─────────────────────────────────────────────────────
// The name a plate's own prompt carries IS the identity in that plate. Nobody is
// drawn into an illustration their moment never names — not the novel's central
// character, not a relative, not the account holder — and no established person's
// reference photographs are attached to a plate that does not mention them.
const WEAK_NAME_WORDS = new Set(['the', 'and', 'his', 'her', 'their', 'mr', 'mrs', 'ms', 'dr', 'sir', 'miss']);
const nameWords = (value) => normalizeText(value)
  .split(' ').filter((word) => word.length > 2 && !WEAK_NAME_WORDS.has(word));
const mentionsName = (text, name) => {
  const body = normalizeText(text);
  const wanted = normalizeText(name);
  if (!body || !wanted) return false;
  if (body.includes(wanted)) return true;
  return nameWords(name).some((word) => new RegExp(`(^| )${word}( |$)`).test(body));
};
const personNames = (person) => [
  person?.name,
  ...names(person?.aliases).map((a) => (typeof a === 'string' ? a : a?.name || a?.alias || a?.display_name)),
].filter(Boolean);
const isNamedInPlate = (text, person) => personNames(person).some((name) => mentionsName(text, name));

const ageStageNote = (age) => {
  const years = Number(age);
  if (!Number.isFinite(years)) return '';
  if (years < 1) return 'a newborn baby, held or lying down, unable to sit up, walk or speak';
  if (years < 2) return 'a one-year-old toddler, only just beginning to walk';
  if (years < 4) return 'a toddler';
  if (years < 6) return 'a small child';
  if (years < 10) return 'a young child';
  if (years < 13) return 'an older child';
  if (years < 18) return 'a teenager';
  if (years < 60) return 'an adult';
  return 'an elderly person';
};

// ── AGE-ACCURATE DEPICTION OF A YOUNGER APPEARANCE ───────────────────────────
// The same age rules Pocketfriend's Story Event images already use: identity comes
// from the reference photographs, developmental stage comes from the recorded age at
// this moment. The reference portrait is the adult they are today, so an adult-only
// feature that had not developed yet must not be carried into a younger depiction —
// a ten-year-old is never shown with his grown beard, a girl is never given adult
// physical development. The person stays recognisable; only the stage changes.
function youngerAppearanceDirective(name, age) {
  const years = Number(age);
  const lines = [
    `${name} appears here at ${years} years old — younger than they are today.`,
    `- Identity comes from the reference photographs: facial structure, eye shape, nose, mouth, complexion, hair colour and texture, and every inherited feature. It must read as this same person at ${years}, never a stranger of that age.`,
    `- Developmental stage comes from the age, not from the portrait: height, body proportions, build and facial maturity follow ${years}.`,
  ];
  if (years < 13) {
    lines.push(`- No facial hair of any kind — no beard, goatee, moustache, stubble or shadow. A child this age has a smooth face even when the adult has a full beard.`);
    lines.push(`- A child's body: a child's proportions, torso and limbs. No adult musculature, no adult jaw or brow, and no adult secondary sexual characteristics.`);
    lines.push(`- Do not shrink the adult portrait into a child's height — rebuild this same person at ${years}.`);
  } else if (years < 16) {
    lines.push(`- Facial hair only as far as it had actually developed at ${years}: sparse, patchy or none. Never the adult's finished beard, goatee or moustache.`);
    lines.push(`- Body proportions and development are those of an early adolescent — no adult physique.`);
  } else if (years < 18) {
    lines.push(`- Facial hair, build and development are those of a ${years}-year-old: adult features may be emerging, never the adult's finished ones.`);
    lines.push(`- No fully matured adult physique.`);
  } else {
    lines.push(`- Adults do not visibly transform on a schedule: do not smooth them into a younger-looking person, and do not add age markers they did not have.`);
  }
  lines.push(`- The recorded appearance notes describe this person today. Where they name an adult-only feature — a full beard, an adult build, adult development — it must not appear at ${years}.`);
  return lines.join('\n');
}

// ── BALLROOM CATEGORY ACCURACY ───────────────────────────────────────────────
// A plate of a ball must show the category the story actually called. This is the
// same established ballroom knowledge Pocketfriend uses for Ball Story Events,
// applied to what the camera is allowed to show: realness is styled and presented,
// runway is walked, voguing is danced — and a Schoolboy Realness plate looks like a
// student, never like an executive and never like a vogue battle.
const BALLROOM_PLATE_SIGNAL = /\b(vogue|voguing|realness|ballroom|kiki ball|house ball|femme queen|butch queen|schoolboy|school boy|executive realness|007s?|tens across the board|runway)\b/i;

function ballroomPlateNote(text) {
  if (!BALLROOM_PLATE_SIGNAL.test(String(text || ''))) return '';
  return [
    `BALLROOM CATEGORY ACCURACY — show the category actually named in this moment, never a generic dance floor:`,
    `Realness is a convincing identity presentation, styled exactly as its category demands. Schoolboy and School Girl Realness wear student clothing — backpack, cap, oversized hoodie, casual shirt, school uniform where it fits, sneakers, youthful streetwear — never executive businesswear and never suits and ties. Executive Realness wears professional tailoring and carries corporate bearing. A realness competitor walks, models and poses for the judges; they are never shown voguing, dipping, duckwalking or on the floor.`,
    `Runway is a walk and a fashion presentation: strut, posture, carriage, a turn or a pose at the end, the garment moving with the body. Never substitute voguing choreography for a runway category.`,
    `Voguing categories are danced, using that style's own vocabulary. Vogue Femme means hand performance, catwalk, duckwalk, floor performance, and spins and dips — Soft and Cunty fluid, graceful and controlled; Dramatics explosive, sharp and forceful. A dip is a dip.`,
  ].join('\n');
}

// ── ESTABLISHED USERS BY WORLD NAME ──────────────────────────────────────────
// A world name in the prose is an identity reference, not an ordinary name. When a
// name in the chapter belongs to an established Pocketfriend user — including a user
// on another account — that person's own avatar and reference photographs are used.
// They are never drawn as a generic substitute, and a name that resolves to nobody
// stays a narrative-only person.
async function resolveUserWorldNames(base44, candidateNames, ownerWorldName) {
  const wanted = new Set(
    names(candidateNames).map((name) => normalizeText(name)).filter((name) => name.length > 1)
  );
  if (ownerWorldName) wanted.delete(normalizeText(ownerWorldName));
  if (!wanted.size) return [];

  const srClient = base44.asServiceRole || base44;
  const settings = asArray(await srClient.entities.UserSettings
    .list(null, 500).catch(() => []));
  const matched = settings.filter((s) => wanted.has(normalizeText(s.fictional_world_name)));
  if (!matched.length) return [];

  const emails = [...new Set(matched.map((s) => s.owner_email).filter(Boolean))];
  const users = emails.length
    ? asArray(await srClient.entities.User
      .filter({ email: { $in: emails } }, null, emails.length).catch(() => []))
    : [];
  const userByEmail = new Map(users.map((u) => [u.email, u]));

  return matched.map((settingsRow) => {
    const record = userByEmail.get(settingsRow.owner_email) || {};
    return {
      name: settingsRow.fictional_world_name,
      email: settingsRow.owner_email,
      avatar_url: record.avatar_url || names(record.generated_avatar_urls)[0] || null,
      reference_images: [
        ...names(record.reference_image_urls),
        ...names(record.generated_avatar_urls),
      ].slice(0, 3),
    };
  }).filter((person) => person.name);
}

// ── PEOPLE BY EXACT ID (cross-account resolved by ID only, never by name) ─────
// `explicitlySelected` is set only for the people the reader chose themselves in Why
// Regenerate's character picker. Their choice is taken at its word: the record is used
// even when it is a test character, which the novel's own discovery keeps out of its
// cast. A classification never turns a selected person into a generic face.
async function resolvePeopleByIds(base44, ids, { explicitlySelected = false } = {}) {
  const wanted = [...new Set((ids || []).filter(Boolean))].slice(0, 10);
  if (!wanted.length) return new Map();
  const readable = asArray(await base44.entities.Character
    .filter({ id: { $in: wanted } }, null, wanted.length).catch(() => []));
  const missing = wanted.filter((id) => !readable.some((p) => p?.id === id));
  const recoverClient = base44.asServiceRole || base44;
  const recovered = missing.length
    ? asArray(await recoverClient.entities.Character
      .filter({ id: { $in: missing } }, null, missing.length).catch(() => []))
    : [];
  const usable = (c) => usableCharacter(c) || (explicitlySelected
    && !!c && !!c.id && !!c.name
    && !NOVEL_DEAD_STATUS.includes(c.status)
    && c.life_status !== 'deceased');
  return new Map([...readable, ...recovered].filter(usable).map((p) => [p.id, p]));
}

async function resolveLocation(base44, locationId, zoneName, directImages) {
  if (!locationId && !directImages?.length) return null;
  if (directImages?.length) {
    return { id: locationId || '', name: '', description: '', zoneName: zoneName || '', images: names(directImages).slice(0, 2), zones: [] };
  }
  const readable = asArray(await base44.entities.LocationReference
    .filter({ id: { $in: [locationId] } }, null, 1).catch(() => []));
  const recoverClient = base44.asServiceRole || base44;
  const recovered = readable.length
    ? []
    : asArray(await recoverClient.entities.LocationReference
      .filter({ id: { $in: [locationId] } }, null, 1).catch(() => []));
  const place = readable[0] || recovered[0] || null;
  return place ? { ...place, zoneName: zoneName || '', images: [], zones: names(place.zones) } : null;
}

const REASON_NOTE = {
  flawed: 'RE-RENDER FOR FAULTLESS CRAFT: correct anatomy, hands, proportions, and the room itself. Keep the same moment, the same people and the same place.',
  no_avatar: 'LIKENESS CORRECTION: the previous plate did not look like the right people. Match every attached identity reference precisely. Never substitute a generic face for an established person.',
  wrong_location: 'LOCATION CORRECTION: the attached place photographs are the correct setting. Reproduce that exact property, never another building or a generic interior.',
  characters_and_location: 'IDENTITY AND SETTING CORRECTION: both the people and the place are corrected by the attached references.',
  dont_like: 'RENDER THIS SCENE EXACTLY: every described detail is a requirement.',
  custom_prompt: 'RENDER THIS SCENE EXACTLY: every described detail is a requirement.',
};

// ── ONE PLATE ────────────────────────────────────────────────────────────────
// Everything a plate needs is resolved here: who is depicted as established people,
// which established users appear, who is genuinely narrative-only, the place and its
// zone, and the ages the records allow. Nothing is invented for anyone with a record.
async function renderPlate({ base44, spec, sceneText, reason, people, userPeople, ownerName, ownerRefs, place, placeZoneName, includeAll = false }) {
  // ── ONE IDENTITY PER NAME ────────────────────────────────────────────────
  // Only the people this plate's own prompt names are depicted, and a name resolves to
  // exactly one identity. An exact recorded name always beats a shared word, so the
  // account holder is never drawn in place of a character with a similar name (or the
  // reverse) because one word of a longer name happened to match. includeAll is the one
  // exception: the reader corrected who belongs here themselves, and that answer is
  // final even when their description does not repeat the names.
  const plateBody = normalizeText(sceneText);
  const exactInText = (name) => {
    const wanted = normalizeText(name);
    return !!wanted && plateBody.includes(wanted);
  };
  const scoreOf = (person) => {
    if (exactInText(person?.name)) return 2;
    return isNamedInPlate(sceneText, person) ? 1 : 0;
  };

  const characterHits = (people || []).map((person) => ({ person, score: scoreOf(person) }))
    .filter((hit) => includeAll || hit.score > 0);
  const userHits = (userPeople || []).map((person) => ({ person, score: scoreOf(person) }))
    .filter((hit) => includeAll || hit.score > 0);

  const ownerScore = !ownerName ? 0 : (exactInText(ownerName) ? 2 : (mentionsName(sceneText, ownerName) ? 1 : 0));

  // The words of a name matched exactly belong to that identity alone, so a weaker
  // one-word match can neither steal them nor stand in for the same person.
  const claimedWords = new Set();
  [...characterHits, ...userHits].forEach((hit) => {
    if (hit.score === 2) normalizeText(hit.person.name).split(' ').forEach((w) => claimedWords.add(w));
  });
  if (ownerScore === 2) normalizeText(ownerName).split(' ').forEach((w) => claimedWords.add(w));

  // A weaker match survives only on a word the plate actually uses and nobody owns.
  const unclaimedWordInText = (name) => nameWords(name)
    .some((word) => !claimedWords.has(word) && new RegExp(`(^| )${word}( |$)`).test(plateBody));
  const uncontested = (hit) => hit.score === 2 || unclaimedWordInText(hit.person.name);

  const depicted = characterHits.filter(uncontested).map((hit) => hit.person);
  const depictedNames = new Set(depicted.map((p) => normalizeText(p.name)));
  // A world name that is also a recorded character in this plate is that character: the
  // user identity is never attached to the same name, and never added alongside it.
  const users = userHits.filter(uncontested)
    .map((hit) => hit.person)
    .filter((u) => !depictedNames.has(normalizeText(u.name)));

  // The account holder's world name is an identity reference too — but only when the
  // moment actually names them. A world name that belongs to an established character
  // in the scene is that character, never the account holder as well.
  const recordedNames = names(spec.narrative_names);
  const ownerNormalized = normalizeText(ownerName);
  const ownerShadowedByPerson = !!ownerNormalized
    && [...depicted, ...users].some((p) => normalizeText(p.name) === ownerNormalized);
  const ownerUncontested = ownerScore === 2 || unclaimedWordInText(ownerName);
  const ownerPresent = !!ownerName && !ownerShadowedByPerson && ownerUncontested
    && (ownerRefs?.includeOwner === true || ownerScore > 0);

  const zone = place
    ? names(place.zones).find((z) => normalizeText(z.zone_name) === normalizeText(placeZoneName)) || null
    : null;

  // Every recorded name is accounted for: an established person, an established user,
  // the account holder, or a person who genuinely has no record.
  const isUser = (name) => users.some((u) => normalizeText(u.name) === normalizeText(name));
  const isOwner = (name) => !!ownerName && normalizeText(ownerName) === normalizeText(name);
  const isCharacter = (name) => depictedNames.has(normalizeText(name));
  const narrativePeople = recordedNames
    .filter((name) => !isUser(name) && !isOwner(name) && !isCharacter(name))
    .filter((name) => includeAll || mentionsName(sceneText, name));

  // ── REFERENCE ORDER FOLLOWS THE DESCRIPTION, NOT THE RECORD ──────────────
  // An image model reads a description in order and its reference photographs in order,
  // and it will happily pair the first-named person with the first photograph. Each
  // identity's own photographs are therefore grouped and attached in the order that
  // identity is first named in the description, and the prompt states which photograph
  // is whom — so a name can never pick up the face of whoever happened to be listed
  // first in the records.
  const mentionRank = (name) => {
    const wanted = normalizeText(name);
    const at = wanted ? plateBody.indexOf(wanted) : -1;
    if (at >= 0) return at;
    const positions = nameWords(name)
      .map((word) => plateBody.search(new RegExp(`(^| )${word}( |$)`)))
      .filter((index) => index >= 0);
    return positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
  };

  const identityGroups = [
    ...depicted.map((p) => ({
      name: p.name,
      images: [...new Set([p.avatar_url || p.image_avatar_url, ...names(p.reference_image_urls).slice(0, 1)].filter(Boolean))].slice(0, 2),
    })),
    ...users.map((u) => ({
      name: u.name,
      images: [...new Set([u.avatar_url, ...names(u.reference_images).slice(0, 2)].filter(Boolean))].slice(0, 2),
    })),
    ...(ownerPresent ? [{ name: ownerName, images: [...new Set(names(ownerRefs?.images))].slice(0, 2) }] : []),
  ].sort((a, b) => mentionRank(a.name) - mentionRank(b.name));

  const placeRefs = (zone ? names(zone.image_urls) : []).slice(0, 2);
  if (!placeRefs.length && place) placeRefs.push(...names(place.image_urls).slice(0, 2));

  const refs = [];
  const referenceLegend = [];
  identityGroups.forEach((group) => {
    const room = 8 - placeRefs.length - refs.length;
    if (room <= 0) return;
    const images = group.images.slice(0, Math.min(2, room));
    if (!images.length) {
      referenceLegend.push(`${group.name} has no photograph on record — keep their established written appearance`);
      return;
    }
    const first = refs.length + 1;
    refs.push(...images);
    referenceLegend.push(images.length === 1
      ? `image ${first} is ${group.name}`
      : `images ${first}–${refs.length} are ${group.name}`);
  });
  refs.push(...placeRefs);

  const identity = depicted
    .map((p) => `${p.name}${p.ethnicities && p.ethnicities.length ? ` (${p.ethnicities.join('/')})` : ''}: ${clip(p.appearance_notes || p.profile_summary, 220)}`)
    .join(' | ');

  // Ages come from the records. A younger appearance belongs to this illustration only
  // — it never alters the character's established age.
  const historicalAges = new Map();
  (spec.depicted_ages || []).forEach((entry) => {
    const person = depicted.find((p) => normalizeText(p.name) === normalizeText(entry.name));
    const youngAge = Number(entry.age);
    if (!person || !Number.isFinite(youngAge) || youngAge < 0) return;
    const presentAge = currentAgeOf(person);
    if (presentAge != null && Math.round(youngAge) >= presentAge) return;
    historicalAges.set(person.id, Math.round(youngAge));
  });

  const ageNotes = depicted.map((p) => {
    const historical = historicalAges.has(p.id) ? historicalAges.get(p.id) : null;
    const age = historical != null ? historical : currentAgeOf(p);
    if (age == null) return `${p.name}'s age is not recorded — keep their established appearance and do not invent an age or an extra person.`;
    const stage = ageStageNote(age);
    return historical != null
      ? youngerAppearanceDirective(p.name, age)
      : `${p.name} is ${age} years old${stage ? ` — ${stage}` : ''}. Depict exactly that age and stage: never older, never younger, never swapped with another child.`;
  }).join(' ');

  const placeDescription = readableText(zone?.zone_description, 420)
    || readableText(place?.description, 420)
    || readableText(spec.location_label, 200);

  // Who every name in this plate actually is, stated explicitly, so an action or a look
  // described for one name can never land on another person in the scene.
  const identityBinding = [
    ...depicted.map((p) => `${p.name} = the established character ${p.name}, from their own records`),
    ...users.map((u) => `${u.name} = an established Pocketfriend user, from their own records`),
    ...(ownerPresent ? [`${ownerName} = the account holder whose world this is`] : []),
    ...narrativePeople.map((n) => `${n} = a narrative-only person with no record`),
  ];

  const prompt = [
    `Literary novel illustration — painterly cinematic realism, natural light, restrained colour, editorial dignity.`,
    sceneText,
    // The description assigns every action to a named person. Being named first is not a
    // role: it carries no subject, no prominence and no permission to take another
    // person's described action.
    `THE DESCRIPTION ABOVE IS THE ONLY AUTHORITY ON WHO DOES WHAT. Every action, posture, position, gesture, expression, gaze, item held and garment named in it belongs to the exact person it is written against, and to nobody else. Being named first means nothing: the first person named is not the subject of the picture, not the one acting, and not the one to inherit another person's line. If one person is described sitting while another is described standing, then that person sits and that person stands, exactly as written — never swapped, never reassigned, never softened into an interchangeable arrangement. Including both people is not enough: each must be doing what the description gives them.`,
    referenceLegend.length
      ? `IDENTITY REFERENCE MAP — attached photographs, in order: ${referenceLegend.join('; ')}. Each photograph belongs to the name stated for it and to no other name. Pair a face with its own name only, never with the order in which people are described.`
      : '',
    depicted.length ? `Established people present: ${depicted.map((p) => p.name).join(', ')}. Each keeps their own identity — face, hair, build and features matching the attached reference photographs exactly: the same person, never a generic lookalike and never a blend of two people.` : '',
    users.length ? `Established people present, by their world names: ${users.map((u) => u.name).join(', ')}. These are existing Pocketfriend users, not background people — each must match their own attached reference photographs exactly. A named world name is never a cue for a generic or substitute person.` : '',
    narrativePeople.length ? `Narrative-only people with no character or user record, drawn generically: ${narrativePeople.join(', ')}. Believable, ordinary faces consistent with the description and with the ages stated above; they must never take on the identity of an established person.` : '',
    (depicted.length || users.length) && narrativePeople.length ? `Established people and these background people share the scene naturally — fill out the gathering if the moment needs it, but every established person above stays clearly present and recognisable.` : '',
    ownerPresent ? `${ownerName} must match their attached reference photographs exactly.` : '',
    identityBinding.length ? `IDENTITY BINDS TO THE NAME: ${identityBinding.join('; ')}. Whatever the description has a named person doing, saying, wearing or looking like is done by that exact identity and by nobody else — never by a person with a similar name, never by another person in the scene, and never swapped between the account holder and a character. Each named person keeps their own body, face, clothing and action; do not merge two people into one figure and do not give one person's description to another. The action is part of the identity: the account holder is never handed a character's described action, and a character is never handed the account holder's — each stands, sits, speaks or holds exactly as written against their own name.` : '',
    place
      ? `Setting: ${place.name || spec.location_label || ''}${zone ? ` — ${zone.zone_name}` : (placeZoneName ? ` — ${placeZoneName}` : '')}.${placeDescription ? ` ${placeDescription}` : ''} The architecture, furnishings, materials and atmosphere must match the attached reference photograph of this exact place — do not substitute another property or a generic interior.`
      : (spec.location_label ? `Setting: ${spec.location_label}.` : ''),
    identity ? `Identity notes: ${identity}` : '',
    ageNotes,
    ballroomPlateNote([sceneText, spec.caption, spec.scene].filter(Boolean).join('\n')),
    REASON_NOTE[reason] || '',
    `No text, no captions, no lettering, no borders, no collage. A single coherent moment, like a plate in an illustrated novel.`,
  ].filter(Boolean).join('\n');

  const result = await base44.integrations.Core.GenerateImage({
    prompt,
    existing_image_urls: [...new Set(refs.filter(Boolean))].slice(0, 8),
  });
  return result?.url;
}

/** The moment a plate sits in, used when a chapter has no stored scene note. */
function paragraphScene(chapter, illustration) {
  const paragraphs = String(chapter?.content || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const index = Math.min(paragraphs.length, Math.max(1, Number(illustration?.after_paragraph) || 1)) - 1;
  const paragraph = clip(paragraphs[index] || '', 700);
  const caption = clip(illustration?.caption, 200);
  return [paragraph, caption ? `Moment: ${caption}` : ''].filter(Boolean).join('\n');
}

Deno.serve(async (req) => {
  try {
    const base44Base = createClientFromRequest(req);
    const sr = base44Base.asServiceRole;
    const user = await base44Base.auth.me().catch(() => null);
    const body = await req.json().catch(() => ({}));

    // Drawing a saved chapter's plates is also started by the "Novel Generation
    // Continuation" workflow, which runs with no user session, so the plates appear
    // even when the reader has left. A single-plate redraw is the reader's own action
    // and always requires their session.
    const internal = !user;
    if (internal && body.mode === 'regenerate') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Reading by ID: an internal run uses service-role access, a caller keeps their scope.
    const base44 = user ? base44Base : sr;

    if (!body.novel_id) return Response.json({ error: 'novel_id is required' }, { status: 400 });

    const novel = await base44.entities.Novel.get(body.novel_id)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!novel) return Response.json({ error: 'Novel not found' }, { status: 404 });
    if (user && novel.created_by_id !== user.id && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const chapter = await base44.entities.NovelChapter.get(body.chapter_id || '')
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!chapter || chapter.novel_id !== novel.id) {
      return Response.json({ error: 'That chapter is not part of this novel' }, { status: 404 });
    }

    // The account holder's own references, when the caller is the account holder.
    const ownerRecord = user || (novel.owner_email
      ? asArray(await sr.entities.User.filter({ email: novel.owner_email }, null, 1).catch(() => []))[0] || {}
      : {});

    const ownerWorldName = String(novel.user_world_name || ownerRecord.full_name || '').trim();
    const ownerRefs = [...names(ownerRecord.reference_image_urls), ...names(ownerRecord.generated_avatar_urls)].slice(0, 2);

    // ── ONE PLATE, REDRAWN ───────────────────────────────────────────────────
    // Why Regenerate on a single illustration. The chapter's prose, title, other plates
    // and their positions are untouched: only this plate's image is replaced. If the
    // correction changes what the scene should show, that adjustment is stored on this
    // plate's own note so later corrections start from it.
    if (body.mode === 'regenerate') {
      const illustrations = [...(chapter.illustrations || [])];
      const index = Number(body.illustration_index);
      if (!Number.isInteger(index) || index < 0 || index >= illustrations.length) {
        return Response.json({ error: 'That illustration is not part of this chapter' }, { status: 404 });
      }
      const existing = illustrations[index];
      const specs = [...(chapter.illustration_specs || [])];
      const storedSpec = specs[index] || {};
      const spec = { ...storedSpec, after_paragraph: existing.after_paragraph, caption: existing.caption };
      const reason = Object.keys(REASON_NOTE).includes(body.reason) ? body.reason : 'flawed';

      const requestedScene = (reason === 'dont_like' || reason === 'custom_prompt')
        ? clip(body.custom_prompt, 1400)
        : '';
      const sceneText = requestedScene || clip(spec.scene, 900) || paragraphScene(chapter, existing);
      if (!sceneText) {
        return Response.json({ error: 'This plate has no scene description to work from.' }, { status: 400 });
      }

      // Who should be in it: the plate's own people, plus anyone the reader corrected.
      const pickedIds = names(body.intended_subject_ids).filter((id) => typeof id === 'string' && id !== '__user__');
      // The plate's own recorded people keep the novel's existing rules. The people the
      // reader chose here are resolved as chosen, so the avatar shown in the picker is the
      // avatar the plate is drawn from — never a generic substitute.
      const recordedPeople = await resolvePeopleByIds(base44, names(spec.person_ids));
      const pickedPeople = pickedIds.length
        ? await resolvePeopleByIds(base44, pickedIds, { explicitlySelected: true })
        : new Map();
      const peopleById = new Map([...recordedPeople, ...pickedPeople]);
      const people = [...peopleById.values()];

      // A world name in the scene resolves to its established user, never to a generic face.
      const userPeople = await resolveUserWorldNames(
        base44,
        [...names(spec.narrative_names), ...names(spec.characters)],
        ownerWorldName
      );

      // A location correction is authoritative for this plate: a chosen place, a chosen
      // zone, or a named off-screen place the reader typed. Never fall back to the old
      // setting when the reader has just corrected it.
      const typedPlaceName = String(body.location_name || '').trim();
      const correctedLocation = !!body.location_id || !!typedPlaceName || names(body.location_images).length > 0;
      let locationOverride = await resolveLocation(
        base44,
        body.location_id || null,
        body.zone_name || null,
        names(body.location_images)
      );
      if (correctedLocation && !locationOverride && typedPlaceName) {
        locationOverride = { id: '', name: typedPlaceName, label: typedPlaceName, description: '', zoneName: body.zone_name || '', images: [], zones: [] };
      }
      if (locationOverride && typedPlaceName && !locationOverride.name) {
        locationOverride = { ...locationOverride, label: typedPlaceName };
      }
      const place = locationOverride || (spec.location_id
        ? await resolveLocation(base44, spec.location_id, spec.zone_name, null)
        : null);
      const placeZoneName = locationOverride?.zoneName || spec.zone_name || '';

      const includeOwner = body.include_user === true || spec.shows_user === true;
      const callerName = String(body.user_name || '').trim();
      const callerRefs = names(body.user_ref_images)
        .filter((url) => typeof url === 'string' && url.startsWith('https://'))
        .slice(0, 3);

      // When the reader corrected who is in the plate, that answer is final. When they
      // only corrected the image or the place, the plate's own records decide — so a
      // world name that appears in the moment still resolves to that person.
      const pickerDecided = body.subject_picker_used === true;
      const resolvedOwnerName = pickerDecided
        ? (includeOwner ? (callerName || ownerWorldName) : '')
        : ownerWorldName;

      const url = await renderPlate({
        base44,
        spec,
        sceneText,
        reason,
        people,
        userPeople,
        ownerName: resolvedOwnerName,
        // A stored plate can claim the account holder was in it when the moment never
        // named them: only the reader's own subject choice forces them in now.
        ownerRefs: { images: callerRefs.length ? callerRefs : ownerRefs, includeOwner: pickerDecided && includeOwner },
        place,
        placeZoneName,
        includeAll: pickerDecided,
      });
      if (!url) {
        return Response.json({
          error: 'The illustration could not be redrawn. The plate you already have is unchanged.',
          failure: { stage: 'illustrations', cause: 'empty_response', retryable: true, canAdjust: true, technical: '', message: 'The image service returned no image. The plate you already have is unchanged, and so is the chapter.' },
        }, { status: 502 });
      }

      const nextSpec = {
        ...spec,
        scene: sceneText,
        location_id: locationOverride?.id || spec.location_id || '',
        location_label: locationOverride?.label || locationOverride?.name || spec.location_label || '',
        zone_name: placeZoneName,
      };
      const newIllustrations = illustrations.map((img, i) => (i === index ? { ...img, url } : img));
      const newSpecs = specs.length
        ? specs.map((s, i) => (i === index ? nextSpec : s))
        : specs;

      const updated = await base44.entities.NovelChapter
        .update(chapter.id, { illustrations: newIllustrations, illustration_specs: newSpecs })
        .catch(() => null);
      if (!updated) {
        return Response.json({ error: 'The illustration was drawn but could not be saved. The chapter is unchanged.' }, { status: 500 });
      }
      // The library thumbnail is the first plate: keep it in step, never the rest.
      if (index === 0 && novel.cover_image_url === existing.url) {
        await base44.entities.Novel.update(novel.id, { cover_image_url: url }).catch(() => novel);
      }
      return Response.json({ chapter: updated, illustration_index: index, notices: [] });
    }

    // ── ALL PLATES FOR A SAVED CHAPTER ───────────────────────────────────────
    if ((chapter.illustrations || []).length) return Response.json({ chapter, notices: [] });

    const specs = (Array.isArray(chapter.illustration_specs) ? chapter.illustration_specs : []).slice(0, 3);
    if (!specs.length) return Response.json({ chapter, notices: [] });

    const personIds = [...new Set(specs.flatMap((spec) => spec.person_ids || []))].slice(0, 10);
    const placeIds = [...new Set(specs.map((spec) => spec.location_id).filter(Boolean))].slice(0, 6);

    const peopleById = await resolvePeopleByIds(base44, personIds);

    const readablePlaces = placeIds.length
      ? asArray(await base44.entities.LocationReference.filter({ id: { $in: placeIds } }, null, placeIds.length).catch(() => []))
      : [];
    const unreadablePlaces = placeIds.filter((id) => !readablePlaces.some((p) => p?.id === id));
    const recoveredPlaces = unreadablePlaces.length
      ? asArray(await sr.entities.LocationReference.filter({ id: { $in: unreadablePlaces } }, null, unreadablePlaces.length).catch(() => []))
      : [];
    const placeById = new Map([...readablePlaces, ...recoveredPlaces].map((p) => [p.id, p]));

    // Established users named in the chapter's own notes — resolved once for all plates.
    const userPeople = await resolveUserWorldNames(
      base44,
      specs.flatMap((spec) => [...names(spec.narrative_names), ...names(spec.characters)]),
      ownerWorldName
    );

    const results = await Promise.allSettled(specs.map((spec) => renderPlate({
      base44,
      spec,
      sceneText: spec.scene,
      reason: 'default',
      people: names(spec.person_ids).map((id) => peopleById.get(id)).filter(Boolean),
      userPeople,
      ownerName: ownerWorldName,
      ownerRefs: { images: ownerRefs, includeOwner: false },
      place: spec.location_id ? placeById.get(spec.location_id) : null,
      placeZoneName: spec.zone_name,
    }).then((url) => ({ url, spec }))));

    const drawn = results
      .filter((result) => result.status === 'fulfilled' && result.value?.url)
      .map((result) => result.value)
      .sort((a, b) => (a.spec.after_paragraph || 0) - (b.spec.after_paragraph || 0));

    const illustrations = drawn.map((entry) => ({
      url: entry.url,
      caption: entry.spec.caption,
      after_paragraph: entry.spec.after_paragraph,
    }));

    const notices = [];
    const missing = specs.length - illustrations.length;
    if (missing > 0) {
      notices.push(missing === specs.length
        ? 'The illustrations could not be created this time. The chapter itself is complete and saved.'
        : `${missing === 1 ? 'One illustration' : `${missing} illustrations`} could not be created this time. The chapter itself is complete.`);
    }
    if (!illustrations.length) return Response.json({ chapter, notices });

    // The notes stay on the chapter, in the same order as the plates they describe, so
    // each plate can later be redrawn on its own without guessing what it showed.
    const illustrationSpecs = drawn.map((entry) => entry.spec);

    const updated = await base44.entities.NovelChapter
      .update(chapter.id, { illustrations, illustration_specs: illustrationSpecs })
      .catch(() => null);
    if (!updated) {
      return Response.json({
        error: 'The illustrations were drawn but could not be saved onto the chapter.',
        failure: {
          stage: 'saving',
          cause: 'save_failed',
          retryable: true,
          canAdjust: false,
          technical: '',
          message: 'The illustrations were drawn but could not be saved onto the chapter. The chapter text is unaffected. You can try again.',
        },
      }, { status: 500 });
    }
    if (!novel.cover_image_url) {
      await base44.entities.Novel.update(novel.id, { cover_image_url: illustrations[0].url }).catch(() => novel);
    }
    return Response.json({ chapter: updated, notices });
  } catch (error) {
    return Response.json({
      error: String(error?.message || 'The illustrations could not be created.'),
      failure: {
        stage: 'illustrations',
        cause: 'unknown',
        retryable: true,
        canAdjust: false,
        technical: statusOf(error) ? `HTTP ${statusOf(error)} — ${String(error?.message || '')}` : String(error?.message || ''),
        message: 'The illustration work could not be completed, and the specific cause could not be identified. The chapter text is complete and saved.',
      },
    }, { status: 500 });
  }
});