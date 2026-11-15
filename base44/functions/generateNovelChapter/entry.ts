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
//
// Illustration plates are drawn by generateNovelIllustrations, in their own
// request. Writing prose and then drawing three images inside one request ran
// past the platform's request limit, and the timeout discarded a finished
// chapter. The prose is therefore saved here first, and the plates are resolved
// to their records here so the next call can draw them.
// ─────────────────────────────────────────────────────────────────────────────

const clip = (value, max) => (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim().slice(0, max || 600);
const asArray = (value) => (Array.isArray(value) ? value : (value && value.items) || []);
const names = (list) => (Array.isArray(list) ? list : []).filter(Boolean);
const NOVEL_DEAD_STATUS = ['deleted', 'soft_deleted', 'merged'];
const usableCharacter = (c) => !!c && !!c.id && !!c.name
  && !NOVEL_DEAD_STATUS.includes(c.status)
  && c.life_status !== 'deceased'
  && c.is_test_character !== true;

// ── FAILURE REPORTING ────────────────────────────────────────────────────────
// A failed attempt never changes the novel. Every failure names the stage that
// failed, whether trying again can help, and whether adjusting the request can
// help, so the reader is never shown a bare HTTP code as the whole explanation.
const failureResponse = (status, failure) =>
  Response.json({ error: failure.message, failure }, { status });

const statusOf = (error) => {
  const value = Number(error?.status || error?.response?.status);
  return Number.isFinite(value) && value > 0 ? value : null;
};

// A transient failure is the service itself: retrying shortly can genuinely help.
const isTransientWriteFailure = (error) => {
  const status = statusOf(error);
  if (status && [429, 500, 502, 503, 504].includes(status)) return true;
  return /overloaded|temporarily unavailable|timeout|timed out|rate limit|too many requests|econnreset/i
    .test(String(error?.message || ''));
};

// A cause is reported only when the response actually shows it. An HTTP code on
// its own never becomes "the service is down", and a request that ran past its own
// time limit is never described as an outage.
const TIMEOUT_PATTERN = /timed? ?out|deployment_timed_out|deadline|time limit|etimedout|took too long/i;
const CONTENT_PATTERN = /content (policy|filter)|safety (system|policy|filter)|moderation|prohibited content|responsible ai|policy violation|blocked by (the )?(content|safety)/i;
const UNAVAILABLE_PATTERN = /service unavailable|temporarily unavailable|overloaded|at capacity|bad gateway/i;

const classifyFailure = (error, stage) => {
  const status = statusOf(error);
  const detail = [String(error?.message || ''), String(error?.response?.data?.error || '')]
    .filter(Boolean).join(' ');
  const technical = [status ? `HTTP ${status}` : '', detail].filter(Boolean).join(' — ');
  const base = { stage, technical };

  // Timeouts are checked first: a platform timeout arrives as "Service
  // Unavailable", but what happened is that this request ran out of time.
  if (status === 408 || TIMEOUT_PATTERN.test(detail)) {
    return {
      ...base, cause: 'timed_out', retryable: true, canAdjust: true,
      message: 'The chapter was still being written when this request ran out of time, so nothing was saved. Your novel has not been changed. Trying again can work, and a narrower focus finishes faster.',
    };
  }
  if (status === 429 || /rate limit|too many requests/i.test(detail)) {
    return {
      ...base, cause: 'busy', retryable: true, canAdjust: false,
      message: 'The writing service is handling too many requests at the moment, so this chapter was not written. Your novel has not been changed. Wait a moment and try again.',
    };
  }
  if (CONTENT_PATTERN.test(detail)) {
    return {
      ...base, cause: 'content_restricted', retryable: true, canAdjust: true,
      message: 'The writing service would not write part of what this chapter asked for. Your novel has not been changed. You can adjust the chapter\'s focus and try again.',
    };
  }
  if (UNAVAILABLE_PATTERN.test(detail)) {
    return {
      ...base, cause: 'service_unavailable', retryable: true, canAdjust: false,
      message: 'The writing service reported that it was unavailable, so this chapter was not written. Your novel has not been changed. You can try again.',
    };
  }
  return {
    ...base, cause: 'unknown', retryable: true, canAdjust: false,
    message: 'This chapter could not be generated, and the specific cause could not be identified from the information available. Your novel has not been changed. You can try again.',
  };
};

// A refusal or an empty answer is a content outcome, not a service outage: the
// retry note asks for the chapter to be written around the restricted moment
// instead of refusing the whole request.
const RESTRICTED_MATERIAL_NOTE = [
  'IMPORTANT CORRECTION: return the chapter itself, in the required JSON shape, and nothing else.',
  'Never return a refusal, a disclaimer, an apology, or an explanation of what you will not write.',
  'If a particular moment would be restricted, write around it: imply it, fade past it, or summarise it in a sentence or two, and keep the rest of the chapter exactly as instructed.',
].join(' ');

const REFUSAL_PATTERN = /^(i'm sorry|i am sorry|i can't|i cannot|i won't|i will not|i'm not able|unable to (comply|continue|help|write)|as an ai|certainly[,!]? here)/i;
const looksLikeRefusal = (text) => String(text || '').trim().length < 500 && REFUSAL_PATTERN.test(String(text || '').trim());

// ── CONTINUATION ASSEMBLY ────────────────────────────────────────────────────
// A finishing response can echo the opening it was given before it carries on —
// the same paragraphs, word for word — and joining that blindly saves a chapter
// with its own beginning written twice. Paragraphs that only repeat prose the
// chapter already contains are therefore dropped before the two parts are joined.
// The comparison is deliberately narrow: only near-identical language goes. A
// callback, a remembered conversation or a reflection that adds something new
// shares a subject and names, not most of its words, and is always kept.
const paragraphsOf = (value) => String(value || '').replace(/\r\n?/g, '\n')
  .split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
const wordSet = (value) => new Set(
  String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
);
const overlapOf = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((word) => { if (b.has(word)) shared += 1; });
  return shared / (a.size + b.size - shared);
};
const DUPLICATE_OVERLAP = 0.85;

function joinContinuation(opening, continuation) {
  const openingParagraphs = paragraphsOf(opening);
  const openingText = ` ${openingParagraphs.map((p) => p.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join(' ')} `;
  const seen = openingParagraphs.map(wordSet);
  const kept = [];
  let dropped = 0;
  let addedWords = 0;
  paragraphsOf(continuation).forEach((paragraph) => {
    const words = wordSet(paragraph);
    const normalized = paragraph.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // A substantial paragraph is repeated when it is built from the same language
    // as one already written.
    const repeatsExisting = words.size >= 12
      && seen.some((other) => overlapOf(words, other) >= DUPLICATE_OVERLAP);
    // A short line — a name, half a sentence of dialogue — carries too little
    // language to compare, so it only counts as repeated when it appears word for
    // word already.
    const repeatsVerbatim = words.size >= 4 && words.size < 12
      && openingText.includes(` ${normalized} `);
    if (repeatsExisting || repeatsVerbatim) { dropped += 1; return; }
    kept.push(paragraph);
    seen.push(words);
    addedWords += String(paragraph).split(/\s+/).filter(Boolean).length;
  });
  return {
    content: [String(opening || '').trim(), kept.join('\n\n')].filter(Boolean).join('\n\n')
      .replace(/\n{3,}/g, '\n\n').trim(),
    dropped,
    addedWords,
  };
}

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

// A location description is written for human readers; strip markdown and drop
// generation preambles so only the actual description reaches the prompt.
const readableText = (value, max) => {
  const text = String(value || '').replace(/[*#_`>]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/^(here are|here is|below are|sure[,!]|certainly|of course)\b/i.test(text)) return '';
  return text.slice(0, max || 400);
};

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
    const channel = m.channel || 'chat';
    const narrative = m.is_narrative ? '[narrative] ' : '';
    const image = m.image_description ? ` [shared image: ${clip(m.image_description, 220)}]` : '';
    return `${when} · ${channel} · ${who}: ${narrative}${clip(m.content, 700)}${image}`;
  }).join('\n');
}

// ── PREMISE-DRIVEN SOURCE SELECTION ──────────────────────────────────────────
// A character's records hold everything they have ever done. One chapter is about
// one subject, so only the material belonging to that subject is sent to the
// writer: unrelated adult history never crowds out the childhood a reader asked
// for. This is a read-only decision about one attempt — no record is changed,
// hidden or denied.
const ROUTINE_PATTERN = /\b(nap|napped|napping|woke|wake|waking|asleep|slept|sleep|bedtime|ate|eaten|eating|breakfast|lunch|dinner|meal|shower|brushed|dressed|hygiene|energy|comfort|simulated|routine)\b/i;
const isRoutineEntry = (text) => ROUTINE_PATTERN.test(String(text || ''));

