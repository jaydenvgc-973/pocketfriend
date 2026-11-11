import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * processDueCharacterDeletions
 *
 * Executor for a deletion that was chosen at the time of death (24 or 48 hours).
 * Invoked once by the "Character Deletion — Trigger on death_deletion_scheduled_at Set"
 * workflow at the registered instant. It is not polled and creates no timers.
 *
 * Removal uses the same writes as deleteCharacter: the record stops being an active
 * character and a CharacterDeletionAudit entry records the deletion. Messages,
 * memories and relationships are never removed — surviving characters keep their
 * protected memories of the deceased.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const nowIso = new Date().toISOString();

  const deceased = await base44.asServiceRole.entities.Character
    .filter({ life_status: 'deceased' }, null, 200)
    .catch(() => []);

  const due = deceased.filter((c) =>
    c.death_deletion_scheduled_at &&
    c.death_deletion_scheduled_at <= nowIso &&
    c.status !== 'soft_deleted'
  );

  const deleted = [];
  for (const c of due) {
    await base44.asServiceRole.entities.Character.update(c.id, {
      status: 'soft_deleted',
      is_active_character: false,
    });
    await base44.asServiceRole.entities.CharacterDeletionAudit.create({
      character_id: c.id,
      deletion_type: 'soft_delete',
    });
    deleted.push({ character_id: c.id, character_name: c.name });
  }

  return Response.json({ success: true, processed: deleted.length, deleted });
});