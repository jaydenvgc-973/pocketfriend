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
 *   "send a message to Maya saying..."
 *   "let Ethan know that..."
 */
export function detectWorldPhoneIntent(userText) {
  if (!userText || userText.length < 5) return null;

  const excludedWords = new Set(['me','him','her','them','us','you','the','a','an','it','this','that','my','your','his','her','their']);

  // Name pattern: 1 or 2 words, first letter any case (user may type lowercase)
  const NAME = '([A-Za-z][a-zA-Z]+(?:\\s+[A-Za-z][a-zA-Z]+)?)';

  // ── PATTERNS WITH EXPLICIT MESSAGE CONTENT ────────────────────────────────
  const patternsWithMessage = [
    // "text/message/msg/tell/contact/hit up/reach out to [Name] [connector] [message]"
    new RegExp(`\\b(?:text|message|msg|tell|contact|hit\\s+up|reach\\s+out\\s+to)\\s+${NAME}\\s+(?:and\\s+(?:tell\\s+(?:him|her|them)\\s+)?|to\\s+say\\s+|that\\s+|:\\s*|,\\s*)(.{5,})`, 'i'),
    // "call [Name] and tell them..."
    new RegExp(`\\b(?:call)\\s+${NAME}\\s+(?:and\\s+(?:tell\\s+(?:him|her|them)\\s+)?|to\\s+say\\s+|that\\s+|:\\s*|,\\s*)(.{5,})`, 'i'),
    // "send [Name] a message/text saying..."
    new RegExp(`\\bsend\\s+${NAME}\\s+(?:a\\s+)?(?:message|text|dm)\\s+(?:saying\\s+|that\\s+|:\\s*)?(.{5,})`, 'i'),
    // "send a message/text to [Name] saying..."
    new RegExp(`\\bsend\\s+(?:a\\s+)?(?:message|text|dm)\\s+to\\s+${NAME}\\s+(?:saying\\s+|that\\s+|:\\s*)?(.{5,})`, 'i'),
    // "let [Name] know [message]"
    new RegExp(`\\blet\\s+${NAME}\\s+know\\s+(?:that\\s+)?(.{5,})`, 'i'),
    // "tell [Name] that/to..." (without connector word)
    new RegExp(`\\btell\\s+${NAME}\\s+(?:that\\s+|to\\s+)(.{5,})`, 'i'),
  ];

  for (const pattern of patternsWithMessage) {
    const match = userText.match(pattern);
    if (match) {
      const recipient = match[1]?.trim();
      const message = match[2]?.trim();
      if (recipient && message && recipient.length > 1 && message.length >= 5) {
        if (!excludedWords.has(recipient.toLowerCase())) {
          return { recipient, message };
        }
      }
    }
  }

  // ── PATTERNS WITHOUT EXPLICIT MESSAGE (recipient-only intents) ────────────
  // These match "text Maya", "call Devon", "message Sarah" with no specified content.
  // message will be null — caller must generate appropriate content.
  const patternsNameOnly = [
    // "text/call/message/dm/hit up [Name]" — bare intent, no message body
    new RegExp(`^\\s*(?:text|call|message|msg|dm|hit\\s+up|reach\\s+out\\s+to|contact)\\s+${NAME}\\s*$`, 'i'),
    // "send [Name] a text/message" — no content specified
    new RegExp(`\\bsend\\s+${NAME}\\s+(?:a\\s+)?(?:text|message|dm)\\s*$`, 'i'),
    // "send a text/message to [Name]" — no content specified
    new RegExp(`\\bsend\\s+(?:a\\s+)?(?:text|message|dm)\\s+to\\s+${NAME}\\s*$`, 'i'),
    // "let [Name] know" — no content after
    new RegExp(`\\blet\\s+${NAME}\\s+know\\s*$`, 'i'),
  ];

  for (const pattern of patternsNameOnly) {
    const match = userText.match(pattern);
    if (match) {
      const recipient = match[1]?.trim();
      if (recipient && recipient.length > 1 && !excludedWords.has(recipient.toLowerCase())) {
        // Return with null message — sendWorldPhoneMessage will generate content via LLM
        return { recipient, message: null };
      }
    }
  }

  // ── PRONOUN-BASED INTENTS ("text him", "call her", "message them") ───────────
  // When the user says "text him now", "call her", "message them" — no name is given.
  // Return a special marker so the caller can resolve the pronoun from conversation context.
  const pronounPatterns = [
    /^\s*(?:text|call|message|msg|dm|hit\s+up|reach\s+out\s+to)\s+(him|her|them)\s*(?:now|please|real\s+quick|asap)?\s*[.!]?\s*$/i,
    /\bsend\s+(?:a\s+)?(?:text|message|dm)\s+to\s+(him|her|them)\s*$/i,
    /\blet\s+(him|her|them)\s+know\s*$/i,
    /\btell\s+(him|her|them)\b/i,
  ];
  for (const pattern of pronounPatterns) {
    const match = userText.match(pattern);
    if (match) {
      // Return special sentinel — caller must resolve pronoun from conversation context
      return { recipient: null, message: null, pronounIntent: true, pronoun: match[1].toLowerCase() };
    }
  }

  return null;
}

