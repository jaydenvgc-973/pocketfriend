import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Generate a catch-up narrative when user returns to chat after time has passed.
 * This creates a summary of what happened while the user was away.
 * Called from Chat page before character responds.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, lastUserMessageTime } = await req.json();

    if (!characterId || !lastUserMessageTime) {
      return Response.json({ error: 'characterId and lastUserMessageTime required' }, { status: 400 });
    }

    // ── 1. FETCH CHARACTER ────────────────────────────────────────────────────
    const charList = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    const character = charList?.[0];
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    if (character.owner_email !== user.email && character.created_by !== user.email) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }

    // ── 2. CHECK TIME GAP ─────────────────────────────────────────────────────
    const lastUserTime = new Date(lastUserMessageTime);
    const now = new Date();
    const minutesAway = Math.floor((now - lastUserTime) / 60000);

    // Only create catch-up if significant time has passed (> 30 mins)
    if (minutesAway < 30) {
      console.log(`[generateCatchupNarrative] SKIP: Only ${minutesAway} mins since last message`);
      return Response.json({ skipped: true, reason: 'not_enough_time' });
    }

    // ── 3. FETCH RECENT NARRATIVES ────────────────────────────────────────────
    const recentNarratives = await base44.entities.AutomaticNarrative.filter(
      { character_id: characterId },
      '-timestamp',
      5 // Get last 5 narratives
    ).catch(() => []);

    // Filter to only narratives created after user's last message
    const newNarratives = recentNarratives.filter(n => new Date(n.timestamp) > lastUserTime);

    // ── 4. BUILD CATCH-UP SUMMARY ─────────────────────────────────────────────
    let catchupText = '';

    if (newNarratives.length === 0) {
      // No narratives generated — create a passive catch-up
      const hoursAway = Math.floor(minutesAway / 60);
      catchupText = buildPassiveCatchup(character, hoursAway, minutesAway);
    } else if (newNarratives.length === 1) {
      // One narrative — use it as the summary
      catchupText = newNarratives[0].narrative_text;
    } else {
      // Multiple narratives — synthesize them
      catchupText = synthesizeNarratives(character, newNarratives, minutesAway);
    }

    // ── 5. SAVE CATCH-UP AS A NARRATIVE RECORD ────────────────────────────────
    const now2 = new Date();
    const catchupRecord = await base44.entities.AutomaticNarrative.create({
      character_id: characterId,
      character_name: character.name,
      owner_user_id: character.owner_user_id || user.id,
      owner_email: character.owner_email || user.email,
      event_type: 'catch_up_summary',
      narrative_text: catchupText,
      memory_summary: `You had a while without talking to them. ${minutesAway > 120 ? 'Several hours' : 'An hour or so'} passed.`,
      timestamp: now2.toISOString(),
      local_time: now2.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      time_of_day: resolveTimeOfDay(now2.getHours()),
      location_id: character.resolved_current_location_id || character.current_home_location_id || null,
      location_name: character.resolved_current_location_name || 'Unknown',
      sleep_state: isSleeping(character) ? 'asleep' : 'awake',
      work_state: isAtWork(character) ? 'at_work' : 'off_work',
      travel_state: character.travel_status || 'at_location',
      needs_snapshot: {
        hunger: character.hunger_value ?? 70,
        energy: character.energy_value ?? 75,
        social: character.social_value ?? 65,
        health: character.health_value ?? 80,
        mental: character.mental_value ?? 70,
        financial_need: character.financial_need_value ?? 60,
        hygiene: character.hygiene_value ?? 75,
        comfort: character.comfort_value ?? 70,
      },
      is_catch_up: true,
      time_gap_minutes: minutesAway,
      visibility: 'visible_in_chat',
    }).catch(err => {
      console.warn(`[generateCatchupNarrative] Failed to save catch-up record: ${err.message}`);
      return null;
    });

    console.log(`[generateCatchupNarrative] ✓ Created catch-up summary for ${character.name} (${minutesAway} mins away, ${newNarratives.length} narratives)`);

    return Response.json({
      success: true,
      catchupId: catchupRecord?.id || null,
      catchupText,
      minutesAway,
      narrativesCreatedWhileAway: newNarratives.length,
      shouldDisplayCatchup: true,
    });

  } catch (error) {
    console.error('[generateCatchupNarrative] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

function isSleeping(character) {
  const hour = new Date().getHours();
  const sleepTime = character.sleep_start_time ? parseInt(character.sleep_start_time) : 23;
  const wakeTime = character.wake_up_time ? parseInt(character.wake_up_time) : 7;
  return hour >= sleepTime || hour < wakeTime;
}

function isAtWork(character) {
  return character.resolved_presence_status === 'at_work';
}

function resolveTimeOfDay(hour) {
  if (hour < 5) return 'late_night';
  if (hour < 7) return 'early_morning';
  if (hour < 10) return 'morning';
  if (hour < 12) return 'late_morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 19) return 'evening';
  if (hour < 21) return 'night';
  return 'late_night';
}

function buildPassiveCatchup(character, hoursAway, minutesAway) {
  const charName = character.name;
  const timePhrase = hoursAway >= 2 ? `${hoursAway} hours` : `${minutesAway} minutes`;

  // Generic catch-up when no specific narratives exist
  if (isSleeping(character)) {
    return `${charName} has been asleep for the past ${timePhrase}. Just resting.`;
  }

  if (isAtWork(character)) {
    return `${charName} has been at work for the past ${timePhrase}, keeping busy with their shift.`;
  }

  return `${charName} has been going about their day for the past ${timePhrase}. Nothing too eventful happened.`;
}

function synthesizeNarratives(character, narratives, minutesAway) {
  const charName = character.name;
  const hoursAway = Math.floor(minutesAway / 60);

  // Build a synthesis of multiple narratives
  const summary = narratives.map(n => {
    const time = new Date(n.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `At ${time}, ${n.narrative_text.toLowerCase()}`;
  }).join(' Then, ');

  return `While you were away for ${hoursAway > 0 ? `${hoursAway} hours` : 'a bit'}, here's what ${charName} was up to: ${summary}.`;
}