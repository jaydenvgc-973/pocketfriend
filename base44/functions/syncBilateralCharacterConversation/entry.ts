/**
 * syncBilateralCharacterConversation
 * 
 * Creates or updates a shared conversation record for character-to-character communication.
 * Both characters can access and retrieve this conversation.
 * 
 * Payload:
 * - owner_email: authenticated user's email
 * - sender_character_id: ID of character initiating contact
 * - receiver_character_id: ID of character receiving contact
 * - conversation_id: ID of the World Phone conversation record
 * - message_id: ID of the trigger message
 * - message_content: what was sent
 * - response_content: optional — reply from receiver
 * - channel: world_phone | direct_text | direct_call | autonomous_contact | group_chat
 * - topic: brief topic label
 * - emotional_tone: calm, warm, urgent, etc.
 * - outcome: positive, neutral, negative, unresolved
 * - timestamp: ISO datetime
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const {
      owner_email,
      sender_character_id,
      receiver_character_id,
      conversation_id,
      message_id,
      message_content,
      response_content,
      channel,
      topic,
      emotional_tone,
      outcome,
      timestamp,
    } = payload;

    // ── VALIDATION ───────────────────────────────────────────────────────────────
    if (!sender_character_id || !receiver_character_id || !conversation_id) {
      return Response.json(
        { error: 'Missing required fields: sender_character_id, receiver_character_id, conversation_id' },
        { status: 400 }
      );
    }

    // ── VERIFY OWNERSHIP ─────────────────────────────────────────────────────────
    // Both characters must belong to owner_email
    const [senderChar, receiverChar] = await Promise.all([
      base44.asServiceRole.entities.Character.filter(
        { id: sender_character_id, owner_email: owner_email || user.email }
      ).then(chars => chars[0]),
      base44.asServiceRole.entities.Character.filter(
        { id: receiver_character_id, owner_email: owner_email || user.email }
      ).then(chars => chars[0]),
    ]);

    if (!senderChar || !receiverChar) {
      return Response.json(
        { error: 'One or both characters do not belong to the authenticated user' },
        { status: 403 }
      );
    }

    const userEmail = owner_email || user.email;

    // ── ENSURE CONVERSATION RECORD EXISTS ────────────────────────────────────────
    // The conversation must have both characters as participants
    const existingConvo = await base44.asServiceRole.entities.Conversation.filter(
      { id: conversation_id }
    ).then(convos => convos[0]);

    let convoId = conversation_id;
    if (existingConvo) {
      // Update conversation to ensure both participant IDs are stored
      if (!existingConvo.character_ids?.includes(receiver_character_id)) {
        const updatedIds = Array.isArray(existingConvo.character_ids)
          ? [...existingConvo.character_ids, receiver_character_id]
          : [sender_character_id, receiver_character_id];
        await base44.asServiceRole.entities.Conversation.update(convoId, {
          character_ids: updatedIds,
        }).catch(() => {});
      }
    } else {
      // Create new shared conversation
      const newConvo = await base44.asServiceRole.entities.Conversation.create({
        title: `${senderChar.name} ↔ ${receiverChar.name} (${channel})`,
        type: channel === 'group_chat' ? 'group' : 'direct',
        character_ids: [sender_character_id, receiver_character_id],
        owner_email: userEmail,
      });
      convoId = newConvo.id;
    }

    // ── CREATE BILATERAL MEMORIES ────────────────────────────────────────────────
    const baseDate = timestamp || new Date().toISOString();
    const memories = [];

    // Memory for sender: "I contacted X about..."
    const senderMemory = await base44.asServiceRole.entities.Memory.create({
      character_id: sender_character_id,
      title: `Contacted ${receiverChar.name}`,
      description: `Reached out to ${receiverChar.name} about "${topic || message_content.substring(0, 50)}". ${response_content ? `They responded: "${response_content.substring(0, 50)}"` : ''}`,
      emotional_impact: emotional_tone || 'neutral',
      lesson_learned: `Communication with ${receiverChar.name}: ${outcome || 'shared moment'}`,
      timestamp: baseDate,
      source_context: `world_phone_${convoId}`,
    });
    memories.push({ character_id: sender_character_id, memory_id: senderMemory.id });

    // Memory for receiver: "X contacted me about..."
    const receiverMemory = await base44.asServiceRole.entities.Memory.create({
      character_id: receiver_character_id,
      title: `${senderChar.name} contacted me`,
      description: `${senderChar.name} reached out about "${topic || message_content.substring(0, 50)}". ${response_content ? 'I responded.' : 'Awaiting response.'}`,
      emotional_impact: emotional_tone || 'neutral',
      lesson_learned: `Heard from ${senderChar.name}: ${outcome || 'shared moment'}`,
      timestamp: baseDate,
      source_context: `world_phone_${convoId}`,
    });
    memories.push({ character_id: receiver_character_id, memory_id: receiverMemory.id });

    // ── CREATE LIFE EVENT (optional, if meaningful) ──────────────────────────────
    let lifeEvent = null;
    if (outcome && ['positive', 'negative', 'significant'].includes(outcome)) {
      lifeEvent = await base44.asServiceRole.entities.LifeEvent.create({
        character_id: sender_character_id,
        character_name: senderChar.name,
        event_type: 'emotional_exchange',
        valence: outcome === 'positive' ? 'positive' : outcome === 'negative' ? 'negative' : 'neutral',
        severity: 'minor',
        title: `Contacted ${receiverChar.name}`,
        description: `Initiated contact with ${receiverChar.name} about "${topic || message_content.substring(0, 50)}"`,
        triggered_by: channel === 'autonomous_contact' ? 'character_decision' : 'user_message',
        context_tags: [channel, topic || 'communication'],
        timestamp: baseDate,
      }).catch(() => null);
    }

    // ── UPDATE FICTIONAL RELATIONSHIPS (if missing) ──────────────────────────────
    // Ensure both characters know about each other if not already recorded
    const senderRelationships = senderChar.fictional_relationships || [];
    const hasReceiverRel = senderRelationships.some(r => r.related_character_id === receiver_character_id);

    if (!hasReceiverRel) {
      await base44.asServiceRole.entities.Character.update(sender_character_id, {
        fictional_relationships: [
          ...senderRelationships,
          {
            person_name: receiverChar.name,
            related_character_id: receiver_character_id,
            relationship_type: 'contact',
            friendship_level: 50,
            description: `Someone I've been in contact with`,
          },
        ],
      }).catch(() => {});
    }

    const receiverRelationships = receiverChar.fictional_relationships || [];
    const hasSenderRel = receiverRelationships.some(r => r.related_character_id === sender_character_id);

    if (!hasSenderRel) {
      await base44.asServiceRole.entities.Character.update(receiver_character_id, {
        fictional_relationships: [
          ...receiverRelationships,
          {
            person_name: senderChar.name,
            related_character_id: sender_character_id,
            relationship_type: 'contact',
            friendship_level: 50,
            description: `Someone who reached out to me`,
          },
        ],
      }).catch(() => {});
    }

    // ── RETURN DIAGNOSTICS ───────────────────────────────────────────────────────
    return Response.json({
      success: true,
      conversation_id: convoId,
      sender_character_id,
      receiver_character_id,
      memories_created: memories.length,
      memory_ids: memories.map(m => m.memory_id),
      life_event_created: !!lifeEvent,
      life_event_id: lifeEvent?.id || null,
      relationships_updated: !hasReceiverRel || !hasSenderRel,
      timestamp: baseDate,
      message_id,
    });
  } catch (error) {
    console.error('[syncBilateralCharacterConversation] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});