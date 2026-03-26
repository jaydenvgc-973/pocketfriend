import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const characters = await base44.asServiceRole.entities.Character.list();
    const needsSchedule = characters.filter(c =>
      c.status === 'active' && (!c.sleep_start_time || !c.wake_up_time)
    );

    const results = [];

    for (const char of needsSchedule) {
      const prompt = `Based on this person's background, generate a realistic personalized sleep schedule for them.

Name: ${char.name}
Age range: ${char.age_range || 'unknown'}
Job: ${char.work_details?.job_title || 'unknown'}
Archetype: ${char.archetype || 'unknown'}
Personality: ${char.personality_summary || 'unknown'}
Current situation: ${char.current_situation || 'unknown'}
Social energy: ${char.social_energy || 'unknown'}

Return ONLY valid JSON with no extra text:
{
  "sleep_start_time": "HH:MM",
  "wake_up_time": "HH:MM",
  "reasoning": "one sentence explaining why"
}

Use 24-hour format. Be realistic — a night owl might sleep at 01:30 and wake at 09:00. An early riser might sleep at 22:30 and wake at 06:00. A shift worker might have unusual hours.`;

      const response = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });

      let parsed;
      try {
        parsed = JSON.parse(response);
      } catch {
        const match = response.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : null;
      }

      if (parsed?.sleep_start_time && parsed?.wake_up_time) {
        await base44.asServiceRole.entities.Character.update(char.id, {
          sleep_start_time: parsed.sleep_start_time,
          wake_up_time: parsed.wake_up_time,
        });
        results.push({ name: char.name, sleep: parsed.sleep_start_time, wake: parsed.wake_up_time, reason: parsed.reasoning });
      } else {
        results.push({ name: char.name, error: 'Failed to parse LLM response', raw: response });
      }
    }

    return Response.json({ success: true, updated: results.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});