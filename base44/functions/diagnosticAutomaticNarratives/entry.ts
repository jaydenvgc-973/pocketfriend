import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all active characters for this user
    const characters = await base44.entities.Character.filter({
      status: 'active',
      character_type: 'active_created_character',
    }, '-updated_date', 50);

    console.log(`[diagnosticAutomaticNarratives] ▶ Checking ${characters.length} active characters`);

    const NOW = new Date();
    const EXPECTED_INTERVAL_MINUTES = 30;
    const OVERDUE_THRESHOLD_MINUTES = 45;

    const diagnostics = [];

    for (const character of characters) {
      // Get last automatic narrative
      const narratives = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
        { character_id: character.id },
        '-timestamp',
        1
      );
      const lastNarrative = narratives?.[0];

      let status = 'unknown';
      let minutesSinceLastNarrative = null;
      let nextEligibleTime = null;
      let isOverdue = false;

      if (lastNarrative) {
        const lastTime = new Date(lastNarrative.timestamp);
        minutesSinceLastNarrative = (NOW.getTime() - lastTime.getTime()) / (1000 * 60);
        nextEligibleTime = new Date(lastTime.getTime() + EXPECTED_INTERVAL_MINUTES * 60 * 1000);
        
        if (minutesSinceLastNarrative < EXPECTED_INTERVAL_MINUTES) {
          status = 'on_schedule';
        } else if (minutesSinceLastNarrative >= OVERDUE_THRESHOLD_MINUTES) {
          status = 'overdue';
          isOverdue = true;
        } else {
          status = 'waiting_for_next';
        }
      } else {
        status = 'no_narratives_yet';
      }

      // Get last user conversation
      const convos = await base44.entities.Conversation.filter(
        { character_ids: [character.id], type: 'direct' },
        '-updated_date',
        1
      );
      const lastConvo = convos?.[0];

      const messages = lastConvo ? 
        await base44.entities.Message.filter(
          { conversation_id: lastConvo.id, sender_type: 'user' },
          '-created_date',
          1
        ) : [];
      const lastUserMessage = messages?.[0];

      const hoursSinceLastUserMessage = lastUserMessage ?
        (NOW.getTime() - new Date(lastUserMessage.timestamp || lastUserMessage.created_date).getTime()) / (1000 * 60 * 60) :
        null;

      diagnostics.push({
        characterId: character.id,
        characterName: character.name,
        ownerEmail: character.owner_email || character.created_by,
        narrativeStatus: status,
        isOverdue,
        minutesSinceLastNarrative,
        lastNarrativeTime: lastNarrative?.timestamp,
        lastNarrativeType: lastNarrative?.event_type,
        nextEligibleNarrativeTime: nextEligibleTime?.toISOString(),
        lastUserInteractionTime: lastUserMessage?.timestamp || lastUserMessage?.created_date,
        hoursSinceLastUserMessage,
        lastUserConversationId: lastConvo?.id,
        currentLocation: character.current_home_location_id || character.home_location_id || 'unknown',
        currentSleepState: character.location_visibility_state,
        currentTravelState: character.travel_status,
        needsSnapshot: {
          hunger: character.hunger_value,
          energy: character.energy_value,
          social: character.social_value,
        },
      });

      console.log(`[diagnosticAutomaticNarratives] ${character.name}: ${status}${isOverdue ? ' ⚠️ OVERDUE' : ''} | last narrative: ${minutesSinceLastNarrative?.toFixed(0)}min ago`);
    }

    // Summary
    const overdueCount = diagnostics.filter(d => d.isOverdue).length;
    const onScheduleCount = diagnostics.filter(d => d.narrativeStatus === 'on_schedule').length;
    const noNarrativesCount = diagnostics.filter(d => d.narrativeStatus === 'no_narratives_yet').length;

    console.log(`[diagnosticAutomaticNarratives] Summary: ${onScheduleCount} on schedule, ${overdueCount} overdue, ${noNarrativesCount} no narratives yet`);

    return Response.json({
      success: true,
      totalCharacters: characters.length,
      diagnostics,
      summary: {
        onSchedule: onScheduleCount,
        overdue: overdueCount,
        noNarrativesYet: noNarrativesCount,
        expectedIntervalMinutes: EXPECTED_INTERVAL_MINUTES,
        overdueThresholdMinutes: OVERDUE_THRESHOLD_MINUTES,
      },
      timestamp: NOW.toISOString(),
    });

  } catch (error) {
    console.error('[diagnosticAutomaticNarratives] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});