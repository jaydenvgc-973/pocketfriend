// src/lib/groupMessageRetrievalContext.js
//
// GROUP MESSAGE RETRIEVAL — READ BEFORE GENERATION
//
// When a user on Chat or Text asks a character to check, read, or describe
// content from a GROUP conversation, this module retrieves the ACTUAL group
// messages using the same established query pattern as GroupChat.jsx:
//   Message.filter({ conversation_id }, 'created_date', 100)
//
// This does NOT route through World Phone. It uses the existing group
// Conversation and Message records directly — the same records the group-chat
// page already loads and displays.
//
// Read-only. No writes, no memory entries, no new storage.
//
// RESOLUTION:
//   1. Detect whether the user explicitly references a group conversation.
//   2. Find group conversations where the current character is a participant.
//   3. If exactly one group matches, retrieve its messages.
//   4. If multiple groups match, try to resolve by character names mentioned.
//   5. If still ambiguous, return a block telling the character to ask which group.
//
// AMBIGUITY:
//   - When the user names a sender and does NOT mention a group, this function
//     returns null — the direct World Phone retrieval pathway handles that.
//   - When the user explicitly mentions a group, this function handles it.
//   - When "check your messages" is ambiguous (no group mention), returns null
//     so the World Phone path can handle the direct-message interpretation.

