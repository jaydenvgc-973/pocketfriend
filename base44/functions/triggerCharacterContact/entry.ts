import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * triggerCharacterContact
 *
 * ORCHESTRATION ONLY. This function decides that a character should contact another,
 * prepares the message content, and delegates the actual World Phone write to
 * sendWorldPhoneMessage — the single authoritative World Phone write path.
 *
 * This function does NOT:
 *   - create World Phone conversations
 *   - create World Phone messages
 *   - generate recipient replies
 *   - update World Phone conversation state
 *   - sync World Phone memory
 *   - contain any World Phone business logic
 *
 * All of that belongs exclusively to sendWorldPhoneMessage.
 *
 * Payload:
 *   senderCharacterId: string       — Character A (the sender)
 *   receiverCharacterName: string   — Character B's name (resolved to ID internally)
 *   receiverCharacterId?: string    — optional: pass directly to skip name resolution
 *   topic: string                   — what the contact is about
 *   messageContent?: string         — if provided, used as-is; otherwise generated
 *   trigger_source?: string         — 'user_requested' | 'need_driven' | 'autonomous' | 'relationship'
 *   autonomy_marker?: string        — optional tag for analytics
 *
 * Returns:
 *   { success, conversationId, messageId, senderName, receiverName }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const user = await base44.auth.me().catch(() => null);

    const {
      senderCharacterId,
      receiverCharacterName,
      receiverCharacterId,
      topic,
      messageContent,
      trigger_source,
      user_instruction_context,
      autonomy_marker,
    } = await req.json();

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

    const ownerEmail = user?.email || sender.owner_email;

    // ── 2. RESOLVE RECIPIENT (name → ID) ─────────────────────────────────────
    // We need the recipient's ID to pass to sendWorldPhoneMessage as recipient_identifier.
    // This is pure orchestration — no World Phone logic here.
    let recipientId = receiverCharacterId || null;
    let recipientName = receiverCharacterName || null;

    if (!recipientId) {
      const nameLower = (receiverCharacterName || '').toLowerCase().trim();
      const allChars = await sr.entities.Character.filter(
        { owner_email: ownerEmail, status: 'active' }, null, 200
      ).catch(() => []);

      const exact = allChars.find(c =>
        c.name?.toLowerCase() === nameLower || c.display_name?.toLowerCase() === nameLower
      );
      if (exact) {
        recipientId = exact.id;
        recipientName = exact.name;
      } else {
        const partial = allChars.filter(c => c.name?.toLowerCase().includes(nameLower));
        if (partial.length === 1) {
          recipientId = partial[0].id;
          recipientName = partial[0].name;
        } else if (partial.length > 1) {
          return Response.json({
            success: false,
            error: `Ambiguous recipient: "${receiverCharacterName}" matches multiple characters. Use receiverCharacterId.`,
          });
        } else {
          return Response.json({
            success: false,
            error: `Recipient not found: "${receiverCharacterName}"`,
          });
        }
      }
    }

    if (recipientId === senderCharacterId) {
      return Response.json({ success: false, error: 'Sender and recipient are the same character.' });
    }

    const triggerSrc = trigger_source || 'user_requested';

    // ── 3. DAILY AUTONOMOUS CAP ───────────────────────────────────────────────
    // Orchestration gate — prevents excessive autonomous contact before delegating.
    if (triggerSrc !== 'user_requested') {
      const today = new Date().toISOString().split('T')[0];
      const recentWP = await sr.entities.Message.filter(
        { sender_character_id: senderCharacterId, channel: 'world_phone' }, '-timestamp', 30
      ).catch(() => []);
      const autonomousToday = recentWP.filter(m =>
        m.created_date?.startsWith(today) &&
        m.autonomy_marker?.startsWith('trigger_contact::')
      ).length;
      if (autonomousToday >= 3) {
        return Response.json({ success: false, reason: 'daily_autonomous_cap_reached', autonomousToday });
      }
    }

    // ── 4. GENERATE MESSAGE CONTENT ───────────────────────────────────────────
    // If no message was provided, generate one in the sender's voice.
    // This is the only content-generation responsibility of this function.
    let finalMessage = messageContent?.trim() || null;

    // Echo guard: reject if provided message is a near-duplicate of the raw instruction
    if (finalMessage && user_instruction_context) {
      const normFinal = finalMessage.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const normInstr = user_instruction_context.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const tokA = new Set(normFinal.split(' ').filter(w => w.length > 2));
      const tokB = new Set(normInstr.split(' ').filter(w => w.length > 2));
      if (tokA.size > 0 && tokB.size > 0) {
        const inter = [...tokA].filter(w => tokB.has(w)).length;
        const union = new Set([...tokA, ...tokB]).size;
        if (inter / union >= 0.65) finalMessage = null;
      }
    }

    if (!finalMessage) {
      const personalityHint = [
        sender.personality_summary,
        sender.communication_style,
        sender.archetype,
      ].filter(Boolean).join('. ');
      const topicHint = topic || (user_instruction_context
        ? `reaching out (context: ${user_instruction_context})`
        : 'catching up');
      const relContext = (sender.fictional_relationships || []).find(r =>
        r.related_character_id === recipientId ||
        r.person_name?.toLowerCase() === (recipientName || '').toLowerCase()
      );
      const relLabel = relContext?.relationship_type || 'contact';

      const generated = await sr.integrations.Core.InvokeLLM({
        prompt: `You are ${sender.name}.${personalityHint ? ` Personality: ${personalityHint}.` : ''}${sender.emotional_state ? ` Mood: ${sender.emotional_state}.` : ''}

Write a short text message to ${recipientName || 'them'} (your ${relLabel}).
Topic/reason: ${topicHint}

Rules: Write in your own natural voice. 1-2 sentences. Return ONLY the message text, nothing else.`,
      }).catch(() => null);

      finalMessage = (typeof generated === 'string' ? generated : '').trim();
    }

    if (!finalMessage) {
      finalMessage = `Hey, just thinking about you. Let's catch up soon.`;
    }

    // ── 5. DELEGATE TO AUTHORITATIVE WORLD PHONE SENDER ─────────────────────
    // This is the ONLY place World Phone writes originate for this function.
    // sendWorldPhoneMessage owns all conversation creation, message creation,
    // recipient reply generation, preview updates, and memory sync.
    const wpResult = await base44.functions.invoke('sendWorldPhoneMessage', {
      sender_character_id: senderCharacterId,
      recipient_identifier: recipientId,
      requested_message: finalMessage,
      source: triggerSrc === 'user_requested' ? 'user_instruction' : 'character_action',
      owner_email: ownerEmail,
      generate_recipient_response: true,
      autonomy_marker: autonomy_marker || `trigger_contact::${triggerSrc}`,
    });

    const wpData = wpResult?.data || wpResult;

    if (!wpData?.success) {
      console.error(
        `[triggerCharacterContact] sendWorldPhoneMessage failed | sender=${sender.name}` +
        ` | error=${wpData?.error || 'unknown'}`
      );
      return Response.json({
        success: false,
        error: wpData?.error || 'sendWorldPhoneMessage returned failure',
        stage: 'world_phone_send',
        sender: sender.name,
        recipientId,
      });
    }

    console.log(
      `[triggerCharacterContact] ✓ delegated to sendWorldPhoneMessage` +
      ` | sender=${sender.name} | recipient=${recipientName || recipientId}` +
      ` | trigger=${triggerSrc}` +
      ` | msg=${wpData.message_id}` +
      ` | convo=${wpData.conversation_id}`
    );

    return Response.json({
      success: true,
      conversationId: wpData.conversation_id,
      messageId: wpData.message_id,
      senderName: sender.name,
      receiverName: recipientName,
      trigger_source: triggerSrc,
    });

  } catch (error) {
    console.error('[triggerCharacterContact] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});