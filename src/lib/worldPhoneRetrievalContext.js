// src/lib/worldPhoneRetrievalContext.js
//
// RETRIEVAL BEFORE GENERATION
//
// When a character is asked about World Phone / World Contacts messages,
// this module retrieves the ACTUAL message records from the authoritative
// World Phone conversation and returns them as a prompt block.
//
// This prevents the LLM from inventing, inferring, or reconstructing messages
// that don't exist in the authoritative record. The character can only quote
// or summarize messages that appear in the retrieved transcript.
//
// If no record is found, the instruction tells the character to respond with
// honest uncertainty instead of fabrication.
//
// ARCHITECTURE:
//   1. Detect whether the user's message references World Phone / World Contacts
//      or asks what another character said/texted/replied.
//   2. Identify the OTHER character being discussed (by name match against roster).
//   3. Retrieve the actual World Phone messages between the current character
//      and the other character using the canonical shared key.
//   4. Return a structured prompt block: the transcript + retrieval rules.
//
// This is a read-only retrieval module. It does NOT write, create, or modify
// any records. It is non-blocking — returns null if no intent is detected.

// Canonical shared key — matches WorldContactsPopup.getCanonicalSharedKey
// and sendWorldPhoneMessage backend function.
function getCanonicalSharedKey(charIdA, charIdB) {
  if (!charIdA || !charIdB) return null;
  const sorted = [charIdA, charIdB].sort();
  return `world_phone::${sorted[0]}::${sorted[1]}`;
}

// World Phone intent patterns — detect when the user is asking about a
// World Phone / World Contacts conversation or what another character said.
// These must be specific enough to avoid false positives on ordinary messages.
const WP_INTENT_PATTERNS = [
  /what did .{2,40} (say|text|reply|respond|write|message|tell you)/i,
  /what did .{2,40} say (back|when|after|to you|to me)/i,
  /did .{2,40} (text|reply|respond|message|say|answer) (back|yet|you|ever)/i,
  /show me (what|the).{0,30}(said|sent|wrote|text|message|conversation)/i,
  /what did .{2,40} say when you (texted|called|messaged)/i,
  // "world phone" / "world contact(s)" anywhere in the message — no trailing text required
  /\b(world phone|world contacts?)\b/i,
  /what did .{2,40} (text|say|reply) (you|back|after)/i,
  /what did .{2,40} (say|tell) (him|her|them)/i,
  /what.s .{2,30} (response|reply|answer|text back)/i,
  // Pronoun-based: "what did he say", "did she text back", "what did they reply"
  /what did (he|she|they) (say|text|reply|respond|write|message)/i,
  /did (he|she|they) (text|reply|respond|message|say|answer) (back|yet|you|ever)/i,
  /what did (he|she|they) say (back|when|after)/i,
  // "checking your world phone/contact", "look at your world phone"
  /(checking|look at|looking at|read|reading|check).{0,20}(world phone|world contacts?)/i,
  /(world phone|world contacts?).{0,20}(check|read|look|reading)/i,
];

function detectWorldPhoneIntent(text) {
  if (!text) return false;
  return WP_INTENT_PATTERNS.some(p => p.test(text));
}

// Find the OTHER character mentioned in the user's message.
// Tries full name first (higher specificity), then first name (only if unambiguous).
function findMentionedCharacter(text, currentCharacterId, allCharacters) {
  if (!text || !Array.isArray(allCharacters)) return null;
  const textLower = text.toLowerCase();
  const others = allCharacters.filter(c => c.id !== currentCharacterId && c.name);
  if (others.length === 0) return null;

  // Full name match — highest specificity
  const fullMatch = others.find(c => textLower.includes(c.name.toLowerCase()));
  if (fullMatch) return fullMatch;

  // First name match — only if unambiguous (exactly one character with that first name)
  // Extract capitalized words from the user's message
  const capitalizedWords = (text.match(/\b([A-Z][a-z]+)\b/g) || []).map(n => n.toLowerCase());
  for (const word of capitalizedWords) {
    const candidates = others.filter(c => {
      const firstName = c.name.toLowerCase().split(' ')[0];
      return firstName === word;
    });
    if (candidates.length === 1) return candidates[0];
  }

  return null;
}

