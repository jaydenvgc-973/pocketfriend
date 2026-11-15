import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─────────────────────────────────────────────────────────────────────────────
// NOVEL ILLUSTRATIONS
//
// Draws the plates for one already-saved chapter. This runs in its own request
// because writing prose and then drawing three images inside a single request
// ran past the platform's request limit — and the timeout discarded a chapter
// that had already been written.
//
// READ-ONLY on every Pocketfriend record: it reads only the people and places the
// chapter's own illustration notes name (cross-account people resolved by exact
// ID), and writes only the NovelChapter's illustration fields and the Novel cover.
// ─────────────────────────────────────────────────────────────────────────────

const clip = (value, max) => (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim().slice(0, max || 400);
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

async function renderIllustration({ base44, spec, peopleById, placeById, userRefs, worldName }) {
  const depicted = (spec.person_ids || []).map((id) => peopleById.get(id)).filter(Boolean);
  const narrativePeople = names(spec.narrative_names);
  const place = spec.location_id ? placeById.get(spec.location_id) : null;
  const zone = place
    ? names(place.zones).find((z) => normalizeText(z.zone_name) === normalizeText(spec.zone_name)) || null
    : null;
  const showsUser = !!spec.shows_user && !!worldName;

  // Each established person's own photograph comes first, so a crowd or a location
  // can never push their identity out of the reference set.
  const refs = [];
  depicted.forEach((p) => {
    const primary = p.avatar_url || p.image_avatar_url;
    if (primary) refs.push(primary);
  });
  if (showsUser) refs.push(...userRefs);
  depicted.forEach((p) => names(p.reference_image_urls).slice(0, 1).forEach((ref) => refs.push(ref)));
  const placeRefs = (zone ? names(zone.image_urls) : []).slice(0, 2);
  if (!placeRefs.length && place) placeRefs.push(...names(place.image_urls).slice(0, 2));
  refs.push(...placeRefs);

  const identity = depicted
    .map((p) => `${p.name}${p.ethnicities && p.ethnicities.length ? ` (${p.ethnicities.join('/')})` : ''}: ${clip(p.appearance_notes || p.profile_summary, 220)}`)
    .join(' | ');

  // Ages come from the records. A younger appearance belongs to this illustration
  // only — it never alters the character's established age.
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
      ? `${p.name} appears about ${age} years old here — the same person at a younger age, the same recognisable face and features${stage ? `, reading clearly as ${stage}` : ''}.`
      : `${p.name} is ${age} years old${stage ? ` — ${stage}` : ''}. Depict exactly that age and stage: never older, never younger, never swapped with another child.`;
  }).join(' ');

  const placeDescription = readableText(zone?.zone_description, 420) || readableText(place?.description, 420);

  const prompt = [
    `Literary novel illustration — painterly cinematic realism, natural light, restrained colour, editorial dignity.`,
    spec.scene,
    depicted.length ? `Established people present: ${depicted.map((p) => p.name).join(', ')}. Each keeps their own identity — face, hair, build and features matching the attached reference photographs exactly: the same person, never a generic lookalike and never a blend of two people.` : '',
    narrativePeople.length ? `Narrative-only people with no character record, drawn generically: ${narrativePeople.join(', ')}. Believable, ordinary faces consistent with the description and with the ages stated above; they must never take on the identity of an established person.` : '',
    (depicted.length && narrativePeople.length) ? `Established characters and these background people share the scene naturally — fill out the gathering if the moment needs it, but every established person above stays clearly present and recognisable.` : '',
    showsUser ? `${worldName} must match their attached reference photographs exactly.` : '',
    place
      ? `Setting: ${place.name}${zone ? ` — ${zone.zone_name}` : ''}.${placeDescription ? ` ${placeDescription}` : ''} The architecture, furnishings, materials and atmosphere must match the attached reference photograph of this exact place — do not substitute another property or a generic interior.`
      : (spec.location_label ? `Setting: ${spec.location_label}.` : ''),
    identity ? `Identity notes: ${identity}` : '',
    ageNotes,
    `No text, no captions, no lettering, no borders, no collage. A single coherent moment, like a plate in an illustrated novel.`,
  ].filter(Boolean).join('\n');

  const result = await base44.integrations.Core.GenerateImage({
    prompt,
    existing_image_urls: [...new Set(refs)].slice(0, 8),
  });
  return { url: result?.url, spec };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (!body.novel_id) return Response.json({ error: 'novel_id is required' }, { status: 400 });

    const novel = await base44.entities.Novel.get(body.novel_id)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!novel) return Response.json({ error: 'Novel not found' }, { status: 404 });
    if (novel.created_by_id !== user.id && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const chapter = await base44.entities.NovelChapter.get(body.chapter_id || '')
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!chapter || chapter.novel_id !== novel.id) {
      return Response.json({ error: 'That chapter is not part of this novel' }, { status: 404 });
    }
    if ((chapter.illustrations || []).length) return Response.json({ chapter, notices: [] });

    const specs = (Array.isArray(chapter.illustration_specs) ? chapter.illustration_specs : []).slice(0, 3);
    if (!specs.length) return Response.json({ chapter, notices: [] });

    // Only the records these plates name are read — cross-account people resolve by
    // exact ID through the service role, never by name.
    const personIds = [...new Set(specs.flatMap((spec) => spec.person_ids || []))].slice(0, 10);
    const placeIds = [...new Set(specs.map((spec) => spec.location_id).filter(Boolean))].slice(0, 6);

    const readablePeople = personIds.length
      ? asArray(await base44.entities.Character.filter({ id: { $in: personIds } }, null, personIds.length).catch(() => []))
      : [];
    const unreadablePeople = personIds.filter((id) => !readablePeople.some((p) => p?.id === id));
    const recoveredPeople = unreadablePeople.length
      ? asArray(await base44.asServiceRole.entities.Character.filter({ id: { $in: unreadablePeople } }, null, unreadablePeople.length).catch(() => []))
      : [];
    const peopleById = new Map([...readablePeople, ...recoveredPeople].filter(usableCharacter).map((p) => [p.id, p]));

    const readablePlaces = placeIds.length
      ? asArray(await base44.entities.LocationReference.filter({ id: { $in: placeIds } }, null, placeIds.length).catch(() => []))
      : [];
    const unreadablePlaces = placeIds.filter((id) => !readablePlaces.some((p) => p?.id === id));
    const recoveredPlaces = unreadablePlaces.length
      ? asArray(await base44.asServiceRole.entities.LocationReference.filter({ id: { $in: unreadablePlaces } }, null, unreadablePlaces.length).catch(() => []))
      : [];
    const placeById = new Map([...readablePlaces, ...recoveredPlaces].map((p) => [p.id, p]));

    const userRefs = [
      ...names(user.reference_image_urls),
      ...names(user.generated_avatar_urls),
    ].slice(0, 2);
    const worldName = novel.user_world_name || user.full_name || '';

    const results = await Promise.allSettled(
      specs.map((spec) => renderIllustration({ base44, spec, peopleById, placeById, userRefs, worldName }))
    );

    const illustrations = results
      .filter((result) => result.status === 'fulfilled' && result.value?.url)
      .map((result) => ({
        url: result.value.url,
        caption: result.value.spec.caption,
        after_paragraph: result.value.spec.after_paragraph,
      }))
      .sort((a, b) => a.after_paragraph - b.after_paragraph);

    const notices = [];
    const missing = specs.length - illustrations.length;
    if (missing > 0) {
      notices.push(missing === specs.length
        ? 'The illustrations could not be created this time. The chapter itself is complete and saved.'
        : `${missing === 1 ? 'One illustration' : `${missing} illustrations`} could not be created this time. The chapter itself is complete.`);
    }
    if (!illustrations.length) return Response.json({ chapter, notices });

    const updated = await base44.entities.NovelChapter
      .update(chapter.id, { illustrations, illustration_specs: [] })
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
        message: 'The illustrations could not be created, and the specific cause could not be identified. The chapter text is complete and saved.',
      },
    }, { status: 500 });
  }
});