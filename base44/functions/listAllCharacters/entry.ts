import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });

    return Response.json({
      total: characters.length,
      characters: characters.map(c => ({
        id: c.id,
        name: c.name,
        is_default: c.is_default,
        status: c.status,
        fictional_relationships_count: (c.fictional_relationships || []).length
      }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});