// ── PROMPT BLOCK BUILDERS ──────────────────────────────────────────────────

function buildNoRecordBlock(contactName) {
  return `\n\n════════════════════════════════════\nWORLD PHONE RETRIEVAL — NO RECORD FOUND (${contactName})\n════════════════════════════════════\nThe user asked about your World Phone conversation with ${contactName}. No World Phone conversation record was found between you and ${contactName}.\n\nCRITICAL — RETRIEVAL BEFORE GENERATION:\nYou must NOT invent, infer, reconstruct, or fabricate what ${contactName} said. You have NO authoritative record of their messages.\nIf asked what they said, respond with honest uncertainty:\n- "I don't have a record of that conversation."\n- "I can't find those messages right now."\n- "I don't want to guess — I'm not seeing that thread."\nDo NOT fill the gap with plausible dialogue. Do NOT use your memory as proof of their exact words. Memory is NOT the authoritative record.\n════════════════════════════════════`;
}

function buildRetrievalBlock(contactName, transcript, totalCount, fromCurrent, fromOther, currentCharName) {
  const otherMissing = fromOther === 0 && fromCurrent > 0;
  const missingNote = otherMissing
    ? `\n\nIMPORTANT: Only YOUR messages appear in this record. ${contactName}'s replies are NOT in the retrieved record. If asked what ${contactName} said, respond: "I can see what I sent, but I'm not seeing ${contactName}'s full reply here." Do NOT invent their response.`
    : '';

  return `\n\n════════════════════════════════════\nWORLD PHONE RETRIEVAL — AUTHORITATIVE RECORD (${contactName})\n════════════════════════════════════\nThe user asked about your World Phone conversation with ${contactName}. Below is the ACTUAL message record retrieved from the authoritative World Phone conversation. This is the ONLY authoritative source for what was said.\n\n--- Transcript (${totalCount} total messages, showing most recent 40) ---\n${transcript || '(no messages found)'}\n--- End Transcript ---\n\nCRITICAL — RETRIEVAL BEFORE GENERATION:\n1. You may ONLY quote or summarize messages that appear in the transcript above.\n2. You may NOT invent, infer, reconstruct, or fabricate any message that does not appear above.\n3. If the user asks about a message that is NOT in the transcript, state that you cannot find it: "I'm not seeing that in the thread" or "I don't have that message."\n4. You may NOT use your memory as proof of ${contactName}'s exact words. The transcript above is the authoritative record — memory is secondary.\n5. Distinguish between what you remember and what appears in the actual record. When in doubt, defer to the record.${missingNote}\n════════════════════════════════════`;
}

// ── MAIN ENTRY POINT ───────────────────────────────────────────────────────

