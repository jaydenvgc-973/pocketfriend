import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * deliverVickFindings
 *
 * GAP FIX G1: Findings delivery mechanism.
 *
 * Trigger: entity automation on VickInvestigation when status → "findings_ready".
 *
 * What it does:
 *   1. Finds Vick's conversation with the user for this account.
 *   2. Delivers the investigation findings as a message in that conversation.
 *   3. Updates investigation status to "delivered" with delivery timestamp.
 *
 * Scope: Scoped to owner_email. No cross-account access.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));

    // Payload from entity automation contains event and data
    const event = payload.event || {};
    const investigation = payload.data || {};

    if (!investigation?.id) {
      return Response.json({ error: 'No investigation data in payload' }, { status: 400 });
    }

    const ownerEmail = investigation.owner_email;
    if (!ownerEmail) {
      return Response.json({ error: 'Investigation missing owner_email' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();

    // ── STEP 1: Find Vick's character record (safe multi-path lookup) ───────
    // Priority: is_world_service flag → name match → character_type fallback.
    // Vick's character_type is NOT required — the lookup finds him regardless.
    let vick = null;

    // Path 1: is_world_service flag (type-independent, safest)
    try {
      const results = await base44.asServiceRole.entities.Character.filter(
        { is_world_service: true, owner_email: ownerEmail, status: 'active' },
        '-created_date', 5
      ).catch(() => []);
      if (results.length > 0) vick = results[0];
    } catch (_) {}

    // Path 2: name match (works regardless of type/flag state)
    if (!vick) {
      try {
        const results = await base44.asServiceRole.entities.Character.filter(
          { name: 'Vick Servicio', owner_email: ownerEmail, status: 'active' },
          '-created_date', 5
        ).catch(() => []);
        if (results.length > 0) vick = results[0];
      } catch (_) {}
    }

    // Path 3: character_type fallback (legacy path, kept as last resort)
    if (!vick) {
      try {
        const results = await base44.asServiceRole.entities.Character.filter(
          { character_type: 'npc_world_service', owner_email: ownerEmail, status: 'active' },
          '-created_date', 5
        ).catch(() => []);
        if (results.length > 0) vick = results[0];
      } catch (_) {}
    }

    if (!vick) {
      console.log(`[deliverVickFindings] No active Vick for ${ownerEmail} — cannot deliver findings`);
      return Response.json({
        success: false,
        reason: 'No active Vick character for this account',
        ownerEmail,
      });
    }

    // ── STEP 2: Find or create Vick's conversation with the user ──────────────
    // Search for existing direct conversation with Vick
    let conversation = null;
    try {
      const convos = await base44.asServiceRole.entities.Conversation.filter(
        { owner_email: ownerEmail, type: 'direct' },
        '-updated_date',
        50
      ).catch(() => []);

      conversation = convos.find(c =>
        Array.isArray(c.character_ids) &&
        c.character_ids.includes(vick.id)
      );
    } catch (_) {}

    if (!conversation) {
      // Create a new conversation
      conversation = await base44.asServiceRole.entities.Conversation.create({
        title: 'Vick Servicio — Recovery Yard',
        type: 'direct',
        character_ids: [vick.id],
        owner_email: ownerEmail,
        channel: 'direct',
        last_message_preview: 'Findings ready for review.',
        last_message_date: nowIso,
      }).catch(() => null);

      if (!conversation) {
        return Response.json({
          success: false,
          reason: 'Could not create conversation for findings delivery',
          ownerEmail,
        });
      }
    }

    // ── STEP 3: Format and deliver findings message ───────────────────────────
    const title = investigation.title || 'Investigation';
    const findings = investigation.findings || '(No findings text recorded)';
    const resolution = investigation.resolution || null;
    const priority = investigation.priority || 'normal';
    const tags = Array.isArray(investigation.tags) ? investigation.tags : [];

    const priorityLabel = { critical: 'CRITICAL', high: 'High', normal: 'Normal', low: 'Low' }[priority] || 'Normal';
    const resolutionLabel = resolution
      ? {
          resolved: 'Resolved',
          confirmed_defect: 'Confirmed Defect',
          confirmed_data_issue: 'Data Issue',
          confirmed_system_issue: 'System Issue',
          user_action_required: 'Action Required',
          monitoring_required: 'Monitoring Required',
          unable_to_verify: 'Unable to Verify',
        }[resolution] || resolution
      : null;

    const messageText = [
      `═══ RECOVERY YARD FINDINGS ═══`,
      ``,
      `Investigation: ${title}`,
      `Priority: ${priorityLabel}`,
      resolutionLabel ? `Classification: ${resolutionLabel}` : '',
      tags.length > 0 ? `Tags: ${tags.join(', ')}` : '',
      ``,
      `Findings:`,
      findings,
      ``,
      resolution === 'user_action_required'
        ? 'This requires your decision before I can proceed.'
        : resolution === 'monitoring_required'
          ? 'I will continue monitoring this. No action needed from you yet.'
          : 'Review complete. Let me know if you have questions.',
    ].filter(Boolean).join('\n');

    // Save message to conversation
    await base44.asServiceRole.entities.Message.create({
      conversation_id: conversation.id,
      sender_type: 'character',
      character_id: vick.id,
      character_name: vick.name || 'Vick Servicio',
      content: messageText,
      recovery_signal: false,
      memory_eligible: true,
      relationship_eligible: true,
      is_read: false,
      timestamp: nowIso,
    }).catch(err => {
      console.error(`[deliverVickFindings] Message save failed: ${err.message}`);
      return null;
    });

    // ── STEP 4: Update investigation status to delivered ──────────────────────
    await base44.asServiceRole.entities.VickInvestigation.update(investigation.id, {
      status: 'delivered',
      findings_delivered: true,
      delivered_at: nowIso,
      conversation_id: conversation.id,
      vick_character_id: vick.id,
    }).catch(err => {
      console.warn(`[deliverVickFindings] Investigation status update failed: ${err.message}`);
    });

    // Update conversation last_message_preview
    await base44.asServiceRole.entities.Conversation.update(conversation.id, {
      last_message_preview: `Recovery Yard findings: ${title}`,
      last_message_date: nowIso,
    }).catch(() => {});

    console.log(`[deliverVickFindings] Delivered findings for investigation ${investigation.id} to ${ownerEmail}`);

    return Response.json({
      success: true,
      ownerEmail,
      investigationId: investigation.id,
      conversationId: conversation.id,
      vickCharacterId: vick.id,
      message: 'Findings delivered to Vick conversation',
    });

  } catch (error) {
    console.error('[deliverVickFindings]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});