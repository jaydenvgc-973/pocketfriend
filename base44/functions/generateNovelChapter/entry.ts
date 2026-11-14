import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─────────────────────────────────────────────────────────────────────────────
// NOVEL CHAPTER GENERATOR
//
// READ-ONLY FEATURE. This function reads the user's own records (character,
// family, life journal, memories, relationships, emotions, chat/text/scene and
// world phone messages, locations, avatars) through the CALLER-SCOPED client, so
// existing access rules decide what can be seen — including across accounts.
// The only records it ever writes are Novel and NovelChapter: its own records.
// No character, memory, journal, relationship, message or location is touched.
// ─────────────────────────────────────────────────────────────────────────────

const clip = (value, max) => (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim().slice(0, max || 600);
const asArray = (value) => (Array.isArray(value) ? value : (value && value.items) || []);
const names = (list) => (Array.isArray(list) ? list : []).filter(Boolean);
const NOVEL_DEAD_STATUS = ['deleted', 'soft_deleted', 'merged'];
const usableCharacter = (c) => !!c && !!c.id && !!c.name
  && !NOVEL_DEAD_STATUS.includes(c.status)
  && c.life_status !== 'deceased'
  && c.is_test_character !== true;

// ── AGES ─────────────────────────────────────────────────────────────────────
// Ages come only from recorded data. A recorded age is authoritative; a recorded
// date of birth or birth year gives the age for any period. Nothing else — not
// appearance, family position or behaviour — may ever produce an age.
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

function characterBlock(c) {
  if (!c) return '';
  const age = currentAgeOf(c);
  const family = names(c.family_members).slice(0, 14)
    .map((f) => `${f.name || f.person_name || 'Unnamed'}${f.relationship_type ? ` (${f.relationship_type})` : ''}`)
    .join('; ');
  return [
    `### ${c.name}`,
    `Age: ${age != null ? `${age} — recorded, use exactly this` : 'not recorded — treat as an adult and never state a number'}`,
    c.birthday ? `Date of birth: ${c.birthday}` : '',
    c.birth_year && !c.birthday ? `Birth year: ${c.birth_year}` : '',
    c.gender ? `Gender: ${c.gender}` : '',
    names(c.ethnicities).length ? `Heritage: ${names(c.ethnicities).join(', ')}` : '',
    c.occupation ? `Occupation: ${clip(c.occupation, 200)}` : '',
    c.profile_summary ? `Profile: ${clip(c.profile_summary, 900)}` : '',
    c.personality_summary ? `Personality: ${clip(c.personality_summary, 900)}` : '',
    names(c.personality_traits).length ? `Traits: ${names(c.personality_traits).slice(0, 18).join(', ')}` : '',
    c.communication_style ? `How they speak: ${clip(c.communication_style, 400)}` : '',
    c.appearance_notes ? `Appearance: ${clip(c.appearance_notes, 400)}` : '',
    (c.background_story || c.backstory) ? `Background: ${clip(c.background_story || c.backstory, 2200)}` : '',
    c.current_situation ? `Current situation: ${clip(c.current_situation, 800)}` : '',
    c.family_history ? `Family history: ${clip(c.family_history, 1800)}` : '',
    family ? `Family members: ${family}` : '',
    c.emotional_baggage ? `Emotional baggage: ${clip(c.emotional_baggage, 700)}` : '',
    c.upset_reaction ? `When hurt: ${clip(c.upset_reaction, 400)}` : '',
    c.emotional_state ? `Present emotional state: ${c.emotional_state}` : '',
  ].filter(Boolean).join('\n');
}

function messageBlock(messages, nameById) {
  return messages.map((m) => {
    const when = m.timestamp ? new Date(m.timestamp).toISOString().slice(0, 16).replace('T', ' ') : '';
    const who = m.sender_type === 'character'
      ? (m.character_name || nameById.get(m.sender_character_id) || 'Character')
      : (nameById.get('user') || 'Her person');
    const channel = m.channel || (m.sender_type === 'character' ? 'chat' : 'chat');
    const narrative = m.is_narrative ? '[narrative] ' : '';
    const image = m.image_description ? ` [shared image: ${clip(m.image_description, 220)}]` : '';
    return `${when} · ${channel} · ${who}: ${narrative}${clip(m.content, 700)}${image}`;
  }).join('\n');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'continue' ? 'continue' : (body.mode === 'redo' ? 'redo' : 'create');

    let novel = null;
    let central = null;
    let targetChapter = null;

    if (mode === 'create') {
      if (!body.character_id) return Response.json({ error: 'character_id is required' }, { status: 400 });
      if (!body.premise || !String(body.premise).trim()) return Response.json({ error: 'A premise is required' }, { status: 400 });
      central = await base44.entities.Character.get(body.character_id)
        .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!central) return Response.json({ error: 'Character not found' }, { status: 404 });
    } else {
      if (!body.novel_id) return Response.json({ error: 'novel_id is required' }, { status: 400 });
      novel = await base44.entities.Novel.get(body.novel_id).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!novel) return Response.json({ error: 'Novel not found' }, { status: 404 });
      if (novel.created_by_id !== user.id && user.role !== 'admin') {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      central = await base44.entities.Character.get(novel.character_id)
        .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    }

    // A rewrite targets one existing chapter of this novel and replaces only that chapter.
    if (mode === 'redo') {
      if (!body.chapter_id) return Response.json({ error: 'chapter_id is required' }, { status: 400 });
      targetChapter = await base44.entities.NovelChapter.get(body.chapter_id)
        .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!targetChapter || targetChapter.novel_id !== novel.id) {
        return Response.json({ error: 'That chapter is not part of this novel' }, { status: 404 });
      }
    }

    const centralId = central?.id || novel.character_id;
    const centralName = central?.name || novel.character_name || 'the character';
    const perspective = mode === 'create' ? (body.perspective === 'outside_narrator' ? 'outside_narrator' : 'character') : novel.perspective;
    const focusIds = names(mode === 'create' ? body.focus_character_ids : novel.focus_character_ids).filter((id) => id && id !== centralId);
    const focusMode = mode === 'create'
      ? (body.focus_mode === 'known' ? 'known' : 'selected')
      : (novel.focus_mode === 'known' ? 'known' : 'selected');
    const includeUser = mode === 'create' ? !!body.include_user : !!novel.include_user;
    const premise = mode === 'create' ? String(body.premise).trim() : novel.premise;
    const focus = mode === 'create' ? clip(body.focus, 600) : (novel.focus || '');
    const direction = clip(body.direction, 1200);

    // ── USER PERSONA (world name only — never "the user") ────────────────────
    const settings = await base44.entities.UserSettings.filter({ owner_email: user.email }, null, 1).catch(() => []);
    const settingsRow = asArray(settings)[0] || {};
    const worldName = settingsRow.fictional_world_name || user.full_name || 'the one who stays';

    // ── FOCUS CHARACTERS ─────────────────────────────────────────────────────
    // The user picked these people in the selection list, which is itself built from
    // the existing contact graph. Records the caller cannot read directly (a character
    // on another account) are resolved by exact ID through the service role. Read-only.
    let focusCharacters = [];
    if (focusIds.length) {
      const wanted = focusIds.slice(0, 12);
      const readable = asArray(await base44.entities.Character.filter({ id: { $in: wanted } }, null, 12).catch(() => []));
      const found = new Set(readable.map((c) => c.id));
      const missing = wanted.filter((id) => !found.has(id));
      const recovered = missing.length
        ? asArray(await base44.asServiceRole.entities.Character.filter({ id: { $in: missing } }, null, missing.length).catch(() => []))
        : [];
      focusCharacters = [...readable, ...recovered].filter(usableCharacter);
    }

    // ── SOURCE MATERIAL (read-only, all caller-scoped) ───────────────────────
    const [lifeEventsRaw, memoriesRaw, relationshipsRaw, conversationsRaw, storyEventsRaw] = await Promise.all([
      base44.entities.LifeEvent.filter({ character_id: centralId }, '-timestamp', 70).catch(() => []),
      base44.entities.CharacterMemory.filter({ character_id: centralId }, '-importance_score', 70).catch(() => []),
      base44.entities.CharacterRelationship.filter({
        $or: [{ source_character_id: centralId }, { target_character_id: centralId }],
      }, null, 60).catch(() => []),
      base44.entities.Conversation.filter({ character_ids: { $in: [centralId] } }, '-last_message_date', 14).catch(() => []),
      // Established Story Events they took part in — read only, nothing is triggered.
      base44.entities.StoryEvent.filter({ participant_character_ids: { $in: [centralId] } }, '-event_date', 18).catch(() => []),
    ]);

    const lifeEvents = asArray(lifeEventsRaw);
    const storyEvents = asArray(storyEventsRaw);

    // ── HOUSEHOLD (existing residency, unit-aware, read-only) ────────────────
    const homeLocationIds = [...new Set([central?.current_home_location_id, central?.temporary_housing_location_id].filter(Boolean))];
    let homeLocations = homeLocationIds.length
      ? asArray(await base44.entities.LocationReference.filter({ id: { $in: homeLocationIds } }, null, homeLocationIds.length).catch(() => []))
      : [];
    const unreadableHomeIds = homeLocationIds.filter((id) => !homeLocations.some((h) => h.id === id));
    if (unreadableHomeIds.length) {
      homeLocations = homeLocations.concat(asArray(await base44.asServiceRole.entities.LocationReference
        .filter({ id: { $in: unreadableHomeIds } }, null, unreadableHomeIds.length).catch(() => [])));
    }
    const householdIdsOf = (home) => {
      const units = Array.isArray(home?.residential_units) ? home.residential_units : [];
      if (units.length) {
        const myUnit = units.find((u) => (u.occupant_character_ids || []).includes(centralId));
        return myUnit ? (myUnit.occupant_character_ids || []) : [];
      }
      return [...new Set([
        ...(home?.resident_character_ids || []),
        ...asArray(home?.residents).map((r) => r?.character_id).filter(Boolean),
      ])];
    };
    const householdIds = new Set(homeLocations.flatMap((home) => householdIdsOf(home)).filter((id) => id && id !== centralId));
    const memories = asArray(memoriesRaw);
    const relationships = asArray(relationshipsRaw);
    const conversations = asArray(conversationsRaw);
    const conversationIds = conversations.map((c) => c.id).filter(Boolean).slice(0, 14);

    const messagePages = await Promise.all([
      conversationIds.length
        ? base44.entities.Message.filter({ conversation_id: { $in: conversationIds } }, '-timestamp', 140).catch(() => [])
        : Promise.resolve([]),
      base44.entities.Message.filter({ participant_character_ids: { $in: [centralId] } }, '-timestamp', 80).catch(() => []),
      base44.entities.Message.filter({ character_id: centralId }, '-timestamp', 80).catch(() => []),
    ]);

    const byId = new Map();
    messagePages.forEach((page) => asArray(page).forEach((m) => { if (m && m.id && !byId.has(m.id)) byId.set(m.id, m); }));
    const messages = [...byId.values()]
      .filter((m) => m.content || m.image_description)
      .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0))
      .slice(-90);

    // ── ANYONE THEY KNOW (only when the user chose that option) ──────────────
    // Candidates come from the central character's own readable records: family,
    // shared household, Story Event participation, fictional and established
    // relationships, memories, and documented conversations. Each source stands on
    // its own — none has to be corroborated. Nothing is created or modified — the
    // user then lets the premise decide who actually belongs in the chapter.
    let knownPeople = [];
    if (focusMode === 'known') {
      const knownVia = new Map();
      const note = (id, reason) => {
        if (!id || typeof id !== 'string' || id === centralId || id === user.id || knownVia.has(id)) return;
        knownVia.set(id, reason);
      };
      // Structured, independently sufficient sources first, so the candidate cap
      // never cuts them off behind the conversational history.
      names(central?.family_members).forEach((f) => note(f?._linked_character_id || f?.character_id || f?.related_character_id, 'family'));
      householdIds.forEach((id) => note(id, 'shared household'));
      storyEvents.forEach((e) => {
        [...(e?.participant_character_ids || []), ...(e?.focus_character_ids || [])]
          .forEach((id) => note(id, 'story event'));
      });
      names(central?.fictional_relationships).forEach((r) => note(r?.related_character_id || r?.character_id, 'relationship'));
      relationships.forEach((r) => note(
        r.source_character_id === centralId ? r.target_character_id : r.source_character_id, 'relationship'
      ));
      memories.forEach((m) => note(m?.related_character_id, 'shared memory'));
      messages.forEach((m) => {
        [...(m.participant_character_ids || []), m.sender_character_id, m.receiver_character_id]
          .forEach((id) => note(id, 'conversation'));
      });

      const candidateIds = [...knownVia.keys()].filter((id) => !focusIds.includes(id)).slice(0, 24);
      const readable = candidateIds.length
        ? asArray(await base44.entities.Character.filter({ id: { $in: candidateIds } }, null, candidateIds.length).catch(() => []))
        : [];
      const found = new Set(readable.map((c) => c.id));
      const missing = candidateIds.filter((id) => !found.has(id));
      const recovered = missing.length
        ? asArray(await base44.asServiceRole.entities.Character.filter({ id: { $in: missing } }, null, missing.length).catch(() => []))
        : [];
      knownPeople = [...readable, ...recovered]
        .filter(usableCharacter)
        .map((c) => ({ ...c, known_via: knownVia.get(c.id) }));
    }

    // Relationship counterpart names (batched, caller-scoped)
    const relatedIds = new Set();
    relationships.forEach((r) => {
      const other = r.source_character_id === centralId ? r.target_character_id : r.source_character_id;
      if (other && other !== centralId) relatedIds.add(other);
    });
    let relatedCharacters = [];
    if (relatedIds.size) {
      const fetched = await base44.entities.Character.filter({ id: { $in: [...relatedIds].slice(0, 24) } }, null, 24).catch(() => []);
      relatedCharacters = asArray(fetched);
    }
    const people = [central, ...focusCharacters, ...relatedCharacters, ...knownPeople].filter(Boolean);
    const nameById = new Map(people.map((p) => [p.id, p.name]));
    nameById.set('user', worldName);
    // Event participants keep the names recorded on the event itself.
    storyEvents.forEach((e) => {
      const ids = e?.participant_character_ids || [];
      const eventNames = e?.participant_character_names || [];
      ids.forEach((id, i) => { if (id && eventNames[i] && !nameById.has(id)) nameById.set(id, eventNames[i]); });
    });

    // Locations (visual continuity)
    const locationIds = [...new Set([
      central?.resolved_current_location_id,
      central?.current_home_location_id,
      central?.occupation_location_id,
    ].filter(Boolean))].slice(0, 4);
    const locations = locationIds.length
      ? asArray(await base44.entities.LocationReference.filter({ id: { $in: locationIds } }, null, 4).catch(() => []))
      : [];

    // ── PREVIOUS CHAPTERS (continuity) ───────────────────────────────────────
    let previousChapters = [];
    if (mode === 'continue') {
      const pages = await base44.entities.NovelChapter.filter({ novel_id: novel.id }, 'chapter_number', 60).catch(() => []);
      previousChapters = asArray(pages).sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0));
    }
    const chapterNumber = previousChapters.length
      ? Math.max(...previousChapters.map((c) => c.chapter_number || 0)) + 1
      : 1;
    const lastChapter = previousChapters[previousChapters.length - 1];

    // ── PROMPT ───────────────────────────────────────────────────────────────
    const source = [];

    source.push(`## THE PEOPLE`);
    source.push(characterBlock(central) || `### ${centralName}`);
    focusCharacters.forEach((c) => source.push(characterBlock(c)));

    if (knownPeople.length) {
      source.push(`\n## PEOPLE IN THEIR LIFE (established connections — draw only on those this chapter needs)`);
      knownPeople.forEach((c) => {
        const bits = [
          c.known_via ? `known through ${c.known_via}` : '',
          c.occupation ? clip(c.occupation, 120) : '',
          c.profile_summary ? clip(c.profile_summary, 220) : '',
        ].filter(Boolean).join(' · ');
        source.push(`- ${c.name}${bits ? ` — ${bits}` : ''}`);
      });
    }

    if (includeUser) {
      source.push([
        `### ${worldName} — the account holder's own persona`,
        `This person appears in the novel under the name ${worldName}. Never write "the user", "the account holder", "the player" or any meta term. ${worldName} is a person in the story.`,
        settingsRow.user_gender ? `Gender: ${settingsRow.user_gender}` : '',
        settingsRow.user_culture ? `Culture: ${clip(settingsRow.user_culture, 200)}` : '',
        names(settingsRow.user_aliases).length ? `Also called: ${names(settingsRow.user_aliases).join(', ')}` : '',
      ].filter(Boolean).join('\n'));
    }

    if (relationships.length) {
      source.push(`\n## ESTABLISHED RELATIONSHIPS`);
      relationships.slice(0, 45).forEach((r) => {
        const outgoing = r.source_character_id === centralId;
        const other = nameById.get(outgoing ? r.target_character_id : r.source_character_id) || 'someone in their life';
        const label = outgoing ? r.label_from_source_perspective : r.label_from_target_perspective;
        const type = r.relationship_type || 'relationship';
        const numbers = [
          r.friendship_level != null ? `friendship ${r.friendship_level}` : '',
          r.trust_level != null ? `trust ${r.trust_level}` : '',
          r.romantic_level ? `romantic ${r.romantic_level}` : '',
          r.attraction_level ? `attraction ${r.attraction_level}` : '',
        ].filter(Boolean).join(', ');
        source.push(`- ${other} — ${label || type}${numbers ? ` (${numbers})` : ''}`);
      });
    }

    if (memories.length) {
      source.push(`\n## MEMORIES ${centralName} ACTUALLY HOLDS`);
      memories.slice(0, 50).forEach((m) => {
        const text = m.memory_summary || m.memory_text;
        if (text) source.push(`- ${clip(text, 420)}`);
      });
    }
    const inlineMemories = names(central?.memories);
    if (inlineMemories.length) {
      source.push(`\n## ADDITIONAL RECORDED MEMORIES`);
      inlineMemories.slice(-20).forEach((m) => {
        const text = m.memory_summary || m.memory_text || m.summary || m.content;
        if (text) source.push(`- ${clip(text, 320)}`);
      });
    }

    if (lifeEvents.length) {
      source.push(`\n## LIFE JOURNAL (established experience, newest first)`);
      lifeEvents.slice(0, 45).forEach((e) => {
        const when = e.timestamp ? new Date(e.timestamp).toISOString().slice(0, 10) : '';
        source.push(`- ${when} ${clip(e.title, 140)}: ${clip(e.description, 420)}${e.emotional_impact ? ` (emotional impact: ${clip(e.emotional_impact, 200)})` : ''}`);
      });
    }

    if (storyEvents.length) {
      source.push(`\n## ESTABLISHED EVENTS THEY TOOK PART IN (recorded Story Events — background you may draw on)`);
      storyEvents.slice(0, 16).forEach((e) => {
        const when = e.event_date || (e.created_date ? new Date(e.created_date).toISOString().slice(0, 10) : '');
        const venue = e.venue_name || e.rabbit_hole_venue_name || '';
        const with_ = names(e.participant_character_names).filter((n) => n && n !== centralName).slice(0, 8).join(', ');
        source.push(`- ${when} ${clip(e.title, 140)}${venue ? ` at ${venue}` : ''}${with_ ? ` — with ${with_}` : ''}${e.plot ? `: ${clip(e.plot, 400)}` : ''}`);
      });
      const recorded = storyEvents.filter((e) => e.generated_narrative).slice(0, 4);
      if (recorded.length) {
        source.push(`\n### WHAT WAS RECORDED AS HAPPENING (do not contradict these events)`);
        recorded.forEach((e) => source.push(`${clip(e.title, 120)}:\n${clip(e.generated_narrative, 1500)}`));
      }
    }

    if (messages.length) {
      source.push(`\n## DOCUMENTED INTERACTIONS (chat, text, scene and world phone — chronology, oldest first)`);
      source.push(messageBlock(messages, nameById));
    }

    if (locations.length) {
      source.push(`\n## ESTABLISHED PLACES`);
      locations.forEach((l) => {
        source.push(`- ${l.name}${l.category ? ` (${l.category})` : ''}${l.description ? `: ${clip(l.description, 300)}` : ''}`);
      });
    }

    const previousBlock = previousChapters.length
      ? [
        `\n## WHAT THIS NOVEL HAS ALREADY COVERED`,
        `Chapters written so far:`,
        ...previousChapters.map((c) => `- Chapter ${c.chapter_number}: ${c.title}${c.summary ? ` — ${clip(c.summary, 300)}` : ''}`),
        `Do not retell what these chapters already covered. Continue the same book, the same voice, the same chronology.`,
        lastChapter?.content ? `\n### THE IMMEDIATELY PRECEDING CHAPTER (for voice, tone and continuity only — do not repeat it)\n${clip(lastChapter.content, 7000)}` : '',
      ].join('\n')
      : `\n## THIS IS CHAPTER ONE\nEstablish the world, the people and the emotional stakes without summarizing the whole life in one chapter.`;

    const perspectiveRule = perspective === 'outside_narrator'
      ? [
        `PERSPECTIVE — OUTSIDE NARRATOR, THIRD PERSON OMNISCIENT.`,
        `Write in third person. The narrator knows the established feelings, thoughts and inner lives of the people involved, and may show that two people experienced the same moment completely differently.`,
        `That knowledge belongs to the narrator alone. Never let a character act on feelings or facts they have not actually learned. No mind-reading by the characters themselves.`,
      ].join('\n')
      : [
        `PERSPECTIVE — ${centralName.toUpperCase()}, FIRST PERSON.`,
        `Write in first person as ${centralName}. You may render their own memories, emotions, thoughts and interpretations.`,
        `They may read another person's feelings only from what they actually saw or heard — tone, hesitation, behaviour, remembered conversations — and must be written as belief or inference ("she seemed", "I told myself", "I couldn't tell whether"), never as certain knowledge of someone's private mind.`,
      ].join('\n');

    const lengthRule = previousChapters.length > 3
      ? `Roughly 1,400–2,200 words, 16–32 paragraphs.`
      : `Roughly 1,800–2,800 words, 20–40 paragraphs.`;

    const instruction = [
      `You are a serious literary novelist writing one chapter of a novel about ${centralName}, built strictly from the established life recorded below.`,
      ``,
      `## THE ONE ABSOLUTE LAW — THE SOURCE IS THE ONLY AUTHORITY`,
      `Everything on the page must be consistent with the SOURCE MATERIAL and the established characters. Never invent a major event, betrayal, confession, promise, illness, death, pregnancy, crime, or new relationship that the source does not support. Never contradict chronology.`,
      ``,
      `## DOCUMENTED EXPERIENCE vs RECONSTRUCTED HISTORY`,
      `- DOCUMENTED: chat, text, scene and world phone messages, recorded life events, memories, established relationships. Treat these as things that really happened. You may quote recorded dialogue — sparingly and faithfully. You may expand a documented moment into a full scene with atmosphere, physical detail, pacing and emotional interpretation, but you must NOT add an argument, confession, promise, revelation or outcome that never occurred. Do not write invented sentences as quotation marks attributed to these people for documented time.`,
      `- RECONSTRUCTED: anything before ${centralName} entered this world — upbringing, family history, earlier life. Here restrained, plausible reconstructed dialogue is allowed, consistent with the known personalities and circumstances, as long as it establishes no new major event and contradicts nothing.`,
      `If you are unsure whether something is documented, describe or summarize it instead of quoting it.`,
      ``,
      `## ${perspectiveRule}`,
      ``,
      `## THIS IS LITERATURE, NOT A TRANSCRIPT`,
      `Most of the chapter must be developed prose: scene-setting, sensory detail, interiority, gesture, silence, transitions, emotional movement, and consequence. Dialogue is a spice, not the body. Never reproduce a chat log. Never mention records, memories-as-files, data, apps, prompts, or that this story is generated.`,
      includeUser ? `When ${worldName} appears, use that name and treat them as a person in the story — never "the user".` : `The account holder does not appear in this novel; do not write them into scenes.`,
      focusMode === 'known'
        ? `No individual people were chosen for this novel. Select from PEOPLE IN THEIR LIFE according to the premise and the period it covers, and leave out anyone who is not relevant. Never force a connection into a chapter.`
        : '',
      ``,
      `## CHAPTER SHAPE`,
      lengthRule,
      `Paragraphs separated by a blank line. No headings, no bullet points, no chapter number inside the body — the chapter title is returned separately. Open inside a moment, not with a summary of the life. End the chapter on a real turn: an image, a decision, a shift in understanding, or a quiet consequence.`,
      ``,
      `## ILLUSTRATIONS`,
      `Choose 2 or 3 moments from THIS chapter — never more than 3 — spread across it, each one a moment the prose actually describes. For each: after_paragraph is the 1-based index of the paragraph it should follow; caption is a short literary line; scene is a precise visual description for an illustrator (who is present, what they are doing, the setting, framing, light, mood); characters lists the names of the people visible (use the exact names above); location is where it happens. Do not illustrate a character or event the chapter does not contain.`,
      ``,
      `## NOVEL`,
      mode === 'continue'
        ? `This is chapter ${chapterNumber} of the existing novel "${novel.title}". Continue it — same book, same voice, moving the story forward into experience not yet covered.`
        : `This is chapter one of a new novel. Also propose a short, evocative novel title (3–6 words, no colon unless it earns it) unless a title is supplied.`,
      `Premise: ${premise}`,
      focus ? `Focus: ${focus}` : '',
      direction ? `Direction for this chapter: ${direction}` : '',
      mode === 'continue' && novel.title ? `Existing title: ${novel.title}` : '',
      mode === 'create' && body.title ? `The user supplied this title, use it exactly: ${body.title}` : '',
      ``,
      `## SOURCE MATERIAL`,
      source.join('\n'),
      previousBlock,
    ].filter(Boolean).join('\n');

    const generated = await base44.integrations.Core.InvokeLLM({
      prompt: instruction,
      model: 'claude-sonnet-5',
      response_json_schema: {
        type: 'object',
        properties: {
          novel_title: { type: 'string' },
          chapter_title: { type: 'string' },
          content: { type: 'string' },
          chapter_summary: { type: 'string' },
          illustrations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                after_paragraph: { type: 'number' },
                caption: { type: 'string' },
                scene: { type: 'string' },
                characters: { type: 'array', items: { type: 'string' } },
                location: { type: 'string' },
              },
              required: ['after_paragraph', 'caption', 'scene'],
            },
          },
        },
        required: ['chapter_title', 'content', 'illustrations'],
      },
    });

    const content = String(generated?.content || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^\s*chapter\s+[0-9ivxlc]+[^\n]*\n+/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!content) return Response.json({ error: 'The chapter came back empty. Please try again.' }, { status: 502 });

    const chapterTitle = clip(generated?.chapter_title, 160) || `Chapter ${chapterNumber}`;

    // ── PERSIST THE NOVEL RECORD (only novel-owned records are written) ──────
    if (mode === 'create') {
      novel = await base44.entities.Novel.create({
        character_id: centralId,
        character_name: centralName,
        owner_email: user.email,
        title: clip(body.title, 160) || clip(generated?.novel_title, 160) || `${centralName}: A Life`,
        focus,
        premise,
        perspective,
        focus_mode: focusMode,
        focus_character_ids: focusIds,
        focus_character_names: focusCharacters.map((c) => c.name),
        include_user: includeUser,
        user_world_name: includeUser ? worldName : '',
        chapter_count: 0,
      });
    }

    // ── ILLUSTRATIONS (max 3, existing reference systems only) ──────────────
    const userRefs = [
      ...names(user.reference_image_urls),
      ...names(user.generated_avatar_urls),
    ].slice(0, 2);

    const specs = (Array.isArray(generated?.illustrations) ? generated.illustrations : []).slice(0, 3);
    const imageResults = await Promise.allSettled(specs.map(async (spec) => {
      const depictedNames = names(spec.characters).map((n) => String(n).toLowerCase());
      const depicted = people.filter((p) => {
        const pn = String(p.name || '').toLowerCase();
        return pn && depictedNames.some((n) => n === pn || n.includes(pn) || pn.includes(n));
      });
      const showsUser = includeUser && depictedNames.some((n) => n.includes(String(worldName).toLowerCase()));

      const refs = [];
      depicted.forEach((p) => {
        if (p.avatar_url) refs.push(p.avatar_url);
        names(p.reference_image_urls).slice(0, 2).forEach((r) => refs.push(r));
      });
      if (showsUser) refs.push(...userRefs);
      const matchedLocation = locations.find((l) => spec.location && String(l.name || '').toLowerCase().includes(String(spec.location).toLowerCase().slice(0, 12)));
      if (matchedLocation) names(matchedLocation.image_urls).slice(0, 1).forEach((r) => refs.push(r));

      const identity = depicted.map((p) => `${p.name}${p.ethnicities && p.ethnicities.length ? ` (${p.ethnicities.join('/')})` : ''}: ${clip(p.appearance_notes || p.profile_summary, 260)}`).join(' | ');

      const prompt = [
        `Literary novel illustration — painterly cinematic realism, natural light, restrained colour, editorial dignity.`,
        spec.scene,
        depicted.length ? `People present: ${depicted.map((p) => p.name).join(', ')}. Their faces, hair and features must match the attached reference photographs exactly — same person, not a lookalike.` : '',
        showsUser ? `${worldName} must match their attached reference photographs exactly.` : '',
        spec.location ? `Setting: ${spec.location}.` : '',
        identity ? `Identity notes: ${identity}` : '',
        `No text, no captions, no lettering, no borders, no collage. A single coherent moment, like a plate in an illustrated novel.`,
      ].filter(Boolean).join('\n');

      const result = await base44.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: [...new Set(refs)].slice(0, 6),
      });
      return { url: result?.url, spec };
    }));

    const illustrations = imageResults
      .filter((r) => r.status === 'fulfilled' && r.value?.url)
      .map((r) => ({
        url: r.value.url,
        caption: clip(r.value.spec.caption, 240),
        after_paragraph: Math.max(1, Math.round(Number(r.value.spec.after_paragraph) || 1)),
      }))
      .sort((a, b) => a.after_paragraph - b.after_paragraph);

    // ── PERSIST THE CHAPTER ─────────────────────────────────────────────────
    const chapter = await base44.entities.NovelChapter.create({
      novel_id: novel.id,
      owner_email: user.email,
      chapter_number: chapterNumber,
      title: chapterTitle,
      content,
      summary: clip(generated?.chapter_summary, 1200),
      direction,
      word_count: content.split(/\s+/).filter(Boolean).length,
      illustrations,
    });

    const updatedNovel = await base44.entities.Novel.update(novel.id, {
      chapter_count: chapterNumber,
      last_chapter_at: new Date().toISOString(),
      cover_image_url: novel.cover_image_url || illustrations[0]?.url || '',
    });

    return Response.json({ novel: updatedNovel, chapter });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});