/**
 * diagnoseAdobevgcOrphansFull
 * Gets complete list of orphaned conversations (no owner_email) for adobevgc chars.
 * Used to verify exactly what needs to be fixed before any write operation.
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

    const allConvos = await base44.asServiceRole.entities.Conversation.list('-created_date', 500);
    const relevantConvos = allConvos.filter(c =>
      (c.character_ids || []).some(id => REFERENCED_CHAR_IDS.includes(id))
    );

    const orphans = relevantConvos.filter(c => !c.owner_email);

    const results = [];
    for (const convo of orphans) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 500
      );
      results.push({
        convo_id: convo.id,
        title: convo.title,
        type: convo.type,
        character_ids: convo.character_ids,
        current_owner_email: convo.owner_email || null,
        message_count: msgs.length,
        created_date: convo.created_date,
        last_message_date: convo.last_message_date,
      });
    }

    // Also check what the 3 "duplicate" adobevgc convos (the empty shells) are
    const adobeConvos = relevantConvos.filter(c => c.owner_email === TARGET_EMAIL);

    return Response.json({
      success: true,
      orphaned_convos: results,
      adobevgc_shell_convos: adobeConvos.map(c => ({
        id: c.id,
        title: c.title,
        type: c.type,
        character_ids: c.character_ids,
        last_message_date: c.last_message_date,
      })),
      total_orphaned: results.length,
      total_orphaned_messages: results.reduce((sum, r) => sum + r.message_count, 0),
      fix_plan: results.map(r => ({
        action: 'SET owner_email = adobevgc@gmail.com',
        convo_id: r.convo_id,
        title: r.title,
        messages_that_will_become_visible: r.message_count,
      })),
    });

  } catch (error) {
    console.error('[diagnoseAdobevgcOrphansFull] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});