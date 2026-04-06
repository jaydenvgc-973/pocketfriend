import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * inviteCharacterToLocation
 * Evaluates whether an invited person will come to the user's current location,
 * and if so, updates their location state. Returns a character-based response.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { inviteeId, inviteeName, inviteeType, locationId, locationName, locationCategory, userDisplayName } = await req.json();

    if (!locationId || !locationName) {
      return Response.json({ error: 'Missing locationId or locationName' }, { status: 400 });
    }

    // Fetch invitee character data if it's a real character
    let invitee = null;
    if (inviteeId && inviteeType !== 'npc_family') {
      const allChars = await base44.asServiceRole.entities.Character.list('-updated_date', 1000);
      invitee = allChars.find(c => c.id === inviteeId) || null;
    }

    const now = new Date();
    const hourNow = now.getHours();

    // Evaluate their current state
    let isAsleep = false;
    let isAtWork = false;
    let isAtSchool = false;
    let currentLocationName = null;

    if (invitee) {
      // Sleep check
      if (invitee.sleep_start_time && invitee.wake_up_time) {
        const [sleepH] = (invitee.sleep_start_time || '23:00').split(':').map(Number);
        const [wakeH] = (invitee.wake_up_time || '08:00').split(':').map(Number);
        if (sleepH > wakeH) {
          isAsleep = hourNow >= sleepH || hourNow < wakeH;
        } else {
          isAsleep = hourNow >= sleepH && hourNow < wakeH;
        }
      }

      // Work check
      if (invitee.work_start_time && invitee.work_end_time && invitee.work_days) {
        const dayOfWeek = now.getDay();
        const [workStartH] = (invitee.work_start_time || '09:00').split(':').map(Number);
        const [workEndH] = (invitee.work_end_time || '17:00').split(':').map(Number);
        const workDays = invitee.work_days || [];
        if (workDays.includes(dayOfWeek) && hourNow >= workStartH && hourNow < workEndH) {
          isAtWork = true;
        }
      }

      // School check
      if (invitee.student_status === 'enrolled' && invitee.education_location_id) {
        if (hourNow >= 8 && hourNow < 16 && [1,2,3,4,5].includes(now.getDay())) {
          isAtSchool = true;
        }
      }

      // Current location name
      if (invitee.current_location_id) {
        try {
          const allLocs = await base44.asServiceRole.entities.LocationReference.filter({ id: invitee.current_location_id });
          currentLocationName = allLocs?.[0]?.name || null;
        } catch (_) {}
      }
    }

    const name = invitee?.name || inviteeName || 'They';
    const personality = invitee?.personality_summary || '';
    const friendshipLevel = invitee?.friendship_level ?? 75;
    const emotionalState = invitee?.emotional_state || 'calm';

    // Build context for LLM decision
    const contextLines = [
      `Person being invited: ${name}`,
      personality ? `Personality: ${personality}` : '',
      `Current emotional state: ${emotionalState}`,
      `Friendship level with user: ${friendshipLevel}/100`,
      isAsleep ? `Status: ASLEEP right now` : '',
      isAtWork ? `Status: CURRENTLY AT WORK` : '',
      isAtSchool ? `Status: CURRENTLY IN SCHOOL/CLASS` : '',
      currentLocationName ? `Current location: ${currentLocationName}` : '',
      `Invited to: ${locationName} (${locationCategory || 'unknown type'})`,
      `Invited by: ${userDisplayName || 'the user'}`,
    ].filter(Boolean).join('\n');

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are deciding how ${name} responds to being invited to ${locationName}.

${contextLines}

Based on their current situation and personality, determine their response. Be specific and character-based — not generic.

Return JSON:
{
  "decision": "coming_now" | "coming_later" | "maybe" | "declined",
  "delay_minutes": number (0 if coming_now, 5-45 if coming_later, 0 otherwise),
  "reason": "brief reason for decision (e.g. 'finishing up at work', 'asleep', 'sounds fun')",
  "response_text": "What they actually say in response to the invite — 1-2 sentences, in character, natural and specific. No quotes within the string."
}

Rules:
- If asleep: likely "declined" with reason about sleeping, unless close friends (friendship >85 might wake up)
- If at work: likely "coming_later" after their shift or "declined" depending on strictness and friendship
- If at school: likely "coming_later" or "declined"
- If free and friendly (friendship >60): "coming_now" or "coming_later" depending on mood
- If emotional_state is negative (irritated, defensive, sad): more likely to decline or hesitate
- Vary the language — don't make everyone sound the same`,
      response_json_schema: {
        type: 'object',
        properties: {
          decision: { type: 'string' },
          delay_minutes: { type: 'number' },
          reason: { type: 'string' },
          response_text: { type: 'string' },
        },
      },
    });

    const decision = result?.decision || 'declined';
    const delayMinutes = result?.delay_minutes || 0;
    const responseText = result?.response_text || `${name} doesn't respond.`;

    // If they're coming, update their location
    if ((decision === 'coming_now' || decision === 'coming_later') && invitee?.id) {
      if (decision === 'coming_now') {
        await base44.asServiceRole.entities.Character.update(invitee.id, {
          current_location_id: locationId,
          current_activity: `at ${locationName}`,
        }).catch(() => {});
      }
      // For coming_later: location update happens after delay — simplified: update now but note they're on their way
      if (decision === 'coming_later') {
        await base44.asServiceRole.entities.Character.update(invitee.id, {
          current_activity: `heading to ${locationName}`,
        }).catch(() => {});
        // Schedule location update after delay
        setTimeout(async () => {
          await base44.asServiceRole.entities.Character.update(invitee.id, {
            current_location_id: locationId,
            current_activity: `at ${locationName}`,
          }).catch(() => {});
        }, delayMinutes * 60 * 1000);
      }
    }

    return Response.json({
      success: true,
      inviteeId: invitee?.id || null,
      inviteeName: name,
      decision,
      delay_minutes: delayMinutes,
      reason: result?.reason || '',
      response_text: responseText,
      avatar_url: invitee?.avatar_url || null,
    });
  } catch (error) {
    console.error('[inviteCharacterToLocation]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});