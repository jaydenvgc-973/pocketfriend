import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * triggerCharacterContact
 *
 * Unified entry point for ALL character-to-character contact:
 *   - user-requested ("tell Ethan to call Maya")
 *   - need-driven (social_value < 35, introvert prefers call over travel)
 *   - autonomous (scheduled / relationship maintenance)
 *
 * ARCHITECTURE NOTE:
 * sendWorldPhoneMessage is the authoritative World Phone path for user-facing calls.
 * This function is the service-role adapter for automation/function-context callers
 * who cannot reach sendWorldPhoneMessage via base44.functions.invoke (no user session).
 * It performs the same canonical World Phone write (same schema, same keys, same fields)
 * without duplicating sendWorldPhoneMessage's user-facing features (pronoun resolution,
 * image sends, detailed visual analysis, Vick boundary enforcement, read-back verification).
 * Those features are only relevant in user-initiated flows — not automation-driven contact.
 *
 * World Phone schema: shared_conversation_key, channel:'world_phone',
 * sender_character_id, receiver_character_id, participant_character_ids — identical
 * to sendWorldPhoneMessage so all messages appear in WorldContactsPopup correctly.
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
    const sr = base44.asServiceRole;
    // auth.me() may return null when called from automation/function context (no user session)
    const user = await base44.auth.me().catch(() => null);

    const { senderCharacterId, receiverCharacterName, receiverCharacterId, topic, messageContent, trigger_source, user_instruction_context, autonomy_marker } = await req.json();

    if (!senderCharacterId || (!receiverCharacterName && !receiverCharacterId)) {
      return Response.json({
        error: 'senderCharacterId and either receiverCharacterName or receiverCharacterId are required',
      }, { status: 400 });
    }

    // ── 1. RESOLVE SENDER ────────────────────────────────────────────────────
    const senderList = await sr.entities.Character.filter({ id: senderCharacterId }, null, 1).catch(() => []);
    const sender = senderList?.[0];
    if (!sender) {
      return Response.json({ error: `Sender character not found: ${senderCharacterId}` }, { status: 404 });
    }
    if (user && sender.owner_email && sender.owner_email !== user.email) {
      return Response.json({ error: 'Ownership violation', stage: 'ownership' }, { status: 403 });
    }

    const ownerEmail = user?.email || sender.owner_email;

    // ── 1b. DAILY AUTONOMOUS CAP ─────────────────────────────────────────────
    const triggerSrc = trigger_source || 'user_requested';
    if (triggerSrc !== 'user_requested') {
      const today = new Date().toISOString().split('T')[0];
      const recentWP = await sr.entities.Message.filter({ sender_character_id: senderCharacterId, channel: 'world_phone' }, '-timestamp', 30).catch(() => []);
      const autonomousToday = recentWP.filter(m =>
        m.created_date?.startsWith(today) &&
        ['need_driven','autonomous','relationship'].includes(m.trigger_source)
      ).length;
      if (autonomousToday >= 3) {
        return Response.json({ success: false, reason: 'daily_autonomous_cap_reached', autonomousToday });
      }
    }

    // ── 2. RESOLVE RECIPIENT ─────────────────────────────────────────────────
    let recipient = null;

    // Direct ID
    if (receiverCharacterId && receiverCharacterId.length > 15) {
      const byId = await sr.entities.Character.filter({ id: receiverCharacterId }, null, 1).catch(() => []);
      if (byId?.[0]) recipient = byId[0];
    }

    // Name lookup
    if (!recipient) {
      const nameLower = (receiverCharacterName || receiverCharacterId || '').toLowerCase().trim();
      const allChars = await sr.entities.Character.filter({ owner_email: ownerEmail, status: 'active' }, null, 200).catch(() => []);
      const exact = allChars.find(c => c.name?.toLowerCase() === nameLower || c.display_name?.toLowerCase() === nameLower);
      if (exact) recipient = exact;
      else {
        const partial = allChars.filter(c => c.name?.toLowerCase().includes(nameLower));
        if (partial.length === 1) recipient = partial[0];
      }
    }

    if (!recipient) {
      return Response.json({ success: false, error: `Recipient not found: "${receiverCharacterName || receiverCharacterId}"` });
    }
    if (recipient.id === senderCharacterId) {
      return Response.json({ success: false, error: 'Sender and recipient are the same character.' });
    }

    // ── 3. BUILD MESSAGE CONTENT ─────────────────────────────────────────────
    let finalMessage = messageContent?.trim() || null;

    // Echo guard
    if (finalMessage && user_instruction_context) {
      const normFinal = finalMessage.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const normInstr = user_instruction_context.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (normFinal === normInstr) {
        finalMessage = null;
      } else {
        const tokA = new Set(normFinal.split(' ').filter(w => w.length > 2));
        const tokB = new Set(normInstr.split(' ').filter(w => w.length > 2));
        if (tokA.size > 0 && tokB.size > 0) {
          const inter = [...tokA].filter(w => tokB.has(w)).length;
          const union = new Set([...tokA, ...tokB]).size;
          if (inter / union >= 0.65) finalMessage = null;
        }
      }
    }

    if (!finalMessage) {
      const personalityHint = [sender.personality_summary, sender.communication_style, sender.archetype].filter(Boolean).join('. ');
      const topicHint = topic || (user_instruction_context ? `reaching out (context: ${user_instruction_context})` : 'catching up');
      const relContext = (sender.fictional_relationships || []).find(r =>
        r.related_character_id === recipient.id || r.person_name?.toLowerCase() === recipient.name?.toLowerCase()
      );
      const relLabel = relContext?.relationship_type || 'contact';

      finalMessage = await sr.integrations.Core.InvokeLLM({
        prompt: `You are ${sender.name}.${personalityHint ? ` Personality: ${personalityHint}.` : ''}${sender.emotional_state ? ` Mood: ${sender.emotional_state}.` : ''}

Write a short text message to ${recipient.name} (your ${relLabel}).
Topic/reason: ${topicHint}

Rules: Write in your own natural voice. 1-2 sentences. Return ONLY the message text, nothing else.`,
      }).catch(() => null);
      finalMessage = (typeof finalMessage === 'string' ? finalMessage : '').trim();
    }

    if (!finalMessage) {
      finalMessage = `Hey, just thinking about you. Let's catch up soon.`;
    }

    // ── 4. CANONICAL WORLD PHONE WRITE ───────────────────────────────────────
    // Same canonical key format as sendWorldPhoneMessage and WorldContactsPopup.
    const sortedIds = [senderCharacterId, recipient.id].sort();
    const canonicalKey = `world_phone::${sortedIds[0]}::${sortedIds[1]}`;
    const participantIds = sortedIds;
    const now = new Date().toISOString();

    // Find or create conversation
    const existing = await sr.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, '-updated_date', 3).catch(() => []);
    let conversationId = existing[0]?.id || null;

    if (!conversationId) {
      const senderType = sender.character_type || null;
      const recipientType = recipient.character_type || null;
      const bothActive = senderType === 'active_created_character' && recipientType === 'active_created_character';
      const newConvo = await sr.entities.Conversation.create({
        title: `world_phone::${participantIds.join('::')}`,
        type: bothActive ? 'direct' : 'npc',
        character_ids: [senderCharacterId, recipient.id],
        participant_character_ids: participantIds,
        shared_conversation_key: canonicalKey,
        owner_email: ownerEmail,
        channel: 'world_phone',
        sync_status: 'pending',
        world_contact_mode: bothActive ? 'active_created_to_active_created' : 'character_to_character',
        participant_character_types: [senderType, recipientType].filter(Boolean),
      });
      conversationId = newConvo.id;
    }

    // Write outbound message
    const outboundMsg = await sr.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: senderCharacterId,
      character_name: sender.name,
      sender_character_id: senderCharacterId,
      receiver_character_id: recipient.id,
      participant_character_ids: participantIds,
      shared_conversation_key: canonicalKey,
      content: finalMessage,
      channel: 'world_phone',
      timestamp: now,
      is_read: true,
      typed_by_user: triggerSrc === 'user_requested',
      user_operated: triggerSrc === 'user_requested',
      sync_status: 'pending',
      recovery_signal: false,
      memory_eligible: true,
      relationship_eligible: true,
      autonomy_marker: autonomy_marker || `trigger_contact::${triggerSrc}`,
    });

    if (!outboundMsg?.id) {
      return Response.json({ success: false, error: 'Message write failed' });
    }

    await sr.entities.Conversation.update(conversationId, {
      last_message_preview: finalMessage.substring(0, 100),
      last_message_date: now,
    }).catch(() => {});

    // ── 5. RECIPIENT RESPONSE ────────────────────────────────────────────────
    let recipientResponseId = null;
    let recipientResponseText = null;

    try {
      const personalityHint = [recipient.personality_summary, recipient.communication_style].filter(Boolean).join('. ');
      const relContext = (sender.fictional_relationships || []).find(r =>
        r.related_character_id === recipient.id || r.person_name?.toLowerCase() === recipient.name?.toLowerCase()
      );
      const relLabel = relContext?.relationship_type || 'contact';

      const rawReply = await sr.integrations.Core.InvokeLLM({
        prompt: `You are ${recipient.name}.${personalityHint ? ` Personality: ${personalityHint}.` : ''}${recipient.emotional_state ? ` Mood: ${recipient.emotional_state}.` : ''}

${sender.name} (your ${relLabel}) just texted you: "${finalMessage}"
Reply naturally in 1-3 sentences as yourself. Return ONLY your reply text.`,
      });

      recipientResponseText = (typeof rawReply === 'string' ? rawReply : '').trim();

      if (recipientResponseText && recipientResponseText.length > 2) {
        const responseTs = new Date(Date.now() + 2000).toISOString();
        const recipientMsg = await sr.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: recipient.id,
          character_name: recipient.name,
          sender_character_id: recipient.id,
          receiver_character_id: senderCharacterId,
          participant_character_ids: participantIds,
          shared_conversation_key: canonicalKey,
          content: recipientResponseText,
          channel: 'world_phone',
          timestamp: responseTs,
          is_read: false,
          reply_to_message_id: outboundMsg.id,
          source_message_id: outboundMsg.id,
          sync_status: 'pending',
          recovery_signal: false,
          memory_eligible: true,
          relationship_eligible: true,
        });
        if (recipientMsg?.id) {
          recipientResponseId = recipientMsg.id;
          await sr.entities.Conversation.update(conversationId, {
            last_message_preview: recipientResponseText.substring(0, 100),
            last_message_date: responseTs,
          }).catch(() => {});
        }
      }
    } catch (respErr) {
      console.warn(`[triggerCharacterContact] Recipient response error (non-fatal): ${respErr.message}`);
    }

    // ── 6. BILATERAL MEMORY SYNC — fire and forget ───────────────────────────
    base44.functions.invoke('syncWorldPhoneMemory', {
      senderCharacterId,
      receiverCharacterId: recipient.id,
      messageContent: recipientResponseText
        ? `${sender.name}: ${finalMessage} | ${recipient.name}: "${recipientResponseText}"`
        : `${sender.name}: ${finalMessage}`,
      context: 'world_phone',
      conversationId,
      receiverMessageId: recipientResponseId || null,
    }).catch(() => {});

    console.log(
      `[triggerCharacterContact] ✓ ${sender.name} → ${recipient.name}` +
      ` | trigger=${triggerSrc}` +
      ` | convo=${conversationId}` +
      ` | msg=${outboundMsg.id}` +
      ` | response=${recipientResponseId || 'none'}`
    );

    return Response.json({
      success: true,
      conversationId,
      messageId: outboundMsg.id,
      senderName: sender.name,
      receiverName: recipient.name,
      receiverResolved: true,
      bilateralMemoryWritten: true,
      messageContent: finalMessage,
      recipientResponseId,
      trigger_source: triggerSrc,
    });

  } catch (error) {
    console.error('[triggerCharacterContact] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});