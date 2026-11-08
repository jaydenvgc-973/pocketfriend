import { base44 } from '@/api/base44Client';

/**
 * dramaPremiseGate.js
 *
 * Pre-commit check for Insert Drama.
 *
 * Insert Drama's failure mode is repetition: a new name, object, room or
 * stranger wrapped around a development that already happened. Wording-level
 * instructions inside the generation prompt catch most of that, not all of it,
 * so the finished development is judged against the beats already present in
 * this conversation before it is saved.
 *
 * The judgement separates three questions so that a legitimate continuation of
 * an open thread is not mistaken for recycling:
 *   same situation?        — the same kind of thing happening again
 *   same concern family?   — money trouble, medical trouble, theft, and so on
 *   advances an open thread? — genuinely new information or a next step
 *
 * It creates no records, stores nothing, and affects no other Action.
 */
export async function isDuplicateDevelopment({ candidatePremise, candidateArea, priorBeats }) {
  if (!candidatePremise || !priorBeats) return false;

  try {
    const res = await base44.integrations.Core.InvokeLLM({
      prompt: `Judge whether a new story development reuses a development that already happened in this conversation.

DEVELOPMENTS ALREADY USED IN THIS CONVERSATION:
${priorBeats.substring(0, 2400)}

NEW DEVELOPMENT UNDER REVIEW:
premise: ${candidatePremise}
area of life: ${candidateArea || '(unspecified)'}

Answer three questions.

1. same_situation — is the same KIND of thing happening again, such that one could be described as the other with substitutions? A different name, relative, object, appliance, room, street, phone number, or wording is NOT a difference.

2. same_concern_family — does it belong to a concern family that a prior development already used? The families are: money trouble; medical trouble or medical news; an unexpected or estranged relative or old acquaintance appearing; theft, burglary or loss; a stranger accusing, confronting or mistaking them; something in the home or building breaking; an official, legal or institutional notice changing their situation; work or job trouble; an animal; being impersonated or a record of them being wrong. Two beats from one family are the same storyline even when the details differ.

3. advances_open_thread — does it genuinely move an already-open thread forward with new information, the next step, or a consequence that had not happened yet? A repeat of the same problem is not advancing, even if the wording is new.

A duplicate is: same_situation is true, OR (same_concern_family is true AND advances_open_thread is false).

Return JSON only.`,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          same_situation: { type: 'boolean' },
          same_concern_family: { type: 'boolean' },
          advances_open_thread: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['same_situation', 'same_concern_family', 'advances_open_thread'],
      },
    });

    if (!res) return false;
    return res.same_situation === true
      || (res.same_concern_family === true && res.advances_open_thread !== true);
  } catch (err) {
    // The check never blocks generation — it only skips the extra attempt.
    console.warn('[dramaPremiseGate] Check skipped:', err.message);
    return false;
  }
}