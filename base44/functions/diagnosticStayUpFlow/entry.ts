import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    const char = await base44.entities.Character.filter({ id: characterId });
    if (char.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const character = char[0];
    const now = new Date();

    // Check current state
    const sleepStart = character?.sleep_start_time || "23:00";
    const wakeUp = character?.wake_up_time || "07:00";
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [sleepH, sleepM] = sleepStart.split(":").map(Number);
    const [wakeH, wakeM] = wakeUp.split(":").map(Number);
    const sleepMinutes = sleepH * 60 + sleepM;
    const wakeMinutes = wakeH * 60 + wakeM;

    // Determine if character should be asleep based on schedule alone
    let shouldBeSleepBySchedule = false;
    if (sleepMinutes > wakeMinutes) {
      shouldBeSleepBySchedule = currentMinutes >= sleepMinutes || currentMinutes < wakeMinutes;
    } else {
      shouldBeSleepBySchedule = currentMinutes >= sleepMinutes && currentMinutes < wakeMinutes;
    }

    // Check if character decided to stay up
    const stayUpUntil = character?.decided_to_stay_up_until ? new Date(character.decided_to_stay_up_until) : null;
    const isStayingUp = stayUpUntil && now < stayUpUntil;

    // Determine final sleep status
    const isAsleep = shouldBeSleepBySchedule && !isStayingUp;

    // Get home location name
    const homeLocation = character.current_home_location_id
      ? await base44.entities.LocationReference.filter({ id: character.current_home_location_id }).then(r => r[0])
      : null;

    return Response.json({
      characterId,
      characterName: character.name,
      currentTime: now.toISOString(),
      sleepSchedule: {
        sleepStart,
        wakeUp,
        shouldBeSleepBySchedule,
      },
      stayUpStatus: {
        isStayingUp,
        decidedUntil: stayUpUntil?.toISOString() || null,
        hoursRemaining: isStayingUp ? ((stayUpUntil - now) / (1000 * 60 * 60)).toFixed(1) : null,
      },
      finalStatus: {
        isAsleep,
        displayIcon: isAsleep ? 'sleep' : 'home',
        displayLabel: isAsleep ? 'sleeping' : `at ${homeLocation?.name || 'home'}`,
        displayColor: isAsleep ? 'text-blue-300' : 'text-pink-400',
      },
      currentActivity: character.current_activity || 'none',
      homeLocation: homeLocation ? { id: homeLocation.id, name: homeLocation.name } : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});