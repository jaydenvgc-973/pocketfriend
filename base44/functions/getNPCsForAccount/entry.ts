import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getNPCsForAccount
 *
 * Fetches NPCs for the authenticated user's account using SERVICE ROLE,
 * which bypasses RLS entirely. This is necessary because NPCs created via
 * createFictionalRelationship use asServiceRole, meaning the platform's
 * immutable created_by_id gets set to the admin/calling session — NOT the
 * actual owning user. This causes permanent RLS leakage if we rely on the
 * frontend SDK (which uses user session RLS).
 *
 * This function is the ONLY safe way to fetch NPCs — it uses owner_email
 * as the sole authoritative ownership field.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use asServiceRole to bypass RLS — filter strictly by owner_email
    // Include all NPC-like types (npc, family_npc, background, promoted_npc)
    // to catch NPCs regardless of how they were created or tagged
    const npcs = await base44.asServiceRole.entities.Character.filter(
      {
        owner_email: user.email,
        character_type: { $in: ['npc', 'family_npc', 'background', 'promoted_npc'] },
        status: { $in: ['active', null] },
      },
      '-created_date',
      100
    );

    // Triple-check: hard filter on owner_email to prevent any leakage
    const owned = npcs.filter(c =>
      c.owner_email === user.email &&
      !c.protected_active &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted'
    );

    return Response.json({ npcs: owned });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});