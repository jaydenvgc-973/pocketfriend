import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * diagnoseUnreadBadgeSource
 *
 * Investigates all unread message badge sources for every active_created_character
 * belonging to the authenticated user.
 *
 * Returns a full diagnostic report classifying every unread message as:
 *   direct_chat       — type=direct, channel != world_phone
 *   text_message      — type=phone, channel != world_phone
 *   world_phone       — channel=world_phone (regardless of type)
 *   world_contact     — type=npc (legacy world contacts)
 *   orphaned_message  — message.conversation_id has no matching conversation
 *   unknown           — does not match any category
 *
 * Also reports what the current CharacterCard badge logic ACTUALLY counts (the bug)
 * vs what it SHOULD count (direct_chat only for red badge).
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    // Step 1: Get all active_created_character records for this user
    const allCharacters = await base44.entities.Character.filter({
      owner_email: ownerEmail,
      character_type: 'active_created_character',
    });

    // Also include characters that have homepage cards but may be missing character_type (legacy)
    const legacyCharacters = await base44.entities.Character.filter({
      owner_email: ownerEmail,
    });
    // Merge: keep all unique by id, prefer active_created but don't exclude others that have cards
    const seenIds = new Set();
    const allActiveCreated = [];
    for (const c of allCharacters) {
      if (!seenIds.has(c.id)) { seenIds.add(c.id); allActiveCreated.push(c); }
    }
    // Add any that are missing character_type but belong to user (legacy)
    for (const c of legacyCharacters) {
      if (!seenIds.has(c.id) && (!c.character_type || c.character_type === 'active_created_character')) {
        seenIds.add(c.id);
        allActiveCreated.push(c);
      }
    }

    // Step 2: Get ALL conversations owned by this user
    const allConversations = await base44.entities.Conversation.filter(
      { owner_email: ownerEmail },
      '-updated_date',
      500
    );

    // Build conversation map for fast lookup
    const convoMap = {};
    for (const c of allConversations) convoMap[c.id] = c;

    // Step 3: For each character, get all unread messages from that character
    const diagnosticByCharacter = [];

    for (const char of allActiveCreated) {
      // Skip moved_away or deleted
      if (char.status === 'moved_away' || char.status === 'deleted' || char.status === 'soft_deleted') continue;

      // Get all unread messages from this character
      const unreadMessages = await base44.entities.Message.filter({
        character_id: char.id,
        sender_type: 'character',
        is_read: false,
      });

      if (unreadMessages.length === 0) continue;

      // For each unread message, classify it
      const classifiedMessages = [];
      let buggyBadgeCount = 0; // what CharacterCard currently shows on CHAT badge (the bug)
      let correctDirectChatCount = 0;
      let worldPhoneCount = 0;
      let textMessageCount = 0;
      let worldContactCount = 0;
      let orphanedCount = 0;
      let unknownCount = 0;

      for (const msg of unreadMessages) {
        const convo = convoMap[msg.conversation_id];

        let classification = 'unknown';
        let convoType = null;
        let convoChannel = null;
        let convoTitle = null;

        if (!convo) {
          classification = 'orphaned_message';
          orphanedCount++;
        } else {
          convoType = convo.type;
          convoChannel = convo.channel;
          convoTitle = convo.title;

          // Classification logic — channel takes priority
          if (convoChannel === 'world_phone') {
            classification = 'world_phone';
            worldPhoneCount++;
          } else if (convoType === 'npc') {
            classification = 'world_contact';
            worldContactCount++;
          } else if (convoType === 'direct') {
            classification = 'direct_chat';
            correctDirectChatCount++;
          } else if (convoType === 'phone') {
            classification = 'text_message';
            textMessageCount++;
          } else {
            classification = 'unknown';
            unknownCount++;
          }

          // BUG SIMULATION: replicate current CharacterCard logic
          // directIds = conversations where type === "direct" (NO channel filter)
          // This means world_phone convos with type="direct" get counted as CHAT badge
          if (convoType === 'direct') {
            buggyBadgeCount++; // This is what currently shows on the red Chat badge — INCLUDING world_phone
          }
        }

        classifiedMessages.push({
          message_id: msg.id,
          conversation_id: msg.conversation_id,
          conversation_type: convoType,
          conversation_channel: convoChannel,
          conversation_title: convoTitle,
          message_content_preview: (msg.content || '').substring(0, 60),
          sender_character_id: msg.sender_character_id || msg.character_id,
          sender_type: msg.sender_type,
          is_read: msg.is_read,
          classification,
          // Is this message being incorrectly shown as a red Chat badge?
          incorrectly_counted_as_chat: (classification === 'world_phone' || classification === 'world_contact') && convoType === 'direct',
        });
      }

      diagnosticByCharacter.push({
        character_name: char.name,
        character_id: char.id,
        character_type: char.character_type || 'missing_type_legacy',
        total_unread_messages: unreadMessages.length,
        // CURRENT BUG: what CharacterCard shows on red Chat badge
        current_buggy_chat_badge: buggyBadgeCount,
        // CORRECT VALUES AFTER FIX
        correct_direct_chat_badge: correctDirectChatCount,
        correct_world_phone_badge: worldPhoneCount + worldContactCount, // these go green
        correct_text_badge: textMessageCount,
        orphaned_messages: orphanedCount,
        unknown_messages: unknownCount,
        has_incorrect_badge: buggyBadgeCount !== correctDirectChatCount,
        world_phone_leaking_into_chat_badge: worldPhoneCount > 0 && buggyBadgeCount > correctDirectChatCount,
        classified_messages: classifiedMessages,
      });
    }

    // Summary across all characters
    const summary = {
      total_characters_with_unread: diagnosticByCharacter.length,
      characters_with_incorrect_badge: diagnosticByCharacter.filter(c => c.has_incorrect_badge).length,
      characters_where_world_phone_leaks_into_chat: diagnosticByCharacter.filter(c => c.world_phone_leaking_into_chat_badge).length,
      total_world_phone_messages_in_wrong_badge: diagnosticByCharacter.reduce((acc, c) => acc + (c.world_phone_leaking_into_chat_badge ? c.correct_world_phone_badge : 0), 0),
      root_cause_confirmed: diagnosticByCharacter.some(c => c.world_phone_leaking_into_chat_badge)
        ? 'CONFIRMED: world_phone conversations with type="direct" are being counted as red Chat badges. The CharacterCard countUnread function uses c.type==="direct" without filtering c.channel!="world_phone".'
        : 'No world_phone leak detected — check orphaned or unknown messages',
    };

    return Response.json({
      owner_email: ownerEmail,
      summary,
      by_character: diagnosticByCharacter,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});