export async function buildWorldPhoneRetrievalContext({
  characterId,
  character,
  userMessage,
  allCharacters,
  base44,
}) {
  if (!characterId || !character || !userMessage || !base44) return null;

  // STEP 1: Detect World Phone intent — exit early if not a WP question
  if (!detectWorldPhoneIntent(userMessage)) return null;

  // STEP 2: Find the other character being discussed.
  // If the user used a name ("what did Vick say"), match by name.
  // If the user used a pronoun ("what did he say", "what did they say back"),
  // fall back to the MOST RECENT World Phone conversation for this character —
  // that is the conversation the user is most likely asking about.
  let mentionedChar = findMentionedCharacter(userMessage, characterId, allCharacters);
  let conversation = null;

  if (mentionedChar) {
    // Named character found — look up the specific conversation by canonical key
    const canonicalKey = getCanonicalSharedKey(characterId, mentionedChar.id);
    try {
      const convos = await base44.entities.Conversation.filter(
        { shared_conversation_key: canonicalKey },
        "-updated_date",
        5
      );
      conversation = convos[0] || null;
    } catch {
      return {
        block: buildNoRecordBlock(mentionedChar.name),
        contactName: mentionedChar.name,
        messageCount: 0,
        noRecord: true,
      };
    }
  } else {
    // No character named — try pronoun fallback: find the most recent
    // World Phone conversation for this character (by last_message_date).
    const PRONOUN_PATTERNS = /\b(he|she|they|him|her|them|that guy|that girl|this person)\b/i;
    const hasPronoun = PRONOUN_PATTERNS.test(userMessage);
    if (!hasPronoun) return null; // no pronoun and no name — can't identify the target

    try {
      const allConvos = await base44.entities.Conversation.filter(
        { character_ids: [characterId] },
        "-last_message_date",
        150
      );
      const wpConvos = (allConvos || []).filter(c =>
        (c.channel === 'world_phone' || c.type === 'npc' || c.type === 'direct') &&
        c.sync_status !== 'merged' &&
        c.id
      );
      if (wpConvos.length === 0) return null;
      conversation = wpConvos[0]; // most recent by last_message_date
    } catch {
      return null; // non-blocking — retrieval is best-effort
    }

    // Resolve the other character from the conversation's participant IDs
    const otherId = (conversation.participant_character_ids || conversation.character_ids || [])
      .find(id => id !== characterId);
    if (otherId && allCharacters) {
      mentionedChar = allCharacters.find(c => c.id === otherId) || null;
    }
    // If we still can't resolve the name, get it from recent messages
    if (!mentionedChar) {
      try {
        const recentMsgs = await base44.entities.Message.filter(
          { conversation_id: conversation.id, archived_date: null },
          "-created_date",
          10
        );
        const otherMsg = (recentMsgs || []).find(m =>
          m.sender_character_id !== characterId &&
          m.character_id !== characterId
        );
        if (otherMsg?.character_name) {
          mentionedChar = { id: otherMsg.sender_character_id || otherMsg.character_id, name: otherMsg.character_name };
        }
      } catch { /* non-blocking */ }
    }
    if (!mentionedChar) return null;
  }

  // No conversation found — return a "no record" instruction
  if (!conversation) {
    return {
      block: buildNoRecordBlock(mentionedChar.name),
      contactName: mentionedChar.name,
      messageCount: 0,
      noRecord: true,
    };
  }

  // Fetch the actual messages — robust pattern matching WorldContactsPopup fix
  let messages = [];
  try {
    messages = await base44.entities.Message.filter(
      { conversation_id: conversation.id, archived_date: null },
      "-created_date",
      100
    );
  } catch {
    return {
      block: buildNoRecordBlock(mentionedChar.name),
      contactName: mentionedChar.name,
      messageCount: 0,
      noRecord: true,
    };
  }

  // Filter: exclude canon_excluded, recovery signals, empty content
  const validMessages = (Array.isArray(messages) ? messages : []).filter(m => {
    if (m.canon_excluded === true) return false;
    if (m.recovery_signal === true) return false;
    return m.content && m.content.trim();
  }).reverse(); // chronological order (oldest first)

  // Count messages by sender
  const fromCurrentChar = validMessages.filter(m =>
    m.sender_character_id === characterId ||
    (!m.sender_character_id && m.character_id === characterId)
  ).length;
  const fromOtherChar = validMessages.length - fromCurrentChar;

  // Build the transcript (last 40 messages to keep prompt size reasonable)
  const transcript = validMessages.slice(-40).map(m => {
    const isFromCurrentChar = m.sender_character_id === characterId ||
      (!m.sender_character_id && m.character_id === characterId);
    const sender = isFromCurrentChar ? character.name : mentionedChar.name;
    const time = m.timestamp || m.created_date || '';
    const timeStr = time ? new Date(time).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    }) : '';
    return `[${timeStr}] ${sender}: ${m.content}`;
  }).join('\n');

  return {
    block: buildRetrievalBlock(
      mentionedChar.name, transcript, validMessages.length,
      fromCurrentChar, fromOtherChar, character.name
    ),
    contactName: mentionedChar.name,
    messageCount: validMessages.length,
    fromCurrentChar,
    fromOtherChar,
    noRecord: validMessages.length === 0,
    conversationId: conversation.id,
  };
}