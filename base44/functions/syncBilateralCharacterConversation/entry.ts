/**
 * syncBilateralCharacterConversation
 *
 * Creates or updates a shared conversation record for character-to-character communication.
 * Both characters can query this conversation via:
 *   - character_ids (includes both IDs)
 *   - participant_character_ids (sorted, stable)
 *   - shared_conversation_key (deterministic key: bilateral_<sortedA>_<sortedB>_<channel>)
 *
 * Payload:
 * - owner_email
 * - sender_character_id
 * - receiver_character_id
 * - conversation_id (the World Phone conversation already created by the UI)
 * - message_id
 * - message_content
 * - response_content (optional)
 * - channel: world_phone | direct_text | direct_call | autonomous_contact | group_chat
 * - topic
 * - emotional_tone
 * - outcome
 * - timestamp
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
      sender_message_id,
      receiver_message_id,
      message_content,
      response_content,
      shared_conversation_key: incomingSharedKey,
      participant_character_ids: incomingParticipantIds,
      channel,
      topic,
      emotional_tone,
      outcome,
      timestamp,
    } = payload;

    if (!sender_character_id || !receiver_character_id || !conversation_id) {
      return Response.json(
        { error: 'Missing required fields: sender_character_id, receiver_character_id, conversation_id' },
        { status: 400 }
      );
    }

    const userEmail = owner_email || user.email;

    // ── VERIFY OWNERSHIP ─────────────────────────────────────────────────────────
    const [senderChar, receiverChar] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ id: sender_character_id, owner_email: userEmail }).then(c => c[0]),
      base44.asServiceRole.entities.Character.filter({ id: receiver_character_id, owner_email: userEmail }).then(c => c[0]),
    ]);

    if (!senderChar || !receiverChar) {
      return Response.json(
        { error: 'One or both characters do not belong to the authenticated user' },
        { status: 403 }
      );
    }

    // ── SHARED CONVERSATION KEY ───────────────────────────────────────────────────
    // CRITICAL: Honor the canonical key sent from the frontend (world_phone::A::B).
    // NEVER regenerate a legacy bilateral_X_Y key here — that would overwrite the
    // canonical key on the conversation record and break Character B's lookup.
    const participantIds = incomingParticipantIds || [sender_character_id, receiver_character_id].sort();
    const shared_conversation_key = incomingSharedKey ||
      `world_phone::${participantIds[0]}::${participantIds[1]}`;

    // ── ENSURE CONVERSATION HAS BOTH PARTICIPANTS ─────────────────────────────────
    const existingConvo = await base44.asServiceRole.entities.Conversation.filter({ id: conversation_id })
      .then(convos => convos[0]);

    let convoId = conversation_id;
    if (existingConvo) {
      // Ensure receiver is in character_ids, and canonical key + participant_ids are stamped.
      // Only update what is missing or wrong — never downgrade a canonical key to a legacy one.
      const currentIds = Array.isArray(existingConvo.character_ids) ? existingConvo.character_ids : [sender_character_id];
      const missingReceiver = !currentIds.includes(receiver_character_id);
      const wrongKey = existingConvo.shared_conversation_key !== shared_conversation_key;
      const missingParticipants = !Array.isArray(existingConvo.participant_character_ids) ||
        !participantIds.every(id => existingConvo.participant_character_ids.includes(id));

      if (missingReceiver || wrongKey || missingParticipants) {
        const updatedIds = missingReceiver ? [...currentIds, receiver_character_id] : currentIds;
        await base44.asServiceRole.entities.Conversation.update(convoId, {
          character_ids: updatedIds,
          participant_character_ids: participantIds,
          shared_conversation_key,
        }).catch(() => {});
      }
    } else {
      // Conversation record does not exist — create it fresh with canonical fields
      const newConvo = await base44.asServiceRole.entities.Conversation.create({
        title: `${senderChar.name} ↔ ${receiverChar.name} (${channel || 'world_phone'})`,
        type: 'npc',
        character_ids: [sender_character_id, receiver_character_id],
        participant_character_ids: participantIds,
        shared_conversation_key,
        owner_email: userEmail,
      });
      convoId = newConvo.id;
    }

    // ── BILATERAL MEMORIES ────────────────────────────────────────────────────────
    const baseDate = timestamp || new Date().toISOString();
    const msgSnippet = (message_content || '').substring(0, 60);
    const memories = [];

    const senderMemory = await base44.asServiceRole.entities.Memory.create({
      character_id: sender_character_id,
      title: `Contacted ${receiverChar.name}`,
      description: `Reached out to ${receiverChar.name} about "${topic || msgSnippet}".${response_content ? ` They responded: "${response_content.substring(0, 50)}"` : ''}`,
      emotional_impact: emotional_tone || 'neutral',
      lesson_learned: `Communication with ${receiverChar.name}: ${outcome || 'shared moment'}`,
      timestamp: baseDate,
      source_context: `world_phone_${convoId}`,
    });
    memories.push({ character_id: sender_character_id, memory_id: senderMemory.id });

    const receiverMemory = await base44.asServiceRole.entities.Memory.create({
      character_id: receiver_character_id,
      title: `${senderChar.name} contacted me`,
      description: `${senderChar.name} reached out about "${topic || msgSnippet}".${response_content ? ' I responded.' : ' Awaiting response.'}`,
      emotional_impact: emotional_tone || 'neutral',
      lesson_learned: `Heard from ${senderChar.name}: ${outcome || 'shared moment'}`,
      timestamp: baseDate,
      source_context: `world_phone_${convoId}`,
    });
    memories.push({ character_id: receiver_character_id, memory_id: receiverMemory.id });

    // ── LIFE EVENT (if meaningful) ────────────────────────────────────────────────
    let lifeEvent = null;
    if (outcome && ['positive', 'negative', 'significant'].includes(outcome)) {
      lifeEvent = await base44.asServiceRole.entities.LifeEvent.create({
        character_id: sender_character_id,
        character_name: senderChar.name,
        event_type: 'emotional_exchange',
        valence: outcome === 'positive' ? 'positive' : outcome === 'negative' ? 'negative' : 'neutral',
        severity: 'minor',
        title: `Contacted ${receiverChar.name}`,
        description: `Initiated contact with ${receiverChar.name} about "${topic || msgSnippet}"`,
        triggered_by: channel === 'autonomous_contact' ? 'character_decision' : 'user_message',
        context_tags: [channel || 'world_phone', topic || 'communication'],
        timestamp: baseDate,
      }).catch(() => null);
    }

    // ── UPDATE FICTIONAL RELATIONSHIPS (if missing) ──────────────────────────────
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

    // ── MARK ALL THREE RECORDS AS SYNC COMPLETE ───────────────────────────────────
    // Update sender message, receiver message, and conversation
    await Promise.allSettled([
     sender_message_id ? base44.asServiceRole.entities.Message.update(sender_message_id, { sync_status: 'complete' }) : Promise.resolve(),
     receiver_message_id ? base44.asServiceRole.entities.Message.update(receiver_message_id, { sync_status: 'complete' }) : Promise.resolve(),
     convoId ? base44.asServiceRole.entities.Conversation.update(convoId, { sync_status: 'complete' }) : Promise.resolve(),
    ]);

    // ── RETURN DIAGNOSTICS ───────────────────────────────────────────────────────
    return Response.json({
      success: true,
      conversation_id: convoId,
      shared_conversation_key,
      participant_character_ids: participantIds,
      sender_character_id,
      receiver_character_id,
      sender_message_id,
      receiver_message_id,
      memories_created: memories.length,
      memory_ids: memories.map(m => m.memory_id),
      life_event_created: !!lifeEvent,
      life_event_id: lifeEvent?.id || null,
      relationships_updated: !hasReceiverRel || !hasSenderRel,
      sync_status: 'complete',
      timestamp: baseDate,
    });
  } catch (error) {
    console.error('[syncBilateralCharacterConversation] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});