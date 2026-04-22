import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role to bypass RLS — fetch ALL npc_fictitious characters owned by this user
    const byOwnerId = await base44.asServiceRole.entities.Character.filter(
      { owner_user_id: user.id, character_type: 'npc_fictitious' },
      '-created_date',
      200
    );

    const byOwnerEmail = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email, character_type: 'npc_fictitious' },
      '-created_date',
      200
    );

    // Merge and deduplicate
    const seen = new Set();
    const all = [...byOwnerId, ...byOwnerEmail].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return c.status !== 'deleted' && c.status !== 'moved_away';
    });

    return Response.json({ npcs: all });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});