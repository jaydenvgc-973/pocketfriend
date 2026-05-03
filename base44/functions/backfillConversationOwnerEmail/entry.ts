import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Use service role to read ALL conversations regardless of owner_email
  // Then filter in application code — only touch records where created_by_id matches this user's platform ID
  const allConvos = await base44.asServiceRole.entities.Conversation.list('-created_date', 500);

  const toRepair = allConvos.filter(c => {
    // Only records missing owner_email
    if (c.owner_email) return false;
    // Only records created by this exact authenticated user (platform UUID match)
    if (c.created_by_id !== user.id) return false;
    return true;
  });

  const unresolvable = allConvos.filter(c => {
    // Missing owner_email but does NOT match this user — belongs to someone else or unknown
    if (c.owner_email) return false;
    if (c.created_by_id === user.id) return false;
    return true;
  });

  const updated = [];
  const failed = [];

  for (const convo of toRepair) {
    try {
      await base44.asServiceRole.entities.Conversation.update(convo.id, {
        owner_email: user.email,
        owner_user_id: user.id,
      });
      updated.push(convo.id);
    } catch (err) {
      failed.push({ id: convo.id, error: err.message });
    }
  }

  return Response.json({
    authenticated_user_id: user.id,
    authenticated_user_email: user.email,
    total_scanned: allConvos.length,
    total_missing_owner_email: toRepair.length + unresolvable.length,
    total_matched_to_current_user: toRepair.length,
    total_updated: updated.length,
    total_failed: failed.length,
    skipped_unresolvable: unresolvable.length,
    ids_updated: updated,
    ids_failed: failed,
    // NOTE: unresolvable records are left untouched — they belong to other users or are genuinely unknown
    // NOTE: Character records, RLS, Home loaders, and NPC loaders are NOT touched by this function
  });
});