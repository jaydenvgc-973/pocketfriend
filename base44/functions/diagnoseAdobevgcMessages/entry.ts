/**
 * diagnoseAdobevgcMessages
 * Traces the 66 messages that reference the 3 deleted character IDs.
 * Finds which conversations they belong to, and who owns those conversations.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const REFERENCED_CHAR_IDS = [
  '69dfcd6c96f06a0babbef844', // Chris Brown
  '69e1cbaf2dae540ad7f9042a', // Alden Spencer  
  '69f4a5447df393b107a193dc', // Jesse Arden
];

const TARGET_EMAIL = 'adobevgc@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all messages referencing the 3 deleted character IDs
    const allMsgs = await base44.asServiceRole.entities.Message.list('-created_date', 2000);
    const orphanedMsgs = allMsgs.filter(m => REFERENCED_CHAR_IDS.includes(m.character_id));

    // Group by conversation_id
    const byConvo = {};
    for (const m of orphanedMsgs) {
      if (!byConvo[m.conversation_id]) byConvo[m.conversation_id] = [];
      byConvo[m.conversation_id].push(m);
    }

    // Look up the conversations these messages belong to
    const convoDetails = [];
    for (const [convoId, msgs] of Object.entries(byConvo)) {
      const convos = await base44.asServiceRole.entities.Conversation.filter({ id: convoId }, '-created_date', 1);
      const convo = convos[0];
      convoDetails.push({
        conversation_id: convoId,
        conversation_owner_email: convo?.owner_email || 'NOT FOUND',
        conversation_title: convo?.title || 'NOT FOUND',
        conversation_char_ids: convo?.character_ids || [],
        message_count: msgs.length,
        char_ids_in_messages: [...new Set(msgs.map(m => m.character_id))],
        sample_messages: msgs.slice(0, 3).map(m => ({
          id: m.id,
          sender_type: m.sender_type,
          character_name: m.character_name,
          character_id: m.character_id,
          content_preview: (m.content || '').substring(0, 80),
          timestamp: m.timestamp,
        })),
      });
    }

    // KEY QUESTION: Are any of these messages/conversations owned by adobevgc?
    const adobeOwnedConvos = convoDetails.filter(c => c.conversation_owner_email === TARGET_EMAIL);
    const otherOwnedConvos = convoDetails.filter(c => c.conversation_owner_email !== TARGET_EMAIL);

    // What about the 3 empty adobevgc conversations?
    // They reference the same char IDs but have 0 messages.
    // The 66 messages are in DIFFERENT conversations?
    const adobeConvoIds = new Set([
      '69f7ff2747c034dc29cfbf4e',
      '69f7ff1e5ffd6ee041afc542',
      '69f7ff1154ccefa02a254dae',
    ]);
    const msgsInAdobeConvos = orphanedMsgs.filter(m => adobeConvoIds.has(m.conversation_id));
    const msgsInOtherConvos = orphanedMsgs.filter(m => !adobeConvoIds.has(m.conversation_id));

    return Response.json({
      success: true,
      total_orphaned_messages: orphanedMsgs.length,
      messages_in_adobevgc_empty_convos: msgsInAdobeConvos.length,
      messages_in_other_convos: msgsInOtherConvos.length,
      breakdown_by_conversation: convoDetails,
      adobe_owned_convos_with_messages: adobeOwnedConvos.length,
      other_owned_convos_with_messages: otherOwnedConvos.length,
      conclusion: msgsInAdobeConvos.length === 0
        ? `The 66 messages are in conversations NOT owned by adobevgc. The adobevgc conversations are genuinely empty. The 3 characters (Chris Brown, Alden Spencer, Jesse Arden) were deleted from the DB — conversations remain but have no characters and no messages. This is a data state issue.`
        : `${msgsInAdobeConvos.length} messages ARE in adobevgc conversations but are not loading. Investigate why.`,
    });

  } catch (error) {
    console.error('[diagnoseAdobevgcMessages] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});