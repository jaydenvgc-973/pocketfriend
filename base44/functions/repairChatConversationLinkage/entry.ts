/**
 * REPAIR: Chat Conversation Linkage
 * 
 * Root cause: Conversation.filter({ owner_email, type, character_ids }) returns 0 results
 * even though 500+ messages exist for the character.
 * 
 * This means either:
 * 1. Conversation record has no/wrong owner_email
 * 2. Conversation record has wrong character_ids field
 * 3. Conversation record has wrong type field
 * 4. Messages exist but their conversation_id points to a different/orphaned conversation
 * 
 * This function diagnoses and optionally repairs the linkage without deleting any messages.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run !== false; // default dry_run = true for safety
    const target_character_id = body.character_id || null;
    const target_character_name = body.character_name || null;

    const report = {
      timestamp: new Date().toISOString(),
      user_email: user.email,
      dry_run,
      characters_checked: [],
      conversations_found: [],
      orphaned_conversations: [],
      conversations_needing_repair: [],
      repairs_applied: [],
    };

    // Get all characters (check Ethan first if specified, then others)
    const charFilter = target_character_id
      ? { id: target_character_id }
      : { owner_email: user.email };

    const chars = await base44.entities.Character.filter(charFilter, '-updated_date', 20);

    // Also check by name if provided
    let targetChars = chars;
    if (target_character_name && !target_character_id) {
      targetChars = chars.filter(c => 
        c.name?.toLowerCase().includes(target_character_name.toLowerCase())
      );
    }

    for (const char of targetChars) {
      console.log(`[repairChatConversationLinkage] Checking ${char.name} (${char.id})`);

      // QUERY 1: How the chat page finds conversations (the query that's failing)
      const convosViaOwnerEmail = await base44.entities.Conversation.filter(
        { owner_email: user.email, character_ids: char.id },
        '-last_message_date',
        50
      ).catch(() => []);

      // QUERY 2: Find ALL conversations for this character regardless of owner_email
      const convosViaCharId = await base44.asServiceRole.entities.Conversation.filter(
        { character_ids: char.id },
        '-last_message_date',
        50
      ).catch(() => []);

      // QUERY 3: Find messages for this character
      const recentMsgs = await base44.entities.Message.filter(
        { character_id: char.id },
        '-created_date',
        10
      ).catch(() => []);

      // QUERY 4: Find messages via service role (full scope)
      const allMsgs = await base44.asServiceRole.entities.Message.filter(
        { character_id: char.id },
        '-created_date',
        5
      ).catch(() => []);

      // Find unique conversation_ids in messages
      const msgConvoIds = [...new Set(recentMsgs.map(m => m.conversation_id).filter(Boolean))];
      const allMsgConvoIds = [...new Set(allMsgs.map(m => m.conversation_id).filter(Boolean))];

      const charReport = {
        character_id: char.id,
        character_name: char.name,
        sleep_debt_hours: char.sleep_debt_hours,
        resolved_presence_status: char.resolved_presence_status,
        // Query 1: What the chat page finds
        convos_via_owner_email_query: convosViaOwnerEmail.length,
        convos_via_owner_email_ids: convosViaOwnerEmail.map(c => ({
          id: c.id,
          type: c.type,
          owner_email: c.owner_email,
          character_ids: c.character_ids,
          shared_conversation_key: c.shared_conversation_key,
          channel: c.channel,
          last_message_date: c.last_message_date,
        })),
        // Query 2: All conversations regardless of owner
        convos_via_char_id_all: convosViaCharId.length,
        convos_via_char_id_owner_mismatch: convosViaCharId.filter(c => c.owner_email !== user.email).length,
        convos_via_char_id_all_ids: convosViaCharId.map(c => ({
          id: c.id,
          type: c.type,
          owner_email: c.owner_email,
          character_ids: c.character_ids,
          has_correct_owner: c.owner_email === user.email,
          last_message_date: c.last_message_date,
        })),
        // Messages
        messages_in_db: recentMsgs.length,
        message_convo_ids: msgConvoIds,
        all_msg_convo_ids: allMsgConvoIds,
        // Repair status
        needs_repair: false,
        repair_type: null,
      };

      // DIAGNOSIS
      if (convosViaOwnerEmail.length === 0 && convosViaCharId.length > 0) {
        // Conversations exist but are missing owner_email or have wrong owner_email
        const wrongOwnerConvos = convosViaCharId.filter(c => c.owner_email !== user.email);
        const missingOwnerConvos = convosViaCharId.filter(c => !c.owner_email);
        
        if (wrongOwnerConvos.length > 0 || missingOwnerConvos.length > 0) {
          charReport.needs_repair = true;
          charReport.repair_type = 'fix_conversation_owner_email';
          charReport.convos_to_repair = [...wrongOwnerConvos, ...missingOwnerConvos].map(c => c.id);
          report.conversations_needing_repair.push(charReport);
        }
      } else if (convosViaOwnerEmail.length === 0 && convosViaCharId.length === 0 && recentMsgs.length > 0) {
        // Messages exist but NO conversation found at all
        charReport.needs_repair = true;
        charReport.repair_type = 'missing_conversation_record';
        charReport.message_convo_ids_from_messages = msgConvoIds;
        report.orphaned_conversations.push(charReport);
      }

      report.characters_checked.push(charReport);
      report.conversations_found.push(...convosViaOwnerEmail.map(c => c.id));

      // REPAIR (if not dry_run)
      if (!dry_run && charReport.needs_repair) {
        if (charReport.repair_type === 'fix_conversation_owner_email') {
          for (const convoId of charReport.convos_to_repair) {
            try {
              await base44.asServiceRole.entities.Conversation.update(convoId, {
                owner_email: user.email,
              });
              report.repairs_applied.push({
                type: 'conversation_owner_email_fixed',
                conversation_id: convoId,
                character_id: char.id,
                character_name: char.name,
                set_owner_email: user.email,
              });
              console.log(`[repairChatConversationLinkage] Repaired conversation ${convoId} owner_email for ${char.name}`);
            } catch (err) {
              console.error(`[repairChatConversationLinkage] Failed to repair conversation ${convoId}: ${err.message}`);
              report.repairs_applied.push({
                type: 'conversation_owner_email_repair_failed',
                conversation_id: convoId,
                error: err.message,
              });
            }
          }
        } else if (charReport.repair_type === 'missing_conversation_record') {
          // Try to find the conversation via the message's conversation_id
          for (const msgConvoId of msgConvoIds) {
            try {
              const existing = await base44.asServiceRole.entities.Conversation.filter(
                { id: msgConvoId }
              ).catch(() => []);
              
              if (existing.length > 0 && existing[0].owner_email !== user.email) {
                // Conversation exists but wrong owner — fix it
                await base44.asServiceRole.entities.Conversation.update(msgConvoId, {
                  owner_email: user.email,
                  character_ids: [char.id],
                });
                report.repairs_applied.push({
                  type: 'conversation_ownership_repaired_via_message_id',
                  conversation_id: msgConvoId,
                  character_id: char.id,
                  character_name: char.name,
                });
              } else if (existing.length === 0) {
                // Conversation record is truly missing — this is data loss
                report.repairs_applied.push({
                  type: 'conversation_record_missing_cannot_auto_repair',
                  conversation_id: msgConvoId,
                  character_id: char.id,
                  character_name: char.name,
                  note: 'Messages reference this convo_id but no convo record found. Manual recovery needed.',
                });
              }
            } catch (err) {
              console.error(`[repairChatConversationLinkage] Error checking/repairing convo ${msgConvoId}: ${err.message}`);
            }
          }
        }
      }
    }

    return Response.json({
      success: true,
      dry_run,
      report,
      summary: {
        characters_checked: report.characters_checked.length,
        conversations_needing_repair: report.conversations_needing_repair.length,
        orphaned_conversations: report.orphaned_conversations.length,
        repairs_applied: report.repairs_applied.length,
        action_needed: report.conversations_needing_repair.length > 0 || report.orphaned_conversations.length > 0,
      },
    });
  } catch (error) {
    console.error('[repairChatConversationLinkage]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});