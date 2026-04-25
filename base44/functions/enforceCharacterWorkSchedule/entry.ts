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
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

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

    // Helper: Check blocking conditions
    const isBlockedFromWork = (char) => {
      const isSleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
      const isCriticallyIll = char.health_value !== undefined && char.health_value < 20;
      const isInEmergency = char.current_activity && char.current_activity.toLowerCase().includes('emergency');
      return isSleeping || isCriticallyIll || isInEmergency;
    };

    // --- Single character mode ---
    if (characterId) {
      // CRITICAL: Filter by user scope using BOTH ownership paths (same as Home page UI)
      const [byCreatedBy, byOwnerEmail] = await Promise.all([
        base44.asServiceRole.entities.Character.filter({ id: characterId, created_by: user.email }),
        base44.asServiceRole.entities.Character.filter({ id: characterId, owner_email: user.email }),
      ]);
      const chars = byCreatedBy.length > 0 ? byCreatedBy : byOwnerEmail;
      if (!chars || chars.length === 0) {
        console.warn(`[enforceCharacterWorkSchedule] Character ${characterId} not found or not owned by ${user.email}`);
        return Response.json({ error: 'Character not found or access denied' }, { status: 404 });
      }
      const character = chars[0];

      let shouldUpdate = false;
      let newLocationId = null;
      let reason = '';

      const workLocId = character.current_work_location_id || character.occupation_location_id;
      const resolvedLocId = character.resolved_current_location_id;
      const isSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
      const isAtWork = workLocId && resolvedLocId === workLocId;
      const activity = (character.current_activity || '').toLowerCase();
      const validSleepReasons = ['overnight_shift', 'on_call', 'emergency', 'user_directed'];
      const hasValidSleepReason = validSleepReasons.some(r => activity.includes(r));

      // CHECK BLOCKING CONDITIONS
      if (isBlockedFromWork(character)) {
        return Response.json({ updated: false, reason: 'Character blocked from work (sleeping/sick/emergency)' });
      }

      if (isOnShift(character)) {
        if (workLocId) {
          newLocationId = workLocId;
          shouldUpdate = true;
          reason = 'On shift now — moved to workplace';
        }
      } else if (!isOnShift(character)) {
        // Off shift: sleeping at work (invalid) or just stuck at work
        if (isAtWork && isSleeping && !hasValidSleepReason) {
          newLocationId = character.current_home_location_id;
          shouldUpdate = !!newLocationId;
          reason = 'SLEEPING_AT_WORK_INVALID — relocating to home to sleep';
          // Keep sleeping status but at home
          if (shouldUpdate) {
            await base44.asServiceRole.entities.Character.update(characterId, {
              resolved_current_location_id: newLocationId,
              resolved_presence_status: 'sleeping',
              resolved_location_type: 'home',
              resolved_last_updated_at: new Date().toISOString(),
            });
            return Response.json({ updated: true, oldLocation: resolvedLocId, newLocation: newLocationId, reason });
          }
        } else if (character.current_home_location_id) {
          newLocationId = character.current_home_location_id;
          const energy = character.energy_value ?? 75;
          const newStatus = energy < 40 ? 'sleeping' : 'home';
          shouldUpdate = true;
          reason = `POST_SHIFT_EXIT — shift ended, going home (${newStatus})`;
          await base44.asServiceRole.entities.Character.update(characterId, {
            resolved_current_location_id: newLocationId,
            resolved_presence_status: newStatus,
            resolved_location_type: 'home',
            resolved_last_updated_at: new Date().toISOString(),
          });
          return Response.json({ updated: true, oldLocation: resolvedLocId, newLocation: newLocationId, reason });
        }
      }

      return Response.json({ updated: false, reason: 'No schedule change needed' });
    }

    // --- Full scan / diagnostic mode (no characterId) ---
    // CRITICAL: Filter by user scope using BOTH ownership paths (same as Home page UI)
    // Legacy characters may have owner_email set instead of created_by
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ status: 'active', created_by: user.email }),
      base44.asServiceRole.entities.Character.filter({ status: 'active', owner_email: user.email }),
    ]);
    const seenIds = new Set();
    const allChars = [...byCreatedBy, ...byOwnerEmail].filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    });

    const issues_found = [];
    const fixes_applied = [];
    const checks = [];
    let fixCount = 0;

    // Valid reasons to sleep at work
    const validSleepAtWorkReasons = ['overnight_shift', 'on_call', 'emergency', 'user_directed'];
    const hasValidSleepAtWorkReason = (char) => {
      const activity = (char.current_activity || '').toLowerCase();
      return validSleepAtWorkReasons.some(r => activity.includes(r));
    };

    for (const char of allChars) {
      // SKIP non-simulation character types (only process active_created_character and npc_fictitious_character)
      const charType = char.character_type;
      const isSimulationChar = ['active_created_character', 'npc_fictitious_character'].includes(charType);
      if (!isSimulationChar) {
        continue;
      }

      // CHECK BLOCKING CONDITIONS EARLY
      if (isBlockedFromWork(char)) {
        checks.push({ name: `${char.name} — blocked from work`, status: 'skipped', message: 'Character is sleeping, critically sick, or in emergency state' });
        continue;
      }

      // Work location: check both fields
      const workLocId = char.current_work_location_id || char.occupation_location_id;

      // Also scan characters without work schedules for asleep-at-work errors
      if (!char.work_start_time || !char.work_end_time || !char.work_days) {
        // No schedule — if they're somehow asleep at a work location, fix it
        const resolvedLocId = char.resolved_current_location_id;
        const isSleepingAtWork = workLocId && resolvedLocId === workLocId &&
          (char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping');
        if (isSleepingAtWork && !hasValidSleepAtWorkReason(char)) {
          const homeLocId = char.current_home_location_id;
          if (homeLocId) {
            issues_found.push(`${char.name}: SLEEPING_AT_WORK_INVALID — no schedule, asleep at work with no valid reason`);
            await base44.asServiceRole.entities.Character.update(char.id, {
              resolved_current_location_id: homeLocId,
              resolved_presence_status: 'sleeping',
              resolved_location_type: 'home',
              resolved_last_updated_at: new Date().toISOString(),
            });
            fixes_applied.push(`${char.name}: relocated from work (sleeping) → home`);
            fixCount++;
          }
        }
        continue;
      }

      const onShift = isOnShift(char);
      const resolvedLocId = char.resolved_current_location_id;
      const isSleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
      const isAtWorkLocation = workLocId && (resolvedLocId === workLocId);

      if (onShift) {
        const isAtWork = isAtWorkLocation;
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
          // VALIDATION: Ensure character exists before updating
          const validateChar = await base44.asServiceRole.entities.Character.filter({ id: char.id, created_by: user.email });
          if (validateChar && validateChar.length > 0) {
            await base44.asServiceRole.entities.Character.update(char.id, {
              resolved_current_location_id: workLocId,
              resolved_presence_status: 'at_work',
              resolved_location_type: 'work',
              location_status: 'at_work',
              current_location_status: 'at_work',
              resolved_last_updated_at: new Date().toISOString(),
            });
            fixes_applied.push(`${char.name}: synced to work location (was: ${resolvedLocId || 'unset'})`);
            fixCount++;
          } else {
            issues_found.push(`${char.name}: character validation failed during work location update — skipped`);
          }
        }
      } else {
        // OFF SHIFT — must not remain at work
        const homeLocId = char.current_home_location_id;

        // Case 1: Asleep at work after shift — CRITICAL error (unless valid reason)
        if (isAtWorkLocation && isSleeping && !hasValidSleepAtWorkReason(char)) {
          issues_found.push(`${char.name}: SLEEPING_AT_WORK_INVALID — shift ended, asleep at work with no valid reason`);
          if (homeLocId) {
            const validateChar = await base44.asServiceRole.entities.Character.filter({ id: char.id, created_by: user.email });
            if (validateChar && validateChar.length > 0) {
              await base44.asServiceRole.entities.Character.update(char.id, {
                resolved_current_location_id: homeLocId,
                resolved_presence_status: 'sleeping',
                resolved_location_type: 'home',
                location_status: 'home',
                current_location_status: 'home',
                resolved_last_updated_at: new Date().toISOString(),
              });
              fixes_applied.push(`${char.name}: SLEEPING_AT_WORK_INVALID fixed — relocated to home to sleep`);
              fixCount++;
              checks.push({ name: `${char.name} — sleep-at-work check`, status: 'fixed', message: 'Was asleep at work after shift ended — relocated to home' });
            }
          }
        }
        // Case 2: Still at work (awake) after shift ended
        else if (isAtWorkLocation && !isSleeping) {
          issues_found.push(`${char.name}: POST_SHIFT_EXIT_NOT_TRIGGERED — off shift but still at work location`);
          if (homeLocId) {
            const validateChar = await base44.asServiceRole.entities.Character.filter({ id: char.id, created_by: user.email });
            if (validateChar && validateChar.length > 0) {
              const energy = char.energy_value || 75;
              const newStatus = energy < 40 ? 'sleeping' : 'home';
              await base44.asServiceRole.entities.Character.update(char.id, {
                resolved_current_location_id: homeLocId,
                resolved_presence_status: newStatus,
                resolved_location_type: 'home',
                location_status: newStatus,
                current_location_status: newStatus,
                resolved_last_updated_at: new Date().toISOString(),
              });
              fixes_applied.push(`${char.name}: POST_SHIFT_EXIT applied — moved home (${newStatus})`);
              fixCount++;
              checks.push({ name: `${char.name} — post-shift exit`, status: 'fixed', message: `Shift ended — moved to home with status '${newStatus}'` });
            }
          }
        } else {
          checks.push({ name: `${char.name} — off-shift check`, status: 'passed', message: 'Off shift, location looks correct' });
        }
      }
    }

    const summary = issues_found.length === 0
      ? `✅ All ${allChars.filter(c => c.work_start_time).length} characters with work schedules checked — no shift/location mismatches found.`
      : `⚠️ Found ${issues_found.length} issue(s): POST_SHIFT_EXIT_NOT_TRIGGERED=${issues_found.filter(i=>i.includes('POST_SHIFT')).length}, SLEEPING_AT_WORK_INVALID=${issues_found.filter(i=>i.includes('SLEEPING')).length}. Applied ${fixCount} fix(es).`;

    return Response.json({ summary, issues_found, fixes_applied, checks });
  } catch (error) {
    console.error('Enforcement error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});