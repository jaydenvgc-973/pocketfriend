import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Ethan
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = characters.find(c => c.name.toLowerCase().includes('ethan'));
    
    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    const fixes = [];

    // Fix 1: Set current_location_id to work location (he's at work right now)
    if (ethan.occupation_location_id && !ethan.current_location_id) {
      await base44.entities.Character.update(ethan.id, {
        current_location_id: ethan.occupation_location_id,
      });
      fixes.push({
        field: 'current_location_id',
        oldValue: null,
        newValue: ethan.occupation_location_id,
        reason: 'Set to work location (Anderson\'s Bar) since it\'s during work hours',
      });
    }

    // Fix 2: Ensure current_activity reflects location
    if (ethan.current_activity === 'sleeping' && ethan.occupation_location_id) {
      await base44.entities.Character.update(ethan.id, {
        current_activity: 'working at Anderson\'s Bar',
      });
      fixes.push({
        field: 'current_activity',
        oldValue: 'sleeping',
        newValue: 'working at Anderson\'s Bar',
        reason: 'Updated stale activity to match work schedule',
      });
    }

    // Fix 3: Ensure system_prompt is set (complete character data)
    if (!ethan.system_prompt) {
      const systemPrompt = `You are ${ethan.name}. ${ethan.profile_summary || ''}`;
      await base44.entities.Character.update(ethan.id, {
        system_prompt: systemPrompt,
      });
      fixes.push({
        field: 'system_prompt',
        oldValue: null,
        newValue: systemPrompt.substring(0, 50) + '...',
        reason: 'Generated missing system prompt',
      });
    }

    // Verify all fixes applied
    const ethanVerify = await base44.entities.Character.filter({ id: ethan.id });
    const updated = ethanVerify[0];

    return Response.json({
      timestamp: new Date().toISOString(),
      character: ethan.name,
      characterId: ethan.id,
      fixes,
      verification: {
        hasCurrentLocationId: !!updated.current_location_id,
        currentLocationId: updated.current_location_id,
        currentActivity: updated.current_activity,
        hasSystemPrompt: !!updated.system_prompt,
      },
      status: 'COMPLETE: Ethan location and activity data restored',
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});