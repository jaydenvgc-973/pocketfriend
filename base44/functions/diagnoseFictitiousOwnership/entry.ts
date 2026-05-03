import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DIAGNOSTIC ONLY — NO DATA CHANGES
 * 
 * Queries npc_fictitious characters via TWO separate paths:
 * 1. User-scoped RLS query (same as Settings regularCharacters)
 * 2. Service-role query filtered by owner_email (same as fetchNPCsForUser)
 * 
 * Returns full name/id/owner_email/owner_user_id for every record found,
 * and labels which source(s) found each record.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Accept ?path=rls or ?path=service from query string to run one path at a time
    const url = new URL(req.url);
    const path = url.searchParams.get('path') || 'rls';

    let records = [];

    if (path === 'rls') {
      // PATH 1 ONLY: RLS-scoped (what Settings regularCharacters sees)
      const rlsAll = await base44.entities.Character.filter(
        { owner_email: user.email },
        '-created_date',
        300
      );
      records = rlsAll
        .filter(c => c.character_type === 'npc_fictitious' && c.status !== 'deleted')
        .map(c => ({
          id: c.id,
          name: c.name || null,
          owner_email: c.owner_email || null,
          owner_user_id: c.owner_user_id || null,
          status: c.status,
          _source: 'RLS',
        }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
      // PATH 2 ONLY: service-role filtered by owner_email (what fetchNPCsForUser sees)
      const serviceAll = await base44.asServiceRole.entities.Character.filter(
        { owner_email: user.email },
        '-created_date',
        300
      );
      records = serviceAll
        .filter(c => c.character_type === 'npc_fictitious' && c.status !== 'deleted')
        .map(c => ({
          id: c.id,
          name: c.name || null,
          owner_email: c.owner_email || null,
          owner_user_id: c.owner_user_id || null,
          status: c.status,
          _source: 'SERVICE',
        }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    // Return compact summary to avoid truncation
    const summary = records.map(c =>
      `${c._source} | ${c.name} | id:${c.id} | owner_email:${c.owner_email} | owner_user_id:${c.owner_user_id} | status:${c.status}`
    );

    return Response.json({
      user_email: user.email,
      rlsCount: rlsFictitious.length,
      serviceCount: serviceFictitious.length,
      unionCount: records.length,
      summary,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});