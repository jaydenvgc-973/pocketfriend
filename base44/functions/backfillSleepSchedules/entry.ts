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
      // Detect overnight shift so LLM knows to assign daytime sleep
      const workStart = char.work_start_time || null;
      const workEnd   = char.work_end_time   || null;
      const workDays  = char.work_days       || null;
      const toMin = (t) => { if (!t) return null; const [h,m] = t.split(':').map(Number); return h*60+(m||0); };
      const wsMin = toMin(workStart);
      const weMin = toMin(workEnd);
      const isOvernightWorker = wsMin !== null && weMin !== null && weMin < wsMin;

      const scheduleContext = workStart && workEnd
        ? `Work schedule: ${workStart}–${workEnd} on days [${(workDays||[]).join(',')}]. ${isOvernightWorker ? 'THIS IS AN OVERNIGHT SHIFT. The character works at night and must sleep during the day. Do NOT assign overnight sleep.' : 'This is a daytime job.'}`
        : 'No fixed work schedule.';

      const prompt = `Based on this person's background, generate a realistic personalized sleep schedule for them.

Name: ${char.name}
Age range: ${char.age_range || 'unknown'}
Job: ${char.work_details?.job_title || 'unknown'}
Archetype: ${char.archetype || 'unknown'}
Personality: ${char.personality_summary || 'unknown'}
Current situation: ${char.current_situation || 'unknown'}
Social energy: ${char.social_energy || 'unknown'}
${scheduleContext}

CRITICAL RULES:
- If the character works an overnight shift (e.g. 22:00–06:00), their sleep window must be DURING THE DAY (e.g. 07:00–15:00). Never overlap sleep with their work shift.
- If the character works a morning shift (e.g. 06:00–14:00), they should sleep early (e.g. 22:00–05:00).
- If the character works an evening shift (e.g. 14:00–22:00), they may sleep late (e.g. 23:30–07:30).
- If no work schedule, use personality to pick a realistic window.

Return ONLY valid JSON with no extra text:
{
  "sleep_start_time": "HH:MM",
  "wake_up_time": "HH:MM",
  "reasoning": "one sentence explaining why"
}

Use 24-hour format.`;

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