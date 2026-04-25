import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Backfill missing narratives for time gaps.
 * Called when user opens a conversation to detect if time passed since last interaction.
 * Generates realistic timeline events for missing periods (hours, overnight, days).
 * Saves events to the character timeline so they persist.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, conversationId } = await req.json();
    if (!characterId || !conversationId) {
      return Response.json({ error: 'characterId and conversationId required' }, { status: 400 });
    }

    // ── 1. FETCH CHARACTER ────────────────────────────────────────────────
    const charList = await base44.entities.Character.filter({ id: characterId }, null, 1);
    const character = charList?.[0];
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // ── 2. DETECT TIME GAPS ───────────────────────────────────────────────
    // Get last user message in this conversation
    const messages = await base44.entities.Message.filter(
      { conversation_id: conversationId, sender_type: 'user' },
      '-created_date',
      1
    );
    const lastUserMsg = messages?.[0];
    const lastUserTime = lastUserMsg ? new Date(lastUserMsg.timestamp || lastUserMsg.created_date) : null;

    // Get last automatic narrative for this character
    const narratives = await base44.entities.AutomaticNarrative.filter(
      { character_id: characterId },
      '-timestamp',
      1
    );
    const lastNarrative = narratives?.[0];
    const lastNarrativeTime = lastNarrative ? new Date(lastNarrative.timestamp) : null;

    const NOW = new Date();
    
    // Determine the "anchor time" (earliest of user msg or narrative)
    let anchorTime = null;
    if (lastUserTime && lastNarrativeTime) {
      anchorTime = lastUserTime > lastNarrativeTime ? lastUserTime : lastNarrativeTime;
    } else if (lastUserTime) {
      anchorTime = lastUserTime;
    } else if (lastNarrativeTime) {
      anchorTime = lastNarrativeTime;
    }

    // No anchor = first conversation, no backfill needed
    if (!anchorTime) {
      console.log(`[backfillMissingNarratives] No anchor time found (first conversation)`);
      return Response.json({
        success: true,
        backfilled: false,
        reason: 'first_conversation',
      });
    }

    const minutesGap = (NOW.getTime() - anchorTime.getTime()) / 60000;
    const hoursGap = minutesGap / 60;

    console.log(`[backfillMissingNarratives] Gap detected: ${minutesGap.toFixed(0)} mins (${hoursGap.toFixed(1)} hours) | anchor=${anchorTime.toISOString()}`);

    // If gap is less than 30 mins, no backfill needed
    if (minutesGap < 30) {
      console.log(`[backfillMissingNarratives] Gap too small (${minutesGap.toFixed(0)} mins), no backfill`);
      return Response.json({
        success: true,
        backfilled: false,
        reason: 'gap_too_small',
        minutesGap,
      });
    }

    // ── 3. GENERATE BACKFILL EVENTS ───────────────────────────────────────
    const backfilledNarratives = [];
    const eventCount = calculateEventCount(minutesGap);

    console.log(`[backfillMissingNarratives] Generating ${eventCount} backfill events for ${hoursGap.toFixed(1)} hour gap`);

    // Generate events spread across the gap
    const timeStep = minutesGap / eventCount;
    for (let i = 0; i < eventCount; i++) {
      const eventTime = new Date(anchorTime.getTime() + (timeStep * (i + 1)) * 60000);
      const eventHour = eventTime.getHours();
      const timeOfDay = resolveTimeOfDay(eventHour);

      // Generate a reasonable narrative for this time period
      const narrativeText = await generateBackfillNarrative(
        base44, character, eventTime, timeOfDay
      );

      console.log(`[backfillMissingNarratives] Saving backfill event ${i + 1}/${eventCount} | char_id=${characterId} | time=${eventTime.toISOString()}`);

      let backfillEvent = null;
      try {
        backfillEvent = await base44.asServiceRole.entities.AutomaticNarrative.create({
          character_id: characterId,
          character_name: character.name,
          owner_user_id: character.owner_user_id,
          owner_email: character.owner_email || character.created_by,
          event_type: 'passive_time',
          narrative_text: narrativeText,
          memory_summary: `${timeOfDay.replace(/_/g, ' ')}: ${narrativeText.substring(0, 100)}...`,
          timestamp: eventTime.toISOString(),
          local_time: `${eventHour}:${String(eventTime.getMinutes()).padStart(2, '0')}`,
          time_of_day: timeOfDay,
          location_id: character.resolved_current_location_id || character.current_home_location_id || null,
          location_name: character.resolved_current_location_name || 'Unknown',
          sleep_state: isSleeping(character, eventHour) ? 'asleep' : 'awake',
          travel_state: character.travel_status === 'not_traveling' ? 'at_location' : 'in_transit',
          work_state: character.resolved_presence_status === 'at_work' ? 'at_work' : 'off_work',
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
          visibility: 'memory_only',
        });

        if (!backfillEvent || !backfillEvent.id) {
          console.error(`[backfillMissingNarratives] Create returned no ID | event=${i+1} | response=${JSON.stringify(backfillEvent)}`);
        } else {
          console.log(`[backfillMissingNarratives] ✓ Saved event ${i+1}/${eventCount} with ID=${backfillEvent.id}`);
          backfilledNarratives.push({
            id: backfillEvent.id,
            time: eventTime.toISOString(),
            timeOfDay,
            text: narrativeText,
          });
        }
      } catch (err) {
        console.error(`[backfillMissingNarratives] SAVE FAILED for event ${i+1}/${eventCount}: ${err.message}`);
      }
    }

    console.log(`[backfillMissingNarratives] ✓ Successfully saved ${backfilledNarratives.length}/${eventCount} backfill events to AutomaticNarrative`);

    // Build context string from backfilled narratives
    const contextBlock = backfilledNarratives
      .map(n => `${n.timeOfDay}: ${n.text}`)
      .join('\n');

    return Response.json({
      success: true,
      backfilled: true,
      minutesGap: minutesGap.toFixed(0),
      hoursGap: hoursGap.toFixed(1),
      eventCount: backfilledNarratives.length,
      narratives: backfilledNarratives,
      contextBlock,
    });

  } catch (error) {
    console.error('[backfillMissingNarratives] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

// ── HELPERS ────────────────────────────────────────────────────────────────

function calculateEventCount(minutesGap) {
  if (minutesGap < 120) return 1; // < 2 hours: 1 event
  if (minutesGap < 480) return 2; // < 8 hours: 2 events
  if (minutesGap < 1440) return 3; // < 24 hours: 3 events
  const days = Math.ceil(minutesGap / 1440);
  return Math.min(days + 1, 10); // 1 event per day, max 10
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

function isSleeping(character, hour) {
  const wakeTime = character.wake_up_time ? parseInt(character.wake_up_time) : 7;
  const sleepTime = character.sleep_start_time ? parseInt(character.sleep_start_time) : 23;
  return hour >= sleepTime || hour < wakeTime;
}

async function generateBackfillNarrative(base44, character, eventTime, timeOfDay) {
  const hour = eventTime.getHours();
  const dayName = eventTime.toLocaleDateString('en-US', { weekday: 'long' });

  const prompt = `Generate a short (2-3 sentences), realistic backfill narrative for ${character.name} during ${timeOfDay} on ${dayName}.

Context:
- Personality: ${character.personality_summary || 'unknown'}
- Current emotional state: ${character.emotional_state || 'calm'}
- Typical routine: ${getRoutineContext(character, hour)}
- Location: ${character.resolved_current_location_name || 'home'}
- Current needs state: ${getNeeds(character)}

Generate a natural narrative of what they were doing during this time. Keep it brief and realistic for the time of day.
No labels, just the narrative text.`;

  try {
    const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      model: 'gemini_3_flash',
    });
    return res?.trim() || getDefaultNarrative(character, timeOfDay);
  } catch (err) {
    console.warn(`[generateBackfillNarrative] LLM failed, using default: ${err.message}`);
    return getDefaultNarrative(character, timeOfDay);
  }
}

function getRoutineContext(character, hour) {
  if (character.work_start_time && character.work_end_time) {
    const workStart = parseInt(character.work_start_time);
    const workEnd = parseInt(character.work_end_time);
    if (hour >= workStart && hour < workEnd) {
      return 'Usually at work during this time';
    }
  }
  if (hour >= 22 || hour < 7) return 'Usually sleeping at this time';
  if (hour >= 7 && hour < 9) return 'Usually morning routine / getting ready';
  return 'Usually at home or out during this time';
}

function getNeeds(character) {
  const needs = [];
  if (character.hunger_value < 40) needs.push('hungry');
  if (character.energy_value < 40) needs.push('tired');
  if (character.social_value < 30) needs.push('isolated');
  if (character.hygiene_value < 40) needs.push('needs to clean up');
  return needs.length > 0 ? needs.join(', ') : 'stable';
}

function getDefaultNarrative(character, timeOfDay) {
  const templates = {
    early_morning: `${character.name} was starting their day, slowly getting ready for what's ahead.`,
    morning: `${character.name} was in their morning routine, preparing for the day.`,
    late_morning: `${character.name} was moving through the morning, handling things that needed attention.`,
    midday: `${character.name} was in the middle of their day, managing the usual tasks.`,
    afternoon: `${character.name} was powering through the afternoon, keeping momentum.`,
    evening: `${character.name} was settling into the evening, unwinding from the day.`,
    night: `${character.name} was winding down, getting ready to rest.`,
    late_night: `${character.name} was deeply asleep, resting peacefully.`,
  };
  return templates[timeOfDay] || templates.afternoon;
}