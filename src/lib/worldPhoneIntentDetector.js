/**
 * worldPhoneIntentDetector.js
 *
 * Detects World Phone actions from:
 * 1. Explicit user instructions: "text Mike...", "call Sarah...", "message Devon that..."
 * 2. Character LLM response claims: "I texted Mike...", "I let Sarah know..."
 *
 * Returns { recipient, message } or null.
 * No side effects. Pure detection only.
 */

/**
 * detectWorldPhoneIntent
 * Detects explicit user instructions to contact another character.
 * Examples:
 *   "Text Mike and tell him not to forget tonight"
 *   "Call Sarah"
 *   "Message Devon that I'll be late"
 *   "Tell Khalil I'm on my way"
 */
export function detectWorldPhoneIntent(userText) {
  if (!userText || userText.length < 5) return null;

  const patterns = [
    // "text/message/tell [Name] and/to/that/: [message]"
    /\b(?:text|message|msg|tell|contact|hit\s+up|reach\s+out\s+to)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:and\s+(?:tell\s+(?:him|her|them)\s+)?|to\s+say\s+|that\s+|:\s*|,\s*)(.{5,})/i,
    // "call [Name] and tell them..."
    /\b(?:call)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:and\s+(?:tell\s+(?:him|her|them)\s+)?|to\s+say\s+|that\s+|:\s*|,\s*)(.{5,})/i,
    // "send [Name] a message/text saying..."
    /\bsend\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:a\s+)?(?:message|text|dm)\s+(?:saying\s+|that\s+|:\s*)?(.{5,})/i,
    // "let [Name] know [message]"
    /\blet\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+know\s+(?:that\s+)?(.{5,})/i,
  ];

  for (const pattern of patterns) {
    const match = userText.match(pattern);
    if (match) {
      const recipient = match[1]?.trim();
      const message = match[2]?.trim();
      if (recipient && message && recipient.length > 1 && message.length >= 5) {
        return { recipient, message };
      }
    }
  }
  return null;
}

/**
 * detectCharacterWorldPhoneAction
 * Detects when a character's LLM response CLAIMS it sent/called/messaged someone.
 * Only past-tense confirmations — not hypothetical future statements.
 * Examples:
 *   "I just texted Mike that I'm on my way."
 *   "I let Sarah know you said hi."
 *
 * senderName — to avoid self-reference matches.
 */
export function detectCharacterWorldPhoneAction(responseText, senderName) {
  if (!responseText || responseText.length < 10) return null;

  const senderFirst = (senderName || '').toLowerCase().split(' ')[0];

  const patterns = [
    // "I texted/messaged [Name] [saying/that/:]..."
    /\bI\s+(?:just\s+)?(?:texted|messaged|called)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:and\s+told\s+(?:him|her|them)\s+|saying\s+|that\s+|to\s+say\s+|:\s*)?["']?(.{5,}?)["']?[.!]/i,
    // "I sent [Name] a message/text [saying/that]..."
    /\bI\s+sent\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:a\s+)?(?:text|message|dm)\s+(?:saying\s+|that\s+|:\s*)?["']?(.{5,}?)["']?[.!]/i,
    // "I let [Name] know that..."
    /\bI\s+(?:let|told)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+know\s+(?:that\s+)?(.{5,}?)[.!]/i,
  ];

  for (const pattern of patterns) {
    const match = responseText.match(pattern);
    if (match) {
      const recipient = match[1]?.trim();
      const message = match[2]?.trim();
      // Avoid self-reference and overly short matches
      if (
        recipient &&
        message &&
        recipient.toLowerCase() !== senderFirst &&
        message.length >= 5
      ) {
        return { recipient, message };
      }
    }
  }
  return null;
}