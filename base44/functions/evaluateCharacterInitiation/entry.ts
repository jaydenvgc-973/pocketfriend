import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * evaluateCharacterInitiation
 * 
 * Determines if a character should initiate a message based on:
 * - schedule profile (wake/sleep times, work hours)
 * - messaging profile (frequency, probabilities)
 * - relationship state
 * - time since last interaction
 * - anti-spam rules
 * 
 * Returns decision with reasoning for initiating or not.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    const char = await base44.entities.Character.get(characterId);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    // ─────────────────────────────────────────────────────────
    // INITIATION CONSTRAINTS: fail fast
    // ─────────────────────────────────────────────────────────
    if (char.status === 'soft_deleted' || char.status === 'merged') {
      return Response.json({
        should_initiate: false,
        reason: `Character is ${char.status}`,
      });
    }

    // ─────────────────────────────────────────────────────────
    // FETCH PROFILES
    // ─────────────────────────────────────────────────────────
    let scheduleProfile, messagingProfile, relationshipState;
    const profiles = await Promise.all([
      char.schedule_profile_id 
        ? base44.entities.CharacterScheduleProfile.get(char.schedule_profile_id)
        : Promise.resolve(null),
      char.messaging_profile_id
        ? base44.entities.CharacterMessagingProfile.get(char.messaging_profile_id)
        : Promise.resolve(null),
      char.relationship_state_id
        ? base44.entities.RelationshipState.get(char.relationship_state_id)
        : Promise.resolve(null),
    ]);
    [scheduleProfile, messagingProfile, relationshipState] = profiles;

    // ─────────────────────────────────────────────────────────
    // TIME CHECKS
    // ─────────────────────────────────────────────────────────
    const now = new Date();
    const tz = scheduleProfile?.timezone || 'America/New_York';
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const [timeStr] = formatter.formatToParts(now);
    const currentMinutes = parseInt(timeStr.value.split(':')[0]) * 60 + parseInt(timeStr.value.split(':')[1]);

    // Wake/sleep validation
    if (scheduleProfile?.wake_time && scheduleProfile?.sleep_time) {
      const [wakeHr, wakeMn] = scheduleProfile.wake_time.split(':').map(Number);
      const [sleepHr, sleepMn] = scheduleProfile.sleep_time.split(':').map(Number);
      const wakeMin = wakeHr * 60 + wakeMn;
      const sleepMin = sleepHr * 60 + sleepMn;

      const isAsleep = sleepMin < wakeMin 
        ? currentMinutes >= sleepMin && currentMinutes < wakeMin
        : currentMinutes < wakeMin || currentMinutes >= sleepMin;

      if (isAsleep) {
        return Response.json({
          should_initiate: false,
          reason: `Character is asleep (${scheduleProfile.sleep_time}–${scheduleProfile.wake_time})`,
        });
      }
    }

    // ─────────────────────────────────────────────────────────
    // COOLDOWN / ANTI-SPAM
    // ─────────────────────────────────────────────────────────
    if (messagingProfile?.last_initiated_at) {
      const lastInitiated = new Date(messagingProfile.last_initiated_at);
      const minutesAgo = (now - lastInitiated) / 1000 / 60;
      const minCooldown = 120; // 2 hours

      if (minutesAgo < minCooldown) {
        return Response.json({
          should_initiate: false,
          reason: `Cooldown active (${Math.ceil(minCooldown - minutesAgo)}min remaining)`,
        });
      }
    }

    // ─────────────────────────────────────────────────────────
    // PROBABILITY ROLL
    // ─────────────────────────────────────────────────────────
    const dailyProb = messagingProfile?.initiation_probability_daily || 0.3;
    const roll = Math.random();
    const shouldInitiate = roll < dailyProb;

    return Response.json({
      should_initiate: shouldInitiate,
      reason: shouldInitiate 
        ? `Probability check passed (${(dailyProb * 100).toFixed(0)}% chance, rolled ${(roll * 100).toFixed(1)}%)`
        : `Probability check failed (${(dailyProb * 100).toFixed(0)}% chance, rolled ${(roll * 100).toFixed(1)}%)`,
      character_id: characterId,
      character_name: char.name,
      profiles: {
        schedule: !!scheduleProfile,
        messaging: !!messagingProfile,
        relationship: !!relationshipState,
      },
      current_time_tz: tz,
      relationship_score: relationshipState?.friendship_score || 50,
    });
  } catch (error) {
    console.error('[evaluateCharacterInitiation]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});