const STOP_WORDS = new Set(['the', 'and', 'his', 'her', 'their', 'about', 'from', 'with', 'that', 'this', 'into', 'over', 'after', 'before', 'when', 'where', 'which', 'while', 'would', 'could', 'should', 'have', 'been', 'being', 'they', 'them', 'then', 'than', 'there', 'these', 'those', 'very', 'just', 'also', 'more', 'most', 'some', 'such', 'only', 'other', 'what', 'your', 'chapter', 'novel', 'book', 'story', 'tell']);
const EARLY_LIFE_PATTERN = /childhood|upbringing|early (years|life)|growing up|as a (boy|girl|kid|child)|younger (days|years)|before everything/i;
const EARLY_LIFE_WORDS = ['child', 'children', 'boy', 'girl', 'kid', 'school', 'grade', 'mother', 'father', 'mom', 'dad', 'family', 'raised', 'born', 'young', 'home'];

const tokensOf = (value) => new Set(
  String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter((word) => word.length > 3 && !STOP_WORDS.has(word))
);

const scoreAgainst = (tokens, text) => {
  if (!tokens.size) return 0;
  const words = new Set(String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' '));
  let score = 0;
  tokens.forEach((token) => { if (words.has(token)) score += 1; });
  return score;
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    period: { type: 'string' },
    keep_memories: { type: 'array', items: { type: 'string' } },
    keep_life_events: { type: 'array', items: { type: 'string' } },
    keep_story_events: { type: 'array', items: { type: 'string' } },
    keep_relationships: { type: 'array', items: { type: 'string' } },
    keep_messages: { type: 'array', items: { type: 'string' } },
  },
  required: ['subject', 'keep_memories', 'keep_life_events', 'keep_relationships', 'keep_messages'],
};

