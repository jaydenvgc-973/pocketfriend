import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * deliverVickFindings
 *
 * Scans for VickInvestigation records with status=findings_ready and findings_delivered=false.
 * For each undelivered finding, saves a Message to Vick's conversation so the user sees it.
 * Marks findings_delivered=true and status=completed after delivery.
 *
 * Called by:
 *   - Scheduled automation (every 5 minutes)
 *   - Frontend after Vick completes an in-chat investigation
 *   - Any backend that creates a VickInvestigation with findings
 *
 * Critical findings (priority=critical) are delivered immediately.
 * All findings persist in the conversation until the user reads them.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // This function is called as service role from automations and frontend.
    // Auth is optional — if called from automation (no user token), use service role throughout.
    let ownerEmail = null;
    try {
      const user = await base44.auth.me();
      ownerEmail = user?.email || null;
    } catch (_) {
      // Automation context — no user auth. ownerEmail stays null → process all accounts.
    }

    // Find undelivered findings
    const query = {
      findings_delivered: false,
    };
    if (ownerEmail) query.owner_email = ownerEmail;

    const pending = await base44.asServiceRole.entities.VickInvestigation.filter(
      query, '-created_date', 50
    );

    const readyToDeliver = pending.filter(inv =>
      inv.status === 'findings_ready' && inv.findings && !inv.findings_delivered
    );

    if (readyToDeliver.length === 0) {
      return Response.json({ success: true, delivered: 0, message: 'No pending findings to deliver.' });
    }

    let delivered = 0;
    const errors = [];

    for (const inv of readyToDeliver) {
      try {
        // Resolve Vick's conversation for this account
        let conversationId = inv.conversation_id;

        if (!conversationId && inv.vick_character_id && inv.owner_email) {
          const convos = await base44.asServiceRole.entities.Conversation.filter({
            owner_email: inv.owner_email,
          }, '-updated_date', 50);

          const vickConvo = convos.find(c =>
            (c.character_ids || []).includes(inv.vick_character_id) &&
            (c.type === 'direct' || c.type === 'npc')
          );
          if (vickConvo) {
            conversationId = vickConvo.id;
            // Cache for future deliveries
            await base44.asServiceRole.entities.VickInvestigation.update(inv.id, {
              conversation_id: conversationId,
            });
          }
        }

        if (!conversationId) {
          // Cannot deliver without a conversation — mark as needing user to open chat first
          errors.push(`Investigation ${inv.id}: no conversation found for ${inv.owner_email}`);
          continue;
        }

        // Build the delivery message
        const priorityPrefix = inv.priority === 'critical'
          ? '🔴 CRITICAL FINDINGS — '
          : inv.priority === 'high'
            ? '🟡 HIGH PRIORITY — '
            : '';

        const messageContent = `${priorityPrefix}Investigation Complete: ${inv.title}\n\n${inv.findings}`;

        // Save message as Vick speaking
        await base44.asServiceRole.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: inv.vick_character_id || null,
          character_name: 'Vick Servicio',
          content: messageContent,
          is_read: false,
          timestamp: new Date().toISOString(),
          channel: 'direct',
          recovery_signal: false,
          memory_eligible: false,
          relationship_eligible: false,
          source_message_id: inv.source_message_id || null,
        });

        // Mark as delivered and completed
        await base44.asServiceRole.entities.VickInvestigation.update(inv.id, {
          findings_delivered: true,
          status: 'completed',
          completed_at: new Date().toISOString(),
          conversation_id: conversationId,
        });

        // Update conversation preview so Home card badge fires
        await base44.asServiceRole.entities.Conversation.update(conversationId, {
          last_message_preview: messageContent.substring(0, 100),
          last_message_date: new Date().toISOString(),
        });

        delivered++;
        console.log(`[deliverVickFindings] Delivered findings for investigation "${inv.title}" to ${inv.owner_email}`);
      } catch (err) {
        errors.push(`Investigation ${inv.id}: ${err.message}`);
        console.error(`[deliverVickFindings] Failed to deliver ${inv.id}: ${err.message}`);
      }
    }

    return Response.json({
      success: true,
      delivered,
      errors,
      totalPending: readyToDeliver.length,
    });
  } catch (error) {
    console.error('[deliverVickFindings]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});