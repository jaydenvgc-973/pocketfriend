import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, socialValue } = await req.json();

    if (!characterId || socialValue == null) {
      return Response.json({ error: 'characterId and socialValue are required' }, { status: 400 });
    }

    await base44.entities.Character.update(characterId, { social_value: socialValue });

    return Response.json({ success: true, characterId, social_value: socialValue });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});