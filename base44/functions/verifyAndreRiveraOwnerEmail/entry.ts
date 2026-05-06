import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ANDRE_ID = '69cd1c421ecd8b69850b3a6a';

    // Single direct ID lookup via service role
    const result = await base44.asServiceRole.entities.Character.filter({ id: ANDRE_ID }, '-created_date', 1);

    if (result.length === 0) {
      return Response.json({ found: false, note: 'SDK service role cannot find this record by ID at all' });
    }

    const r = result[0];
    return Response.json({
      found: true,
      id: r.id,
      name: r.name,
      owner_email: r.owner_email ?? 'MISSING',
      owner_user_id: r.owner_user_id ?? 'MISSING',
      character_type: r.character_type,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});