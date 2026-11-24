/**
 * observeInteraction
 *
 * Generates a character-to-character exchange inside an OBSERVED scene.
 * The observing user is not present: they are never a participant, never
 * addressed, and never written into the transcript. Direction supplied by the
 * observer is authorial circumstance, never dialogue or a physical action.
 *
 * The observer may also speak AS one of the characters. Those words are that
 * character's own words: they are attributed to the character, answered by the
 * others, and remembered by the character as something they themselves said.
 *
 * Uses the existing character context + memory pathways so each participant
 * keeps their own record of what actually happened between them.
 */
import { base44 } from '@/api/base44Client';
import { filterDashes } from '@/lib/dashFilter';
import { findAddressedBackgroundPeople, buildBackgroundResponderRule } from '@/lib/sceneBackgroundResponse';
import { buildSceneCircumstances } from '@/lib/sceneCircumstances';
import { isInfantCharacter, childSpeechLimit } from '@/lib/characterAgeStage';
import { scopeCanonicalContext, buildUnitBoundaryBlock, applyObserverAbsence } from '@/lib/sceneUnitScope';

// NARRATIVE — one event that has already happened. It may contain dialogue spoken during
// it; the whole event, dialogue included, is what these people just lived through.
const ESTABLISHED_NARRATIVE = (narrative) => `
=== WHAT HAS ALREADY HAPPENED (AN EXPERIENCE, NOT A MESSAGE) ===
${narrative}

This is one event these people have just lived through, written as it happened. It may contain dialogue — words someone said during it — and those words are part of that same event, spoken in the past, to whoever was there at the time.
- The whole thing, dialogue included, is already over. It is their own recent experience, the way a person remembers something that has just taken place, not news delivered to them now.
- The dialogue in it was said during that event, to the people who were there. It is not addressed to anyone in this room now, and it is not a message, a statement, or an instruction from someone outside the scene.
- There is nobody to answer, thank, argue with, agree with, or reply to. No one is waiting on a response to it, and nobody asks who said it or what it meant.
- Nobody performs it again, announces it, asks whether it should happen, or hears about it for the first time.
- Never repeat that dialogue as new speech, and never have anyone say those words again as if for the first time.
- Do not contradict, undo, soften, or summarise these events.
- Write only the next moment that follows from this reality, including what it has left behind in them.
===`;

// DIRECT — what happens next. The characters carry it out now.
const DIRECTION_TO_PLAY_OUT = (direction) => `
=== WHAT HAPPENS NEXT (TO BE PLAYED OUT NOW) ===
${direction}

This has NOT happened yet. It is what should now take place in the moment you are writing.
- Carry it out for real: the characters take these actions as the scene moves.
- When words are attributed to a character, that character says them out loud here, in their own voice, as part of the moment.
- A name given with the direction is the person who does it: "<action> — <Name>" means that named person takes that action. Nobody else performs it.
- The bracketed line is a note about the scene, written down outside it. Nobody in the scene hears it, receives it, is told it, or knows it was written. It never arrives as a message, a request, a reminder, or an instruction from anyone, and no one in the scene can know what was written there.
- The wording inside it is the name of the activity for the person who wrote the note. It is not vocabulary: nobody quotes it, repeats it, thanks anyone for it, or calls what they are doing by it. These people are simply doing it, and they say it in their own words or not at all.
- Never answer with agreement, commentary, or acknowledgement of the instruction itself. Play the scene out.
- There is no director, no instruction, no author, and no observer anywhere in this scene.
===`;

// WHO ACTS — the chosen person performs and experiences the action themselves.
// Chosen to belong to them, never evidence that anyone is operating them.
const WHO_TAKES_THE_ACTION = (actorName) => `
=== WHO DOES THIS, AND HOW THEY EXPERIENCE IT ===
${actorName} is the one who does this, themselves, as part of their own ordinary day.
- ${actorName} performs it and experiences it: the others here respond to ${actorName}, not to anybody else.
- It is ${actorName}'s own decision and appetite in the moment. Nobody hands it to them and nothing about it feels arranged.
- It is never mentioned, thanked, credited, blamed, or referred to as anything other than what ${actorName} did.
- Nobody refers to a direction, an instruction, a choice, a button, or being told to do it — that wording never exists in this scene.
- ${actorName} does not say their own name out loud.
===`;

