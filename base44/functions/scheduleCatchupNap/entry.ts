import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, napStartTime, napDurationMinutes = 120 } = await req.json();
    if (!characterId || !napStartTime) {
      return Response.json({ error: 'Missing characterId or napStartTime' }, { status: 400 });
    }

    const char = await base44.entities.Character.filter({ id: characterId });
    if (char.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // napStartTime: ISO timestamp when the nap begins
    // After nap, character will be rested (clear the stayed_up flag)
    const napStart = new Date(napStartTime);
    const napEnd = new Date(napStart.getTime() + napDurationMinutes * 60 * 1000);

    // Update character to reflect nap scheduling
    // Set current_activity to "napping" and clear decided_to_stay_up_until if nap covers that period
    await base44.entities.Character.update(characterId, {
      current_activity: `napping (${napDurationMinutes}min)`,
    });

    // Return scheduled nap details
    return Response.json({
      success: true,
      characterId,
      napStartTime: napStart.toISOString(),
      napEndTime: napEnd.toISOString(),
      durationMinutes: napDurationMinutes,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});