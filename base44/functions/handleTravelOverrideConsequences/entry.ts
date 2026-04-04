import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      characterId,
      leftScheduleEarly = false,
      minutesMissed = 0,
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    const chars = await base44.entities.Character.filter({ id: characterId });
    if (chars.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const character = chars[0];
    const consequences = [];

    if (!leftScheduleEarly) {
      return Response.json({
        success: true,
        consequences,
        memories: [],
      });
    }

    // Create memory of skipping schedule
    const hoursMissed = Math.round(minutesMissed / 60);
    const memory = await base44.entities.CharacterMemory.create({
      character_id: characterId,
      memory_type: 'event',
      memory_text: `Left ${character.work_details?.job_title ? 'work' : 'school'} early to spend time with the user (missed ${hoursMissed} hours)`,
      memory_summary: `Skipped part of ${character.work_details?.job_title ? 'work' : 'school'}`,
      importance_score: 5,
      permanence: 'long_term',
    });

    consequences.push({
      type: 'consequence',
      description: `Missed ${hoursMissed} hours of ${character.work_details?.job_title ? 'work' : 'school'}`,
      severity: character.work_details?.job_title ? 'high' : 'medium',
    });

    // Potential boss/teacher reaction (for future dialogue)
    if (character.work_details?.job_title) {
      consequences.push({
        type: 'future_reaction',
        actor: 'boss',
        likelihood: 0.7,
        action: 'may_mention_absence',
      });
    }

    return Response.json({
      success: true,
      consequences,
      memories: [memory.id],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});