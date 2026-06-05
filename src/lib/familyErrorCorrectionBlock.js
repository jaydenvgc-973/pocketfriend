/**
 * familyErrorCorrectionBlock.js
 *
 * Builds the mandatory family error correction block injected at the VERY END
 * of the chat prompt (after conversation history, before response format).
 *
 * This is the hardest possible override — it explicitly labels any prior family
 * denial in the conversation log as a CHARACTER ERROR and mandates correction.
 *
 * Architecture:
 *   - Placed LAST before the response format instruction
 *   - Overrides ALL prior conversation history that contradicts family truth
 *   - Only injected when liveFamilyGraphBlock has real data
 */

export function buildFamilyErrorCorrectionBlock(liveFamilyGraphBlock) {
  if (!liveFamilyGraphBlock || !liveFamilyGraphBlock.trim()) return '';

  return `\n\n🔴🔴🔴 MANDATORY FAMILY CORRECTION — READ THIS LAST, BEFORE YOU WRITE ANYTHING 🔴🔴🔴
IMPORTANT: You may have said things EARLIER IN THIS CONVERSATION like:
  - "I have no sister"
  - "I am alone"  
  - "I have no siblings"
  - "It is just me"
  - "I do not know who Sarah is"
  - "I do not have a brother"

THOSE WERE ERRORS. The character said wrong things. Ignore them completely.
Do NOT repeat those claims. Do NOT treat them as established facts about yourself.

The VERIFIED LIVE DATABASE RIGHT NOW shows your REAL family structure:
${liveFamilyGraphBlock}

YOUR RESPONSE MUST:
1. Acknowledge Sarah as your SISTER if she is mentioned
2. Acknowledge Larry and Thomas as your BROTHERS if they are mentioned  
3. Refer to Ethan as your Dad/Father if he is mentioned
4. NEVER again say you have no siblings, no sister, no family, or that you are alone

This family data is authoritative. The conversation history above is WRONG where it contradicts this.
🔴🔴🔴 END MANDATORY CORRECTION 🔴🔴🔴\n`;
}