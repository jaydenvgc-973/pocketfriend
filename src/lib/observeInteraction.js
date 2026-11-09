/**
 * observeInteraction
 *
 * Generates a character-to-character exchange inside an OBSERVED scene.
 * The observing user is not present: they are never a participant, never
 * addressed, and never written into the transcript. Direction supplied by the
 * observer is authorial circumstance, never dialogue or a physical action.
 *
 * Uses the existing character context + memory pathways so each participant
 * keeps their own record of what actually happened between them.
 */
import { base44 } from '@/api/base44Client';
import { filterDashes } from '@/lib/dashFilter';

const OFF_SCREEN_DIRECTION = (direction) => `
=== OFF-SCREEN DIRECTION (authorial circumstance only) ===
${direction}

RULES FOR THIS DIRECTION:
- It shapes mood, circumstance, topic, timing, or the physical setting only.
- It is NOT spoken by anyone. It is NOT an action performed by anyone present.
- Nobody in the scene notices it happening and nobody reacts to it as an event.
- Never mention a director, an observer, an author, an audience, or a prompt.
===`;

export async function generateObserveBeat({ participants, location, activeZone, messages, direction, displayName, ownerEmail }) {
  const cast = (participants || []).filter((c) => c && c.id && c.name && !c.isNpc);
  if (cast.length < 1 || !location) return [];

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

  const transcript = (messages || [])
    .filter((m) => m.sender === 'character')
    .slice(-18)
    .map((m) => `${m.senderName}: ${m.content}`)
    .join('\n');

  const nameList = cast.map((c) => c.name).join(' and ');
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

  const prompt = `You are writing a scene that takes place between the characters themselves at ${location.name}${activeZone ? `, in the ${activeZone}` : ''} (${location.category}).

THE OBSERVER IS NOT PRESENT — NON-NEGOTIABLE:
- Nobody is watching this. There is no observer in the room, nearby, or at the edge of it.
- A person who is not part of this scene may read it afterwards. That person does not exist in this moment: their name must never appear, and no character may address, greet, name, glance toward, speak to, think about, or perform for anyone outside the participant list below.
- Never write dialogue, thoughts, or actions for anyone who is not a listed participant.
- Nobody here is aware of being observed. Nothing may hint at an audience or a narrator.

PARTICIPANTS (only these people may speak):
${castLines}

${canonicalSection ? `=== ESTABLISHED IDENTITIES ===\nThese records describe who these people are. Some wording in them was written for conversations with a person who is NOT here now. Nothing in them overrides the rule above: nobody in this scene addresses, names, or plays to anyone outside the participant list.\n${canonicalSection}\n===` : ''}
${memorySection ? `=== THEIR CONTINUING LIVES AND MEMORIES ===\n${memorySection}\n===` : ''}

${transcript ? `=== WHAT HAS JUST HAPPENED BETWEEN THEM ===\n${transcript}\n===` : 'They are together for the first time in this moment.'}
${direction ? OFF_SCREEN_DIRECTION(direction) : ''}

WRITE THE NEXT MOMENT:
- ${nameList} interact with each other directly: they speak to one another and react to what the other just said or did.
- Their established personalities, relationship, history and current circumstances drive how they behave.
- Move the moment forward. Do not restate or replay the transcript. Nobody repeats a line already spoken.
- Give each participant at most one turn, 1-2 sentences, natural and in-character.
- Characters do not say their own name out loud when speaking about themselves.
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

  const allowed = new Map(cast.map((c) => [c.name.trim().toLowerCase(), c]));
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
        avatarUrl: char.avatar_url,
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
 */
export async function recordObserveBeatMemories({ lines, participants }) {
  const cast = (participants || []).filter((p) => p && p.id);
  for (let i = 1; i < (lines || []).length; i++) {
    const previous = lines[i - 1];
    const current = lines[i];
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