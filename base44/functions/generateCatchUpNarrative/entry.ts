import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      characterId,
      conversationId,
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // ── FETCH CHARACTER ───────────────────────────────────────────────────
    const charList = await base44.entities.Character.filter({ id: characterId }, null, 1);
    const character = charList?.[0];
    
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // ── FETCH LAST USER INTERACTION ───────────────────────────────────────
    const messages = await base44.entities.Message.filter(
      { 
        conversation_id: conversationId,
        sender_type: 'user',
      },
      '-created_date',
      1
    );
    const lastUserMessage = messages?.[0];
    
    if (!lastUserMessage) {
      return Response.json({ error: 'No user interaction found', success: false });
    }

    // ── FETCH AUTOMATIC NARRATIVES SINCE LAST INTERACTION ─────────────────
    const lastInteractionTime = new Date(lastUserMessage.timestamp || lastUserMessage.created_date);
    const NOW = new Date();
    const hoursSinceInteraction = (NOW.getTime() - lastInteractionTime.getTime()) / (1000 * 60 * 60);

    console.log(`[generateCatchUpNarrative] Character: ${character.name} | hours since last interaction: ${hoursSinceInteraction.toFixed(1)}`);

    // If less than 5 minutes, no catch-up needed
    if (hoursSinceInteraction < 0.083) {
      return Response.json({
        success: false,
        reason: 'no_time_passed',
        hoursSinceInteraction,
      });
    }

    // Fetch all automatic narratives since last user interaction
    const narratives = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
      { 
        character_id: characterId,
        timestamp: { $gt: lastInteractionTime.toISOString() },
      },
      'timestamp',
      20
    );

    console.log(`[generateCatchUpNarrative] Found ${narratives.length} narratives since last interaction`);

    if (narratives.length === 0) {
      // No automatic narratives exist — generate a catch-up summary
      return generateCatchUpSummary(base44, character, hoursSinceInteraction);
    }

    // Build catch-up context from narratives
    const catchUpText = narratives
      .map(n => n.memory_summary)
      .filter(Boolean)
      .join(' → ');

    // Generate a conversational catch-up narrative using the stored narratives
    const catchUpPrompt = `Summarize briefly (1-2 sentences) what ${character.name} has been doing since the user last messaged (about ${Math.round(hoursSinceInteraction)} hour${hoursSinceInteraction > 1 ? 's' : ''} ago).

Timeline of what happened:
${narratives.map(n => `- ${n.memory_summary}`).join('\n')}

Generate a natural, brief summary that ${character.name} would mention in response to user returning. Keep it conversational and brief.`;

    const summaryRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: catchUpPrompt,
      model: 'gemini_3_flash',
    });

    const catchUpSummary = summaryRes?.trim() || catchUpText;

    // ── SAVE CATCH-UP NARRATIVE ───────────────────────────────────────────
    const catchUpNarrative = await base44.asServiceRole.entities.CharacterAutomaticNarrative.create({
      character_id: characterId,
      character_name: character.name,
      owner_user_id: character.owner_user_id,
      owner_email: character.owner_email || character.created_by,
      event_type: 'catch_up_summary',
      narrative_text: catchUpSummary,
      memory_summary: catchUpText,
      timestamp: NOW.toISOString(),
      local_time: `${NOW.getHours()}:${String(NOW.getMinutes()).padStart(2, '0')}`,
      time_of_day: getTimeOfDay(NOW.getHours()),
      sleep_state: character.location_visibility_state === 'hidden' ? 'sleeping' : 'awake',
      travel_state: character.travel_status === 'not_traveling' ? 'stationary' : 'in_transit',
      triggered_by: 'user_return',
      is_catch_up: true,
      hours_since_last_interaction: hoursSinceInteraction,
    });

    console.log(`[generateCatchUpNarrative] ✓ Catch-up narrative saved: ${catchUpNarrative.id}`);

    return Response.json({
      success: true,
      catchUpNarrativeId: catchUpNarrative.id,
      catchUpText: catchUpSummary,
      hoursSinceLastInteraction: hoursSinceInteraction,
      narrativeCount: narratives.length,
    });

  } catch (error) {
    console.error('[generateCatchUpNarrative] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

// ── HELPERS ───────────────────────────────────────────────────────────────

function getTimeOfDay(hour) {
  if (hour >= 5 && hour < 9) return 'early_morning';
  if (hour >= 9 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 15) return 'midday';
  if (hour >= 15 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 21) return 'evening';
  return 'night';
}

async function generateCatchUpSummary(base44, character, hoursSinceInteraction) {
  const summaryPrompt = `Generate a brief catch-up summary (1-2 sentences) for ${character.name}.

Time passed since last user interaction: ${Math.round(hoursSinceInteraction)} hours

Character context:
- Personality: ${character.personality_summary || 'unknown'}
- Current emotional state: ${character.emotional_state || 'calm'}
- Current activity: ${character.current_activity || 'none'}

Generate a natural summary of what the character might have been doing during the time gap.
Keep it vague but realistic (e.g., "Been resting at home", "Working my shift", "Out running errands").`;

  const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: summaryPrompt,
    model: 'gemini_3_flash',
  });

  return {
    success: true,
    catchUpText: res?.trim() || `${character.name} has been going about their day over the past ${Math.round(hoursSinceInteraction)} hours.`,
    generated: true,
  };
}