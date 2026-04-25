import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * OWNERSHIP-ISOLATED SCHEDULER
 * 
 * Queries ALL active_created_character records globally.
 * Groups by owner_email (the stored ownership field).
 * Processes each group independently — no cross-account access.
 * 
 * Input: { characterId? }
 * Output (single): { updated, oldLocation, newLocation, reason }
 * Output (scan):   { summary, issues_found, fixes_applied, checks, charactersByOwner }
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

    const isBlockedFromWork = (char) => {
      const isSleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
      const isCriticallyIll = char.health_value !== undefined && char.health_value < 20;
      const isInEmergency = char.current_activity && char.current_activity.toLowerCase().includes('emergency');
      return isSleeping || isCriticallyIll || isInEmergency;
    };

    // --- Single character mode (user-scoped) ---
    if (characterId) {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

      // Query by BOTH ownership paths
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
        if (isAtWork && isSleeping && !hasValidSleepReason) {
          newLocationId = character.current_home_location_id;
          shouldUpdate = !!newLocationId;
          reason = 'SLEEPING_AT_WORK_INVALID — relocating to home to sleep';
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

    // --- GLOBAL SCHEDULER MODE (no session required) ---
    // Query ALL active_created_character records
    const allActiveCreated = await base44.asServiceRole.entities.Character.filter({
      character_type: 'active_created_character',
      status: 'active'
    });

    console.log(`[enforceCharacterWorkSchedule] Found ${allActiveCreated.length} active_created_character records`);

    // CRITICAL: Group by owner_email (stored ownership field)
    const charactersByOwner = {};
    const blockedCharacters = [];

    for (const char of allActiveCreated) {
      // BLOCK: Missing ownership
      if (!char.owner_email) {
        blockedCharacters.push({
          id: char.id,
          name: char.name,
          reason: 'OWNERSHIP_BLOCKED — owner_email missing',
          action: 'no_movement'
        });
        console.warn(`[enforceCharacterWorkSchedule] OWNERSHIP BLOCKED: ${char.name} (${char.id}) — owner_email missing`);
        continue;
      }

      // Group by owner_email
      const ownerEmail = char.owner_email;
      if (!charactersByOwner[ownerEmail]) {
        charactersByOwner[ownerEmail] = [];
      }
      charactersByOwner[ownerEmail].push(char);
    }

    console.log(`[enforceCharacterWorkSchedule] Grouped characters by owner_email: ${Object.keys(charactersByOwner).length} owners`);

    const issues_found = [];
    const fixes_applied = [];
    const checks = [];
    let fixCount = 0;

    const validSleepAtWorkReasons = ['overnight_shift', 'on_call', 'emergency', 'user_directed'];
    const hasValidSleepAtWorkReason = (char) => {
      const activity = (char.current_activity || '').toLowerCase();
      return validSleepAtWorkReasons.some(r => activity.includes(r));
    };

    // PROCESS EACH OWNER GROUP INDEPENDENTLY
    for (const [ownerEmail, groupChars] of Object.entries(charactersByOwner)) {
      console.log(`[enforceCharacterWorkSchedule] Processing owner ${ownerEmail}: ${groupChars.length} characters`);

      // Load ONLY locations for this owner
      const groupLocations = await base44.asServiceRole.entities.LocationReference.filter({
        owner_email: ownerEmail
      });
      const locationMapForGroup = Object.fromEntries(groupLocations.map(l => [l.id, l]));

      for (const char of groupChars) {
        const charType = char.character_type;
        const isSimulationChar = ['active_created_character', 'npc_fictitious_character'].includes(charType);
        if (!isSimulationChar) {
          continue;
        }

        if (isBlockedFromWork(char)) {
          checks.push({ name: `${char.name} — blocked from work`, status: 'skipped', message: 'Character is sleeping, critically sick, or in emergency state' });
          continue;
        }

        const workLocId = char.current_work_location_id || char.occupation_location_id;

        if (!char.work_start_time || !char.work_end_time || !char.work_days) {
          const resolvedLocId = char.resolved_current_location_id;
          const isSleepingAtWork = workLocId && resolvedLocId === workLocId &&
            (char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping');
          if (isSleepingAtWork && !hasValidSleepAtWorkReason(char)) {
            const homeLocId = char.current_home_location_id;
            if (homeLocId) {
              // VERIFY: home location exists in this owner's scope
              if (!locationMapForGroup[homeLocId]) {
                issues_found.push(`${char.name}: LOCATION_OUT_OF_SCOPE — home location ${homeLocId} not in owner scope`);
                continue;
              }
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
            // VERIFY: work location exists in this owner's scope
            if (!locationMapForGroup[workLocId]) {
              issues_found.push(`${char.name}: LOCATION_OUT_OF_SCOPE — work location ${workLocId} not in owner scope`);
              continue;
            }
            issues_found.push(`${char.name}: should be at work (${char.work_start_time}–${char.work_end_time}) but location is stale — STALE_SCHEDULE_LOCATION_DATA`);
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
          }
        } else {
          const homeLocId = char.current_home_location_id;

          if (isAtWorkLocation && isSleeping && !hasValidSleepAtWorkReason(char)) {
            issues_found.push(`${char.name}: SLEEPING_AT_WORK_INVALID — shift ended, asleep at work with no valid reason`);
            if (homeLocId) {
              // VERIFY: home location exists in this owner's scope
              if (!locationMapForGroup[homeLocId]) {
                issues_found.push(`${char.name}: LOCATION_OUT_OF_SCOPE — home location ${homeLocId} not in owner scope`);
                continue;
              }
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
          else if (isAtWorkLocation && !isSleeping) {
            issues_found.push(`${char.name}: POST_SHIFT_EXIT_NOT_TRIGGERED — off shift but still at work location`);
            if (homeLocId) {
              // VERIFY: home location exists in this owner's scope
              if (!locationMapForGroup[homeLocId]) {
                issues_found.push(`${char.name}: LOCATION_OUT_OF_SCOPE — home location ${homeLocId} not in owner scope`);
                continue;
              }
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
          } else {
            checks.push({ name: `${char.name} — off-shift check`, status: 'passed', message: 'Off shift, location looks correct' });
          }
        }
      }
    }

    const summary = issues_found.length === 0
      ? `✅ Processed ${allActiveCreated.length} active_created_character records across ${Object.keys(charactersByOwner).length} owners — no shift/location mismatches found.`
      : `⚠️ Found ${issues_found.length} issue(s): POST_SHIFT_EXIT_NOT_TRIGGERED=${issues_found.filter(i=>i.includes('POST_SHIFT')).length}, SLEEPING_AT_WORK_INVALID=${issues_found.filter(i=>i.includes('SLEEPING')).length}, LOCATION_OUT_OF_SCOPE=${issues_found.filter(i=>i.includes('OUT_OF_SCOPE')).length}. Applied ${fixCount} fix(es). Blocked: ${blockedCharacters.length}`;

    return Response.json({ 
      summary, 
      issues_found, 
      fixes_applied, 
      checks,
      charactersByOwner: Object.keys(charactersByOwner),
      blockedCharacters
    });
  } catch (error) {
    console.error('Enforcement error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});