// SEVERAL ACT — one shared moment, and every chosen person is in it. Nobody is left
// standing aside while the first name does everything, and nobody joins who was not chosen.
const WHO_DOES_IT_TOGETHER = (names) => {
  const list = names.join(', ');
  const group = names.length === 2 ? 'both of them' : 'all of them';
  return `
=== WHO DOES THIS, AND HOW THEY EXPERIENCE IT ===
${list} do this together, as part of their own ordinary day. This is one shared moment, not one person acting while the others watch.
- ${list} each take part: ${group} perform it and experience it at the same time, in the same room.
- Each of them does it in their own way, from their own personality, appetite, age and mood. Nobody is described as merely present, waiting, or left out.
- Nobody else takes part. Only ${list} do this — anyone else here is elsewhere in the scene and not part of it.
- It is their own decision in the moment. Nobody hands it to them and nothing about it feels arranged.
- It is never mentioned, thanked, credited, blamed, or referred to as anything other than what they did.
- Nobody refers to a direction, an instruction, a choice, a button, or being told to do it — that wording never exists in this scene.
- Nobody says their own name out loud.
===`;
};

function realCast(list) {
  return (list || []).filter((c) => c && c.id && c.name && !c.isNpc && !String(c.id).startsWith('npc_'));
}

function backgroundCast(list) {
  return (list || []).filter((c) => c && c.id && c.name && (c.isNpc === true || String(c.id).startsWith('npc_')));
}

// `spokenBy` is the character the observer spoke as, resolved from the existing Speak As
// selection: { id, name, content }. The words are that character's own, not the observer's.
export async function generateObserveBeat({ participants, responders, location, activeZone, messages, direction, narrative, ownerEmail, observerName = null, watchNote = null, ambient = [], npcSpeakers = [], actorName = null, actorNames = null, unitScope = null, spokenBy = null, venueContext = null }) {
  // One chosen person, or several taking part in the same activity. `actorName` is kept
  // for every existing caller; an activity performed by a group passes `actorNames`.
  const actionNames = (Array.isArray(actorNames) ? actorNames : []).filter(Boolean);
  const actorBlock = actionNames.length > 1
    ? WHO_DOES_IT_TOGETHER(actionNames)
    : (actionNames.length === 1 || actorName) ? WHO_TAKES_THE_ACTION(actionNames[0] || actorName) : '';
  const actorSummary = actionNames.length > 1
    ? `${actionNames.join(', ')} are the ones doing it together, as their own ordinary action. Everyone else reacts to them.`
    : (actionNames[0] || actorName)
      ? `${actionNames[0] || actorName} is the one doing it, as their own ordinary action. Everyone else reacts to ${actionNames[0] || actorName}.`
      : '';
  const cast = realCast(participants);
  const selectedBackground = backgroundCast(npcSpeakers);
  if ((cast.length < 1 && selectedBackground.length < 1) || !location) return [];

  // A baby cannot speak. They stay physically present in the moment, but no words are
  // ever generated for them — the same age rule the user-present scene path enforces.
  const nonverbalCast = cast.filter((c) => isInfantCharacter(c));
  const speakingCast = cast.filter((c) => !isInfantCharacter(c));

  // Who may speak in this beat. Everyone else in the cast is present but listens.
  const requested = responders ? responders.map((c) => c.id) : null;
  const speaking = requested ? speakingCast.filter((c) => requested.includes(c.id)) : speakingCast;
  // Background people of the venue can join the conversation when they were chosen
  // from Who's Here. They have no canonical record — they speak in role only.
  const bgSpeaking = selectedBackground.filter((n) => !requested || requested.includes(n.id));
  // Whoever was just spoken to answers. A chosen background person is a real
  // participant in this conversation, not a name in a list.
  const lastLine = [...(messages || [])].reverse().find((m) => m.sender === 'character' && m.content && !m.is_canon_event);
  const addressedBackground = findAddressedBackgroundPeople(lastLine?.content, selectedBackground);
  addressedBackground.forEach((n) => { if (!bgSpeaking.some((s) => s.id === n.id)) bgSpeaking.push(n); });
  const backgroundRule = buildBackgroundResponderRule({ addressed: addressedBackground, selected: selectedBackground });
  if (speaking.length === 0 && bgSpeaking.length === 0) return [];

  const canonicalCtx = {};
  const memoryCtx = {};
  await Promise.all(cast.map(async (c) => {
    try {
      const r = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId: c.id,
        interactionContext: 'scene',
        ownerEmailHint: c.owner_email || ownerEmail || null,
      });
      if (r?.data?.systemPrompt) canonicalCtx[c.id] = r.data.systemPrompt;
    } catch { /* context is additive */ }
    try {
      const r = await base44.functions.invoke('retrieveCrossPageMemory', { characterId: c.id, limitMessages: 12 });
      if (r?.data?.contextText) memoryCtx[c.id] = r.data.contextText;
    } catch { /* memory is additive */ }
  }));

  // Canon narrative from earlier in this scene stays in the record: those events
  // already happened to these people, so later beats continue from them.
  // A strip activity stays in the record too: an immediate one already happened, and a
  // direct one was played out — either way the scene continues from it, so something
  // begun earlier (cooking) is still the situation they are in.
  const transcript = (messages || [])
    .filter((m) => m.sender === 'character' || m.sender === 'activity' || (m.is_canon_event && m.content))
    .slice(-18)
    // A character line is spoken dialogue, written as such: who said it, and their words.
    .map((m) => {
      if (m.is_canon_event) return `(already happened, before this moment) ${m.content}`;
      if (m.sender === 'activity') return `(a moment played out just now) ${m.content}`;
      return `${m.senderName} says out loud: "${m.content}"`;
    })
    .join('\n');

  const nameList = [...speaking.map((c) => c.name), ...bgSpeaking.map((n) => n.name)].join(', ');
  const silent = cast.filter((c) => !speaking.some((s) => s.id === c.id));

  // The place is populated: ordinary staff and patrons are here doing their own
  // thing. They are part of the scene, never the focus, and never stand in for the
  // established people in it.
  const ambientLine = (ambient || []).filter((a) => a && a.name);
  const placeBlock = `=== THE PLACE THEY ARE IN (RIGHT NOW) ===
${unitScope ? `${unitScope.unitLabel}, inside ${unitScope.facilityName}` : location.name}${activeZone ? ` — ${activeZone}` : ''} (${location.category?.replace(/_/g, ' ') || 'venue'}) is a real, working place, not an empty stage.
${ambientLine.length > 0
  ? `Other people are here, living their ordinary day:
${ambientLine.map((a) => `- ${a.name}${a.role ? `, ${String(a.role).toLowerCase()}` : ''}`).join('\n')}
They go about their own business, and they may act or speak briefly and in character when it is natural (a bartender asks what someone wants, an instructor addresses the room, a receptionist greets a visitor). They are never the focus, never take over the moment, and never become one of the main participants.`
  : 'No one else is around right now.'}
${bgSpeaking.length > 0
  ? `${bgSpeaking.map((n) => `${n.name}${n.role ? ` (${String(n.role).toLowerCase()})` : ''}`).join(', ')} ${bgSpeaking.length === 1 ? 'is' : 'are'} part of this conversation and may speak directly when it fits. They speak in role, from what this place and their job actually are.`
  : ''}
===

=== THEY ARE ALREADY HERE ===
Everyone in this scene is already at this place${activeZone ? `, in the ${activeZone}` : ''}. Being here is not an arrival.
- Nobody says they just got here, just arrived, just made it, finally got there, or announces walking in.
- Nobody re-enters the room, discovers where they are, or is surprised to be here.
- The moment continues from what these people were already doing before it began.`;
  const unitBlock = buildUnitBoundaryBlock(unitScope);

  // Names here are identities, not labels that may drift. Two similar names are two
  // different people, and whoever the observer spoke AS stays that person.
  const namesRule = `=== NAMES ARE EXACT IDENTITY ===
- Every person here is exactly the name given in PARTICIPANTS and in the transcript. Use those names, and only those, for those people.
- Never substitute a different or similar-sounding name for anyone, never shorten one person's name into another person's, and never merge two people because their names look or sound alike. A speaker named in a line is that speaker and nobody else.
- Nobody is addressed by another person's name by accident, and no one is addressed as a person who is not in this scene.
- Whenever one person here speaks to another, the person spoken to is someone in PARTICIPANTS, called by their own name. A line is never aimed at anyone else, and a name from outside this scene never stands in for the person actually being spoken to.`;

  // SPEAK AS ATTRIBUTION — the words typed through Speak As belong to that character,
  // identified by their own record ID. They are not the observer's words, and the others
  // answer that character, never the person operating the interface.
  const spokenAttribution = spokenBy?.id && spokenBy?.name ? `
=== THE LAST LINE WAS SPOKEN BY ${spokenBy.name} — THEIR OWN WORDS ===
${spokenBy.name} (character ID ${spokenBy.id}) just said this out loud, in this scene:
"${spokenBy.content || ''}"
- These are ${spokenBy.name}'s own words, spoken aloud in this room by ${spokenBy.name}, and by nobody else.
- ${spokenBy.name} is a person in this scene, exactly as recorded under that ID. The answer is directed to ${spokenBy.name}, under that name.
- Everyone else present is answering ${spokenBy.name} — never the person watching. The observer is not in this scene, has no name in it, and is never spoken to, addressed, thanked, asked, or answered.
- This line is never re-attributed to another character, to an unnamed person, to the place, or to anyone who is not here.
- Do not repeat the line back, summarise it, or quote it as new speech. Answer it.
===` : '';
  // Inside one apartment / patient room / cell a property-wide co-presence roster must not
  // survive: it says everyone in the building is standing in this space. The boundary
  // block below states the real space instead.
  const canonicalSection = cast
    .filter((c) => canonicalCtx[c.id])
    // Observing is not presence: any claim in the record that the account holder is
    // standing in this place is corrected before it can reach the scene.
    .map((c) => `=== ${c.name} — FULL CANONICAL IDENTITY ===\n${applyObserverAbsence(scopeCanonicalContext(canonicalCtx[c.id], unitScope))}\n=== END ${c.name} ===`)
    .join('\n\n');
  // Memory arrives from the character's conversations with the account holder, written
  // with that person as a speaker. Those conversations happened elsewhere and at other
  // times: here they are history only, never people in this room. The transcript is
  // re-labelled and framed so nobody in the scene can answer it or mistake it for
  // someone present.
  const memorySection = cast
    .filter((c) => memoryCtx[c.id])
    .map((c) => `[${c.name}'s memory of their own life]\n${String(memoryCtx[c.id])
      .replace(/\bUser(\s*\[[^\]]*\])?:/g, 'The account holder, in that earlier conversation elsewhere:')}`)
    .join('\n\n');
  const castLines = cast
    .map((c) => `- ${c.name} (${c.personality_summary?.split('.')[0] || c.archetype || 'character'}; mood: ${c.emotional_state || 'calm'})`)
    .join('\n');

  // Who these people are here, from their existing records: an employee knows this is
  // their workplace, a student knows they are here for school. Only a genuine visitor
  // speaks like a visitor.
  // The person the observer is speaking AS stays part of who is here: an inmate spoken
  // for is still an inmate of this facility, and that shapes what they say.
  const voiceContext = spokenBy?.id && spokenBy?.role && !bgSpeaking.some((n) => n.id === spokenBy.id)
    ? [...bgSpeaking, { id: spokenBy.id, name: spokenBy.name, role: spokenBy.role }]
    : bgSpeaking;
  const circumstancesBlock = buildSceneCircumstances({
    location,
    participants: cast,
    backgroundPeople: voiceContext.map((n) => ({ id: n.id, name: n.name, role: n.role })),
  });

  const silentRule = silent.length > 0
    ? `\nONLY THESE MAY SPEAK THIS BEAT: ${nameList}.\n${silent.map((c) => c.name).join(', ')} ${silent.length === 1 ? 'is' : 'are'} present and part of the scene, but do not give ${silent.length === 1 ? 'them' : 'them'} a spoken line this beat — they may only be shown listening or reacting without words.`
    : '';

  const nonverbalRule = nonverbalCast.length > 0
    ? `\nPRESENT BUT CANNOT SPEAK (mandatory): ${nonverbalCast.map((c) => c.name).join(', ')} ${nonverbalCast.length === 1 ? 'is a baby' : 'are babies'} below speaking age. They are physically here and part of the moment, shown only through non-verbal behaviour (crying, cooing, babbling, reaching, being held, sleeping). ⛔ Do NOT give them words, sentences, questions, answers, or any spoken line, and never include them as a speaker. Everyone else present may speak to and about the baby.`
    : '';

  const speechLimitRuleText = speaking.map(childSpeechLimit).filter(Boolean).join('\n');

  // The account holder is a real person in these characters' lives and is NOT in this
  // scene. Their name is everywhere in the records, memories and conversations below, so
  // it is named here explicitly: knowing someone is not having them in the room, and
  // their name is never the person a line spoken here is addressed to.
  // A placeholder name ("You") is not a name in these people's world — the general
  // absence rule above already covers that case.
  const holder = /^(you|the user)$/i.test(String(observerName || '').trim()) ? '' : String(observerName || '').trim();
  const accountHolderRule = holder ? `
THE ACCOUNT HOLDER, ${holder}, IS NOT IN THIS SCENE:
- ${holder} owns this world. They are NOT here: not standing anywhere in this place, not within sight or hearing, and not one of the people in this scene.
- ${holder}'s name appears throughout the records, memories and conversations below because these people know them and have a life with them. Knowing ${holder} does not put ${holder} in this room.
- Every line spoken here is spoken to a person who is actually in this scene, under that person's own name. Never address, answer, ask, thank, invite, touch, kiss, hand something to, or look toward ${holder}.
- When one person here speaks to another, the name used is the other person's name, the one standing there. ${holder}'s name is never used as the person being spoken to, and never replaces anyone in this scene.
- ${holder} may be talked about in the third person, as someone who is somewhere else. That is the only way ${holder} appears in this moment.` : '';

  const prompt = `You are writing a scene that takes place between the characters themselves at ${location.name}${activeZone ? `, in the ${activeZone}` : ''} (${location.category}).

THE OBSERVER IS NOT PRESENT — NON-NEGOTIABLE:
- Nobody is watching this. There is no observer in the room, nearby, or at the edge of it.
- The person who directs this scene is NOT in it. They are not standing with these people, not sitting at their table, not at the bar with them, and not within sight or hearing of them. Nobody greets, addresses, names as being here, hands something to, waits on, glances toward, performs for, or includes that person in the moment.
- Never write dialogue, thoughts, or physical actions at this place for anyone who is not the people listed here or in THE PLACE below.
- An absent person is still part of these people's lives. They may be mentioned, remembered, discussed, missed, or credited for something that already happened — exactly the way real people talk about someone who is somewhere else. A mention is never presence: the absent person stays absent, does nothing here, and the moment stays with the people who are actually in this place. Never invent a physical arrival for them.
- Nobody here is aware of being observed, directed, or operated. Nothing may hint at an audience, a narrator, or anyone outside this scene.
- Nobody in this scene is doing what they are doing because someone told, reminded, suggested, or asked them to. Nobody thanks, credits, blames, or refers to anyone for it, and nobody asks whether anyone wants them to do something, or whether someone is going to join in. It is simply what they are doing.
${accountHolderRule}

PARTICIPANTS (the people this moment is about):
${castLines || '(no established Pocketfriend character is in this moment)'}
${silentRule}
${nonverbalRule}
${speechLimitRuleText ? `\nAGE SPEECH RULES (mandatory):\n${speechLimitRuleText}` : ''}

${placeBlock}
${unitBlock}
${circumstancesBlock ? `\n${circumstancesBlock}\n` : ''}
${venueContext ? `\n${venueContext}\n` : ''}
${backgroundRule}

${canonicalSection ? `=== ESTABLISHED IDENTITIES ===\nThese records describe who these people are. Some wording in them was written for conversations with a person who is NOT here now. Nothing in them overrides the rule above: nobody here treats that person as present, addresses them as though they were standing there, or plays to anyone outside this scene. Mentioning them as someone elsewhere is allowed; placing them in this room is not.${unitScope ? ` These records were written for the whole ${unitScope.facilityNoun}: anyone named in them as living, staying or being kept elsewhere in it is not in this ${unitScope.unitNoun} right now. Everything in them that actually happened still happened — a visit someone made to this ${unitScope.unitNoun}, a conversation, time spent together — and is remembered and spoken about normally.` : ''}\n${canonicalSection}\n===` : ''}
${namesRule}
${memorySection ? `=== THEIR OWN LIVES, LIVED ELSEWHERE AND AT OTHER TIMES ===
This is history these people carry. Some of it happened with the account holder, in conversations at other times and other places. None of it is happening now: nobody in this scene answers it, replies to it, continues it, or treats anyone in it as being in this room. The account holder is somewhere else and is not part of this moment.
${memorySection}\n===` : ''}

${transcript ? `=== WHAT HAS JUST HAPPENED BETWEEN THEM ===\n${transcript}\n===` : 'Nothing has passed between them yet in this scene. It opens from where they already are.'}
${spokenAttribution}
${watchNote ? `=== WHAT THEY ARE DOING TOGETHER RIGHT NOW ===\n${watchNote}\nThey are watching this together, in the same room. They may talk about it, react to it, or ignore it like real people do.\n===` : ''}
${narrative ? ESTABLISHED_NARRATIVE(narrative) : ''}
${direction ? DIRECTION_TO_PLAY_OUT(direction) : ''}
${direction ? actorBlock : ''}

WRITE THE NEXT MOMENT:
${narrative ? `- These people have ALREADY lived the events above, its dialogue included. Continue from the situation those events left behind: what is said and done now is the consequence of them.
- The events are their own recent experience, never words just spoken to them: nobody answers that dialogue, replies to it, or treats it as something another person said to them now.
- Never reenact, re-announce, or question them. Anything quoted above was already said and must not be spoken again.` : ''}
${direction ? `- Now play out the directed moment above: the people named take those actions, say any attributed words out loud in their own voice, and it happens as real scene beats — never as agreement or commentary about the direction.${actorSummary ? `\n- ${actorSummary}` : ''}` : ''}
- ${nameList} interact with each other directly: they speak to one another and react to what the other just said or did.${spokenBy?.name ? `\n- The line just spoken belongs to ${spokenBy.name}. The others answer ${spokenBy.name} as the person who said it.` : ''}
- Their established personalities, relationship, history and current circumstances drive how they behave.
- Move the moment forward. Do not restate or replay the transcript. Nobody repeats a line already spoken.
- Continuing is not an event. Ordinary conversation is a complete continuation: they simply keep talking. An activity already underway stays underway without being re-announced. Include a physical action or a new development ONLY when it genuinely follows from what was just said and done between these people — never because a beat was requested, and never to make the moment busier than it is.
- Give each speaking participant at most one turn, 1-2 sentences, natural and in-character.
- Characters do not say their own name out loud when speaking about themselves.
- Background people of the place stay background unless they are the ones being spoken to: when a line is aimed at them they answer for themselves, in role; otherwise they work, pass by, and never take the moment over or replace the named participants.
- No narration of the observer. No summary of the scene.
- These people act on their own. You may return ONE spontaneous_action, and only when what has just passed between them genuinely leads to it: an affectionate exchange that is already going there between two adults who are free to, a conflict that has actually escalated, or the ordinary task their role and this conversation have already put in front of them. It must follow from the transcript, their relationship and their circumstances.
- Most beats have NO action. Conversation alone is a complete beat. Never add one to make the scene busier, never repeat an action already in the transcript, never force flirting into a kiss or an argument into a fight, and never give anyone an action that belongs to another person's role or that their circumstances forbid.
- Describe it briefly in the third person, naming the person, the way an established scene activity reads ("Marisol starts filing the intake forms."). Set ongoing true when it is something they are now doing rather than something completed in this beat.

Return JSON only.`;

  const res = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              character_name: { type: 'string' },
              content: { type: 'string' },
            },
          },
        },
        // Their own action, when the moment genuinely led to one. Absent on most beats.
        spontaneous_action: {
          type: 'object',
          properties: {
            character_name: { type: 'string' },
            description: { type: 'string' },
            emoji: { type: 'string' },
            ongoing: { type: 'boolean' },
          },
        },
      },
    },
  });

  const allowed = new Map([
    ...speaking.map((c) => [c.name.trim().toLowerCase(), c]),
    ...bgSpeaking.map((n) => [n.name.trim().toLowerCase(), n]),
  ]);
  const bgIds = new Set(bgSpeaking.map((n) => n.id));
  const stamp = Date.now();
  const lines = (res?.lines || [])
    .map((line, i) => {
      const char = allowed.get(line?.character_name?.trim()?.toLowerCase());
      if (!char || !line?.content) return null;
      // A child below speaking age never gets a generated line.
      if (isInfantCharacter(char)) return null;
      return {
        id: `${stamp}_obs_${i}`,
        sender: 'character',
        senderName: char.name,
        characterId: char.id,
        avatarUrl: char.avatar_url || null,
        isNpc: bgIds.has(char.id),
        content: filterDashes(line.content),
        timestamp: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  // An action these people take on their own is the SAME scene activity the strip
  // produces, so it is shown, remembered and continued from exactly as one the observer
  // chose — only ever for someone actually in this scene.
  const raw = res?.spontaneous_action;
  const actor = raw?.character_name ? allowed.get(String(raw.character_name).trim().toLowerCase()) : null;
  const description = String(raw?.description || '').trim();
  const action = (actor && description && !isInfantCharacter(actor))
    ? {
        id: `${stamp}_act`,
        emoji: raw?.emoji || null,
        content: filterDashes(description),
        // A finished action is canon; something they are now doing is still underway.
        is_canon_event: raw?.ongoing !== true,
      }
    : null;

  return { lines, action };
}

/**
 * Writes each participant's own memory of what happened between them, through the
 * existing turn-memory pathway. The counterpart is passed as the played character,
 * so memories record the other character — never the observing user.
 * `priorLine` is a line that already happened but is not in `lines` (a line the
 * observer spoke as one of the characters), so the first reply still remembers it.
 */
export async function recordObserveBeatMemories({ lines, participants, priorLine }) {
  const cast = (participants || []).filter((p) => p && p.id);
  // Background people of the venue have no record and no memory to write.
  const sequence = (priorLine ? [priorLine, ...(lines || [])] : (lines || [])).filter((l) => l && !l.isNpc);
  for (let i = 1; i < sequence.length; i++) {
    const previous = sequence[i - 1];
    const current = sequence[i];
    if (!previous?.characterId || !current?.characterId) continue;
    if (previous.characterId === current.characterId) continue;
    const witnesses = cast
      .filter((p) => p.id !== current.characterId && p.id !== previous.characterId)
      .map((p) => p.id);
    try {
      await base44.functions.invoke('extractMemoriesFromTurn', {
        characterId: current.characterId,
        userMessage: previous.content,
        playingAsCharacterId: previous.characterId,
        characterReply: current.content,
        witnessCharacterIds: witnesses,
      });
    } catch { /* memory write failure must not stop the scene */ }
  }
}

/**
 * Narrative is canon: the events described ALREADY happened to the people in the
 * scene. Each participating character keeps their own record of having lived it,
 * through the existing turn-memory pathway — no separate memory system.
 */
export async function recordNarrativeMemories({ narrative, participants, lines }) {
  const text = (narrative || '').trim();
  if (!text) return;
  const cast = (participants || []).filter((p) => p && p.id);
  for (const person of cast) {
    const own = (lines || []).find((l) => l.characterId === person.id);
    if (!own?.content) continue;
    // The event is the situation these people were in, never words spoken to them from
    // outside the scene. It is anchored to what another person there actually said, so
    // the memory holds the exchange that happened and never a narrator.
    const other = (lines || []).find((l) => l.characterId && l.characterId !== person.id && l.content);
    try {
      await base44.functions.invoke('extractMemoriesFromTurn', {
        characterId: person.id,
        userMessage: other?.content ? `${other.content} Around them, this had just happened: ${text}` : text,
        playingAsCharacterId: other?.characterId || undefined,
        characterReply: own.content,
        witnessCharacterIds: cast.filter((p) => p.id !== person.id).map((p) => p.id),
      });
    } catch { /* memory write failure must not stop the scene */ }
  }
}

/**
 * A line the observer spoke AS one of the characters is that character's own
 * words. It is recorded through the existing play-as memory pathway, so the
 * character remembers saying it themselves — never as something the observer said.
 */
export async function recordVoicedLineMemory({ speaker, listeners, content, location }) {
  if (!speaker?.id || !content?.trim()) return;
  const present = (listeners || []).filter((l) => l && l.id && l.id !== speaker.id);
  const target = present[0];
  if (!target) return;
  try {
    await base44.functions.invoke('recordPlayAsInteraction', {
      playingAsCharacterId: speaker.id,
      playingAsCharacterName: speaker.name,
      targetCharacterId: target?.id || speaker.id,
      targetCharacterName: target?.name || 'the people here',
      userAction: content.trim(),
      targetResponse: present.map((p) => p.name).join(', ') || 'no one else was there',
      emotionalReaction: 'neutral',
      locationName: location?.name || null,
    });
  } catch { /* memory write failure must not stop the scene */ }
}