const GROUP_INTENT_PATTERNS = [
  // Explicit group references
  /\bgroup\s*chat\b/i,
  /\bgroup\s*conversation\b/i,
  /\bthe\s+group\b/i,
  /\bin\s+(?:the\s+)?group\b/i,
  // "read/check the group"
  /(?:read|check|look at|see|what(?:'s|s| did)).{0,20}\bgroup\b/i,
];

function detectGroupIntent(text) {
  if (!text) return false;
  return GROUP_INTENT_PATTERNS.some(p => p.test(text));
}

// Extract capitalized words from the user's message that match character first names
function findMentionedCharacterNames(text, allCharacters, currentCharacterId) {
  if (!text || !Array.isArray(allCharacters)) return [];
  const textLower = text.toLowerCase();
  const others = allCharacters.filter(c => c.id !== currentCharacterId && c.name);
  const mentioned = [];
  for (const c of others) {
    const nameLower = c.name.toLowerCase();
    if (textLower.includes(nameLower)) {
      mentioned.push(c);
      continue;
    }
    const firstName = c.name.split(' ')[0];
    if (firstName && firstName.length > 2 && textLower.includes(firstName.toLowerCase())) {
      // Only match first name if unambiguous
      const duplicates = others.filter(x => x.name.toLowerCase().split(' ')[0] === firstName.toLowerCase());
      if (duplicates.length === 1) mentioned.push(c);
    }
  }
  return mentioned;
}

function buildGroupNoRecordBlock(characterName) {
  return `\n\n════════════════════════════════════\nGROUP CHAT RETRIEVAL — NO GROUP FOUND\n════════════════════════════════════\nThe user asked about a group chat conversation. No group conversation was found that includes you (${characterName}) as a participant.\n\nCRITICAL:\nDo NOT invent what was said in a group chat. If you have no group chat record, respond honestly:\n- "I'm not in any group chat like that."\n- "I don't have a group conversation matching that."\nDo NOT fabricate group chat content from memory.\n════════════════════════════════════`;
}

function buildGroupAmbiguityBlock(characterName, groupNames) {
  const list = groupNames.map(g => `"${g}"`).join(', ');
  return `\n\n════════════════════════════════════\nGROUP CHAT RETRIEVAL — MULTIPLE GROUPS MATCH\n════════════════════════════════════\nThe user asked about a group chat. You are in multiple group conversations: ${list}.\n\nAsk the user which group they mean. Do NOT guess or read from the wrong group.\n════════════════════════════════════`;
}

function buildGroupRetrievalBlock(groupTitle, transcript, totalCount, characterName) {
  return `\n\n════════════════════════════════════\nGROUP CHAT RETRIEVAL — AUTHORITATIVE RECORD (${groupTitle})\n════════════════════════════════════\nThe user asked about your group chat "${groupTitle}". Below is the ACTUAL message record retrieved from that group conversation. This is the ONLY authoritative source for what was said.\n\n--- Group Transcript (${totalCount} total messages, showing most recent 40) ---\n${transcript || '(no messages found)'}\n--- End Group Transcript ---\n\nCRITICAL — RETRIEVAL BEFORE GENERATION:\n1. You may ONLY quote or summarize messages that appear in the transcript above.\n2. You may NOT invent, infer, reconstruct, or fabricate any message that does not appear above.\n3. If the user asks about a message that is NOT in the transcript, state that you cannot find it.\n4. You may NOT use your memory as proof of what was said. The transcript is the authoritative record.\n5. Image descriptions in brackets [sent an image: ...] are the stored visual descriptions of what was shared — treat them as what you actually saw.\n════════════════════════════════════`;
}

/**
 * Build a group-message retrieval context block.
 *
 * Returns null when no group intent is detected (so the direct World Phone path
 * can handle the request). Returns a block string when group content is retrieved
 * or when clarification is needed.
 *
 * @param {object} params
 * @param {string} params.characterId
 * @param {object} params.character
 * @param {string} params.userMessage
 * @param {array}  params.allCharacters
 * @param {object} params.base44
 * @returns {Promise<{block: string, groupTitle: string, messageCount: number, noRecord: boolean, ambiguous: boolean} | null>}
 */
export async function buildGroupMessageRetrievalContext({
  characterId,
  character,
  userMessage,
  allCharacters,
  base44,
}) {
  if (!characterId || !character || !userMessage || !base44) return null;

  // STEP 1: Detect group intent — return null if not a group question
  // so the direct World Phone pathway handles direct-message requests
  if (!detectGroupIntent(userMessage)) return null;

  // STEP 2: Find group conversations where this character is a participant
  const ownerEmail = character.owner_email;
  if (!ownerEmail) return null;

  let groupConvos = [];
  try {
    groupConvos = await base44.entities.Conversation.filter(
      { type: 'group', owner_email: ownerEmail },
      '-updated_date',
      50
    );
  } catch {
    return null; // non-blocking
  }

  // Filter to groups where this character is a participant and not merged
  const charGroups = (groupConvos || []).filter(c =>
    Array.isArray(c.character_ids) && c.character_ids.includes(characterId) &&
    c.sync_status !== 'merged'
  );

  if (charGroups.length === 0) {
    return {
      block: buildGroupNoRecordBlock(character.name || 'you'),
      groupTitle: null,
      messageCount: 0,
      noRecord: true,
      ambiguous: false,
    };
  }

  // STEP 3: Resolve the target group
  let targetGroup = null;

  if (charGroups.length === 1) {
    targetGroup = charGroups[0];
  } else {
    // Try to resolve by matching character names mentioned in the user message
    const mentionedChars = findMentionedCharacterNames(userMessage, allCharacters, characterId);
    if (mentionedChars.length > 0) {
      const mentionedIds = new Set(mentionedChars.map(c => c.id));
      // Find the group that contains the most mentioned characters
      let bestMatch = null;
      let bestOverlap = 0;
      for (const g of charGroups) {
        const overlap = (g.character_ids || []).filter(id => mentionedIds.has(id)).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestMatch = g;
        }
      }
      if (bestMatch && bestOverlap > 0) {
        targetGroup = bestMatch;
      }
    }

    // Also try matching by group title keywords
    if (!targetGroup) {
      const textLower = userMessage.toLowerCase();
      const titleMatch = charGroups.find(g => {
        const titleLower = (g.title || '').toLowerCase();
        if (titleLower && textLower.includes(titleLower)) return true;
        return false;
      });
      if (titleMatch) targetGroup = titleMatch;
    }

    // If still unresolved, ask for clarification
    if (!targetGroup) {
      return {
        block: buildGroupAmbiguityBlock(
          character.name || 'you',
          charGroups.map(g => g.title || 'untitled')
        ),
        groupTitle: null,
        messageCount: 0,
        noRecord: false,
        ambiguous: true,
        candidateGroups: charGroups.map(g => g.title || 'untitled'),
      };
    }
  }

  // STEP 4: Retrieve the actual messages using the same pattern as GroupChat.jsx
  let messages = [];
  try {
    messages = await base44.entities.Message.filter(
      { conversation_id: targetGroup.id },
      'created_date',
      100
    );
  } catch {
    return {
      block: buildGroupNoRecordBlock(character.name || 'you'),
      groupTitle: targetGroup.title,
      messageCount: 0,
      noRecord: true,
    };
  }

  // Filter: exclude canon_excluded, recovery signals. Retain messages with text or image descriptions.
  const validMessages = (Array.isArray(messages) ? messages : []).filter(m => {
    if (m.canon_excluded === true) return false;
    if (m.recovery_signal === true) return false;
    const hasText = m.content && m.content.trim();
    const hasImageDesc = m.user_edited_description || m.visual_analysis_description ||
      m.image_description || m.inferred_image_description;
    return hasText || hasImageDesc;
  });

  // Build a name lookup for all characters in the group
  const charNameMap = {};
  if (allCharacters) {
    for (const c of allCharacters) {
      if (c.id) charNameMap[c.id] = c.name;
    }
  }

  // Build the transcript (last 40 messages, chronological order)
  const transcript = validMessages.slice(-40).map(m => {
    let speaker;
    if (m.sender_type === 'user') {
      speaker = m.played_as_character_name || m.played_as_character_id
        ? (m.played_as_character_name || charNameMap[m.played_as_character_id] || 'User')
        : 'User';
    } else {
      speaker = m.character_name || charNameMap[m.character_id] || 'Someone';
    }
    const time = m.timestamp || m.created_date || '';
    const timeStr = time ? new Date(time).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    }) : '';
    const imageDesc = m.user_edited_description || m.visual_analysis_description ||
      m.image_description || m.inferred_image_description || null;
    const imageNote = imageDesc ? ` [sent an image: ${imageDesc}]` : '';
    return `[${timeStr}] ${speaker}: ${m.content || ''}${imageNote}`;
  }).join('\n');

  return {
    block: buildGroupRetrievalBlock(
      targetGroup.title || 'Group Chat',
      transcript,
      validMessages.length,
      character.name || 'you'
    ),
    groupTitle: targetGroup.title,
    messageCount: validMessages.length,
    noRecord: validMessages.length === 0,
    ambiguous: false,
    conversationId: targetGroup.id,
  };
}