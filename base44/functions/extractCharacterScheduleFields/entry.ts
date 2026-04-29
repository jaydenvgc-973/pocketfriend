import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { character_id, owner_email } = await req.json();

    if (!owner_email || owner_email !== user.email) {
      return Response.json({ error: 'Forbidden: owner_email must match authenticated user' }, { status: 403 });
    }

    const characters = await base44.entities.Character.filter({
      id: character_id,
      owner_email
    });

    if (!characters || characters.length === 0) {
      return Response.json({ error: 'Character not found or ownership mismatch' }, { status: 404 });
    }

    const c = characters[0];

    return Response.json({
      character_id: c.id,
      name: c.name || null,
      owner_email: c.owner_email || null,
      work_start_time: c.work_start_time || null,
      work_end_time: c.work_end_time || null,
      work_days: c.work_days || null,
      occupation_location_id: c.occupation_location_id || null,
      current_work_location_id: c.current_work_location_id || null
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});