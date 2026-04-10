import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ── Time helpers (ET-aware) ─────────────────────────────────────────────────
function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function isInWindow(nowMinutes, startStr, endStr) {
  const start = toMinutes(startStr);
  const end = toMinutes(endStr);
  if (start == null || end == null) return false;
  if (start <= end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end; // overnight
}

/**
 * Check if a location's explicit shift for this character is active right now.
 * Returns true | false.
 */
function isOnShiftNow(shift, now) {
  if (!shift?.start || !shift?.end) return false;
  const day = now.getDay();
  if (shift.days?.length > 0 && !shift.days.includes(day)) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return isInWindow(nowMin, shift.start, shift.end);
}

/**
 * Check if character is on their own work schedule (work_start_time / work_end_time / work_days).
 */
function isOnCharacterWorkSchedule(character, now) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days?.length) return false;
  const day = now.getDay();
  if (!character.work_days.includes(day)) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return isInWindow(nowMin, character.work_start_time, character.work_end_time);
}

/**
 * Given a character and a location map, resolve the correct current location using
 * the same strict schedule-authority logic as the frontend resolution engine.
 *
 * Priority:
 * 1. Any work location where an explicit shift is active for this character
 * 2. Any work location where character has no explicit shift but IS on their personal work schedule
 * 3. Sleep → home
 * 4. Home fallback
 */
function resolveCorrectLocation(character, locationMap, now) {
  // Collect ALL work location IDs
  const workLocIds = [];
  if (character.occupation_location_id) workLocIds.push(character.occupation_location_id);
  if (character.current_work_location_id) workLocIds.push(character.current_work_location_id);
  (character.additional_occupation_locations || []).forEach(l => {
    if (l.location_id && !workLocIds.includes(l.location_id)) workLocIds.push(l.location_id);
  });

  for (const locId of workLocIds) {
    const loc = locationMap[locId];
    if (!loc) continue;

    const explicitShift = loc.worker_shifts?.[character.id];

    if (explicitShift) {
      // Has an explicit shift — it is the authority
      if (isOnShiftNow(explicitShift, now)) {
        return { location_id: locId, location_name: loc.name, status: 'at_work', reason: 'explicit_shift' };
      }
      // Shift defined but inactive — skip, don't fall back to personal schedule for this loc
      continue;
    }

    // No explicit shift — fall back to character's personal work schedule
    if (isOnCharacterWorkSchedule(character, now)) {
      return { location_id: locId, location_name: loc.name, status: 'at_work', reason: 'personal_schedule' };
    }
  }

  // Not at work — check home
  if (character.current_home_location_id) {
    const homeLoc = locationMap[character.current_home_location_id];
    if (homeLoc) {
      return { location_id: character.current_home_location_id, location_name: homeLoc.name, status: 'home', reason: 'home_fallback' };
    }
  }

  return null; // Cannot resolve
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = getNowET();

    // Fetch all locations and build a map by ID
    const locations = await base44.asServiceRole.entities.LocationReference.list();
    const locationMap = {};
    locations.forEach(loc => { locationMap[loc.id] = loc; });

    // Fetch all active created characters for this user
    const allChars = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active',
    });

    const results = [];
    let fixed = 0;

    for (const character of allChars) {
      const resolved = resolveCorrectLocation(character, locationMap, now);
      if (!resolved) {
        results.push({ character: character.name, status: 'UNRESOLVED', reason: 'no_location_found' });
        continue;
      }

      const currentLocId = character.resolved_current_location_id || character.current_location_id;

      if (currentLocId === resolved.location_id) {
        results.push({ character: character.name, status: 'OK', location: resolved.location_name, reason: resolved.reason });
        continue;
      }

      // Location is wrong — update it
      await base44.entities.Character.update(character.id, {
        resolved_current_location_id: resolved.location_id,
        resolved_current_location_name: resolved.location_name,
        resolved_location_type: resolved.status === 'at_work' ? 'work' : 'home',
        resolved_presence_status: resolved.status,
        resolved_source_reason: resolved.reason,
        resolved_last_updated_at: now.toISOString(),
      });

      fixed++;
      results.push({
        character: character.name,
        status: 'FIXED',
        from: currentLocId,
        to: resolved.location_name,
        reason: resolved.reason,
      });
    }

    return Response.json({
      success: true,
      fixed,
      total: allChars.length,
      results,
      message: fixed > 0 ? `Fixed ${fixed} character location(s).` : 'All character locations are correct.',
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});