/**
 * stripFabricatedReplyFromResponse
 * When Character A's send actually succeeded, strips any fabricated summary of
 * what Character B supposedly said back. Character B's REAL response is generated
 * by the backend — Character A must not invent how Character B responded.
 * 
 * Removes patterns like:
 *   "...and they said X"
 *   "...she replied X"
 *   "...he texted back X"
 *   "...they responded that X"
 */
export function stripFabricatedReplyFromResponse(responseText) {
  if (!responseText) return responseText;
  return responseText
    .replace(/\s+(?:and\s+)?(?:they|she|he)\s+(?:said|replied|responded|texted\s+back|wrote\s+back)[^.!?]*[.!?]/gi, '.')
    .replace(/\s+(?:she|he)\s+(?:said|replied|responded)[^.!?]*[.!?]/gi, '.')
    .replace(/,?\s+(?:they|she|he)\s+(?:said|replied|texted\s+back)[^.!?]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || '...';
}

/**
 * detectCharacterWorldPhoneAction
 * Detects when a character's LLM response CLAIMS it sent/called/messaged someone.
 * Only past-tense confirmations — not hypothetical future statements.
 * Examples:
 *   "I just texted Mike that I'm on my way."
 *   "I let Sarah know you said hi."
 *   "Already messaged him."
 *   "I reached out to Devon."
 *
 * senderName — to avoid self-reference matches.
 */
export function detectCharacterWorldPhoneAction(responseText, senderName) {
  if (!responseText || responseText.length < 10) return null;

  const senderFirst = (senderName || '').toLowerCase().split(' ')[0];
  const excludedWords = new Set(['me','him','her','them','us','you','the','a','an','it','my','your','his','their']);

  // Name pattern: 1 or 2 capitalized words
  const NAME = '([A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+)?)';

  // ── PATTERNS WITH EXPLICIT RECIPIENT + MESSAGE ────────────────────────────
  const patternsWithMessage = [
    // "I texted/messaged/called [Name] [saying/that/:]..."
    new RegExp(`\\bI\\s+(?:just\\s+)?(?:texted|messaged|called|hit\\s+up)\\s+${NAME}\\s+(?:and\\s+told\\s+(?:him|her|them)\\s+|saying\\s+|that\\s+|to\\s+say\\s+|:\\s*)?["']?(.{5,}?)["']?[.!]`, 'i'),
    // "I sent [Name] a message/text [saying/that]..."
    new RegExp(`\\bI\\s+sent\\s+${NAME}\\s+(?:a\\s+)?(?:text|message|dm)\\s+(?:saying\\s+|that\\s+|:\\s*)?["']?(.{5,}?)["']?[.!]`, 'i'),
    // "I let/told [Name] know that..."
    new RegExp(`\\bI\\s+(?:let|told)\\s+${NAME}\\s+know\\s+(?:that\\s+)?(.{5,}?)[.!]`, 'i'),
    // "I reached out to [Name] about..."
    new RegExp(`\\bI\\s+reached\\s+out\\s+to\\s+${NAME}\\s+(?:about\\s+|to\\s+say\\s+|saying\\s+|that\\s+)?(.{5,}?)[.!]`, 'i'),
    // "Already texted/messaged [Name]..."
    new RegExp(`\\b(?:already|just)\\s+(?:texted|messaged|called)\\s+${NAME}\\s+(?:about\\s+|that\\s+|saying\\s+)?(.{5,}?)[.!]`, 'i'),
  ];

  for (const pattern of patternsWithMessage) {
    const match = responseText.match(pattern);
    if (match) {
      const recipient = match[1]?.trim();
      const message = match[2]?.trim();
      if (
        recipient &&
        message &&
        recipient.toLowerCase() !== senderFirst &&
        !excludedWords.has(recipient.toLowerCase()) &&
        message.length >= 5
      ) {
        return { recipient, message };
      }
    }
  }

  // ── PATTERNS WITH RECIPIENT BUT NO EXPLICIT MESSAGE CONTENT ───────────────
  // Catches: "I texted Maya", "I called Devon", "I sent Sarah a message"
  // message will be null — caller must derive content from context.
  const patternsNameOnly = [
    // "I texted/messaged/called/hit up [Name]" — no message body
    new RegExp(`\\bI\\s+(?:just\\s+)?(?:texted|messaged|called|hit\\s+up|contacted)\\s+${NAME}(?:\\s*[.!,]|\\s+(?:about|earlier|already|real quick|really quick))?`, 'i'),
    // "I sent [Name] a text/message"
    new RegExp(`\\bI\\s+sent\\s+${NAME}\\s+(?:a\\s+)?(?:text|message|dm)\\b`, 'i'),
    // "I let/told [Name] know"
    new RegExp(`\\bI\\s+(?:let|told)\\s+${NAME}\\s+know\\b`, 'i'),
    // "I reached out to [Name]"
    new RegExp(`\\bI\\s+reached\\s+out\\s+to\\s+${NAME}\\b`, 'i'),
    // "Already texted/messaged [Name]"
    new RegExp(`\\b(?:already|just)\\s+(?:texted|messaged|called|contacted)\\s+${NAME}\\b`, 'i'),
  ];

  for (const pattern of patternsNameOnly) {
    const match = responseText.match(pattern);
    if (match) {
      const recipient = match[1]?.trim();
      if (
        recipient &&
        recipient.toLowerCase() !== senderFirst &&
        !excludedWords.has(recipient.toLowerCase())
      ) {
        return { recipient, message: null };
      }
    }
  }

  return null;
}