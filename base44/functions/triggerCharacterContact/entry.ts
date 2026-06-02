import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * triggerCharacterContact
 *
 * Unified entry point for ALL character-to-character contact:
 *   - user-requested ("tell Ethan to call Maya")
 *   - need-driven (social_value < 35, introvert prefers call over travel)
 *   - autonomous (scheduled / relationship maintenance)
 *
 * CANONICAL PATH: Delegates to sendWorldPhoneMessage so every message is
 * written with the correct World Phone fields (shared_conversation_key,
 * channel:'world_phone', sender_character_id, receiver_character_id, etc.)
 * and is visible in WorldContactsPopup.
 *
 * Does NOT create narrative-only contact — if it runs, a real World Phone event exists.
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
    let senderList;
    try {
      senderList = await base44.entities.Character.filter({ id: senderCharacterId }, null, 1);
    } catch (lookupErr) {
      const msg = lookupErr?.message || String(lookupErr);
      if (msg.includes('Object not found') || msg.includes('not found') || msg.includes('Invalid id')) {
        return Response.json({ error: `Sender character id=${senderCharacterId} not found`, stage: 'sender_lookup' }, { status: 404 });
      }
      throw lookupErr;
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
      // Check World Phone messages sent today by this character
      const recentWPMessages = await base44.entities.Message.filter({
        sender_character_id: senderCharacterId,
        channel: 'world_phone',
      }, '-timestamp', 30).catch(() => []);
      const autonomousToday = recentWPMessages.filter(m =>
        m.created_date?.startsWith(today) &&
        (m.trigger_source === 'need_driven' || m.trigger_source === 'autonomous' || m.trigger_source === 'relationship')
      ).length;
      if (autonomousToday >= 3) {
        return Response.json({
          success: false,
          reason: 'daily_autonomous_cap_reached',
          detail: `${sender.name} has already made 3 autonomous contacts today`,
          autonomousToday,
        });
      }
    }

    // ── 2. BUILD MESSAGE CONTENT ─────────────────────────────────────────────
    let finalMessage = messageContent?.trim() || null;
    const resolvedReceiverName = receiverCharacterName || '';

    if (!finalMessage) {
      const canonicalRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId: senderCharacterId,
        interactionContext: 'world_phone',
        topKMemories: 6,
      }).catch(() => null);
      const senderContext = canonicalRes?.data?.systemPrompt || `You are ${sender.name}.`;

      finalMessage = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `${senderContext}

You need to contact ${resolvedReceiverName || 'them'} about: ${topic || 'catching up'}.

Write a short, natural text message (1-3 sentences) that you would send them right now.
Write in your own voice. Make it feel spontaneous and real, not formal.
Return only the message text, nothing else.`,
      }).catch(() => null);
      finalMessage = (finalMessage || '').trim();
    }

    if (!finalMessage) {
      finalMessage = `Hey, thinking about you. We should catch up soon.`;
    }

    // ── 3. DELEGATE TO sendWorldPhoneMessage — the canonical World Phone path ──
    // sendWorldPhoneMessage handles: conversation find/create with canonical key,
    // message write with all required World Phone fields, bilateral memory sync,
    // and recipient response generation. This ensures messages are visible in
    // WorldContactsPopup exactly as if the user manually sent them.
    const recipientIdentifier = receiverCharacterId || resolvedReceiverName;

    const wpResult = await base44.functions.invoke('sendWorldPhoneMessage', {
      sender_character_id: senderCharacterId,
      recipient_identifier: recipientIdentifier,
      requested_message: finalMessage,
      source: triggerSrc === 'user_requested' ? 'user_instruction' : 'character_action',
      owner_email: user.email,
      // Pass generate_recipient_response only for autonomous/need-driven — not user_requested
      // (user_requested is already handled by sendWorldPhoneMessage's default behavior)
      generate_recipient_response: triggerSrc !== 'user_requested',
    });

    const wpData = wpResult?.data;

    if (!wpData?.success) {
      console.warn(`[triggerCharacterContact] sendWorldPhoneMessage failed: ${wpData?.error}`);
      return Response.json({
        success: false,
        error: wpData?.error || 'sendWorldPhoneMessage failed',
        stage: 'world_phone_send',
      });
    }

    console.log(
      `[triggerCharacterContact] ✓ ${sender.name} → ${resolvedReceiverName || recipientIdentifier}` +
      ` | trigger=${triggerSrc}` +
      ` | convo_id=${wpData.conversation_id}` +
      ` | msg_id=${wpData.message_id}` +
      ` | world_phone=canonical`
    );

    return Response.json({
      success: true,
      conversationId: wpData.conversation_id,
      messageId: wpData.message_id,
      senderName: sender.name,
      receiverName: resolvedReceiverName || recipientIdentifier,
      receiverResolved: !!wpData.receiver_character_id,
      bilateralMemoryWritten: true,
      messageContent: finalMessage,
      trigger_source: triggerSrc,
      world_phone_canonical: true,
    });

  } catch (error) {
    console.error('[triggerCharacterContact] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});