/**
 * testWorldPhoneRecordsProof
 *
 * Non-destructive diagnostic: queries actual database records to prove
 * World Phone exchange created real records, not just dialogue.
 *
 * Returns proof data for verification.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { sender_character_id, recipient_character_id } = await req.json();

    if (!sender_character_id || !recipient_character_id) {
      return Response.json({
        error: 'Missing sender_character_id or recipient_character_id'
      });
    }

    // Load both characters
    const [senderArr, recipientArr] = await Promise.all([
      base44.entities.Character.filter({ id: sender_character_id }, null, 1),
      base44.entities.Character.filter({ id: recipient_character_id }, null, 1),
    ]);

    const sender = senderArr?.[0];
    const recipient = recipientArr?.[0];

    if (!sender || !recipient) {
      return Response.json({
        error: `Character(s) not found: sender=${!!sender}, recipient=${!!recipient}`
      });
    }

    // Build canonical key
    const sortedIds = [sender_character_id, recipient_character_id].sort();
    const canonicalKey = `world_phone::${sortedIds[0]}::${sortedIds[1]}`;
    const participantIds = sortedIds;

    console.log(`[TEST] Looking for World Phone records: key=${canonicalKey}`);

    // 1. Find Conversation
    const convos = await base44.entities.Conversation.filter({
      shared_conversation_key: canonicalKey,
      channel: 'world_phone'
    }, '-created_date', 5);

    const conversation = convos?.[0];
    if (!conversation) {
      return Response.json({
        success: false,
        error: 'No World Phone Conversation found',
        searched: { shared_conversation_key: canonicalKey, channel: 'world_phone' }
      });
    }

    console.log(`[TEST] ✓ Conversation found: ${conversation.id}`);

    // 2. Find outgoing message (sender → recipient)
    const outgoing = await base44.entities.Message.filter({
      conversation_id: conversation.id,
      sender_character_id: sender_character_id,
      receiver_character_id: recipient_character_id,
      channel: 'world_phone'
    }, '-created_date', 1);

    const outgoingMsg = outgoing?.[0];
    if (!outgoingMsg) {
      return Response.json({
        success: false,
        error: 'No outgoing World Phone message found',
        conversation_id: conversation.id
      });
    }

    console.log(`[TEST] ✓ Outgoing message found: ${outgoingMsg.id}`);

    // 3. Find incoming response (recipient → sender)
    const incoming = await base44.entities.Message.filter({
      conversation_id: conversation.id,
      sender_character_id: recipient_character_id,
      receiver_character_id: sender_character_id,
      channel: 'world_phone'
    }, '-created_date', 1);

    const incomingMsg = incoming?.[0];
    if (!incomingMsg) {
      return Response.json({
        success: false,
        error: 'No incoming/response World Phone message found',
        conversation_id: conversation.id
      });
    }

    console.log(`[TEST] ✓ Incoming response found: ${incomingMsg.id}`);

    // 4. Check bilateral memory
    const senderMems = await base44.entities.CharacterMemory.filter({
      character_id: sender_character_id,
      related_character_id: recipient_character_id
    }, '-created_date', 5);

    const recipientMems = await base44.entities.CharacterMemory.filter({
      character_id: recipient_character_id,
      related_character_id: sender_character_id
    }, '-created_date', 5);

    const senderWorldPhoneMem = senderMems?.find(m => m.memory_text?.includes('world_phone') || m.memory_type === 'event');
    const recipientWorldPhoneMem = recipientMems?.find(m => m.memory_text?.includes('world_phone') || m.memory_type === 'event');

    console.log(`[TEST] ✓ Bilateral memory: sender=${!!senderWorldPhoneMem}, recipient=${!!recipientWorldPhoneMem}`);

    // 5. Verify no duplicate People-in-World
    const senderWorldContacts = await base44.entities.CasualContact.filter({
      character_id: sender_character_id,
      contact_character_id: recipient_character_id
    }, null, 1);

    const duplicates = senderWorldContacts?.length > 1;

    return Response.json({
      success: true,
      proof: {
        conversation: {
          id: conversation.id,
          shared_conversation_key: conversation.shared_conversation_key,
          participant_character_ids: conversation.participant_character_ids,
          channel: conversation.channel,
          owner_email: conversation.owner_email,
          world_contact_mode: conversation.world_contact_mode
        },
        outgoing_message: {
          id: outgoingMsg.id,
          sender_character_id: outgoingMsg.sender_character_id,
          receiver_character_id: outgoingMsg.receiver_character_id,
          content: outgoingMsg.content?.substring(0, 100),
          timestamp: outgoingMsg.timestamp,
          channel: outgoingMsg.channel
        },
        incoming_response: {
          id: incomingMsg.id,
          sender_character_id: incomingMsg.sender_character_id,
          receiver_character_id: incomingMsg.receiver_character_id,
          content: incomingMsg.content?.substring(0, 100),
          timestamp: incomingMsg.timestamp,
          channel: incomingMsg.channel,
          is_reply_to: incomingMsg.reply_to_message_id === outgoingMsg.id
        },
        bilateral_memory: {
          sender_has_memory: !!senderWorldPhoneMem,
          recipient_has_memory: !!recipientWorldPhoneMem
        },
        duplicate_contacts: duplicates,
        contact_count: senderWorldContacts?.length || 0
      }
    });

  } catch (error) {
    console.error('[testWorldPhoneRecordsProof]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});