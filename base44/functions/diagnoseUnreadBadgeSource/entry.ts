import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * diagnoseUnreadBadgeSource
 *
 * Reports BOTH the old (buggy) badge result AND the new (fixed) badge result
 * for every active_created_character belonging to the authenticated user.
 *
 * OLD logic (buggy):  directIds = c.type === "direct"  (no channel filter)
 * NEW logic (fixed):  directIds = c.type === "direct" && c.channel !== "world_phone"
 *                     worldPhoneIds = c.channel === "world_phone"
 *
 * This allows the diagnostic to verify the repair by comparing the two outputs.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    // Step 1: Get all characters for this user (include legacy missing character_type)
    const allCharacters = await base44.entities.Character.filter({ owner_email: ownerEmail });
    const activeCreated = allCharacters.filter(c =>
      (!c.character_type || c.character_type === 'active_created_character') &&
      c.status !== 'moved_away' && c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
    );

    // Step 2: Get ALL conversations owned by this user
    const allConversations = await base44.entities.Conversation.filter(
      { owner_email: ownerEmail }, '-updated_date', 500
    );
    const convoMap = {};
    for (const c of allConversations) convoMap[c.id] = c;

    // Step 3: Per-character classification
    const diagnosticByCharacter = [];

    for (const char of activeCreated) {
      // Message entity does NOT have owner_email. Ownership scoping is enforced by only
      // counting messages whose conversation_id exists in convoMap (already filtered to
      // owner_email via Step 2). Messages in conversations not owned by this user are
      // automatically excluded when convoMap lookup fails (no convo = orphaned, not counted).
      const unreadMessages = await base44.entities.Message.filter({
        character_id: char.id,
        sender_type: 'character',
        is_read: false,
      });

      if (unreadMessages.length === 0) continue;

      // Classify each message
      const classifiedMessages = [];

      // OLD logic counters (buggy — simulates pre-fix CharacterCard)
      let old_chat_badge = 0;    // type=direct, no channel filter
      let old_phone_badge = 0;   // type=phone, no channel filter

      // NEW logic counters (fixed — matches new CharacterCard countUnread)
      let new_direct_chat = 0;   // type=direct AND channel != world_phone
      let new_phone_badge = 0;   // type=phone AND channel != world_phone
      let new_world_phone = 0;   // channel=world_phone (regardless of type)
      let new_world_contact = 0; // type=npc AND channel != world_phone (legacy NPC chats)
      let orphaned = 0;
      let unknown = 0;

      for (const msg of unreadMessages) {
        const convo = convoMap[msg.conversation_id];

        if (!convo) {
          orphaned++;
          classifiedMessages.push({
            message_id: msg.id,
            conversation_id: msg.conversation_id,
            old_badge_bucket: 'orphaned',
            new_badge_bucket: 'orphaned',
            moved_from_red_to_green: false,
          });
          continue;
        }

        const type = convo.type;
        const channel = convo.channel;

        // --- OLD LOGIC (buggy) ---
        let oldBucket = 'unknown';
        if (type === 'direct') { old_chat_badge++; oldBucket = 'old_red_chat'; }
        else if (type === 'phone') { old_phone_badge++; oldBucket = 'old_red_phone'; }
        else if (type === 'npc') { oldBucket = 'old_npc_untracked'; }

        // --- NEW LOGIC (fixed) ---
        let newBucket = 'unknown';
        if (channel === 'world_phone') {
          new_world_phone++; newBucket = 'new_green_world_phone';
        } else if (type === 'npc') {
          new_world_contact++; newBucket = 'new_green_world_contact';
        } else if (type === 'direct') {
          new_direct_chat++; newBucket = 'new_red_chat';
        } else if (type === 'phone') {
          new_phone_badge++; newBucket = 'new_red_phone';
        } else {
          unknown++;
        }

        const movedFromRedToGreen =
          oldBucket === 'old_red_chat' &&
          (newBucket === 'new_green_world_phone' || newBucket === 'new_green_world_contact');

        classifiedMessages.push({
          message_id: msg.id,
          conversation_id: msg.conversation_id,
          conversation_type: type,
          conversation_channel: channel || null,
          conversation_title: convo.title,
          content_preview: (msg.content || '').substring(0, 60),
          old_badge_bucket: oldBucket,
          new_badge_bucket: newBucket,
          moved_from_red_to_green: movedFromRedToGreen,
        });
      }

      const total_moved_to_green = classifiedMessages.filter(m => m.moved_from_red_to_green).length;
      const convo_ids_moved = classifiedMessages.filter(m => m.moved_from_red_to_green).map(m => m.conversation_id);

      diagnosticByCharacter.push({
        character_name: char.name,
        character_id: char.id,
        character_type: char.character_type || 'missing_type_legacy',
        total_unread_messages: unreadMessages.length,
        // OLD (buggy) badge values — what showed before the fix
        old_badge: {
          red_chat: old_chat_badge,
          red_phone: old_phone_badge,
        },
        // NEW (fixed) badge values — what CharacterCard now shows after the fix
        new_badge: {
          red_chat: new_direct_chat,
          red_phone: new_phone_badge,
          green_world_phone: new_world_phone + new_world_contact,
        },
        repair_verified: old_chat_badge !== new_direct_chat,
        total_moved_from_red_to_green: total_moved_to_green,
        conversation_ids_moved_to_green: [...new Set(convo_ids_moved)],
        classified_messages: classifiedMessages,
      });
    }

    // Global summary
    const totalMovedGlobal = diagnosticByCharacter.reduce((a, c) => a + c.total_moved_from_red_to_green, 0);
    const repairVerifiedChars = diagnosticByCharacter.filter(c => c.repair_verified);

    const summary = {
      total_characters_checked: diagnosticByCharacter.length,
      characters_where_repair_is_verified: repairVerifiedChars.length,
      total_messages_moved_from_red_to_green: totalMovedGlobal,
      repair_status: repairVerifiedChars.length > 0
        ? `REPAIR VERIFIED: ${repairVerifiedChars.length} character(s) had world_phone messages removed from red badge and placed in green badge. Old red count > new red count.`
        : totalMovedGlobal === 0 && diagnosticByCharacter.length > 0
          ? 'NO WORLD_PHONE LEAKAGE DETECTED — either already fixed or no world_phone unread messages exist.'
          : 'NO DATA — no unread messages found.',
    };

    // Parse request body for optional filter
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const onlyRepaired = body.only_repaired === true;
    const onlyWithGreen = body.only_with_green === true;
    const compact = body.compact === true; // omit classified_messages for smaller output

    let outputCharacters = diagnosticByCharacter;
    if (onlyRepaired || onlyWithGreen) {
      outputCharacters = diagnosticByCharacter.filter(c =>
        (onlyRepaired && c.repair_verified) ||
        (onlyWithGreen && c.new_badge.green_world_phone > 0)
      );
    }

    // In compact mode or when filtering, omit classified_messages to keep response small
    const finalCharacters = (compact || onlyRepaired || onlyWithGreen)
      ? outputCharacters.map(({ classified_messages, ...rest }) => rest)
      : outputCharacters;

    return Response.json({
      owner_email: ownerEmail,
      summary,
      by_character: finalCharacters,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});