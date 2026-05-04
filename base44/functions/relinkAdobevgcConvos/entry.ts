/**
 * relinkAdobevgcConvos
 * Updates conversation character_ids to point to the new restored character IDs.
 * Old IDs no longer exist — new IDs are the restored characters.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';

// Map: old deleted ID -> new restored character ID
const ID_MAP = {
  '69dfcd6c96f06a0babbef844': '69f8023777fab6817ae006cb', // Chris Brown old -> new
  '69e1cbaf2dae540ad7f9042a': '69f80267ccf02af717b60524', // Alden Spencer old -> new (already done for some)
  '69f4a5447df393b107a193dc': '69f8023c21e4307953d905c7', // Jesse Arden old -> new
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const report = { fixed: [], skipped: [], errors: [] };

    // Get all conversations for adobevgc
    const allConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );

    // Get all valid character IDs
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );
    const validIds = new Set(allChars.map(c => c.id));

    for (const convo of allConvos) {
      const currentIds = convo.character_ids || [];
      const hasInvalid = currentIds.some(id => !validIds.has(id));
      if (!hasInvalid) {
        report.skipped.push({ convo_id: convo.id, title: convo.title, reason: 'all_ids_valid' });
        continue;
      }

      const newIds = currentIds.map(id => {
        if (validIds.has(id)) return id; // already valid
        if (ID_MAP[id]) return ID_MAP[id]; // remap to new ID
        return id; // unknown — leave as is
      });

      try {
        await base44.asServiceRole.entities.Conversation.update(convo.id, {
          character_ids: newIds,
        });
        report.fixed.push({
          convo_id: convo.id,
          title: convo.title,
          old_char_ids: currentIds,
          new_char_ids: newIds,
        });
      } catch (e) {
        report.errors.push(`Failed to update convo ${convo.id}: ${e.message}`);
      }
    }

    // Final verification
    const freshConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );
    const allValid = freshConvos.every(c =>
      (c.character_ids || []).every(id => validIds.has(id))
    );

    // Message count verification
    let totalMsgs = 0;
    for (const convo of freshConvos) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 500
      );
      totalMsgs += msgs.length;
    }

    return Response.json({
      success: true,
      report,
      verification: {
        total_convos: freshConvos.length,
        all_char_refs_valid: allValid,
        total_messages_visible: totalMsgs,
        chars: allChars.map(c => ({ id: c.id, name: c.name })),
        convos: freshConvos.map(c => ({
          id: c.id, title: c.title, type: c.type, character_ids: c.character_ids,
          ids_valid: (c.character_ids || []).every(id => validIds.has(id)),
        })),
      },
    });

  } catch (error) {
    console.error('[relinkAdobevgcConvos] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});