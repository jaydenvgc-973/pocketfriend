/**
 * "This is nonsense" correction prompts.
 *
 * The user flags a message as wrong: a factual, contextual, behavioural,
 * chronological or structural error. The replacement must resolve that error
 * against the character's established reality — never preserve the flagged
 * claim and never invent a circumstance that exists only to make the error true.
 *
 * The authoritative material comes from the same sources normal replies use:
 * the canonical character context, the live location record, and the real
 * timeline of the conversation. All times are Eastern (America/New_York).
 */

const ET = 'America/New_York';

export function easternMoment(iso) {
  const ms = new Date(iso).getTime();
  const d = new Date(ms);
  const et = new Date(d.toLocaleString('en-US', { timeZone: ET }));
  const h = et.getHours();
  const timeLabel = `${h % 12 || 12}:${String(et.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  let daypart = 'night';
  if (h < 4) daypart = 'deep night';
  else if (h < 6) daypart = 'pre-dawn';
  else if (h < 8) daypart = 'early morning';
  else if (h < 12) daypart = 'morning';
  else if (h < 17) daypart = 'afternoon';
  else if (h < 20) daypart = 'evening';
  return { ms, timeLabel, daypart };
}

export function elapsedWords(fromMs, toMs) {
  const mins = Math.max(0, Math.round((toMs - fromMs) / 60000));
  if (!Number.isFinite(mins)) return 'a short while';
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hLabel = `${h} hour${h === 1 ? '' : 's'}`;
  return m ? `${hLabel} ${m} minute${m === 1 ? '' : 's'}` : hLabel;
}

function ageFromBirthday(birthday) {
  const m = String(birthday || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: ET }));
  let age = now.getFullYear() - Number(m[1]);
  if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) age--;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Time at the flagged moment plus how much time really passed before it.
 * priorMessages: [{ ms, isNarrative, content }] in conversation order.
 */
export function buildTimeAndProgressionBlock({ originalMs, priorMessages }) {
  const { timeLabel, daypart } = easternMoment(new Date(originalMs).toISOString());
  const lines = [
    `TIME AT THIS POINT IN THE CONVERSATION: ${timeLabel} Eastern (${daypart}). The replacement describes this moment, not the present.`,
  ];

  const prev = priorMessages[priorMessages.length - 1];
  if (prev && Number.isFinite(prev.ms)) {
    lines.push(`The turn immediately before this one was written ${elapsedWords(prev.ms, originalMs)} earlier.`);
  }

  const narratives = priorMessages.filter(m => m.isNarrative && (m.content || '').trim());
  const lastNarrative = narratives[narratives.length - 1];
  if (lastNarrative) {
    lines.push(
      `The most recent established scene before this moment was written ${elapsedWords(lastNarrative.ms, originalMs)} earlier:\n"${lastNarrative.content.trim().slice(0, 400)}"`
    );
  }

  lines.push(
    `HOW TIME WORKS HERE:
- Time passes. Anything described as underway earlier in the conversation is not still underway now: it finished, changed, or was set aside in between.
- Doing something again is normal. Cooking, eating, sleeping, working or visiting a place a second time is legitimate as a NEW current instance and must not be removed just because it happened earlier.
- Only treating an earlier moment as permanently ongoing is an error. The elapsed times above are real; do not compress or stretch them.`
  );

  return lines.join('\n');
}

export function buildCorrectionPrompt({
  systemPrompt,
  locationBlock,
  timeBlock,
  contextLog,
  answeredTurnText,
  flaggedText,
  isNarrative,
}) {
  const kind = isNarrative ? 'narrative' : 'message';
  return `${systemPrompt}

════════════════════════════════════
THE USER HAS FLAGGED THE FOLLOWING ${kind.toUpperCase()} AS NONSENSE
════════════════════════════════════
That means it is wrong. It contradicts established facts or circumstances, its chronology is impossible, its continuity is broken, its behaviour does not follow from this character, or its logic does not hold together. Find what is actually wrong and write this same moment again with the error resolved.

WHICH INFORMATION IS AUTHORITATIVE
- The character's established facts above (age, birthday, family, personality, preferences, history, knowledge, manner of speaking), the real location below and the real timeline are TRUE. None of them may be changed to fit the flagged text.
- The flagged text is NOT true, even where it states something confidently. A claim does not become a fact because a generation wrote it. Do not preserve its claims and do not reword the same claim.
- Earlier conversation, earlier narratives and earlier events remain real, unless one of them is the thing that is wrong.

${locationBlock || ''}

${timeBlock}

CONVERSATION BEFORE THIS MOMENT (older turns — already said, already true):
${contextLog || '(this is the start of the conversation)'}
${isNarrative ? '' : `\nTHE USER MESSAGE THIS ANSWERED:\n"${answeredTurnText || '(the previous user message)'}"\n`}
THE FLAGGED ${kind.toUpperCase()} (incorrect — do not carry it over):
"${flaggedText}"

HOW TO WRITE THE REPLACEMENT
1. Silently identify the exact contradiction or failure and fix that. Leave everything about the moment that is not wrong exactly as it was.
2. Do not invent a circumstance, excuse, backstory or exception whose only purpose is to make the original claim legal. If keeping the claim would require an explanation that was never established, drop the claim instead of adding the explanation.
3. Do not flatten the character to be safe. They may genuinely do again what they did earlier, change their mind, make a mistake, lie, or feel something contradictory — as long as their established circumstances, knowledge and motivations support it. Correcting nonsense is not a reason to remove legitimate behaviour.
4. The replacement covers the same turn and the same moment, at the same time of day, in the same place. Not the present and not a later scene.
5. Keep the character's own voice, vocabulary, manner and emotional state, and roughly the same length. Nothing the character could not know may appear.
6. Never mention this correction, the user's report, these rules, or any contradiction.
7. Never use em dashes or en dashes.

FORMAT (do not change it): ${isNarrative
    ? 'This replacement is a NARRATIVE. Write it in the third person, describing the character from outside, by name or as she/he/they. It is never the character talking and never first person, and it contains no dialogue formatting.'
    : "This replacement is spoken dialogue. First person, the character's own words only. It never describes the character from outside and never narrates the scene."}

${isNarrative
      ? 'Write only the corrected narrative, in the same third-person descriptive register:'
      : "Write only the corrected spoken words, in the character's own voice:"}`;
}

export function buildFactsSummary({ character, locationBlock, timeBlock }) {
  const lines = [];
  if (character?.name) lines.push(`Name: ${character.name}`);
  const age = character?.age || ageFromBirthday(character?.birthday);
  if (age) lines.push(`Age: ${age}`);
  if (character?.birthday) lines.push(`Date of birth: ${character.birthday}`);
  if (character?.occupation) lines.push(`Occupation: ${character.occupation}`);
  if (character?.personality_summary) lines.push(`Personality: ${character.personality_summary}`);
  if (character?.communication_style) lines.push(`Communication style: ${character.communication_style}`);
  if (character?.emotional_state) lines.push(`Emotional state: ${character.emotional_state}`);
  if (locationBlock) lines.push(locationBlock);
  if (timeBlock) lines.push(timeBlock);
  return lines.join('\n');
}

export function buildAuditPrompt({ flaggedText, replacement, facts, isNarrative }) {
  return `A character ${isNarrative ? 'narrative' : 'message'} was reported by the user as nonsense and has been rewritten. Check the rewrite honestly.

ESTABLISHED FACTS (authoritative):
${facts}

FLAGGED ORIGINAL (contains at least one error):
"${flaggedText}"

REWRITE:
"${replacement}"

Judge only against the facts listed above. Anything they do not mention is unknown, not false, and the flagged original is not evidence about anything.

Answer precisely:
- clean: is the rewrite free of the original error? It is NOT clean if it still asserts, assumes or depends on a claim of the flagged original that contradicts the established facts, or keeps the same contradiction in different words.
- invented: does the rewrite explain the original error away with a new fact that was never established (for example correcting the profile, blaming a mistake, or granting an exception)? Ordinary everyday detail the established facts do not mention is not an invention by itself.
- problems: only actual contradictions with the established facts, quoted briefly. An ordinary scene detail that is simply not listed above is not a problem. Empty when there are none.

Return JSON: { "clean": true | false, "invented": true | false, "problems": ["..."] }`;
}

export function buildRepairPrompt({ replacement, problems, locationBlock, isNarrative }) {
  return `This character ${isNarrative ? 'narrative' : 'message'} was written to replace one the user reported as nonsense, but it still carries problems.

${locationBlock || ''}

PROBLEMS REMAINING:
${problems.length ? problems.map(p => `- ${p}`).join('\n') : '- it keeps a claim that contradicts the established facts'}

CURRENT VERSION:
"${replacement}"

Fix only those problems. Keep everything else, the character's voice and roughly the same length. Do not add an explanation that exists only to justify the original error, and do not remove legitimate current activity. ${isNarrative ? 'Keep it a narrative.' : 'Keep it spoken words, not narration.'} Never use em dashes or en dashes. Never mention the correction.

Write only the corrected text:`;
}

export const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    clean: { type: 'boolean' },
    invented: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['clean'],
};