async function selectPremiseSource({ base44, premise, focus, direction, central, memories, lifeEvents, relationships, storyEvents, messages, nameById }) {
  const asked = [premise, focus, direction].filter(Boolean).join(' ');
  const centralName = central?.name || 'the character';
  const centralAge = currentAgeOf(central);

  const substantiveMemories = memories.filter((m) => !isRoutineEntry(m.memory_summary || m.memory_text));
  const substantiveLifeEvents = lifeEvents.filter((e) => !isRoutineEntry(`${e.title || ''} ${e.description || ''}`));
  const substantiveMessages = messages.filter((m) => String(m.content || '').trim().length > 40);

  const memoryItems = substantiveMemories.slice(0, 40).map((record, i) => ({
    key: `m${i}`, record, text: clip(record.memory_summary || record.memory_text, 150),
  }));
  const lifeItems = substantiveLifeEvents.slice(0, 36).map((record, i) => ({
    key: `l${i}`, record,
    text: `${record.timestamp ? new Date(record.timestamp).toISOString().slice(0, 10) : ''} ${clip(record.title, 90)}: ${clip(record.description, 160)}`,
  }));
  const eventItems = storyEvents.slice(0, 12).map((record, i) => ({
    key: `s${i}`, record,
    text: `${record.event_date || ''} ${clip(record.title, 90)}${record.venue_name ? ` at ${record.venue_name}` : ''}`,
  }));
  const relationItems = relationships.slice(0, 18).map((record, i) => {
    const outgoing = record.source_character_id === central?.id;
    const otherName = nameById.get(outgoing ? record.target_character_id : record.source_character_id) || 'someone';
    return {
      key: `r${i}`, record,
      text: `${otherName} — ${record.relationship_type || 'relationship'}${outgoing ? '' : ` (their view of ${centralName})`}`,
    };
  });
  const messageItems = substantiveMessages.slice(-24).map((record, i) => ({
    key: `c${i}`, record,
    text: `${record.timestamp ? new Date(record.timestamp).toISOString().slice(0, 10) : ''} ${record.channel || 'chat'} · ${clip(record.content, 150)}`,
  }));

  const routineTotal = (memories.length - substantiveMemories.length) + (lifeEvents.length - substantiveLifeEvents.length);
  const catalogue = [
    memoryItems.length ? `--- MEMORIES ---\n${memoryItems.map((item) => `${item.key}: ${item.text}`).join('\n')}` : '',
    lifeItems.length ? `--- LIFE JOURNAL ---\n${lifeItems.map((item) => `${item.key}: ${item.text}`).join('\n')}` : '',
    eventItems.length ? `--- STORY EVENTS ---\n${eventItems.map((item) => `${item.key}: ${item.text}`).join('\n')}` : '',
    relationItems.length ? `--- RELATIONSHIPS ---\n${relationItems.map((item) => `${item.key}: ${item.text}`).join('\n')}` : '',
    messageItems.length ? `--- RECORDED CONVERSATIONS ---\n${messageItems.map((item) => `${item.key}: ${item.text}`).join('\n')}` : '',
    routineTotal ? `--- ROUTINE ---\n${routineTotal} further entries record only sleep, naps, meals and physical needs.` : '',
  ].filter(Boolean);

  const planPrompt = [
    `You are choosing the recorded material for ONE chapter of a novel about ${centralName}${centralAge != null ? `, who is ${centralAge} years old today` : ''}.`,
    ``,
    `## THE REQUEST`,
    `Premise: ${premise}`,
    focus ? `Focus: ${focus}` : '',
    direction ? `Direction for this chapter: ${direction}` : '',
    ``,
    `## YOUR TASK`,
    `Name the subject the reader actually asked for, and choose the recorded entries that belong to it.`,
    ``,
    `## RULES`,
    `- Judge every entry against the requested subject, never against how interesting it is on its own.`,
    `- If the request is about childhood, upbringing or early life, keep family, formative years, school and the people who raised them, and leave out adult relationships, adult experiences and everything belonging to a later life.`,
    `- If the request is about a particular person, period, relationship or event, keep only what serves it.`,
    `- Leave out routine housekeeping (sleep, naps, meals, needs) unless ordinary daily life is the subject.`,
    `- Never reject an entry for being painful or difficult: a hard childhood memory is exactly what a childhood chapter needs.`,
    `- Entries left out are not denied — they are simply not part of this chapter. Use empty lists only if nothing in the catalogue belongs to the request.`,
    ``,
    `## CATALOGUE`,
    catalogue.join('\n\n'),
    ``,
    `## REPLY`,
    `subject: the requested subject in one short sentence.`,
    `period: the life period it points to (for example "childhood", "his thirties", "the present"), or an empty string.`,
    `Then the keys you keep in keep_memories, keep_life_events, keep_story_events, keep_relationships and keep_messages.`,
  ].filter(Boolean).join('\n');

  let plan = null;
  try {
    plan = await base44.integrations.Core.InvokeLLM({
      model: 'gemini_3_8_flash',
      prompt: planPrompt,
      response_json_schema: PLAN_SCHEMA,
    });
  } catch {
    plan = null;
  }

  const keep = (items, keys) => {
    if (!plan || !Array.isArray(keys)) return null;
    const wanted = new Set(keys.filter((key) => typeof key === 'string'));
    return items.filter((item) => wanted.has(item.key)).map((item) => item.record);
  };

  const planned = plan ? {
    memories: keep(memoryItems, plan.keep_memories),
    lifeEvents: keep(lifeItems, plan.keep_life_events),
    storyEvents: keep(eventItems, plan.keep_story_events),
    relationships: keep(relationItems, plan.keep_relationships),
    messages: keep(messageItems, plan.keep_messages),
  } : null;

  const candidateCount = memoryItems.length + lifeItems.length + relationItems.length + messageItems.length;
  const plannedCount = planned
    ? Object.values(planned).reduce((total, list) => total + (list ? list.length : 0), 0)
    : 0;

  // The plan is used when it produced a usable selection. When no plan could be
  // made — or it selected nothing from a catalogue that clearly holds candidates —
  // relevance is scored against the request's own words, so the chapter is still
  // written from the material closest to what was asked for.
  if (planned && (!candidateCount || plannedCount > 0)) {
    return {
      memories: planned.memories.slice(0, 20),
      lifeEvents: planned.lifeEvents.slice(0, 20),
      storyEvents: planned.storyEvents.slice(0, 8),
      relationships: planned.relationships.slice(0, 12),
      messages: planned.messages.slice(0, 12),
      subject: clip(plan.subject, 240) || premise,
      period: clip(plan.period, 120),
      planned: true,
    };
  }

  const tokens = tokensOf(asked);
  if (EARLY_LIFE_PATTERN.test(asked)) EARLY_LIFE_WORDS.forEach((word) => tokens.add(word));
  const ranked = (items, limit) => items
    .map((item) => ({ item, score: scoreAgainst(tokens, item.text) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item.record);

  return {
    memories: ranked(memoryItems, 16),
    lifeEvents: ranked(lifeItems, 16),
    storyEvents: ranked(eventItems, 6),
    relationships: relationItems.slice(0, 10).map((item) => item.record),
    messages: ranked(messageItems, 10),
    subject: premise,
    period: EARLY_LIFE_PATTERN.test(asked) ? 'early life' : '',
    planned: false,
  };
}

// A Redo writes its replacement over the chapter it replaces. While that is happening
// the version being replaced is kept on the chapter itself, so a redo that fails can
// put it back exactly as it was — prose, title, word count, plates and stored premise.
async function restoreReplacedChapter(base44, chapter) {
  const previous = chapter?.previous_version;
  if (!previous || !previous.content) return false;
  const restored = await base44.entities.NovelChapter.update(chapter.id, {
    content: previous.content,
    title: previous.title || chapter.title,
    word_count: previous.word_count || 0,
    illustrations: Array.isArray(previous.illustrations) ? previous.illustrations : [],
    illustration_specs: Array.isArray(previous.illustration_specs) ? previous.illustration_specs : [],
    direction: previous.direction || '',
    writing_state: 'complete',
    writing_brief: {},
    previous_version: {},
  }).catch(() => null);
  return !!restored;
}

Deno.serve(async (req) => {
  // Which part of the work we are in, so an unexpected crash can still say where
  // it happened instead of returning a bare code.
  let stage = 'source';
  // Set once a Redo has begun replacing a chapter: a failure below must hand that
  // chapter back, not leave a half-written replacement in its place.
  let redoRevert = null;
  try {
    const base44Base = createClientFromRequest(req);
    const sr = base44Base.asServiceRole;
    const user = await base44Base.auth.me().catch(() => null);
    const body = await req.json().catch(() => ({}));

    // Server-side continuation: the "Novel Generation Continuation" workflow starts the
    // finishing stage with no user session, so a chapter completes even when the Novel
    // reader is no longer open. Only the finishing stage may run that way, and only on
    // a chapter that is already partly written — never a new or a completed chapter.
    const internalFinish = !user && body.part === 'finish';
    if (!user && !internalFinish) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // The internal stage reads the records it needs by ID, so it runs with service-role
    // access. Every caller with a session keeps their own scope, exactly as before.
    const base44 = user ? base44Base : sr;
    const ownerEmail = user?.email || null;
    // A chapter is written in two bounded requests: an opening here, then a finish
    // in a second call. One longer request runs past the platform's request limit,
    // and the timeout used to throw away everything that had been written.
    const finishing = body.part === 'finish';
    const mode = finishing
      ? 'continue'
      : (body.mode === 'continue' ? 'continue' : (body.mode === 'redo' ? 'redo' : 'create'));

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
      if (user && novel.created_by_id !== user.id && user.role !== 'admin') {
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

    // Finishing continues the opening already saved for this chapter, from the
    // material that opening was built from.
    let resumeChapter = null;
    let brief = null;
    if (finishing) {
      if (!body.chapter_id) return Response.json({ error: 'chapter_id is required' }, { status: 400 });
      resumeChapter = await base44.entities.NovelChapter.get(body.chapter_id)
        .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      if (!resumeChapter || resumeChapter.novel_id !== novel?.id) {
        return Response.json({ error: 'That chapter is not part of this novel' }, { status: 404 });
      }
      // Already finished: report it as it stands rather than writing it twice.
      if (resumeChapter.writing_state !== 'writing') {
        return Response.json({ novel, chapter: resumeChapter, notices: [], illustration_pending: false });
      }
      brief = resumeChapter.writing_brief || null;
      // A redo's replacement is being written over a kept copy of the chapter it
      // replaces: if anything below fails, that copy goes back.
      if (resumeChapter?.previous_version?.content) {
        redoRevert = { client: base44, chapter: resumeChapter };
      }
    }

    // Every failure in this request is reported the same way — and, when a redo was
    // under way, the chapter it was replacing is handed back first.
    const failureOf = async (status, failure) => {
      if (redoRevert) {
        const restored = await restoreReplacedChapter(redoRevert.client, redoRevert.chapter);
        redoRevert = null;
        if (restored) {
          return failureResponse(status, {
            ...failure,
            message: `${failure.message} The chapter this rewrite was replacing is back in place, unchanged.`,
          });
        }
      }
      return failureResponse(status, failure);
    };

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
    // The chapter is written from the premise confirmed for it. A Redo carries the
    // premise the reader reviewed in the box; when none is supplied, the chapter's own
    // stored premise is used — never the novel's overall premise, which is a different
    // instruction and would produce a different chapter.
    // Stored exactly as the reader wrote it. A long premise is never cut short, so the
    // Redo box always shows the whole instruction this chapter was written from.
    const direction = [body.direction, targetChapter?.direction, resumeChapter?.direction]
      .map((value) => String(value || '').trim())
      .find(Boolean) || '';

    // ── EXCLUSIONS (this attempt only) ───────────────────────────────────────
    // The reader may leave people, events or subjects out of ONE chapter. This
    // only changes what this request considers — no record is edited, hidden or
    // suppressed, and the next attempt starts from the full source again.
    const exclusions = [...new Set(
      names(body.exclusions).map((value) => clip(value, 160)).filter(Boolean)
    )].slice(0, 12);
    const isExcludedName = (name) => {
      const target = String(name || '').toLowerCase().trim();
      if (!target) return false;
      return exclusions.some((entry) => {
        const value = entry.toLowerCase().trim();
        return !!value && (target === value || target.includes(value));
      });
    };
    const sourceIssues = [];

    // ── USER PERSONA (world name only — never "the user") ────────────────────
    const settingsOwner = ownerEmail || novel?.owner_email || resumeChapter?.owner_email || targetChapter?.owner_email || '';
    const settings = await base44.entities.UserSettings.filter({ owner_email: settingsOwner }, null, 1).catch(() => []);
    const settingsRow = asArray(settings)[0] || {};
    const worldName = settingsRow.fictional_world_name || user?.full_name || 'the one who stays';

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
        ? asArray(await sr.entities.Character.filter({ id: { $in: missing } }, null, missing.length).catch(() => []))
        : [];
      focusCharacters = [...readable, ...recovered].filter(usableCharacter)
        .filter((c) => !isExcludedName(c.name));
    }

    // ── SOURCE MATERIAL (read-only, all caller-scoped) ───────────────────────
    // A source that cannot be read is reported as missing and the chapter is still
    // written from everything that did load — it is never a reason to fail.
    const [lifeEventsRaw, memoriesRaw, relationshipsRaw, conversationsRaw, storyEventsRaw] = await Promise.all([
      base44.entities.LifeEvent.filter({ character_id: centralId }, '-timestamp', 70)
        .catch(() => { sourceIssues.push('the life journal'); return []; }),
      base44.entities.CharacterMemory.filter({ character_id: centralId }, '-importance_score', 70)
        .catch(() => { sourceIssues.push('memories'); return []; }),
      base44.entities.CharacterRelationship.filter({
        $or: [{ source_character_id: centralId }, { target_character_id: centralId }],
      }, null, 60).catch(() => { sourceIssues.push('relationships'); return []; }),
      base44.entities.Conversation.filter({ character_ids: { $in: [centralId] } }, '-last_message_date', 14)
        .catch(() => { sourceIssues.push('conversations'); return []; }),
      // Established Story Events they took part in — read only, nothing is triggered.
      base44.entities.StoryEvent.filter({ participant_character_ids: { $in: [centralId] } }, '-event_date', 18)
        .catch(() => { sourceIssues.push('story events'); return []; }),
    ]);

    let lifeEvents = asArray(lifeEventsRaw);
    let storyEvents = asArray(storyEventsRaw);

    // Finishing continues from the material the opening was built from, fetched by
    // the exact IDs stored with the chapter — the same selection, with none of the
    // planning work repeated.
    let briefMemories = null;
    let briefRelationships = null;
    if (finishing && brief) {
      const idsOf = (list, cap) => names(list).slice(0, cap);
      const memoryIds = idsOf(brief.memory_ids, 30);
      const lifeIds = idsOf(brief.life_event_ids, 30);
      const eventIds = idsOf(brief.story_event_ids, 12);
      const relationIds = idsOf(brief.relationship_ids, 30);
      const [bMemories, bLife, bEvents, bRelations] = await Promise.all([
        memoryIds.length ? base44.entities.CharacterMemory.filter({ id: { $in: memoryIds } }, null, memoryIds.length).catch(() => []) : [],
        lifeIds.length ? base44.entities.LifeEvent.filter({ id: { $in: lifeIds } }, null, lifeIds.length).catch(() => []) : [],
        eventIds.length ? base44.entities.StoryEvent.filter({ id: { $in: eventIds } }, null, eventIds.length).catch(() => []) : [],
        relationIds.length ? base44.entities.CharacterRelationship.filter({ id: { $in: relationIds } }, null, relationIds.length).catch(() => []) : [],
      ]);
      if (asArray(bMemories).length) briefMemories = asArray(bMemories);
      if (asArray(bLife).length) lifeEvents = asArray(bLife);
      if (asArray(bEvents).length) storyEvents = asArray(bEvents);
      if (asArray(bRelations).length) briefRelationships = asArray(bRelations);
    }

    // ── HOUSEHOLD (existing residency, unit-aware, read-only) ────────────────
    const homeLocationIds = [...new Set([central?.current_home_location_id, central?.temporary_housing_location_id].filter(Boolean))];
    let homeLocations = homeLocationIds.length
      ? asArray(await base44.entities.LocationReference.filter({ id: { $in: homeLocationIds } }, null, homeLocationIds.length).catch(() => []))
      : [];
    const unreadableHomeIds = homeLocationIds.filter((id) => !homeLocations.some((h) => h.id === id));
    if (unreadableHomeIds.length) {
      homeLocations = homeLocations.concat(asArray(await sr.entities.LocationReference
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
    let memories = asArray(memoriesRaw);
    let relationships = asArray(relationshipsRaw);
    const conversations = asArray(conversationsRaw);
    const conversationIds = conversations.map((c) => c.id).filter(Boolean).slice(0, 14);

    const messagePages = await Promise.all([
      conversationIds.length
        ? base44.entities.Message.filter({ conversation_id: { $in: conversationIds } }, '-timestamp', 140)
          .catch(() => { sourceIssues.push('recorded conversations'); return []; })
        : Promise.resolve([]),
      base44.entities.Message.filter({ participant_character_ids: { $in: [centralId] } }, '-timestamp', 80)
        .catch(() => { sourceIssues.push('recorded conversations'); return []; }),
      base44.entities.Message.filter({ character_id: centralId }, '-timestamp', 80)
        .catch(() => { sourceIssues.push('recorded conversations'); return []; }),
    ]);

    const byId = new Map();
    messagePages.forEach((page) => asArray(page).forEach((m) => { if (m && m.id && !byId.has(m.id)) byId.set(m.id, m); }));
    let messages = [...byId.values()]
      .filter((m) => m.content || m.image_description)
      .filter((m) => !isExcludedName(m.character_name))
      .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0))
      .slice(-90);

    // Finishing reuses the exact conversations the opening was built from.
    if (finishing && brief && names(brief.message_ids).length) {
      const wanted = new Set(names(brief.message_ids));
      messages = messages.filter((m) => wanted.has(m.id));
    }

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
        ? asArray(await sr.entities.Character.filter({ id: { $in: missing } }, null, missing.length).catch(() => []))
        : [];
      knownPeople = [...readable, ...recovered]
        .filter(usableCharacter)
        .filter((c) => !isExcludedName(c.name))
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
    const peopleById = new Map();
    [central, ...focusCharacters, ...relatedCharacters, ...knownPeople].filter(Boolean).forEach((p) => {
      if (p?.id && !peopleById.has(p.id)) peopleById.set(p.id, p);
    });
    const peopleList = [...peopleById.values()];
    const nameById = new Map(peopleList.map((p) => [p.id, p.name]));
    nameById.set('user', worldName);
    // Event participants keep the names recorded on the event itself.
    storyEvents.forEach((e) => {
      const ids = e?.participant_character_ids || [];
      const eventNames = e?.participant_character_names || [];
      ids.forEach((id, i) => { if (id && eventNames[i] && !nameById.has(id)) nameById.set(id, eventNames[i]); });
    });

    // ── FAMILY MEMBERS WHO EXIST AS CHARACTERS (read-only) ───────────────────
    // A Family Member character is reached through the family link its relative's
    // record already holds (_linked_character_id), so this never leaves the
    // established record graph. Readable records first, then the exact IDs of the
    // links themselves — which is how a family member on another account resolves.
    const familyLinks = new Map();
    peopleList.forEach((p) => {
      names(p.family_members).forEach((f) => {
        const id = f?._linked_character_id || f?.character_id || f?.related_character_id;
        if (!id || id === p.id || familyLinks.has(id)) return;
        familyLinks.set(id, {
          relative: p.name,
          relationship: clip(f?.relationship_type || f?.relationship || 'family', 60),
        });
      });
    });
    const familyDirectory = [];
    if (familyLinks.size) {
      const wanted = [...familyLinks.keys()].slice(0, 60);
      const readableFamily = asArray(await base44.entities.Character
        .filter({ id: { $in: wanted } }, null, wanted.length).catch(() => []));
      const readableIds = new Set(readableFamily.map((c) => c?.id));
      const unreadableFamilyIds = wanted.filter((id) => !readableIds.has(id));
      const recoveredFamily = unreadableFamilyIds.length
        ? asArray(await sr.entities.Character
          .filter({ id: { $in: unreadableFamilyIds } }, null, unreadableFamilyIds.length).catch(() => []))
        : [];
      [...readableFamily, ...recoveredFamily].forEach((c) => {
        if (!usableCharacter(c) || peopleById.has(c.id) || isExcludedName(c.name)) return;
        const link = familyLinks.get(c.id);
        familyDirectory.push({ person: c, relative: link.relative, relationship: link.relationship });
      });
    }

    // ── ESTABLISHED PLACES + HOUSEHOLDS (read-only) ──────────────────────────
    // Where people live now — including the apartment or unit inside a shared
    // dwelling — and the existing location descriptions and zone images that keep
    // an established place looking like itself.
    const placeIds = [...new Set([
      central?.resolved_current_location_id,
      central?.current_home_location_id,
      central?.temporary_housing_location_id,
      central?.occupation_location_id,
      central?.current_school_location_id,
      ...peopleList.map((p) => p.current_home_location_id),
      ...peopleList.map((p) => p.temporary_housing_location_id),
      ...storyEvents.map((e) => e.venue_id),
    ].filter(Boolean))].slice(0, 20);

    let places = placeIds.length
      ? asArray(await base44.entities.LocationReference.filter({ id: { $in: placeIds } }, null, placeIds.length).catch(() => []))
      : [];
    const unreadablePlaceIds = placeIds.filter((id) => !places.some((p) => p.id === id));
    if (unreadablePlaceIds.length) {
      places = places.concat(asArray(await sr.entities.LocationReference
        .filter({ id: { $in: unreadablePlaceIds } }, null, unreadablePlaceIds.length).catch(() => [])));
    }
    const placeById = new Map(places.map((p) => [p.id, p]));

    const unitOf = (place, characterId) => {
      const units = Array.isArray(place?.residential_units) ? place.residential_units : [];
      return units.find((u) => (u.occupant_character_ids || []).includes(characterId)) || null;
    };

    // A household is one exact dwelling: same place AND the same apartment or unit.
    // Other apartments in a shared building are separate households, never one family.
    const householdGroups = new Map();
    const notInHousehold = [];
    peopleList.forEach((p) => {
      const home = placeById.get(p.current_home_location_id) || placeById.get(p.temporary_housing_location_id);
      if (!home) { notInHousehold.push(p.name); return; }
      const units = Array.isArray(home.residential_units) ? home.residential_units : [];
      const unit = unitOf(home, p.id);
      // In a multi-dwelling building, an unassigned resident is not part of any
      // apartment's household and must never be grouped with the others.
      if (units.length && !unit) { notInHousehold.push(p.name); return; }
      const key = `${home.id}::${unit?.unit_id || 'whole'}`;
      if (!householdGroups.has(key)) {
        householdGroups.set(key, { label: `${home.name}${unit?.unit_name ? ` — ${unit.unit_name}` : ''}`, members: [] });
      }
      householdGroups.get(key).members.push(p.name);
    });
    const households = [...householdGroups.values()].filter((h) => h.members.length);

    // ── PRECEDING / FOLLOWING CHAPTERS (continuity) ──────────────────────────
    let previousChapters = [];
    let laterChapters = [];
    let chapterNumber = 1;
    if (mode !== 'create') {
      const pages = await base44.entities.NovelChapter.filter({ novel_id: novel.id }, 'chapter_number', 120).catch(() => []);
      const allChapters = asArray(pages).sort((a, b) => (a.chapter_number || 0) - (b.chapter_number || 0));
      if (finishing) {
        // Finishing rewrites nothing and adds nothing: it completes the chapter it
        // was given, so that chapter is never counted as one that came before.
        const target = resumeChapter.chapter_number || 1;
        previousChapters = allChapters.filter((c) => c.id !== resumeChapter.id && (c.chapter_number || 0) < target);
        laterChapters = allChapters.filter((c) => c.id !== resumeChapter.id && (c.chapter_number || 0) > target);
        chapterNumber = target;
      } else if (mode === 'redo') {
        const target = targetChapter.chapter_number || 1;
        previousChapters = allChapters.filter((c) => c.id !== targetChapter.id && (c.chapter_number || 0) < target);
        laterChapters = allChapters.filter((c) => c.id !== targetChapter.id && (c.chapter_number || 0) > target);
        chapterNumber = target;
      } else {
        previousChapters = allChapters;
        chapterNumber = allChapters.length ? Math.max(...allChapters.map((c) => c.chapter_number || 0)) + 1 : 1;
      }
    }
    const lastChapter = previousChapters[previousChapters.length - 1];

    // ── PREMISE-DRIVEN SOURCE SELECTION ──────────────────────────────────────
    // The same character can be written about a hundred ways, and one chapter is
    // about one subject. Only the material belonging to that subject goes into the
    // request; the rest stays on the record, untouched and undiminished.
    // Finishing does not select again: the opening already decided what this
    // chapter is built from, and re-planning would both cost another call and risk
    // handing the second half a different set of records than the first.
    const selection = finishing && brief
      ? {
        memories: briefMemories || memories,
        lifeEvents,
        relationships: briefRelationships || relationships,
        storyEvents,
        messages,
        subject: brief.subject || premise,
        period: brief.period || '',
        planned: true,
      }
      : await selectPremiseSource({
        base44, premise, focus, direction, central, memories, lifeEvents, relationships, storyEvents, messages, nameById,
      });
    memories = selection.memories;
    lifeEvents = selection.lifeEvents;
    relationships = selection.relationships;
    storyEvents = selection.storyEvents;
    messages = selection.messages;

    // ── PROMPT ───────────────────────────────────────────────────────────────
    const source = [];

    source.push(`## THE PEOPLE`);
    source.push(characterBlock(central) || `### ${centralName}`);
    focusCharacters.forEach((c) => source.push(characterBlock(c)));

    if (knownPeople.length) {
      source.push(`\n## PEOPLE IN THEIR LIFE (established connections — draw only on those this chapter needs)`);
      knownPeople.forEach((c) => {
        const knownAge = currentAgeOf(c);
        const bits = [
          knownAge != null ? `age ${knownAge}` : '',
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
        const otherId = outgoing ? r.target_character_id : r.source_character_id;
        const otherPerson = peopleById.get(otherId);
        const otherAge = otherPerson ? currentAgeOf(otherPerson) : null;
        const otherName = nameById.get(otherId) || '';
        if (isExcludedName(otherName)) return;
        const other = `${otherName || 'someone in their life'}${otherAge != null ? ` (age ${otherAge})` : ''}`;
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

    if (places.length) {
      source.push(`\n## ESTABLISHED PLACES (authoritative appearance — never substitute another property)`);
      places.forEach((p) => {
        const placeText = readableText(p.description, 500);
        source.push(`- ${p.name}${p.category ? ` (${p.category})` : ''}${placeText ? `: ${placeText}` : ''}`);
        const zones = names(p.zones);
        if (zones.length) {
          source.push(`  zones: ${zones.map((z) => {
            const zoneText = readableText(z.zone_description, 200);
            return `${z.zone_name}${zoneText ? ` — ${zoneText}` : ''}`;
          }).join('; ')}`);
        }
      });
    }

    if (households.length || notInHousehold.length) {
      source.push(`\n## HOUSEHOLDS — WHO ACTUALLY LIVES TOGETHER (current residential records)`);
      households.forEach((h) => source.push(`- ${h.label}: ${h.members.join(', ')}`));
      if (notInHousehold.length) source.push(`- Not recorded in a household: ${notInHousehold.join(', ')}`);
      source.push(`Residents of other apartments in the same building are neighbours, not housemates.`);
    }

    if (familyDirectory.length) {
      source.push(`\n## FAMILY MEMBERS WHO EXIST AS CHARACTERS (established people — use their recorded names)`);
      familyDirectory.forEach(({ person, relative, relationship }) => {
        const age = currentAgeOf(person);
        source.push(`- ${person.name}${age != null ? ` (age ${age})` : ''} — ${relative}'s ${relationship}; an existing character with their own established appearance${person.appearance_notes ? `: ${clip(person.appearance_notes, 160)}` : ''}`);
      });
      source.push(`When one of these people is in a scene, name them. Do not replace a recorded child with "his children" or "a child", and never merge two of them into one.`);
    }

    const previousBlock = mode === 'redo'
      ? [
        `\n## THIS CHAPTER IS BEING REWRITTEN`,
        `Chapter ${chapterNumber} of this novel already exists and you are writing a new version of it. Replace that chapter — do not write a different part of the story, and do not summarise the whole life.`,
        previousChapters.length
          ? `What comes before it:\n${previousChapters.map((c) => `- Chapter ${c.chapter_number}: ${c.title}${c.summary ? ` — ${clip(c.summary, 300)}` : ''}`).join('\n')}`
          : `It is the opening chapter of the novel.`,
        lastChapter?.content ? `\n### THE CHAPTER IMMEDIATELY BEFORE (for voice, tone and continuity only — do not repeat it)\n${clip(lastChapter.content, 6000)}` : '',
        laterChapters.length
          ? `\n### CHAPTERS THAT ALREADY COME AFTER IT (fixed — never rewritten, never contradicted)\n${laterChapters.map((c) => `- Chapter ${c.chapter_number}: ${c.title}${c.summary ? ` — ${clip(c.summary, 300)}` : ''}`).join('\n')}\nYour new version must lead into them without retelling them.`
          : '',
      ].filter(Boolean).join('\n')
      : previousChapters.length
        ? [
          `\n## WHAT THIS NOVEL HAS ALREADY COVERED`,
          `Chapters written so far:`,
          ...previousChapters.map((c) => `- Chapter ${c.chapter_number}: ${c.title}${c.summary ? ` — ${clip(c.summary, 300)}` : ''}`),
          `Do not retell what these chapters already covered. Continue the same book, the same voice, the same chronology.`,
          lastChapter?.content ? `\n### THE IMMEDIATELY PRECEDING CHAPTER (for voice, tone and continuity only — do not repeat it)\n${clip(lastChapter.content, 7000)}` : '',
        ].join('\n')
        : (finishing
          ? ''
          : `\n## THIS IS CHAPTER ONE\nEstablish the world, the people and the emotional stakes without summarizing the whole life in one chapter.`);

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

    // The finish writes only the remainder of the chapter, so its length is what is
    // still missing — never the length of the whole chapter a second time.
    const openingWords = finishing
      ? String(resumeChapter.content || '').split(/\s+/).filter(Boolean).length
      : 0;
    const continuationRule = `roughly ${Math.max(650, 2200 - openingWords)}–${Math.max(950, 2900 - openingWords)} words of new prose`;
    const openingTail = finishing
      ? clip((String(resumeChapter.content || '').trim()
        .match(/[^.!?…]*[.!?…]["')\]]*\s*$/) || [''])[0].trim(), 320)
      : '';

    // The chapter is written in two bounded requests. These are the only rules that
    // differ between them: what to write now, and what the plates must account for.
    const openingShapeRules = [
      `## WRITE THE OPENING OF THIS CHAPTER`,
      `Open inside a moment, not with a summary of the life. Write roughly 900–1,200 words, 10–16 paragraphs, and stop at a natural break in the movement: a change of scene, of time, or of focus.`,
      `Do not conclude the chapter, do not summarise the life, and do not wrap anything up. The rest is written immediately after, continuing from your last line, so leave it mid-breath rather than closing it.`,
    ].join('\n');

    const finishShapeRules = [
      `## FINISH THIS CHAPTER — WRITE ONLY WHAT COMES NEXT`,
      `The prose under THE CHAPTER SO FAR is already written and saved. It is context, not material to write.`,
      `Your content returns ONLY the new prose that follows its final sentence: ${continuationRule}, carrying the chapter on to a real ending.`,
      `- Never retype, re-include, summarise, paraphrase or re-describe any part of THE CHAPTER SO FAR. Not one sentence, not one paragraph.`,
      `- Do not re-open the scene or restate the situation. If something has already happened on the page — a bag packed, a message read, a conversation had — it has happened. Write forward from it.`,
      `- Your first paragraph begins the next beat, continuing as one uninterrupted piece of prose: same voice, same tense, same scene if it is still running. Never announce that the chapter is continuing.`,
      `- End on a real turn: an image, a decision, a shift in understanding, or a quiet consequence.`,
    ].join('\n');

    const illustrationRules = [
      `## ILLUSTRATIONS`,
      `Choose 2 or 3 moments from the whole chapter — the opening given to you and what you write now — never more than 3, spread across it, each one a moment the prose actually describes. For each: after_paragraph is the 1-based paragraph index in the finished chapter; caption is a short literary line; scene is a precise visual description for an illustrator (who is present, what they are doing, the setting, framing, light, mood); characters lists the exact names of the people visible; location is the exact name of the place from ESTABLISHED PLACES when the scene happens there, otherwise leave it empty and describe the setting inside scene; location_zone is one of that place's listed zones when the scene happens in a particular room or area. Do not illustrate a character or event the chapter does not contain.`,
      `In characters, use the recorded name of every established person — including each family member listed under FAMILY MEMBERS WHO EXIST AS CHARACTERS — never "his children", "a child", "his daughter" or any description, and never give a recorded person's name to somebody invented. A person who exists only in this prose and has no character record has no recorded name: describe them in a few words instead (for example "the soup-kitchen mother", "an unnamed neighbour"). Established people and narrative-only people may share one illustration.`,
      `When an established user appears — the account holder or anyone known by their world name — name them exactly as the prose names them, so the illustration can resolve that same person's own appearance. Never swap a world name for a description like "a man" or "his friend".`,
      `Whatever category a ball scene is walking, the illustration must show that category: realness as a styled, convincing presentation that is walked and posed rather than danced (student styling for Schoolboy and School Girl Realness, professional tailoring for Executive Realness), runway as a walk and a fashion presentation, voguing as the dance the style actually calls.`,
      `Every established person is illustrated at their recorded age and stage: a newborn is a baby held in arms who cannot sit up or walk, never a child.`,
      `When someone appears younger than they are now (a historical moment), return depicted_ages with that person's name and their age in this scene, worked out from recorded chronology — never invented. Do not list anyone who appears at their present age.`,
      `ESTABLISHED PLACES must look like their records. An elegant, well-maintained residence stays elegant and well-maintained; a different home keeps its own distinct interior, never a copy of another property and never a generic interior. One character's hard past never makes an established present-day place look rundown, neglected or disorganised.`,
    ].join('\n');

    // ── BALLROOM CATEGORY ACCURACY ───────────────────────────────────────────
    // Only when this chapter is about a ball does the ballroom guidance apply. It is
    // the same established knowledge Pocketfriend already uses for Ball Story Events,
    // carried into the novel so a ball chapter is written with the categories kept
    // distinct — Realness is an illusion of identity, Runway is a walk, Voguing is a
    // dance — instead of every category collapsing into the same performance.
    const BALLROOM_CHAPTER_SIGNAL = /\b(vogue|voguing|realness|ballroom|kiki ball|house ball|femme queen|butch queen|schoolboy|school boy|executive realness|007s?|tens across the board)\b/i;
    const BALL_CHAPTER_SIGNAL = /\bball\b/i;
    const ballroomChapterText = [premise, focus, direction, novel?.title, novel?.focus,
      targetChapter?.title, targetChapter?.content, resumeChapter?.title].filter(Boolean).join('\n');
    const ballroomChapter = BALLROOM_CHAPTER_SIGNAL.test(ballroomChapterText)
      || (BALL_CHAPTER_SIGNAL.test(ballroomChapterText)
        && /\b(categor(?:y|ies)|walk(?:ing)?|runway|house|judges?|chop(?:ped)?|dip)\b/i.test(ballroomChapterText));
    const ballroomBlock = ballroomChapter
      ? [
        `## BALLROOM CATEGORY ACCURACY — THIS CHAPTER IS SET AT A BALL`,
        `A ball is one event inside the LGBTQ ballroom scene, written from inside that culture as it is actually lived. Every rule about invented houses, personalities and ball names already established for Pocketfriend's Ball Story Events applies here too: original names for houses and ballroom personalities, and never describe any house, character or ball as fictional, invented or simulated.`,
        `Realness, Runway and Voguing are three different kinds of category and are never interchangeable. What is worn, what happens on the floor, and what the judges are watching all follow the category actually called.`,
        `- REALNESS is an illusion of identity: how completely the competitor passes as the person or role the category names. Clothing, grooming, posture and attitude serve that illusion, and the competitor walks, models and presents to the judges. Schoolboy Realness and School Girl Realness look like students — backpacks, caps, oversized hoodies, casual shirts, school uniforms where allowed, sneakers, youthful streetwear — never executive businesswear, and never suits and ties because the competitors are adults. Executive Realness is professional tailoring and corporate bearing. Femme Queen Realness carries its own presentation. Realness is never voguing: no dips, duckwalks, floor performance or spins inside a realness category.`,
        `- RUNWAY is the walk: strut, posture, carriage, the turn at the end, the garment moving with the body, fashion-model presentation and command of the floor. Runway is walked, never danced — no hand performance, no floor work, no dips.`,
        `- VOGUING is a dance. Vogue Femme is built from hand performance, catwalk, duckwalk, floor performance, and spins and dips. Vogue Femme Soft and Cunty is soft, fluid, graceful and alluring, with controlled precision rather than force. Vogue Femme Dramatics is explosive and high-energy, with harder movement, sharp transitions and dramatic dips. They are two separate categories and are never merged, renamed for each other, or performed the same way. Old Way and New Way have their own movement vocabularies and are not interchangeable with Vogue Femme.`,
        `- A dip is a dip. Never write "death drop" or "shablam".`,
        `Whatever a chapter states a competitor wore and did must remain consistent within that performance: a realness walk stays a realness walk, and a drama category stays a drama category from the call to the judging.`,
      ].join('\n')
      : '';

    const instruction = [
      `You are a serious literary novelist writing one chapter of a novel about ${centralName}, built strictly from the established life recorded below.`,
      ``,
      `## WHAT THIS CHAPTER IS ABOUT`,
      `Requested subject: ${selection.subject || premise}`,
      selection.period ? `Life period the request points to: ${selection.period}` : '',
      `The material below was selected for that subject. Anything recorded elsewhere in ${centralName}'s life was deliberately left out of this attempt: do not reach for it, do not summarise the rest of their life, and never treat its absence as proof that it did not happen.`,
      ``,
      `## THE ONE ABSOLUTE LAW — THE SOURCE IS THE ONLY AUTHORITY`,
      `Everything on the page must be consistent with the SOURCE MATERIAL and the established characters. Never invent a major event, betrayal, confession, promise, illness, death, pregnancy, crime, or new relationship that the source does not support. Never contradict chronology.`,
      ``,
      `## DOCUMENTED EXPERIENCE vs RECONSTRUCTED HISTORY`,
      `- DOCUMENTED: chat, text, scene and world phone messages, recorded life events, memories, established relationships. Treat these as things that really happened. You may quote recorded dialogue — sparingly and faithfully. You may expand a documented moment into a full scene with atmosphere, physical detail, pacing and emotional interpretation, but you must NOT add an argument, confession, promise, revelation or outcome that never occurred. Do not write invented sentences as quotation marks attributed to these people for documented time.`,
      `- RECONSTRUCTED: anything before ${centralName} entered this world — upbringing, family history, earlier life. Here restrained, plausible reconstructed dialogue is allowed, consistent with the known personalities and circumstances, as long as it establishes no new major event and contradicts nothing.`,
      `If you are unsure whether something is documented, describe or summarize it instead of quoting it.`,
      ``,
      `## AGES — RECORDED, NEVER INVENTED`,
      `Every person in THE PEOPLE carries their recorded age. That number is the only age you may use, and it applies to every character, not only ${centralName}.`,
      `- Present-day scenes: use the recorded age exactly. Never substitute another number because someone looks, sounds, works or behaves a certain way.`,
      `- Earlier periods: work the age out from the recorded date of birth or birth year and the year of the scene. Never guess, and never round toward a more dramatic age.`,
      `- If no age or date of birth is recorded, treat that person as an adult and do not state a number for them.`,
      `- Never infer an age from appearance, family position, relationships, occupation, behaviour or narrative convenience.`,
      `- An earlier chapter of this novel may state an age that contradicts the records. The records win. Never repeat a mistake for the sake of literary continuity.`,
      ``,
      `## FAMILY IS NOT A HOUSEHOLD`,
      `HOUSEHOLDS lists where people live now, in their current home and their actual apartment or unit, taken from the residential records.`,
      `- Only people under the same household (same place, same unit) live together.`,
      `- A parent, child, sibling, spouse or adopted relative listed elsewhere does not live with them. They may visit, stay over or share scenes, but that home is not theirs.`,
      `- In a multi-dwelling residence, residents of other apartments are neighbours. Never move them into one household.`,
      `- Never invent cohabitation from closeness, affection, adoption or family ties.`,
      `- Earlier living arrangements may come from background and family history, but never assume an old arrangement is still current.`,
      `- Visitors and guests stay visitors and guests.`,
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
      `## SELECTION — THE PREMISE DECIDES WHAT HAPPENS`,
      `Everything in the source below belongs to the requested subject; none of it is compulsory. The premise, the focus and the direction decide what this chapter is about and what it needs.`,
      `- Build the chapter from the memories, conversations, events and relationships that serve the requested subject. When the reader asks for a particular relationship, period or experience, that is what the chapter is made of.`,
      `- Everything else is background: use it to understand who these people are — how they speak, what they carry, how they treat one another — without staging it as a scene. A chapter must never become a tour of records simply because they exist.`,
      `- Do not invent a place in the chapter for someone who has nothing to do with the requested subject, and do not leave out material the premise actually requires.`,
      `- This is selection inside the telling, never a claim that anything else did not happen. Never contradict or deny what the source records.`,
      ``,
      `## LANGUAGE AND ADULT MATERIAL — AUTHENTIC, NOT GRATUITOUS`,
      `These people have recorded histories, and some of what is recorded contains profanity, crudeness, sexual references, substance use, or raw emotional conflict. That is their established voice and part of who they are: its presence in the source is never by itself a reason to refuse, sanitise or abandon the chapter.`,
      `- When such language belongs to the moment the premise asks for, write them as these people actually speak.`,
      `- When it does not belong to the requested subject, leave it out. Never import mature material into a chapter that has no use for it, and never reach for it for effect.`,
      `- If a particular moment cannot be depicted, write around it — imply it, cut away from it, or summarise it in a sentence — and keep the chapter. Never return a refusal in place of prose, and never silently change what is established about a character.`,
      ``,
      ballroomBlock,
      ``,
      `## CHAPTER SHAPE`,
      lengthRule,
      `Paragraphs separated by a blank line. No headings, no bullet points, no chapter number inside the body — the chapter title is returned separately.`,
      ``,
      finishing ? finishShapeRules : openingShapeRules,
      ``,
      finishing
        ? illustrationRules
        : `Return illustrations as an empty array: the plates are chosen once the whole chapter exists.`,
      ``,
      `## NOVEL`,
      mode === 'create'
        ? `This is chapter one of a new novel. Also propose a short, evocative novel title (3–6 words, no colon unless it earns it) unless a title is supplied.`
        : finishing
          ? `You are finishing chapter ${chapterNumber} of the existing novel "${novel.title}". It is a single continuous piece of prose; the opening is already written.`
          : mode === 'redo'
            ? `This is a new version of chapter ${chapterNumber} of the existing novel "${novel.title}", rewritten at its reader's request. Same book, same voice, same point in the chronology — but built from the authoritative records rather than from whatever the old version said.`
            : `This is chapter ${chapterNumber} of the existing novel "${novel.title}". Continue it — same book, same voice, moving the story forward into experience not yet covered.`,
      `Premise: ${premise}`,
      focus ? `Focus: ${focus}` : '',
      direction ? `Direction for this chapter: ${direction}` : '',
      mode !== 'create' && novel.title ? `Existing title: ${novel.title}` : '',
      mode === 'create' && body.title ? `The user supplied this title, use it exactly: ${body.title}` : '',
      ``,
      exclusions.length
        ? [
          `## LEFT OUT OF THIS ATTEMPT`,
          `The reader asked for the following to be left out of this chapter: ${exclusions.join('; ')}.`,
          `Do not depict, name, describe, quote or allude to any of it, and do not let it shape a scene indirectly. Write the chapter as though it simply is not part of this telling.`,
          `This is a choice about this chapter only. It never means the material did not happen, and it must never be referred to inside the prose as missing, withheld or redacted.`,
        ].join('\n')
        : '',
      ``,
      `## SOURCE MATERIAL`,
      source.join('\n'),
      previousBlock,
      finishing && resumeChapter?.content
        ? [
          `\n## THE CHAPTER SO FAR — ALREADY WRITTEN AND SAVED. CONTEXT ONLY.`,
          `No part of the passage below may appear in your reply.`,
          resumeChapter.content,
          `---`,
          `The chapter stops at this sentence: "${openingTail}"`,
          `Begin immediately after it with the next thing that happens. Your content must contain none of the passage above.`,
        ].join('\n')
        : '',
    ].filter(Boolean).join('\n');

    stage = 'writing';
    // One automatic retry covers a transient service failure or a refusal. Nothing
    // is saved before a chapter exists, so a retry can never duplicate or overwrite.
    let generated = null;
    let writeError = null;
    const askForChapter = (note) => base44.integrations.Core.InvokeLLM({
      prompt: note ? `${instruction}\n\n${note}` : instruction,
      model: 'claude-sonnet-5',
      response_json_schema: {
        type: 'object',
        properties: {
          novel_title: { type: 'string' },
          chapter_title: { type: 'string' },
          content: {
            type: 'string',
            description: finishing
              ? 'ONLY the new prose that continues after the saved opening. Never include or repeat the opening itself.'
              : 'The chapter prose, paragraphs separated by a blank line.',
          },
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
                location_zone: { type: 'string' },
                depicted_ages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      age: { type: 'number' },
                    },
                    required: ['name', 'age'],
                  },
                },
              },
              required: ['after_paragraph', 'caption', 'scene'],
            },
          },
        },
        required: ['chapter_title', 'content', 'illustrations'],
      },
    });

    // A refusal or an empty answer comes back quickly, so it is worth one corrected
    // retry inside this request. A failed call is never retried here: a second full
    // attempt would run past the request's own time limit, and the retry is a fresh
    // request anyway.
    for (let attempt = 0; attempt < 2 && !generated; attempt += 1) {
      try {
        const result = await askForChapter(attempt === 0 ? '' : RESTRICTED_MATERIAL_NOTE);
        const text = String(result?.content || '').trim();
        if (!text || looksLikeRefusal(text)) {
          writeError = { cause: text ? 'content_restricted' : 'empty_response' };
          continue;
        }
        generated = result;
      } catch (error) {
        writeError = error;
        break;
      }
    }

    // What a failed attempt leaves behind differs by part: nothing at all when the
    // opening failed, and a saved opening when only the finish failed.
    const unchanged = finishing
      ? 'The opening of this chapter is saved and safe; the rest of it was not written.'
      : 'Your novel has not been changed.';
    const recovery = finishing
      ? 'Finish the chapter again, and it continues from where the saved opening ends.'
      : 'You can try again.';

    if (!generated) {
      if (writeError?.cause === 'content_restricted' || writeError?.cause === 'empty_response') {
        const restricted = writeError.cause === 'content_restricted';
        return failureOf(422, {
          stage: 'writing',
          cause: writeError.cause,
          retryable: true,
          canAdjust: true,
          technical: '',
          message: restricted
            ? `The writing service would not write this part of the chapter as requested. ${unchanged} ${recovery}`
            : `The writing service returned no chapter text. ${unchanged} ${recovery}`,
        });
      }
      const classified = classifyFailure(writeError, 'writing');
      return failureOf(classified.cause === 'busy' ? 429 : 502, finishing
        ? { ...classified, message: classified.message.replace('Your novel has not been changed.', unchanged) }
        : classified);
    }

    const written = String(generated?.content || '')
      .replace(/\r\n?/g, '\n')
      .replace(/^\s*chapter\s+[0-9ivxlc]+[^\n]*\n+/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!written) {
      return failureOf(422, {
        stage: 'writing',
        cause: 'empty_response',
        retryable: true,
        canAdjust: true,
        technical: '',
        message: `The writing service returned no usable chapter text. ${unchanged} ${recovery}`,
      });
    }

    // The two parts are one piece of prose: the finish is joined onto the saved
    // opening with a single blank line between paragraphs, never a marker — after
    // any prose the finish repeated from the opening has been removed, so a chapter
    // can never be saved with its own beginning written twice.
    let content = written;
    if (finishing) {
      const joined = joinContinuation(resumeChapter.content, written);
      content = joined.content;
      // Nothing but repetition came back, so the chapter gained nothing: the saved
      // opening is reported back intact and the reader can finish it again.
      if (joined.dropped > 0 && joined.addedWords < 200) {
        return failureOf(422, {
          stage: 'writing',
          cause: 'repeated_opening',
          retryable: true,
          canAdjust: false,
          technical: '',
          message: `The writing service returned this chapter's own opening again instead of what comes after it, so nothing was added. The opening of this chapter is saved and safe. Finishing it again continues from where that opening ends.`,
        });
      }
    }
    const totalParagraphs = paragraphsOf(content).length;

    const chapterTitle = clip(generated?.chapter_title, 160)
      || (finishing ? resumeChapter.title : '')
      || `Chapter ${chapterNumber}`;

    // ── PERSIST THE NOVEL RECORD (only novel-owned records are written) ──────
    if (mode === 'create') {
      novel = await base44.entities.Novel.create({
        character_id: centralId,
        character_name: centralName,
        owner_email: ownerEmail || '',
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

    // ── ILLUSTRATION NOTES (drawn by generateNovelIllustrations) ────────────
    // Each plate's people and place are resolved to records here, while the people
    // directory is already in hand, and stored on the chapter. Drawing happens in
    // its own request so a finished chapter is never lost to a request timeout.
    const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const findPlace = (name) => {
      const target = normalize(name);
      if (!target) return null;
      return places.find((p) => normalize(p.name) === target)
        || places.find((p) => {
          const pn = normalize(p.name);
          return pn && (pn.includes(target) || target.includes(pn));
        })
        || null;
    };
    const findZone = (place, zoneName) => {
      const target = normalize(zoneName);
      if (!place || !target) return null;
      const zones = names(place.zones);
      return zones.find((z) => normalize(z.zone_name) === target)
        || zones.find((z) => {
          const zn = normalize(z.zone_name);
          return zn && (zn.includes(target) || target.includes(zn));
        })
        || null;
    };
    const directory = [...new Map([
      ...peopleById.values(),
      ...familyDirectory.map((entry) => entry.person),
    ].filter((p) => p && p.name).map((p) => [p.id, p])).values()];
    const matchPerson = (name) => {
      const target = normalize(name);
      if (!target) return null;
      return directory.find((p) => normalize(p.name) === target)
        || directory.find((p) => {
          const pn = normalize(p.name);
          return pn.length > 2 && (pn.includes(target) || target.includes(pn));
        })
        || null;
    };

    // Plates are chosen in the finishing request, when the whole chapter exists.
    const specs = (finishing && Array.isArray(generated?.illustrations) ? generated.illustrations : []).slice(0, 3);
    const illustrationSpecs = specs.map((spec) => {
      const depictedNames = names(spec.characters).map((n) => String(n || '').trim()).filter(Boolean);
      const personIds = [];
      const narrativeNames = [];
      depictedNames.forEach((name) => {
        const person = matchPerson(name);
        if (person) {
          if (!personIds.includes(person.id)) personIds.push(person.id);
        } else if (!narrativeNames.includes(name)) {
          narrativeNames.push(name);
        }
      });
      const place = findPlace(spec.location);
      const zone = findZone(place, spec.location_zone);
      return {
        after_paragraph: Math.min(totalParagraphs, Math.max(1, Math.round(Number(spec.after_paragraph) || 1))),
        caption: clip(spec.caption, 240),
        scene: clip(spec.scene, 900),
        person_ids: personIds.slice(0, 5),
        narrative_names: narrativeNames.slice(0, 5),
        shows_user: includeUser && normalize(worldName)
          && depictedNames.some((n) => normalize(n).includes(normalize(worldName))),
        depicted_ages: (Array.isArray(spec.depicted_ages) ? spec.depicted_ages : [])
          .filter((entry) => entry && entry.name && Number.isFinite(Number(entry.age)))
          .map((entry) => ({ name: String(entry.name), age: Math.round(Number(entry.age)) }))
          .slice(0, 5),
        location_id: place?.id || '',
        location_label: clip(spec.location, 120),
        zone_name: zone?.zone_name || '',
      };
    });

    const notices = [];
    if (sourceIssues.length) {
      notices.push(`Some recorded background could not be retrieved for this chapter (${[...new Set(sourceIssues)].join(', ')}). Everything that was retrieved was used, and your records are unchanged.`);
    }

    // ── PERSIST THE CHAPTER (novel-owned records only) ───────────────────────
    // The prose is saved before any image is drawn: a chapter that exists is worth
    // more than a request that might not finish. The opening is stored as writing
    // in progress, together with the material it was built from, so finishing it
    // costs no second planning pass — and never a second selection.
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const chapterFields = finishing
      ? {
        content,
        word_count: wordCount,
        illustrations: [],
        illustration_specs: illustrationSpecs,
        writing_state: 'complete',
        writing_brief: {},
        // The prose is finished, so the plate stage starts with its own allowance of
        // automatic restarts.
        writing_attempts: 0,
        // The replacement is written and saved: the version it replaced is released.
        previous_version: {},
      }
      : {
        title: chapterTitle,
        content,
        direction,
        word_count: wordCount,
        illustrations: [],
        illustration_specs: [],
        // A redo keeps the chapter it is replacing — prose, plates, stored premise —
        // until the new version is written and saved. A new chapter replaces nothing.
        previous_version: mode === 'redo'
          ? {
            content: targetChapter.content || '',
            title: targetChapter.title || '',
            word_count: targetChapter.word_count || 0,
            illustrations: Array.isArray(targetChapter.illustrations) ? targetChapter.illustrations : [],
            illustration_specs: Array.isArray(targetChapter.illustration_specs) ? targetChapter.illustration_specs : [],
            direction: targetChapter.direction || '',
            saved_at: new Date().toISOString(),
          }
          : {},
        writing_state: 'writing',
        // This attempt starts the chapter's allowance of automatic restarts afresh.
        writing_attempts: 0,
        writing_brief: {
          subject: clip(selection.subject, 240),
          period: clip(selection.period, 120),
          memory_ids: memories.map((m) => m.id).filter(Boolean).slice(0, 30),
          life_event_ids: lifeEvents.map((e) => e.id).filter(Boolean).slice(0, 30),
          story_event_ids: storyEvents.map((e) => e.id).filter(Boolean).slice(0, 12),
          relationship_ids: relationships.map((r) => r.id).filter(Boolean).slice(0, 30),
          message_ids: messages.map((m) => m.id).filter(Boolean).slice(0, 20),
        },
      };

    stage = 'saving';
    let chapter = null;
    try {
      chapter = finishing
        ? await base44.entities.NovelChapter.update(resumeChapter.id, chapterFields)
        : (mode === 'redo'
          ? await base44.entities.NovelChapter.update(targetChapter.id, chapterFields)
          : await base44.entities.NovelChapter.create({
            ...chapterFields,
            novel_id: novel.id,
            owner_email: ownerEmail || novel.owner_email || '',
            chapter_number: chapterNumber,
          }));
    } catch (error) {
      // A novel created moments ago by this very attempt has no chapters and is
      // removed, so a retry never leaves a duplicate behind. An existing novel is
      // never touched.
      if (mode === 'create' && novel?.id) {
        await base44.entities.Novel.delete(novel.id).catch(() => {});
      }
      return failureOf(500, {
        stage: 'saving',
        cause: 'save_failed',
        retryable: true,
        canAdjust: false,
        technical: statusOf(error) ? `HTTP ${statusOf(error)} — ${String(error?.message || '')}` : String(error?.message || ''),
        message: `The chapter was written but could not be saved. ${unchanged} ${recovery}`,
      });
    }

    // The chapter is saved: nothing is owed back to the version a redo replaced.
    redoRevert = null;

    // Counters are bookkeeping: a failure there must never discard a chapter that
    // is already saved.
    const updatedNovel = await base44.entities.Novel.update(novel.id, mode === 'redo'
      ? { last_chapter_at: new Date().toISOString() }
      : { chapter_count: chapterNumber, last_chapter_at: new Date().toISOString() }).catch(() => novel);

    return Response.json({
      novel: updatedNovel,
      chapter,
      notices,
      // The opening is saved, not finished: the reader is told to call once more to
      // complete this same chapter before it is shown as a chapter.
      needs_finish: !finishing,
      illustration_pending: illustrationSpecs.length > 0,
    });
  } catch (error) {
    // A crash during a redo must not cost the reader the chapter being replaced.
    if (redoRevert) {
      await restoreReplacedChapter(redoRevert.client, redoRevert.chapter);
      redoRevert = null;
    }
    const classified = classifyFailure(error, stage);
    return failureResponse(classified.cause === 'timed_out' ? 504 : 500, classified);
  }
});