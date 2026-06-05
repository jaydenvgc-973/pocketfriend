/**
 * familyTruthGuard.js
 *
 * Post-generation validation layer for family truth enforcement.
 *
 * When the LLM generates a response that contradicts a resolved family graph
 * (e.g., "I have no sister" when Sarah is a verified sister), this guard:
 *   1. Detects the contradiction using FAMILY_DENIAL_PATTERNS
 *   2. Blocks the false response from reaching the database
 *   3. Regenerates with a stronger enforcement prompt
 *   4. If the second generation also fails, clears the response to "..."
 *
 * This is the FINAL enforcement layer — nothing that contradicts resolved
 * family state may be saved or displayed to the user.
 *
 * Rules:
 * - Never deletes database records
 * - Never modifies user messages
 * - Only fires when liveFamilyGraphBlock is non-empty (family is resolved)
 * - Applies to all character types, not just npc_family_member
 */

import { containsFamilyDenial } from "@/lib/promptContextBuilders";
import { callLLMWithRetry } from "@/lib/llmUtils";
import { parseCharacterResponse } from "@/lib/chatResponseParser";

/**
 * Validates a generated character response against the resolved family graph.
 * Regenerates if the response contains a false family denial.
 *
 * @param {string} responseText - The LLM-generated response text
 * @param {string} liveFamilyGraphBlock - The resolved family graph prompt block (empty if no family)
 * @param {string} fullPrompt - The original full prompt used to generate the response
 * @param {string} characterName - Character name for logging
 * @returns {Promise<string>} - Validated (and possibly regenerated) response text
 */
export async function enforceFamilyTruth(responseText, liveFamilyGraphBlock, fullPrompt, characterName) {
  // Only enforce when family graph is resolved and response contains a denial
  if (!responseText || !liveFamilyGraphBlock || !containsFamilyDenial(responseText)) {
    return responseText;
  }

  console.error(
    `[FAMILY_SAVE_GUARD] BLOCKED false family denial for ${characterName}: ` +
    `"${responseText.substring(0, 120)}" — regenerating with stronger enforcement`
  );

  const enforcedPrompt = fullPrompt +
    `\n\n🚨 REGENERATION REQUIRED — FAMILY DENIAL DETECTED:\n` +
    `Your previous response contained a false statement about having no family or no siblings. ` +
    `That is incorrect. The FAMILY IDENTITY block at the top of this prompt contains your verified family. ` +
    `Regenerate your response now. ` +
    `Do NOT say you have no siblings, no sister, no brother, no family. ` +
    `You HAVE family. State the truth naturally or change the subject — but NEVER deny your family.`;

  try {
    const regenResponse = await callLLMWithRetry(enforcedPrompt);
    const regenObj = parseCharacterResponse(regenResponse);
    const regenText = regenObj.text_content?.trim() || '';

    if (regenText && !containsFamilyDenial(regenText)) {
      console.log(`[FAMILY_SAVE_GUARD] Regeneration succeeded for ${characterName}: "${regenText.substring(0, 80)}"`);
      return regenText;
    }

    // Second denial — clear rather than save false claim
    console.error(`[FAMILY_SAVE_GUARD] Regeneration also produced denial for ${characterName} — response cleared`);
    return '...';
  } catch (regenErr) {
    console.error(`[FAMILY_SAVE_GUARD] Regeneration failed for ${characterName}: ${regenErr.message} — response cleared`);
    return '...';
  }
}