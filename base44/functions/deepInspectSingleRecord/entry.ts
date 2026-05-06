import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Inspects Andre Rivera via both SDK paths to expose the exact data structure
 * and explain the service-role invisibility.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ANDRE_ID = '69cd1c421ecd8b69850b3a6a';

    // Path 1: User RLS token (should work per backfillMyCharacterOwnerEmail)
    let rlsRecord = null;
    try {
      const rlsResult = await base44.entities.Character.filter({ id: ANDRE_ID }, '-created_date', 1);
      rlsRecord = rlsResult[0] || null;
    } catch (e) {
      rlsRecord = { error: e.message };
    }

    // Path 2: Service role by owner_email + id
    let srByOwner = null;
    try {
      const r = await base44.asServiceRole.entities.Character.filter(
        { id: ANDRE_ID, owner_email: 'murqart@gmail.com' },
        '-created_date', 1
      );
      srByOwner = r[0] || null;
    } catch (e) {
      srByOwner = { error: e.message };
    }

    // Path 3: List all via service role, find by id manually
    let foundInList = null;
    try {
      const all = await base44.asServiceRole.entities.Character.list('-created_date', 500);
      const match = all.find(c => c.id === ANDRE_ID);
      foundInList = match ? {
        found: true,
        owner_email: match.owner_email,
        owner_user_id: match.owner_user_id,
        name: match.name,
      } : { found: false, total_in_list: all.length };
    } catch (e) {
      foundInList = { error: e.message };
    }

    return Response.json({
      rls_path: rlsRecord ? {
        found: true,
        owner_email: rlsRecord.owner_email ?? 'MISSING',
        owner_user_id: rlsRecord.owner_user_id ?? 'MISSING',
        name: rlsRecord.name,
      } : { found: false },
      service_role_by_owner_and_id: srByOwner ? {
        found: true,
        owner_email: srByOwner.owner_email ?? 'MISSING',
        name: srByOwner.name,
      } : { found: false },
      service_role_list_search: foundInList,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});