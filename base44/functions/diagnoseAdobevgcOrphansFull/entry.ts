/**
 * diagnoseAdobevgcOrphansFull
 *
 * Strict read-only service-role diagnostic for adobevgc@gmail.com.
 * No writes. No migrations. No ownership assignments.
 *
 * Returns:
 * 1. Characters with owner_email = adobevgc@gmail.com
 * 2. Conversations with owner_email = adobevgc@gmail.com
 * 3. Messages inside those conversations
 * 4. Whether conversation character_ids point to existing Character records
 * 5. Characters with NO owner_email (reported only, not assigned)
 * 6. Messages for referenced missing character_ids
 * 7. Legacy conversations using name-based titles or old character ids
 * 8. Whether empty conversations were created today (loader artifacts)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';
const TODAY = new Date().toISOString().split('T')[0]; // 2025-05-04

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Characters with owner_email = adobevgc@gmail.com
    // ─────────────────────────────────────────────────────────────────────────
    const ownedChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 200
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Conversations with owner_email = adobevgc@gmail.com
    // ─────────────────────────────────────────────────────────────────────────
    const ownedConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 200
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Messages inside those conversations
    // ─────────────────────────────────────────────────────────────────────────
    const convoMessageCounts = [];
    let totalMessages = 0;
    for (const convo of ownedConvos) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 500
      );
      totalMessages += msgs.length;
      convoMessageCounts.push({
        convo_id: convo.id,
        title: convo.title,
        type: convo.type,
        character_ids: convo.character_ids,
        message_count: msgs.length,
        created_date: convo.created_date,
        last_message_date: convo.last_message_date,
        owner_email: convo.owner_email,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Whether conversation character_ids point to existing Character records
    // ─────────────────────────────────────────────────────────────────────────
    const ownedCharIds = new Set(ownedChars.map(c => c.id));
    // Collect ALL unique character_ids referenced across owned conversations
    const allReferencedCharIds = new Set(
      ownedConvos.flatMap(c => c.character_ids || [])
    );

    const charIdResolution = [];
    for (const charId of allReferencedCharIds) {
      const found = ownedChars.find(c => c.id === charId);
      // If not in owned chars, do a direct lookup
      let directLookup = null;
      if (!found) {
        const results = await base44.asServiceRole.entities.Character.filter(
          { id: charId }, '-created_date', 1
        );
        directLookup = results[0] || null;
      }
      charIdResolution.push({
        char_id: charId,
        exists_in_owned_chars: !!found,
        owned_char_name: found?.name || null,
        found_globally: !!directLookup,
        global_record_owner_email: directLookup?.owner_email || null,
        global_record_name: directLookup?.name || null,
      });
    }

    const brokenConvos = ownedConvos.filter(c =>
      (c.character_ids || []).some(id => !ownedCharIds.has(id))
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Characters with NO owner_email (global scan — reported only)
    // ─────────────────────────────────────────────────────────────────────────
    // Fetch a broad set and filter for missing owner_email
    const allCharsNoOwner = await base44.asServiceRole.entities.Character.filter(
      {}, '-created_date', 500
    );
    const noOwnerChars = allCharsNoOwner.filter(
      c => !c.owner_email || c.owner_email.trim() === ''
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Messages for referenced missing character_ids
    // ─────────────────────────────────────────────────────────────────────────
    // For each character_id that doesn't exist in owned chars,
    // check if there are any messages with that character_id anywhere
    const missingCharIds = charIdResolution
      .filter(r => !r.exists_in_owned_chars)
      .map(r => r.char_id);

    const orphanMessageData = [];
    for (const missingId of missingCharIds) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { character_id: missingId }, '-created_date', 20
      );
      orphanMessageData.push({
        missing_char_id: missingId,
        message_count: msgs.length,
        sample_messages: msgs.slice(0, 3).map(m => ({
          id: m.id,
          conversation_id: m.conversation_id,
          sender_type: m.sender_type,
          content: (m.content || '').substring(0, 80),
          timestamp: m.timestamp,
        })),
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Legacy conversations — name-based titles or old char ids
    // ─────────────────────────────────────────────────────────────────────────
    const legacyPatternTitles = ownedConvos.filter(c =>
      /^(npc_chat__|Chat with |Text with |direct with |phone with )/i.test(c.title || '')
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Empty conversations created today (loader artifacts)
    // ─────────────────────────────────────────────────────────────────────────
    const emptyConvosCreatedToday = convoMessageCounts.filter(c => {
      const createdToday = c.created_date && c.created_date.startsWith(TODAY);
      return c.message_count === 0 && createdToday;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────────
    return Response.json({
      success: true,
      diagnostic_target: TARGET_EMAIL,
      diagnostic_date: TODAY,

      // 1
      owned_characters: {
        total: ownedChars.length,
        records: ownedChars.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          character_type: c.character_type,
          owner_email: c.owner_email,
        })),
      },

      // 2
      owned_conversations: {
        total: ownedConvos.length,
        detail: convoMessageCounts,
      },

      // 3
      total_messages_in_owned_convos: totalMessages,

      // 4
      character_id_resolution: {
        all_resolved: charIdResolution.every(r => r.exists_in_owned_chars),
        resolution: charIdResolution,
        broken_conversations: brokenConvos.map(c => ({
          id: c.id,
          title: c.title,
          character_ids: c.character_ids,
          broken_ids: (c.character_ids || []).filter(id => !ownedCharIds.has(id)),
        })),
      },

      // 5
      no_owner_email_chars: {
        total: noOwnerChars.length,
        records: noOwnerChars.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          character_type: c.character_type,
          owner_email: c.owner_email || null,
        })),
      },

      // 6
      orphan_message_data: orphanMessageData,

      // 7
      legacy_titled_conversations: {
        total: legacyPatternTitles.length,
        records: legacyPatternTitles.map(c => ({
          id: c.id,
          title: c.title,
          type: c.type,
          character_ids: c.character_ids,
          message_count: convoMessageCounts.find(m => m.convo_id === c.id)?.message_count ?? null,
        })),
      },

      // 8
      empty_convos_created_today: {
        total: emptyConvosCreatedToday.length,
        records: emptyConvosCreatedToday,
        interpretation: emptyConvosCreatedToday.length > 0
          ? 'LIKELY CHAT LOADER ARTIFACTS — created today with 0 messages'
          : 'none found',
      },
    });

  } catch (error) {
    console.error('[diagnoseAdobevgcOrphansFull] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});