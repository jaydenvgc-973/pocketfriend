import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * triggerCharacterContact
 *
 * Called when the user tells Character A to contact Character B in Chat.
 * Creates a real World Phone thread + message + bilateral memory.
 *
 * Payload:
 *   senderCharacterId: string — Character A (the one the user is chatting with)
 *   receiverCharacterName: string — Character B's name (used to resolve their ID)
 *   topic: string — what the contact is about (from conversation context)
 *   messageContent: string (optional) — explicit message text; generated if absent
 *
 * Returns:
 *   { success, conversationId, messageId, senderName, receiverName, receiverResolved }
 */

// World Phone conversation title convention — mirrors WorldContactsPopup
function npcConvoTitle(ownerCharId, contactName, contactCharId) {
  if (contactCharId) return `npc_chat__${ownerCharId}__cid_${contactCharId}`;
  return `npc_chat__${ownerCharId}__${contactName}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { senderCharacterId, receiverCharacterName, topic, messageContent } = await req.json();

    if (!senderCharacterId || !receiverCharacterName) {
      return Response.json({
        error: 'senderCharacterId and receiverCharacterName are required',
        fields_received: { senderCharacterId, receiverCharacterName },
      }, { status: 400 });
    }

    // ── 1. RESOLVE SENDER ────────────────────────────────────────────────────
    const senderList = await base44.entities.Character.filter({ id: senderCharacterId }, null, 1);
    const sender = senderList?.[0];
    if (!sender) {
      return Response.json({ error: `Sender character id=${senderCharacterId} not found`, stage: 'sender_lookup' }, { status: 404 });
    }
    if (sender.owner_email !== user.email) {
      return Response.json({ error: `Ownership violation: sender does not belong to ${user.email}`, stage: 'ownership' }, { status: 403 });
    }

    // ── 2. RESOLVE RECEIVER BY NAME (prefer stable ID) ──────────────────────
    // First look in sender's fictional_relationships for a linked Character record
    let receiver = null;
    let receiverFoundVia = null;

    const linkedRel = (sender.fictional_relationships || []).find(
      r => r.person_name?.trim().toLowerCase() === receiverCharacterName.trim().toLowerCase()
        && r.related_character_id
    );

    if (linkedRel?.related_character_id) {
      const rcList = await base44.entities.Character.filter({ id: linkedRel.related_character_id }, null, 1);
      if (rcList?.[0] && rcList[0].owner_email === user.email) {
        receiver = rcList[0];
        receiverFoundVia = 'fictional_relationships_linked';
      }
    }

    // Fallback: search all owned characters by name
    if (!receiver) {
      const nameMatch = await base44.entities.Character.filter({ owner_email: user.email }, null, 300);
      const matched = nameMatch.find(
        c => c.name?.trim().toLowerCase() === receiverCharacterName.trim().toLowerCase()
          && c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
      );
      if (matched) {
        receiver = matched;
        receiverFoundVia = 'owner_name_search';
      }
    }

    // ── 3. BUILD MESSAGE CONTENT ─────────────────────────────────────────────
    let finalMessage = messageContent?.trim() || null;

    if (!finalMessage) {
      // Generate a contextually appropriate message from sender to receiver
      const canonicalRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId: senderCharacterId,
        interactionContext: 'world_phone',
        topKMemories: 6,
      }).catch(() => null);
      const senderContext = canonicalRes?.data?.systemPrompt || `You are ${sender.name}.`;

      finalMessage = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `${senderContext}

You need to contact ${receiverCharacterName} about: ${topic || 'catching up'}.

Write a short, natural text message (1-3 sentences) that you would send them right now.
Write in your own voice. Make it feel spontaneous and real, not formal.
Return only the message text, nothing else.`,
      });
      finalMessage = (finalMessage || '').trim();
    }

    if (!finalMessage) {
      finalMessage = `Hey, thinking about you. We should catch up soon.`;
    }

    // ── 4. FIND OR CREATE WORLD PHONE CONVERSATION ──────────────────────────
    const stableTitle = npcConvoTitle(senderCharacterId, receiverCharacterName, receiver?.id || null);
    const legacyTitle  = npcConvoTitle(senderCharacterId, receiverCharacterName, null);

    const existingConvos = await base44.entities.Conversation.filter({
      type: 'npc',
      character_ids: [senderCharacterId],
    });

    let conversationId = null;
    const existingMatch = existingConvos.find(c => c.title === stableTitle) ||
                          existingConvos.find(c => c.title === legacyTitle);

    if (existingMatch) {
      conversationId = existingMatch.id;
    } else {
      // Create new thread — include both IDs when receiver is a real Character
      const charIds = receiver?.id
        ? [senderCharacterId, receiver.id]
        : [senderCharacterId];

      const newConvo = await base44.entities.Conversation.create({
        title: stableTitle,
        type: 'npc',
        character_ids: charIds,
        owner_email: user.email,
      });
      conversationId = newConvo.id;
    }

    // ── 5. CREATE THE MESSAGE ────────────────────────────────────────────────
    const savedMsg = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: senderCharacterId,
      character_name: sender.name,
      content: finalMessage,
      timestamp: new Date().toISOString(),
    });

    await base44.entities.Conversation.update(conversationId, {
      last_message_preview: finalMessage.substring(0, 100),
      last_message_date: new Date().toISOString(),
    }).catch(() => {});

    // ── 6. BILATERAL MEMORY — only when both are real Character records ──────
    let memorySynced = false;
    if (receiver?.id) {
      await base44.functions.invoke('syncWorldPhoneMemory', {
        senderCharacterId,
        receiverCharacterId: receiver.id,
        messageContent: finalMessage,
        context: 'world_phone',
        conversationId,
      }).catch(err => {
        console.warn(`[triggerCharacterContact] syncWorldPhoneMemory failed (non-fatal): ${err.message}`);
      });
      memorySynced = true;
    } else {
      // Receiver is name-only — write sender memory only, mark receiver as unresolved
      await base44.entities.Memory.create({
        character_id: senderCharacterId,
        title: `Reached out to ${receiverCharacterName}`,
        description: `I contacted ${receiverCharacterName} about: ${topic || 'catching up'}. Message sent: "${finalMessage.substring(0, 200)}"`,
        emotional_impact: 'neutral',
        timestamp: new Date().toISOString(),
        source_context: `world_phone_${conversationId}`,
      }).catch(() => {});
      memorySynced = false;
    }

    console.log(
      `[triggerCharacterContact] ✓ ${sender.name} → ${receiverCharacterName}` +
      ` | receiver_resolved=${!!receiver}` +
      ` | receiver_found_via=${receiverFoundVia || 'not_found'}` +
      ` | bilateral_memory=${memorySynced}` +
      ` | convo_id=${conversationId}` +
      ` | msg_id=${savedMsg.id}`
    );

    return Response.json({
      success: true,
      conversationId,
      messageId: savedMsg.id,
      senderName: sender.name,
      receiverName: receiverCharacterName,
      receiverResolved: !!receiver,
      receiverFoundVia: receiverFoundVia || null,
      bilateralMemoryWritten: memorySynced,
      messageContent: finalMessage,
    });

  } catch (error) {
    console.error('[triggerCharacterContact] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});