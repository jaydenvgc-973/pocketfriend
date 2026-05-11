import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * triggerCharacterContact
 *
 * Unified entry point for ALL character-to-character contact:
 *   - user-requested ("tell Ethan to call Maya")
 *   - need-driven (social_value < 35, introvert prefers call over travel)
 *   - autonomous (scheduled / relationship maintenance)
 *
 * Creates a real World Phone thread + Message + bilateral Memory records.
 * Does NOT create narrative-only contact — if it runs, a real event exists.
 *
 * Payload:
 *   senderCharacterId: string       — Character A (the sender)
 *   receiverCharacterName: string   — Character B's name (resolved to ID internally)
 *   receiverCharacterId?: string    — optional: pass directly to skip name resolution
 *   topic: string                   — what the contact is about
 *   messageContent?: string         — if provided, used as-is; otherwise generated
 *   trigger_source?: string         — 'user_requested' | 'need_driven' | 'autonomous' | 'relationship'
 *
 * Returns:
 *   { success, conversationId, messageId, senderName, receiverName, receiverResolved, bilateralMemoryWritten }
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

    const { senderCharacterId, receiverCharacterName, receiverCharacterId, topic, messageContent, trigger_source } = await req.json();

    if (!senderCharacterId || (!receiverCharacterName && !receiverCharacterId)) {
      return Response.json({
        error: 'senderCharacterId and either receiverCharacterName or receiverCharacterId are required',
        fields_received: { senderCharacterId, receiverCharacterName, receiverCharacterId },
      }, { status: 400 });
    }

    // ── 1. RESOLVE SENDER ────────────────────────────────────────────────────
    // Platform throws "Object not found" when filter({ id }) receives a nonexistent ID.
    // Catch it explicitly and return 404 — not 500.
    let senderList;
    try {
      senderList = await base44.entities.Character.filter({ id: senderCharacterId }, null, 1);
    } catch (lookupErr) {
      const msg = lookupErr?.message || String(lookupErr);
      if (msg.includes('Object not found') || msg.includes('not found') || msg.includes('Invalid id')) {
        return Response.json({ error: `Sender character id=${senderCharacterId} not found`, stage: 'sender_lookup' }, { status: 404 });
      }
      throw lookupErr; // unexpected — re-throw
    }
    const sender = senderList?.[0];
    if (!sender) {
      return Response.json({ error: `Sender character id=${senderCharacterId} not found`, stage: 'sender_lookup' }, { status: 404 });
    }
    if (sender.owner_email !== user.email) {
      return Response.json({ error: `Ownership violation: sender does not belong to ${user.email}`, stage: 'ownership' }, { status: 403 });
    }

    // ── 1b. DAILY AUTONOMOUS CAP ─────────────────────────────────────────────
    // Autonomous contact is capped at 3 per sender character per day to prevent spam.
    // User-requested contact always bypasses this cap.
    const triggerSrc = trigger_source || 'user_requested';
    if (triggerSrc !== 'user_requested') {
      const today = new Date().toISOString().split('T')[0];
      const todayConvos = await base44.entities.Conversation.filter({
        type: 'npc',
        character_ids: [senderCharacterId],
        owner_email: user.email,
      }).catch(() => []);
      let autonomousToday = 0;
      for (const c of todayConvos) {
        const recentMsgs = await base44.entities.Message.filter({
          conversation_id: c.id,
          sender_type: 'character',
          character_id: senderCharacterId,
        }, '-timestamp', 20).catch(() => []);
        autonomousToday += recentMsgs.filter(m =>
          m.created_date?.startsWith(today) &&
          (m.trigger_source === 'need_driven' || m.trigger_source === 'autonomous' || m.trigger_source === 'relationship')
        ).length;
      }
      if (autonomousToday >= 3) {
        return Response.json({
          success: false,
          reason: 'daily_autonomous_cap_reached',
          detail: `${sender.name} has already made 3 autonomous contacts today`,
          autonomousToday,
        });
      }
    }

    // ── 2. RESOLVE RECEIVER BY STABLE ID FIRST, THEN NAME ───────────────────
    let receiver = null;
    let receiverFoundVia = null;
    const resolvedReceiverName = receiverCharacterName || '';

    // Path A: caller provided a direct character ID (most reliable)
    if (receiverCharacterId) {
      let rcList;
      try {
        rcList = await base44.entities.Character.filter({ id: receiverCharacterId }, null, 1);
      } catch { rcList = []; }
      if (rcList?.[0] && rcList[0].owner_email === user.email) {
        receiver = rcList[0];
        receiverFoundVia = 'direct_id';
      }
    }

    // Path B: look in sender's fictional_relationships for a linked Character record
    if (!receiver && resolvedReceiverName) {
      const linkedRel = (sender.fictional_relationships || []).find(
        r => r.person_name?.trim().toLowerCase() === resolvedReceiverName.trim().toLowerCase()
          && r.related_character_id
      );
      if (linkedRel?.related_character_id) {
        let rcList;
        try {
          rcList = await base44.entities.Character.filter({ id: linkedRel.related_character_id }, null, 1);
        } catch { rcList = []; }
        if (rcList?.[0] && rcList[0].owner_email === user.email) {
          receiver = rcList[0];
          receiverFoundVia = 'fictional_relationships_linked';
        }
      }
    }

    // Path C: search all owned characters by name
    if (!receiver && resolvedReceiverName) {
      const nameMatch = await base44.entities.Character.filter({ owner_email: user.email }, null, 300).catch(() => []);
      const matched = nameMatch.find(
        c => c.name?.trim().toLowerCase() === resolvedReceiverName.trim().toLowerCase()
          && c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
      );
      if (matched) {
        receiver = matched;
        receiverFoundVia = 'owner_name_search';
      }
    }

    // Use receiver's real name if resolved, otherwise use provided name
    const finalReceiverName = receiver?.name || resolvedReceiverName || 'them';

    // ── 3. BUILD MESSAGE CONTENT ─────────────────────────────────────────────
    let finalMessage = messageContent?.trim() || null;

    if (!finalMessage) {
      const canonicalRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId: senderCharacterId,
        interactionContext: 'world_phone',
        topKMemories: 6,
      }).catch(() => null);
      const senderContext = canonicalRes?.data?.systemPrompt || `You are ${sender.name}.`;

      finalMessage = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `${senderContext}

You need to contact ${finalReceiverName} about: ${topic || 'catching up'}.

Write a short, natural text message (1-3 sentences) that you would send them right now.
Write in your own voice. Make it feel spontaneous and real, not formal.
Return only the message text, nothing else.`,
      }).catch(() => null);
      finalMessage = (finalMessage || '').trim();
    }

    if (!finalMessage) {
      finalMessage = `Hey, thinking about you. We should catch up soon.`;
    }

    // ── 4. FIND OR CREATE WORLD PHONE CONVERSATION ──────────────────────────
    const stableTitle = npcConvoTitle(senderCharacterId, finalReceiverName, receiver?.id || null);
    const legacyTitle  = npcConvoTitle(senderCharacterId, finalReceiverName, null);

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
      // Store trigger_source so daily cap queries can count autonomous contacts
      trigger_source: triggerSrc,
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
      `[triggerCharacterContact] ✓ ${sender.name} → ${finalReceiverName}` +
      ` | trigger=${triggerSrc}` +
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
      receiverName: finalReceiverName,
      receiverResolved: !!receiver,
      receiverFoundVia: receiverFoundVia || null,
      bilateralMemoryWritten: memorySynced,
      messageContent: finalMessage,
      trigger_source: triggerSrc,
    });

  } catch (error) {
    console.error('[triggerCharacterContact] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});