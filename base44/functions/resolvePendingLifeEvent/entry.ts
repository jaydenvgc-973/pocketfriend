import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * resolvePendingLifeEvent
 *
 * Handles user approval/rejection of AI-proposed occupation or education changes.
 *
 * Payload:
 *   pendingEventId: string  — ID of the PendingLifeEvent record
 *   action: 'approve' | 'reject' | 'link'
 *   linkTarget: string (optional) — description of what existing entry it maps to (for 'link')
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { pendingEventId, action, linkTarget } = await req.json();
    if (!pendingEventId || !action) {
      return Response.json({ error: 'pendingEventId and action required' }, { status: 400 });
    }

    const pending = await base44.entities.PendingLifeEvent.get(pendingEventId);
    if (!pending) return Response.json({ error: 'Pending event not found' }, { status: 404 });
    if (pending.status !== 'pending') {
      return Response.json({ error: 'Event already resolved' }, { status: 400 });
    }

    const now = new Date().toISOString();

    if (action === 'approve') {
      // Apply the proposed data patch to the character
      await base44.asServiceRole.entities.Character.update(pending.character_id, pending.proposed_data);
      await base44.entities.PendingLifeEvent.update(pendingEventId, { status: 'approved', resolved_at: now });

      // Log a life event for the change
      try {
        const categoryLabel = {
          occupation: 'Work Update',
          education: 'Education Update',
          job_training: 'Job Training Update',
        }[pending.event_category] || 'Life Update';

        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: pending.character_id,
          character_name: pending.character_name,
          event_type: pending.event_category === 'occupation' ? 'life_milestone_event' : 'growth_event',
          valence: 'positive',
          severity: 'moderate',
          title: categoryLabel,
          description: pending.description,
          triggered_by: 'user_message',
          timestamp: now,
        });
      } catch (_) {}

      return Response.json({ success: true, action: 'approved', message: 'Change applied to character profile.' });
    }

    if (action === 'reject') {
      await base44.entities.PendingLifeEvent.update(pendingEventId, { status: 'rejected', resolved_at: now });
      return Response.json({ success: true, action: 'rejected', message: 'Proposed change discarded.' });
    }

    if (action === 'link') {
      // User says this already exists — mark as linked (no patch applied)
      await base44.entities.PendingLifeEvent.update(pendingEventId, {
        status: 'linked',
        resolved_at: now,
        source_context: (pending.source_context || '') + ` | Linked to: ${linkTarget || 'existing entry'}`,
      });
      return Response.json({ success: true, action: 'linked', message: 'Marked as existing entry. No changes made.' });
    }

    return Response.json({ error: 'Invalid action. Use approve, reject, or link.' }, { status: 400 });
  } catch (error) {
    console.error('[resolvePendingLifeEvent]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});