import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, stayUpUntilTime } = await req.json();
    if (!characterId || !stayUpUntilTime) {
      return Response.json({ error: 'Missing characterId or stayUpUntilTime' }, { status: 400 });
    }

    const char = await base44.entities.Character.filter({ id: characterId });
    if (char.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // stayUpUntilTime should be an ISO timestamp (e.g., "2026-04-06T08:00:00Z")
    await base44.entities.Character.update(characterId, {
      decided_to_stay_up_until: stayUpUntilTime,
    });

    return Response.json({ success: true, decidedUntil: stayUpUntilTime });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});