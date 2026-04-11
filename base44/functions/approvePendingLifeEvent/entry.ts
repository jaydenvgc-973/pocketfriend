import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * approvePendingLifeEvent
 *
 * Handles user decisions on AI-proposed occupation/education changes.
 * Actions:
 *   approve  - Apply the proposed_data patch to the Character entity
 *   reject   - Mark the record as rejected, no changes applied
 *   link     - Mark as linked to an existing entry, no new data added
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { pendingId, action, linkedToLabel } = await req.json();

    if (!pendingId || !action) {
      return Response.json({ error: 'pendingId and action required' }, { status: 400 });
    }
    if (!['approve', 'reject', 'link'].includes(action)) {
      return Response.json({ error: 'action must be approve, reject, or link' }, { status: 400 });
    }

    const pending = (await base44.asServiceRole.entities.PendingLifeEvent.filter({ id: pendingId }))[0];
    if (!pending) return Response.json({ error: 'Pending event not found' }, { status: 404 });
    if (pending.status !== 'pending') {
      return Response.json({ error: 'This event has already been resolved' }, { status: 400 });
    }

    if (action === 'approve') {
      // Apply the proposed_data patch to the Character
      const proposedData = pending.proposed_data || {};
      if (Object.keys(proposedData).length > 0) {
        await base44.asServiceRole.entities.Character.update(pending.character_id, proposedData);
      }
      await base44.asServiceRole.entities.PendingLifeEvent.update(pendingId, { status: 'approved' });

      return Response.json({ success: true, action: 'approved', applied: Object.keys(proposedData) });
    }

    if (action === 'reject') {
      await base44.asServiceRole.entities.PendingLifeEvent.update(pendingId, { status: 'rejected' });
      return Response.json({ success: true, action: 'rejected' });
    }

    if (action === 'link') {
      await base44.asServiceRole.entities.PendingLifeEvent.update(pendingId, {
        status: 'linked',
        linked_to_label: linkedToLabel || 'existing entry',
      });
      return Response.json({ success: true, action: 'linked', linkedTo: linkedToLabel });
    }

  } catch (error) {
    console.error('[approvePendingLifeEvent]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});