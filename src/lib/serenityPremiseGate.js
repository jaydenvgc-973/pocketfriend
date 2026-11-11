import { base44 } from '@/api/base44Client';

/**
 * serenityPremiseGate.js
 *
 * Pre-commit check for Insert Serenity.
 *
 * Insert Serenity's failure mode is repetition in the other direction: pleasant moments
 * come back wearing new surface details — a different stranger, a different amount, a
 * different flavor of the same kindness. Wording-level rules inside the prompt catch most
 * of that, not all of it, so the finished moment is judged against the beats already
 * present in this conversation before it is saved.
 *
 * The judgement separates three questions so that a legitimate next step of an open
 * thread is not mistaken for recycling:
 *   same moment?      — the same kind of pleasant thing happening again
 *   same area of life? — money, kindness from a stranger, old friend returning, and so on
 *   a genuine next step? — new information or a real continuation, not a repeat
 *
 * It creates no records, stores nothing, and affects no other Action.
 */
export async function isRepeatedSerenity({ candidatePremise, candidateArea, priorBeats }) {
  if (!candidatePremise || !priorBeats) return false;

  try {
    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `Judge whether a new pleasant development reuses something that already happened in this conversation.

PLEASANT DEVELOPMENTS ALREADY USED IN THIS CONVERSATION:
${priorBeats.substring(0, 2400)}

NEW DEVELOPMENT UNDER REVIEW:
premise: ${candidatePremise}
area of life: ${candidateArea || '(unspecified)'}

Answer three questions.

1. same_moment — is the same KIND of pleasant thing happening again, such that one could be described as the other with substitutions? A different person, amount, place, flavor, or wording is NOT a difference. "A stranger buys her coffee" and "a stranger buys her lunch" are one moment. "An old friend calls" and "a former classmate texts out of nowhere" are one moment.

2. same_area_of_life — does it belong to an area already used? The areas are: unexpected money or financial ease; a compliment or recognition; an old friend or acquaintance reconnecting; good news from work or an opportunity approved; a small kindness from a stranger (a paid drink or meal, a returned item); a gift; food and everyday pleasure; rest and sleep; an ordinary quiet or peaceful stretch; help with a task; a discovery (a place, a hobby, a song); affection or appreciation from someone close. Two beats from one area are the same storyline even when the details differ.

3. genuine_next_step — is it actually moving an already-open thread forward (the invitation arrives, the new hobby is tried for the first time, the friend follows through), rather than restating the same pleasant thing?

A duplicate is: same_moment is true, OR (same_area_of_life is true AND genuine_next_step is false).

Return JSON only.`,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          same_moment: { type: 'boolean' },
          same_area_of_life: { type: 'boolean' },
          genuine_next_step: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['same_moment', 'same_area_of_life', 'genuine_next_step'],
      },
    });

    if (!res) return false;
    return res.same_moment === true
      || (res.same_area_of_life === true && res.genuine_next_step !== true);
  } catch (err) {
    // The check never blocks generation — it only skips the extra attempt.
    console.warn('[serenityPremiseGate] Check skipped:', err.message);
    return false;
  }
}