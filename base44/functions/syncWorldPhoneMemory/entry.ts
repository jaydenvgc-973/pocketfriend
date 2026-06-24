import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

    const { senderCharacterId, receiverCharacterId, messageContent, context, conversationId, receiverMessageId } = await req.json();

    if (!senderCharacterId || !receiverCharacterId || !messageContent) {
      return Response.json({ error: 'Missing required fields: senderCharacterId, receiverCharacterId, messageContent' }, { status: 400 });
    }

    // ── CANON EXCLUSION GUARD ──────────────────────────────────────────────────
    // If the NPC response message has been canon-excluded (fourth-wall violation,
    // impossible knowledge, or user removal), do NOT write memories or relationship
    // updates from it. This function must never propagate excluded content.
    if (receiverMessageId) {
      const receiverMsgs = await base44.entities.Message.filter({ id: receiverMessageId }).catch(() => []);
      const receiverMsg = receiverMsgs[0];
      if (receiverMsg?.canon_excluded === true || receiverMsg?.memory_eligible === false) {
        console.log(`[syncWorldPhoneMemory] SKIPPED — message ${receiverMessageId} is canon_excluded or memory_ineligible`);
        return Response.json({
          success: true,
          skipped: true,
          reason: 'canon_excluded',
          message_id: receiverMessageId,
        });
      }
    }

    // Fetch both characters — use asServiceRole for world service characters (e.g. Vick Servicio)
    // which have null owner_email and are invisible to user-scoped queries.
    // CRITICAL: World service characters MUST be reachable for memory sync.
    const [senderResults, receiverResults] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ id: senderCharacterId }).catch(() => []),
      base44.asServiceRole.entities.Character.filter({ id: receiverCharacterId }).catch(() => []),
    ]);

    const sender = senderResults[0];
    const receiver = receiverResults[0];

    if (!sender || !receiver) {
      return Response.json({ error: 'One or both characters not found' }, { status: 404 });
    }

    // OWNERSHIP CHECK:
    // Allow the sync if:
    //   - the character's owner_email matches the authenticated user, OR
    //   - the character has no owner_email (world service / shared / legacy character)
    // Block only if owner_email is explicitly set to a DIFFERENT user's email.
    const senderEmailMismatch = sender.owner_email && sender.owner_email !== user.email;
    const receiverEmailMismatch = receiver.owner_email && receiver.owner_email !== user.email;
    if (senderEmailMismatch || receiverEmailMismatch) {
      console.warn(`[syncWorldPhoneMemory] Ownership violation — sender=${sender.owner_email || 'unset'} receiver=${receiver.owner_email || 'unset'} user=${user.email}`);
      return Response.json({ error: 'Ownership violation: characters must belong to current user' }, { status: 403 });
    }

    const contextLabel = context || 'world_phone';
    const timestamp = new Date().toISOString();
    const sourceCtx = conversationId ? `${contextLabel}_${conversationId}` : contextLabel;

    // Write memory for SENDER — use asServiceRole to handle world service characters (null owner_email)
    const senderMemory = base44.asServiceRole.entities.Memory.create({
      character_id: senderCharacterId,
      title: `${contextLabel.replace(/_/g, ' ')} with ${receiver.name}`,
      description: `Exchange with ${receiver.name} via ${contextLabel.replace(/_/g, ' ')}: ${messageContent.substring(0, 400)}`,
      emotional_impact: 'neutral',
      timestamp,
      source_context: `${sourceCtx}_sender`,
    });

    // Write memory for RECEIVER — use asServiceRole for same reason
    const receiverMemory = base44.asServiceRole.entities.Memory.create({
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

    // CRITICAL: Use asServiceRole for all character reads/writes here.
    // World service characters (e.g. Vick Servicio) have null owner_email —
    // user-scoped queries return 0 results for them, causing silent write failures.
    // asServiceRole bypasses RLS and allows memory sync for ALL character types.

    // Sender: re-fetch immediately before write
    const freshSenderArr = await base44.asServiceRole.entities.Character.filter({ id: senderCharacterId }).catch(() => []);
    const freshSender = freshSenderArr[0];
    if (freshSender) {
      const senderRels = freshSender.fictional_relationships || [];
      const senderRelIdx = senderRels.findIndex(r => r.related_character_id === receiverCharacterId);
      if (senderRelIdx >= 0) {
        const updatedSenderRels = senderRels.map((r, i) =>
          i === senderRelIdx ? { ...r, last_interaction_summary: senderInteractionSummary } : r
        );
        await base44.asServiceRole.entities.Character.update(senderCharacterId, { fictional_relationships: updatedSenderRels });
      } else {
        await base44.asServiceRole.entities.Character.update(senderCharacterId, {
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
    const freshReceiverArr = await base44.asServiceRole.entities.Character.filter({ id: receiverCharacterId }).catch(() => []);
    const freshReceiver = freshReceiverArr[0];
    if (freshReceiver) {
      const receiverRels = freshReceiver.fictional_relationships || [];
      const receiverRelIdx = receiverRels.findIndex(r => r.related_character_id === senderCharacterId);
      if (receiverRelIdx >= 0) {
        const updatedReceiverRels = receiverRels.map((r, i) =>
          i === receiverRelIdx ? { ...r, last_interaction_summary: receiverInteractionSummary } : r
        );
        await base44.asServiceRole.entities.Character.update(receiverCharacterId, { fictional_relationships: updatedReceiverRels });
      } else {
        await base44.asServiceRole.entities.Character.update(receiverCharacterId, {
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