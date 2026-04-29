import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // AUTH: must be authenticated
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { owner_email } = await req.json();

    // OWNERSHIP GUARD: caller must match owner_email
    if (!owner_email || owner_email !== user.email) {
      return Response.json({ error: 'Forbidden: owner_email must match authenticated user' }, { status: 403 });
    }

    // QUERY: active_created_character only, scoped by owner_email
    const characters = await base44.entities.Character.filter({
      owner_email,
      character_type: 'active_created_character'
    });

    // DISCOVERY ONLY: return character list, no writes, no invocations
    const character_ids = characters.map(c => ({
      character_id: c.id,
      name: c.name || null
    }));

    return Response.json({
      owner_email,
      total: characters.length,
      character_ids
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});