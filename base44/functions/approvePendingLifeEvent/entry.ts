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

    const { pendingId, action, linkedToLabel, overrideDates, overrideName } = await req.json();

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
      // Apply the proposed_data patch to the Character, merging any user-edited dates and name
      let proposedData = { ...(pending.proposed_data || {}), ...(overrideDates || {}) };

      // Apply user-edited course/training name override
      if (overrideName) {
        if (pending.change_type === 'education_change') {
          proposedData.current_education_activity = overrideName;
          if (proposedData.education_details) {
            proposedData.education_details = { ...proposedData.education_details, course_name: overrideName };
          }
        } else if (pending.change_type === 'job_training_change') {
          proposedData.current_job_training_activity = overrideName;
          if (proposedData.job_training_details) {
            proposedData.job_training_details = { ...proposedData.job_training_details, training_name: overrideName };
          }
        }
      }
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