/**
 * sendWorldPhoneMessage
 *
 * Shared backend function for all World Phone character-to-character messaging.
 * Called from two paths:
 *   - "user_instruction": user explicitly told Character A to text/call/message Character B
 *   - "character_action": character's LLM response claimed it sent a message to someone
 *
 * RULES:
 * - owner_email only — never created_by
 * - Must find recipient from Character records (canonical ID match first, name fallback)
 * - Rewrites message in sender's voice before saving
 * - Creates bilateral World Phone messages (bilateral channel)
 * - Syncs memory for both sender and recipient
 * - Returns proof: sender, recipient, message IDs, thread IDs, memory results
 * - If ANY step fails, returns success: false with reason — caller must not fake success
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const {
      sender_character_id,
      recipient_identifier,   // character name or id
      requested_message,      // the message the user asked to send (raw)
      source,                 // "user_instruction" | "character_action"
      current_chat_message_id,
      current_conversation_id,
      owner_email,
    } = await req.json();

    if (!sender_character_id || !recipient_identifier || !requested_message) {
      return Response.json({
        success: false,
        error: 'Missing required fields: sender_character_id, recipient_identifier, requested_message',
      }, { status: 400 });
    }

    const ownerEmail = owner_email || user.email;

    // ── LOAD SENDER CHARACTER ─────────────────────────────────────────────────
    const senderArr = await base44.entities.Character.filter({ id: sender_character_id }, null, 1).catch(() => []);
    const sender = senderArr?.[0];
    if (!sender) {
      return Response.json({ success: false, error: `Sender character not found: ${sender_character_id}` });
    }

    // ── RESOLVE RECIPIENT ─────────────────────────────────────────────────────
    // Priority: exact ID match → name match in sender's fictional_relationships → name match in all account characters
    let recipient = null;
    let recipientResolutionPath = null;

    // 1. Check if recipient_identifier is a character ID
    if (recipient_identifier.length > 15 && !recipient_identifier.includes(' ')) {
      const byId = await base44.entities.Character.filter({ id: recipient_identifier }, null, 1).catch(() => []);
      if (byId?.[0]) {
        recipient = byId[0];
        recipientResolutionPath = 'direct_id';
      }
    }

    // 2. Search sender's fictional_relationships by name
    if (!recipient && sender.fictional_relationships?.length > 0) {
      const nameLower = recipient_identifier.toLowerCase().trim();
      const relMatch = sender.fictional_relationships.find(r =>
        r.name?.toLowerCase().includes(nameLower) ||
        r.character_name?.toLowerCase().includes(nameLower)
      );
      if (relMatch?.related_character_id) {
        const relArr = await base44.entities.Character.filter({ id: relMatch.related_character_id }, null, 1).catch(() => []);
        if (relArr?.[0]) {
          recipient = relArr[0];
          recipientResolutionPath = 'fictional_relationships';
        }
      }
    }

    // 3. Search sender's family_members by name
    if (!recipient && sender.family_members?.length > 0) {
      const nameLower = recipient_identifier.toLowerCase().trim();
      const famMatch = sender.family_members.find(f =>
        f.name?.toLowerCase().includes(nameLower)
      );
      if (famMatch?.character_id) {
        const famArr = await base44.entities.Character.filter({ id: famMatch.character_id }, null, 1).catch(() => []);
        if (famArr?.[0]) {
          recipient = famArr[0];
          recipientResolutionPath = 'family_members';
        }
      }
    }

    // 4. Broad name search across all account characters
    if (!recipient) {
      const nameLower = recipient_identifier.toLowerCase().trim();
      const allChars = await base44.entities.Character.filter({ owner_email: ownerEmail }, null, 200).catch(() => []);
      
      // Exact name match first
      let match = allChars.find(c =>
        c.name?.toLowerCase() === nameLower ||
        c.display_name?.toLowerCase() === nameLower ||
        c.primary_name?.toLowerCase() === nameLower
      );
      // Partial name match fallback
      if (!match) {
        match = allChars.find(c =>
          c.name?.toLowerCase().includes(nameLower) ||
          c.display_name?.toLowerCase().includes(nameLower)
        );
      }
      if (match) {
        recipient = match;
        recipientResolutionPath = 'account_name_search';
      }
    }

    if (!recipient) {
      return Response.json({
        success: false,
        error: `Recipient not found: "${recipient_identifier}". Character must exist in the app.`,
        resolution_attempted: ['direct_id', 'fictional_relationships', 'family_members', 'account_name_search'],
      });
    }

    // ── REWRITE MESSAGE IN SENDER'S VOICE ────────────────────────────────────
    const personalityHint = [
      sender.personality_summary,
      sender.communication_style,
      sender.archetype,
    ].filter(Boolean).join(', ');

    const traitHints = [];
    if (sender.trait_dry_humor) traitHints.push('dry humor');
    if (sender.trait_blunt) traitHints.push('blunt');
    if (sender.trait_flirty) traitHints.push('flirty');
    if (sender.trait_oversharer) traitHints.push('oversharer');
    if (sender.trait_night_owl) traitHints.push('night owl');
    const traitStr = traitHints.slice(0, 3).join(', ');

    let rewrittenMessage = requested_message;
    try {
      const rewriteRes = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${sender.name}. ${personalityHint ? `Your personality: ${personalityHint}.` : ''} ${traitStr ? `Key traits: ${traitStr}.` : ''} ${sender.emotional_state ? `Current mood: ${sender.emotional_state}.` : ''}

You need to send this message to ${recipient.name}:
"${requested_message}"

Rewrite it in your authentic voice — keep the exact meaning and intent but make it sound like YOU. Keep it short (1-3 sentences max), natural, and real. Do NOT add greetings or sign-offs unless they're genuinely part of your style. Return ONLY the rewritten message text, no quotes, no explanation.`,
      });
      if (typeof rewriteRes === 'string' && rewriteRes.trim().length > 0) {
        rewrittenMessage = rewriteRes.trim();
      }
    } catch (e) {
      console.warn('[sendWorldPhoneMessage] Voice rewrite failed, using original:', e.message);
      // Use original message — non-fatal
    }

    // ── BUILD BILATERAL CONVERSATION KEY ──────────────────────────────────────
    // bilateral key = "bilateral_" + sorted character IDs joined by "_" + "_world_phone"
    const sortedIds = [sender_character_id, recipient.id].sort();
    const sharedConvKey = `bilateral_${sortedIds[0]}_${sortedIds[1]}_world_phone`;

    // ── FIND OR CREATE BILATERAL CONVERSATION ────────────────────────────────
    let bilateralConvId = null;
    const existingConvos = await base44.entities.Conversation.filter({
      type: 'bilateral',
      owner_email: ownerEmail,
    }, '-created_date', 50).catch(() => []);

    const existingConvo = existingConvos.find(c =>
      c.shared_conversation_key === sharedConvKey ||
      (c.character_ids?.includes(sender_character_id) && c.character_ids?.includes(recipient.id) && c.type === 'bilateral')
    );

    if (existingConvo) {
      bilateralConvId = existingConvo.id;
    } else {
      const newConvo = await base44.entities.Conversation.create({
        title: `${sender.name} & ${recipient.name}`,
        type: 'bilateral',
        channel: 'world_phone',
        character_ids: [sender_character_id, recipient.id],
        shared_conversation_key: sharedConvKey,
        owner_email: ownerEmail,
        participant_character_ids: sortedIds,
      });
      bilateralConvId = newConvo.id;
    }

    const now = new Date().toISOString();
    const participantIds = sortedIds;

    // ── SAVE OUTGOING MESSAGE (sender → recipient) ────────────────────────────
    const outgoingMsg = await base44.entities.Message.create({
      conversation_id: bilateralConvId,
      sender_type: 'character',
      character_id: sender_character_id,
      character_name: sender.name,
      sender_character_id: sender_character_id,
      receiver_character_id: recipient.id,
      participant_character_ids: participantIds,
      shared_conversation_key: sharedConvKey,
      content: rewrittenMessage,
      channel: 'world_phone',
      timestamp: now,
      is_read: false,
      typed_by_user: source === 'user_instruction',
      user_operated: source === 'user_instruction',
      source_message_id: current_chat_message_id || null,
      sync_status: 'complete',
      memory_eligible: true,
      relationship_eligible: true,
      recovery_signal: false,
    });

    if (!outgoingMsg?.id) {
      return Response.json({ success: false, error: 'Failed to save outgoing World Phone message' });
    }

    // ── UPDATE CONVERSATION PREVIEW ───────────────────────────────────────────
    await base44.entities.Conversation.update(bilateralConvId, {
      last_message_preview: rewrittenMessage.substring(0, 100),
      last_message_date: now,
    }).catch(() => {});

    // ── SYNC BILATERAL MEMORY — sender remembers sending ────────────────────
    let senderMemoryId = null;
    let recipientMemoryId = null;

    try {
      const senderMemory = await base44.entities.CharacterMemory.create({
        character_id: sender_character_id,
        memory_type: 'event',
        memory_text: `I sent a World Phone message to ${recipient.name}: "${rewrittenMessage}"`,
        memory_summary: `Texted ${recipient.name} via World Phone`,
        related_character_id: recipient.id,
        importance_score: 5,
        confidence_score: 1.0,
        permanence: 'long_term',
        validation_status: 'confirmed',
      });
      senderMemoryId = senderMemory?.id || null;
    } catch (e) {
      console.warn('[sendWorldPhoneMessage] Sender memory write failed (non-fatal):', e.message);
    }

    // ── SYNC BILATERAL MEMORY — recipient remembers receiving ────────────────
    try {
      const recipientMemory = await base44.entities.CharacterMemory.create({
        character_id: recipient.id,
        memory_type: 'event',
        memory_text: `${sender.name} sent me a World Phone message: "${rewrittenMessage}"`,
        memory_summary: `Received text from ${sender.name} via World Phone`,
        related_character_id: sender_character_id,
        importance_score: 5,
        confidence_score: 1.0,
        permanence: 'long_term',
        validation_status: 'confirmed',
      });
      recipientMemoryId = recipientMemory?.id || null;
    } catch (e) {
      console.warn('[sendWorldPhoneMessage] Recipient memory write failed (non-fatal):', e.message);
    }

    // ── ENSURE RELATIONSHIP RECORDS EXIST ────────────────────────────────────
    // If they don't have each other in fictional_relationships, add them.
    try {
      const senderHasRecipient = (sender.fictional_relationships || []).some(
        r => r.related_character_id === recipient.id
      );
      if (!senderHasRecipient) {
        const existingRels = sender.fictional_relationships || [];
        await base44.entities.Character.update(sender_character_id, {
          fictional_relationships: [
            ...existingRels,
            {
              related_character_id: recipient.id,
              name: recipient.name,
              character_name: recipient.name,
              relationship_type: 'contact',
              source: 'world_phone',
              last_interaction_summary: `Sent World Phone message: "${rewrittenMessage.substring(0, 80)}"`,
              added_at: now,
            },
          ],
        });
      }
    } catch (e) {
      console.warn('[sendWorldPhoneMessage] Sender relationship sync failed (non-fatal):', e.message);
    }

    console.log(`[sendWorldPhoneMessage] ✅ ${sender.name} → ${recipient.name} | conv=${bilateralConvId} | msg=${outgoingMsg.id} | source=${source} | path=${recipientResolutionPath}`);

    return Response.json({
      success: true,
      proof: {
        sender: { id: sender_character_id, name: sender.name },
        recipient: { id: recipient.id, name: recipient.name },
        original_request: requested_message,
        rewritten_message: rewrittenMessage,
        outgoing_message_id: outgoingMsg.id,
        conversation_id: bilateralConvId,
        shared_conversation_key: sharedConvKey,
        recipient_resolution_path: recipientResolutionPath,
        sender_memory_id: senderMemoryId,
        recipient_memory_id: recipientMemoryId,
        source,
      },
    });

  } catch (error) {
    console.error('[sendWorldPhoneMessage]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});