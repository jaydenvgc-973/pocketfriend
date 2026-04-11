/**
 * validateInvite
 *
 * Validates whether a character can send an invite.
 * Blocks if: character is asleep, jailed, or the target location is closed.
 *
 * Payload:
 *   character_id: string
 *   location_id: string (optional — if inviting to a specific place)
 *
 * Returns:
 *   { valid: boolean, reason?: string, fallback?: string }
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { character_id, location_id } = body;

  if (!character_id) return Response.json({ error: 'character_id required' }, { status: 400 });

  const chars = await base44.asServiceRole.entities.Character.filter({ id: character_id });
  const character = chars[0];
  if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

  // ── JAIL CHECK ────────────────────────────────────────────────────────────
  if (character.is_jailed) {
    return Response.json({
      valid: false,
      reason: 'INVITE_VALIDATION_FAILED: Character is currently jailed and cannot send invites.',
      code: 'CHARACTER_JAILED',
    });
  }

  // ── SLEEP CHECK ───────────────────────────────────────────────────────────
  const isAsleep = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
  if (isAsleep) {
    return Response.json({
      valid: false,
      reason: 'ASLEEP_CHARACTER_SENT_INVITE: Character is asleep and cannot send invites or make plans.',
      code: 'CHARACTER_ASLEEP',
      fallback: 'Wait until the character wakes up before sending any invites.',
    });
  }

  // ── LOCATION HOURS CHECK ─────────────────────────────────────────────────
  if (location_id) {
    const locations = await base44.asServiceRole.entities.LocationReference.filter({ id: location_id });
    const location = locations[0];

    if (location?.operating_hours?.length > 0) {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const todayHours = location.operating_hours.find(h => h.day_of_week === dayOfWeek);

      if (todayHours) {
        const parseTime = (t) => {
          const [h, m] = t.split(':').map(Number);
          return h * 60 + m;
        };
        const openMinutes = parseTime(todayHours.open_time);
        const closeMinutes = parseTime(todayHours.close_time);
        const isClosed = currentMinutes < openMinutes || currentMinutes >= closeMinutes;

        if (isClosed) {
          return Response.json({
            valid: false,
            reason: `INVITE_TO_CLOSED_LOCATION: "${location.name}" is currently closed (hours: ${todayHours.open_time}–${todayHours.close_time}).`,
            code: 'LOCATION_CLOSED',
            fallback: `Choose an open location, or send a message instead. "${location.name}" opens at ${todayHours.open_time}.`,
          });
        }
      }
    }
  }

  // ── ALL CHECKS PASSED ─────────────────────────────────────────────────────
  return Response.json({ valid: true });
});