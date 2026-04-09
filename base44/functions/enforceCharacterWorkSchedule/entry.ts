import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Enforces work schedule for one character (if characterId given)
 * OR runs a full diagnostic scan across all characters (if no characterId).
 *
 * Input: { characterId? }
 * Output (single): { updated, oldLocation, newLocation, reason }
 * Output (scan):   { summary, issues_found, fixes_applied, checks }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { characterId } = body;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const dayOfWeek = now.getDay();

    const isOnShift = (char) => {
      if (!char.work_start_time || !char.work_end_time || !char.work_days) return false;
      const [startH, startM = 0] = char.work_start_time.split(':').map(Number);
      const [endH, endM = 0] = char.work_end_time.split(':').map(Number);
      const nowMins = currentHour * 60 + currentMinute;
      const startMins = startH * 60 + startM;
      const endMins = endH * 60 + endM;
      const isWorkDay = char.work_days.includes(dayOfWeek);
      return isWorkDay && nowMins >= startMins && nowMins < endMins;
    };

    // --- Single character mode ---
    if (characterId) {
      const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      if (!chars || chars.length === 0) {
        return Response.json({ error: 'Character not found' }, { status: 404 });
      }
      const character = chars[0];

      let shouldUpdate = false;
      let newLocationId = null;
      let reason = '';

      if (isOnShift(character)) {
        if (character.current_work_location_id) {
          newLocationId = character.current_work_location_id;
          shouldUpdate = true;
          reason = 'On shift now — moved to workplace';
        }
      } else if (character.current_home_location_id) {
        newLocationId = character.current_home_location_id;
        reason = 'Not scheduled now — moved home';
        shouldUpdate = true;
      }

      if (shouldUpdate && newLocationId) {
        const oldLocation = character.resolved_current_location_id || character.current_work_location_id;
        await base44.asServiceRole.entities.Character.update(characterId, {
          resolved_current_location_id: newLocationId
        });
        return Response.json({ updated: true, oldLocation, newLocation: newLocationId, reason });
      }

      return Response.json({ updated: false, reason: 'No schedule change needed' });
    }

    // --- Full scan / diagnostic mode (no characterId) ---
    const allChars = await base44.asServiceRole.entities.Character.filter({ status: 'active' });

    const issues_found = [];
    const fixes_applied = [];
    const checks = [];
    let fixCount = 0;

    for (const char of allChars) {
      if (!char.work_start_time || !char.work_end_time || !char.work_days) continue;

      const onShift = isOnShift(char);
      const workLocId = char.current_work_location_id || char.occupation_location_id;
      const resolvedLocId = char.resolved_current_location_id;

      if (onShift) {
        const isAtWork = workLocId && (resolvedLocId === workLocId);
        const checkResult = {
          name: `${char.name} — shift check`,
          status: isAtWork ? 'passed' : 'fixed',
          message: isAtWork
            ? `On shift and correctly placed at work location`
            : `[STALE_SCHEDULE_LOCATION_DATA] On shift (${char.work_start_time}–${char.work_end_time}) but resolved location (${resolvedLocId || 'none'}) does not match work location (${workLocId || 'none'})`,
        };
        checks.push(checkResult);

        if (!isAtWork && workLocId) {
          issues_found.push(`${char.name}: should be at work (${char.work_start_time}–${char.work_end_time}) but location is stale — STALE_SCHEDULE_LOCATION_DATA`);
          await base44.asServiceRole.entities.Character.update(char.id, {
            resolved_current_location_id: workLocId,
            resolved_presence_status: 'at_work',
            resolved_location_type: 'work',
            resolved_last_updated_at: new Date().toISOString(),
          });
          fixes_applied.push(`${char.name}: synced to work location (was: ${resolvedLocId || 'unset'})`);
          fixCount++;
        }
      } else {
        // Off shift — verify they're not incorrectly stuck at work
        const homeLocId = char.current_home_location_id;
        if (homeLocId && resolvedLocId === workLocId && workLocId) {
          issues_found.push(`${char.name}: off shift but still showing at work — stale location`);
          await base44.asServiceRole.entities.Character.update(char.id, {
            resolved_current_location_id: homeLocId,
            resolved_presence_status: 'home',
            resolved_location_type: 'home',
            resolved_last_updated_at: new Date().toISOString(),
          });
          fixes_applied.push(`${char.name}: returned home after shift ended`);
          fixCount++;
          checks.push({ name: `${char.name} — off-shift check`, status: 'fixed', message: 'Was stuck at work after shift ended — moved home' });
        } else {
          checks.push({ name: `${char.name} — off-shift check`, status: 'passed', message: 'Off shift, location looks correct' });
        }
      }
    }

    const summary = issues_found.length === 0
      ? `✅ All ${allChars.filter(c => c.work_start_time).length} characters with work schedules checked — no shift/location mismatches found.`
      : `⚠️ Found ${issues_found.length} shift/location mismatch(es). Applied ${fixCount} fix(es).`;

    return Response.json({ summary, issues_found, fixes_applied, checks });
  } catch (error) {
    console.error('Enforcement error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});