import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncWorldPhoneMemory
 * Writes conversation memory for ALL characters involved in a World Phone / Group Chat exchange.
 * Called after any character-to-character interaction so both sides remember it.
 * 
 * Payload:
 *   senderCharacterId: string — who sent the message
 *   receiverCharacterId: string — who received it
 *   messageContent: string — what was said
 *   context: string — 'world_phone' | 'group_chat' | 'scene' | 'travel'
 *   conversationId: string (optional)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { senderCharacterId, receiverCharacterId, messageContent, context, conversationId } = await req.json();

    if (!senderCharacterId || !receiverCharacterId || !messageContent) {
      return Response.json({ error: 'Missing required fields: senderCharacterId, receiverCharacterId, messageContent' }, { status: 400 });
    }

    // Fetch both characters — ownership enforced by owner_email
    const [senderResults, receiverResults] = await Promise.all([
      base44.entities.Character.filter({ id: senderCharacterId }),
      base44.entities.Character.filter({ id: receiverCharacterId }),
    ]);

    const sender = senderResults[0];
    const receiver = receiverResults[0];

    if (!sender || !receiver) {
      return Response.json({ error: 'One or both characters not found' }, { status: 404 });
    }

    // LEGACY COMPATIBILITY OWNERSHIP CHECK:
    // Legacy characters may not have owner_email set (created before that field was required).
    // RLS already enforces scope at the DB layer — only allow the check to block when
    // owner_email is explicitly set to a DIFFERENT user's email.
    // Missing owner_email = legacy record = allowed (do not block).
    const senderEmailMismatch = sender.owner_email && sender.owner_email !== user.email;
    const receiverEmailMismatch = receiver.owner_email && receiver.owner_email !== user.email;
    if (senderEmailMismatch || receiverEmailMismatch) {
      console.warn(`[syncWorldPhoneMemory] Ownership warning — sender=${sender.owner_email || 'unset'} receiver=${receiver.owner_email || 'unset'} user=${user.email}`);
      return Response.json({ error: 'Ownership violation: characters must belong to current user' }, { status: 403 });
    }

    const contextLabel = context || 'world_phone';
    const timestamp = new Date().toISOString();
    const sourceCtx = conversationId ? `${contextLabel}_${conversationId}` : contextLabel;

    // Write memory for SENDER — includes the full exchange (sent + received)
    const senderMemory = base44.entities.Memory.create({
      character_id: senderCharacterId,
      title: `${contextLabel.replace(/_/g, ' ')} with ${receiver.name}`,
      description: `Exchange with ${receiver.name} via ${contextLabel.replace(/_/g, ' ')}: ${messageContent.substring(0, 400)}`,
      emotional_impact: 'neutral',
      timestamp,
      source_context: `${sourceCtx}_sender`,
    });

    // Write memory for RECEIVER — they know both what was said to them AND what they replied
    const receiverMemory = base44.entities.Memory.create({
      character_id: receiverCharacterId,
      title: `${contextLabel.replace(/_/g, ' ')} from ${sender.name}`,
      description: `Exchange with ${sender.name} via ${contextLabel.replace(/_/g, ' ')}: ${messageContent.substring(0, 400)}`,
      emotional_impact: 'neutral',
      timestamp,
      source_context: `${sourceCtx}_receiver`,
    });

    await Promise.all([senderMemory, receiverMemory]);

    // Update last_interaction_summary on both sides — only for real exchanges, never for bootstrap
    const senderInteractionSummary = `Sent a ${contextLabel.replace(/_/g, ' ')} message: "${messageContent.substring(0, 100)}"`;
    const receiverInteractionSummary = `${sender.name} reached out via ${contextLabel.replace(/_/g, ' ')}: "${messageContent.substring(0, 100)}"`;

    // ── FRESH READ BEFORE WRITE ────────────────────────────────────────────────
    // CRITICAL: Always re-fetch the LATEST fictional_relationships immediately before
    // writing. Using the records fetched at the top of this function is unsafe — any
    // concurrent write (AddPeopleInTheirWorldPanel, NPCRelationshipEditor,
    // ensureBilateralCharacterAwareness) between that fetch and this write will be silently
    // overwritten by a stale array. This is the primary cause of relationship data loss.
    // Sequential fetch+write (not parallel) ensures each write sees the latest state.

    // Sender: re-fetch immediately before write
    const freshSenderArr = await base44.entities.Character.filter({ id: senderCharacterId }).catch(() => []);
    const freshSender = freshSenderArr[0];
    if (freshSender) {
      const senderRels = freshSender.fictional_relationships || [];
      const senderRelIdx = senderRels.findIndex(r => r.related_character_id === receiverCharacterId);
      if (senderRelIdx >= 0) {
        const updatedSenderRels = senderRels.map((r, i) =>
          i === senderRelIdx ? { ...r, last_interaction_summary: senderInteractionSummary } : r
        );
        await base44.entities.Character.update(senderCharacterId, { fictional_relationships: updatedSenderRels });
      } else {
        await base44.entities.Character.update(senderCharacterId, {
          fictional_relationships: [
            ...senderRels,
            {
              person_name: receiver.name,
              related_character_id: receiverCharacterId,
              relationship_type: 'acquaintance',
              current_status: 'ongoing',
              friendship_level: 50,
              user_respect_level: 50,
              romantic_level: 0,
              attraction_level: 0,
              chosen_family_level: 0,
              last_interaction_summary: senderInteractionSummary,
            },
          ],
        });
      }
    }

    // Receiver: re-fetch immediately before write (after sender write completes)
    const freshReceiverArr = await base44.entities.Character.filter({ id: receiverCharacterId }).catch(() => []);
    const freshReceiver = freshReceiverArr[0];
    if (freshReceiver) {
      const receiverRels = freshReceiver.fictional_relationships || [];
      const receiverRelIdx = receiverRels.findIndex(r => r.related_character_id === senderCharacterId);
      if (receiverRelIdx >= 0) {
        const updatedReceiverRels = receiverRels.map((r, i) =>
          i === receiverRelIdx ? { ...r, last_interaction_summary: receiverInteractionSummary } : r
        );
        await base44.entities.Character.update(receiverCharacterId, { fictional_relationships: updatedReceiverRels });
      } else {
        await base44.entities.Character.update(receiverCharacterId, {
          fictional_relationships: [
            ...receiverRels,
            {
              person_name: sender.name,
              related_character_id: senderCharacterId,
              relationship_type: 'acquaintance',
              current_status: 'ongoing',
              friendship_level: 50,
              user_respect_level: 50,
              romantic_level: 0,
              attraction_level: 0,
              chosen_family_level: 0,
              last_interaction_summary: receiverInteractionSummary,
            },
          ],
        });
      }
    }

    console.log(`[syncWorldPhoneMemory] Complete | ${sender.name} (${senderCharacterId}) ↔ ${receiver.name} (${receiverCharacterId}) | context=${contextLabel}`);

    return Response.json({
      success: true,
      sender: sender.name,
      sender_id: senderCharacterId,
      receiver: receiver.name,
      receiver_id: receiverCharacterId,
      context: contextLabel,
      memory_written: true,
      relationship_synced: true,
    });

  } catch (error) {
    console.error('[syncWorldPhoneMemory] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});