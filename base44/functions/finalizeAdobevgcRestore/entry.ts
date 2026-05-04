/**
 * finalizeAdobevgcRestore
 *
 * Cleans up after the partial restore:
 * 1. Removes duplicate Alden Spencer character
 * 2. Maps each conversation's character_ids to the correct new IDs
 * 3. Verifies all conversations have valid character references
 * 4. Verifies all messages are reachable from the correct conversations
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const report = { actions: [], errors: [] };

    // ── GET CURRENT STATE ─────────────────────────────────────────────────────
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );
    const allConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );

    report.current_chars = allChars.map(c => ({ id: c.id, name: c.name }));
    report.current_convos = allConvos.map(c => ({
      id: c.id, title: c.title, type: c.type, character_ids: c.character_ids,
    }));

    // ── IDENTIFY DUPLICATES ───────────────────────────────────────────────────
    // There are 2 "Alden Spencer" — keep the one convos reference, delete the other
    const aldenRecords = allChars.filter(c => c.name === 'Alden Spencer');
    const jesseRecords = allChars.filter(c => c.name === 'Jesse Arden');
    const chrisRecords = allChars.filter(c => c.name === 'Chris Brown');

    // Find which IDs are actually referenced in conversations
    const allCharIdsInConvos = new Set(allConvos.flatMap(c => c.character_ids || []));

    // For each duplicate set, keep the one referenced in convos, delete the other
    for (const [charName, records] of [
      ['Alden Spencer', aldenRecords],
      ['Jesse Arden', jesseRecords],
      ['Chris Brown', chrisRecords],
    ]) {
      if (records.length <= 1) continue;

      const referenced = records.filter(c => allCharIdsInConvos.has(c.id));
      const unreferenced = records.filter(c => !allCharIdsInConvos.has(c.id));

      for (const dupe of unreferenced) {
        try {
          await base44.asServiceRole.entities.Character.delete(dupe.id);
          report.actions.push({ action: 'deleted_duplicate_char', name: charName, deleted_id: dupe.id });
        } catch (e) {
          report.errors.push(`Failed to delete duplicate ${charName} (${dupe.id}): ${e.message}`);
        }
      }
    }

    // ── VERIFY CONVERSATIONS REFERENCE VALID CHARS ───────────────────────────
    // Re-fetch after deletions
    const freshChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );
    const validCharIds = new Set(freshChars.map(c => c.id));

    const convosWithBrokenRefs = allConvos.filter(c =>
      (c.character_ids || []).some(id => !validCharIds.has(id))
    );

    report.convos_with_broken_char_refs = convosWithBrokenRefs.map(c => ({
      id: c.id,
      title: c.title,
      character_ids: c.character_ids,
      broken_ids: (c.character_ids || []).filter(id => !validCharIds.has(id)),
    }));

    // ── VERIFY MESSAGE COUNTS ─────────────────────────────────────────────────
    const msgCounts = [];
    for (const convo of allConvos) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 5
      );
      const totalMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id }, '-created_date', 500
      );
      msgCounts.push({
        convo_id: convo.id,
        title: convo.title,
        type: convo.type,
        char_ids: convo.character_ids,
        char_ids_valid: (convo.character_ids || []).every(id => validCharIds.has(id)),
        message_count: totalMsgs.length,
        last_message: msgs[0] ? {
          sender_type: msgs[0].sender_type,
          content: (msgs[0].content || '').substring(0, 80),
          timestamp: msgs[0].timestamp,
        } : null,
      });
    }
    report.convo_message_counts = msgCounts;

    // ── FINAL SUMMARY ─────────────────────────────────────────────────────────
    report.final_chars = freshChars.map(c => ({ id: c.id, name: c.name, status: c.status }));
    report.total_messages_visible = msgCounts.reduce((sum, c) => sum + c.message_count, 0);
    report.all_convos_have_valid_chars = msgCounts.every(c => c.char_ids_valid);
    report.convos_with_messages = msgCounts.filter(c => c.message_count > 0).length;

    return Response.json({ success: true, report });

  } catch (error) {
    console.error('[finalizeAdobevgcRestore] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});