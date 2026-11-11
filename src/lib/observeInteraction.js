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

// NARRATIVE — events that have ALREADY HAPPENED. Canon, not an instruction.
const ESTABLISHED_NARRATIVE = (narrative) => `
=== WHAT HAS ALREADY HAPPENED (ESTABLISHED — ALREADY COMPLETE) ===
${narrative}

THESE EVENTS ARE ALREADY OVER. They happened before the moment you are writing, and they are part of these people's lived history. Everyone present already lived them and already knows them.
- Nobody performs them again, announces them, asks whether they should happen, or hears about them for the first time.
- Any words in quotation marks attributed to a character were ALREADY SPOKEN in the past. Never repeat those words as new dialogue, and never have anyone say them again as if for the first time.
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
- Never answer with agreement, commentary, or acknowledgement of the instruction itself. Play the scene out.
- There is no director, no instruction, no author, and no observer anywhere in this scene.
===`;

function realCast(list) {
  return (list || []).filter((c) => c && c.id && c.name && !c.isNpc && !String(c.id).startsWith('npc_'));
}

function backgroundCast(list) {
  return (list || []).filter((c) => c && c.id && c.name && (c.isNpc === true || String(c.id).startsWith('npc_')));
}

export async function generateObserveBeat({ participants, responders, location, activeZone, messages, direction, narrative, ownerEmail, watchNote = null, ambient = [], npcSpeakers = [] }) {
  const cast = realCast(participants);
  const selectedBackground = backgroundCast(npcSpeakers);
  if ((cast.length < 1 && selectedBackground.length < 1) || !location) return [];

  // Who may speak in this beat. Everyone else in the cast is present but listens.
  const requested = responders ? responders.map((c) => c.id) : null;
  const speaking = requested ? cast.filter((c) => requested.includes(c.id)) : cast;
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
  const transcript = (messages || [])
    .filter((m) => m.sender === 'character' || (m.is_canon_event && m.content))
    .slice(-18)
    .map((m) => (m.is_canon_event ? `(already happened, before this moment) ${m.content}` : `${m.senderName}: ${m.content}`))
    .join('\n');

  const nameList = [...speaking.map((c) => c.name), ...bgSpeaking.map((n) => n.name)].join(', ');
  const silent = cast.filter((c) => !speaking.some((s) => s.id === c.id));

  // The place is populated: ordinary staff and patrons are here doing their own
  // thing. They are part of the scene, never the focus, and never stand in for the
  // established people in it.
  const ambientLine = (ambient || []).filter((a) => a && a.name);
  const placeBlock = `=== THE PLACE THEY ARE IN (RIGHT NOW) ===
${location.name}${activeZone ? ` — ${activeZone}` : ''} (${location.category?.replace(/_/g, ' ') || 'venue'}) is a real, working place, not an empty stage.
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
  const canonicalSection = cast
    .filter((c) => canonicalCtx[c.id])
    .map((c) => `=== ${c.name} — FULL CANONICAL IDENTITY ===\n${canonicalCtx[c.id]}\n=== END ${c.name} ===`)
    .join('\n\n');
  const memorySection = cast
    .filter((c) => memoryCtx[c.id])
    .map((c) => `[${c.name}'s memory]\n${memoryCtx[c.id]}`)
    .join('\n\n');
  const castLines = cast
    .map((c) => `- ${c.name} (${c.personality_summary?.split('.')[0] || c.archetype || 'character'}; mood: ${c.emotional_state || 'calm'})`)
    .join('\n');

  const silentRule = silent.length > 0
    ? `\nONLY THESE MAY SPEAK THIS BEAT: ${nameList}.\n${silent.map((c) => c.name).join(', ')} ${silent.length === 1 ? 'is' : 'are'} present and part of the scene, but do not give ${silent.length === 1 ? 'them' : 'them'} a spoken line this beat — they may only be shown listening or reacting without words.`
    : '';

  const prompt = `You are writing a scene that takes place between the characters themselves at ${location.name}${activeZone ? `, in the ${activeZone}` : ''} (${location.category}).

THE OBSERVER IS NOT PRESENT — NON-NEGOTIABLE:
- Nobody is watching this. There is no observer in the room, nearby, or at the edge of it.
- A person who is not part of this scene may read it afterwards. That person does not exist in this moment: their name must never appear, and no character may address, greet, name, glance toward, speak to, think about, or perform for anyone outside the participant list below.
- Never write dialogue, thoughts, or actions for anyone who is not the people listed here or in THE PLACE below.
- Nobody here is aware of being observed. Nothing may hint at an audience or a narrator.

PARTICIPANTS (the people this moment is about):
${castLines || '(no established Pocketfriend character is in this moment)'}
${silentRule}

${placeBlock}
${backgroundRule}

${canonicalSection ? `=== ESTABLISHED IDENTITIES ===\nThese records describe who these people are. Some wording in them was written for conversations with a person who is NOT here now. Nothing in them overrides the rule above: nobody in this scene addresses, names, or plays to anyone outside the participant list.\n${canonicalSection}\n===` : ''}
${memorySection ? `=== THEIR CONTINUING LIVES AND MEMORIES ===\n${memorySection}\n===` : ''}

${transcript ? `=== WHAT HAS JUST HAPPENED BETWEEN THEM ===\n${transcript}\n===` : 'Nothing has passed between them yet in this scene. It opens from where they already are.'}
${watchNote ? `=== WHAT THEY ARE DOING TOGETHER RIGHT NOW ===\n${watchNote}\nThey are watching this together, in the same room. They may talk about it, react to it, or ignore it like real people do.\n===` : ''}
${narrative ? ESTABLISHED_NARRATIVE(narrative) : ''}
${direction ? DIRECTION_TO_PLAY_OUT(direction) : ''}

WRITE THE NEXT MOMENT:
${narrative ? `- These people have ALREADY lived the events above. Continue from the situation those events left behind: what is said and done now is the consequence of them.
- Never reenact, re-announce, or question them. Anything quoted above was already said and must not be spoken again.` : ''}
${direction ? `- Now play out the directed moment above: the people named take those actions, say any attributed words out loud in their own voice, and it happens as real scene beats — never as agreement or commentary about the direction.` : ''}
- ${nameList} interact with each other directly: they speak to one another and react to what the other just said or did.
- Their established personalities, relationship, history and current circumstances drive how they behave.
- Move the moment forward. Do not restate or replay the transcript. Nobody repeats a line already spoken.
- Give each speaking participant at most one turn, 1-2 sentences, natural and in-character.
- Characters do not say their own name out loud when speaking about themselves.
- Background people of the place stay background unless they are the ones being spoken to: when a line is aimed at them they answer for themselves, in role; otherwise they work, pass by, and never take the moment over or replace the named participants.
- No narration of the observer. No summary of the scene.

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
      },
    },
  });

  const allowed = new Map([
    ...speaking.map((c) => [c.name.trim().toLowerCase(), c]),
    ...bgSpeaking.map((n) => [n.name.trim().toLowerCase(), n]),
  ]);
  const bgIds = new Set(bgSpeaking.map((n) => n.id));
  const stamp = Date.now();
  return (res?.lines || [])
    .map((line, i) => {
      const char = allowed.get(line?.character_name?.trim()?.toLowerCase());
      if (!char || !line?.content) return null;
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
    try {
      await base44.functions.invoke('extractMemoriesFromTurn', {
        characterId: person.id,
        userMessage: text,
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