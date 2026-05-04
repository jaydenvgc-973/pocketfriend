/**
 * diagnoseAdobevgcOrphans
 * Examines the REAL conversations (the ones with messages) that belong to
 * Chris Brown, Alden Spencer, Jesse Arden — and determines their true ownership.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const REAL_CONVO_IDS = [
  '69f4a5449c8a6cadc6050c05', // Chat with Jesse Arden — 19 msgs
  '69e1d087f7d7d28359a14af1', // direct with Alden Spencer — 88 msgs
  // Chris Brown convo id unknown — need to find it
];

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

    // Get ALL conversations in the DB
    const allConvos = await base44.asServiceRole.entities.Conversation.list('-created_date', 500);

    // Find all conversations that reference the 3 deleted character IDs
    const convosByCharId = allConvos.filter(c =>
      (c.character_ids || []).some(id => REFERENCED_CHAR_IDS.includes(id))
    );

    // Full details on each — including raw DB fields
    const convoReport = convosByCharId.map(c => ({
      id: c.id,
      title: c.title,
      type: c.type,
      character_ids: c.character_ids,
      owner_email: c.owner_email || 'MISSING',
      last_message_date: c.last_message_date,
      last_message_preview: c.last_message_preview,
      created_date: c.created_date,
    }));

    // Separate: which have owner_email set vs missing
    const withOwner = convosByCharId.filter(c => !!c.owner_email);
    const withoutOwner = convosByCharId.filter(c => !c.owner_email);

    // For conversations WITHOUT owner_email, check message count
    const orphanDetails = [];
    for (const convo of withoutOwner) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 5
      );
      const totalMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 500
      );
      orphanDetails.push({
        convo_id: convo.id,
        title: convo.title,
        type: convo.type,
        character_ids: convo.character_ids,
        owner_email: convo.owner_email || 'MISSING',
        message_count: totalMsgs.length,
        last_message_date: convo.last_message_date,
        created_date: convo.created_date,
        sample: msgs.slice(0, 2).map(m => ({
          sender_type: m.sender_type,
          character_name: m.character_name,
          content: (m.content || '').substring(0, 80),
          timestamp: m.timestamp,
        })),
      });
    }

    // What useChatLoadConvo does: filter conversations by owner_email
    // If owner_email is MISSING from these real convos, they will NEVER appear
    // when the adobevgc user opens their Chat page
    const summary = {
      total_convos_referencing_these_chars: convosByCharId.length,
      with_owner_email_set: withOwner.length,
      without_owner_email: withoutOwner.length,
      adobevgc_owned_convos: convosByCharId.filter(c => c.owner_email === TARGET_EMAIL).length,
    };

    const conclusions = [];
    if (withoutOwner.length > 0) {
      conclusions.push(`ROOT CAUSE CONFIRMED: ${withoutOwner.length} conversation(s) with real message history have NO owner_email. useChatLoadConvo filters by owner_email — these conversations are INVISIBLE to adobevgc's UI. The chat page creates new empty conversations instead of finding these real ones.`);
      conclusions.push(`FIX REQUIRED: Set owner_email = "adobevgc@gmail.com" on the ${withoutOwner.length} orphaned conversation(s). Also restore the 3 characters (Chris Brown, Alden Spencer, Jesse Arden) or ensure their IDs exist.`);
    }
    if (withOwner.filter(c => c.owner_email === TARGET_EMAIL).length > 0) {
      conclusions.push(`${withOwner.filter(c => c.owner_email === TARGET_EMAIL).length} conversation(s) already owned by adobevgc — but their characters are missing from DB.`);
    }

    return Response.json({
      success: true,
      summary,
      all_convos_for_these_chars: convoReport,
      orphaned_convos_full_detail: orphanDetails,
      root_cause_conclusions: conclusions,
    });

  } catch (error) {
    console.error('[diagnoseAdobevgcOrphans] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});