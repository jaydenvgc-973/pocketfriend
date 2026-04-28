import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * OWNERSHIP-ISOLATED SCHEDULER
 * 
 * AUTHORITY: owner_email ONLY
 * - NO session auth (no user.email ownership inference)
 * - NO created_by logic
 * - Groups all active_created_character by owner_email
 * - Processes each owner_email group in complete isolation
 * - Blocks records with missing owner_email immediately
 * - Location access scoped strictly: location.owner_email === character.owner_email
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

    // --- Single character mode (requires session auth to scope to owned character) ---
    if (characterId) {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

      // OWNERSHIP CHECK: Must match owner_email
      const char = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      if (!char || char.length === 0) {
        return Response.json({ error: 'Character not found' }, { status: 404 });
      }
      const character = char[0];

      // OWNERSHIP BOUNDARY: owner_email must match session user
      if (!character.owner_email || character.owner_email !== user.email) {
        return Response.json({ error: 'Access denied — ownership mismatch' }, { status: 403 });
      }

      const workLocId = character.current_work_location_id || character.occupation_location_id;
      const resolvedLocId = character.resolved_current_location_id;
      const isSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
      const activity = (character.current_activity || '').toLowerCase();

      // LOCATION BOUNDARY: work location must match character's owner_email
      if (workLocId) {
        const workLoc = await base44.asServiceRole.entities.LocationReference.filter({ id: workLocId });
        if (workLoc && workLoc.length > 0 && workLoc[0].owner_email !== character.owner_email) {
          return Response.json({ error: 'Location access denied — ownership mismatch' }, { status: 403 });
        }
      }

      // Helper: Check if character is blocked from work
      const isBlockedFromWork = (char) => {
        const isSleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
        const isCriticallyIll = char.health_value !== undefined && char.health_value < 20;
        const isInEmergency = char.current_activity && char.current_activity.toLowerCase().includes('emergency');
        return isSleeping || isCriticallyIll || isInEmergency;
      };

      // Helper: Check if on shift
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

      if (isBlockedFromWork(character)) {
        return Response.json({ updated: false, reason: 'Character blocked from work (sleeping/sick/emergency)' });
      }

      // CALLOUT GUARD: valid callout for today = full work schedule bypass
      const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
        .toISOString().slice(0, 10);
      if (character.work_exception_status === 'called_out' && character.work_exception_date === todayET) {
        return Response.json({ updated: false, reason: 'Character has a valid callout for today — work schedule bypassed' });
      }

      const validSleepReasons = ['overnight_shift', 'on_call', 'emergency', 'user_directed'];
      const hasValidSleepReason = validSleepReasons.some(r => activity.includes(r));

      if (isOnShift(character) && workLocId) {
        await base44.asServiceRole.entities.Character.update(characterId, {
          resolved_current_location_id: workLocId,
          resolved_presence_status: 'at_work',
          resolved_location_type: 'work',
          resolved_last_updated_at: new Date().toISOString(),
        });
        return Response.json({ updated: true, oldLocation: resolvedLocId, newLocation: workLocId, reason: 'On shift — moved to work' });
      }

      if (!isOnShift(character)) {
        if (isSleeping && resolvedLocId === workLocId && !hasValidSleepReason) {
          const homeLocId = character.current_home_location_id;
          if (homeLocId) {
            await base44.asServiceRole.entities.Character.update(characterId, {
              resolved_current_location_id: homeLocId,
              resolved_presence_status: 'sleeping',
              resolved_location_type: 'home',
              resolved_last_updated_at: new Date().toISOString(),
            });
            return Response.json({ updated: true, oldLocation: resolvedLocId, newLocation: homeLocId, reason: 'Sleeping at work — moved home' });
          }
        } else if (resolvedLocId === workLocId && !isSleeping && character.current_home_location_id) {
          const homeLocId = character.current_home_location_id;
          const energy = character.energy_value ?? 75;
          const newStatus = energy < 40 ? 'sleeping' : 'home';
          await base44.asServiceRole.entities.Character.update(characterId, {
            resolved_current_location_id: homeLocId,
            resolved_presence_status: newStatus,
            resolved_location_type: 'home',
            resolved_last_updated_at: new Date().toISOString(),
          });
          return Response.json({ updated: true, oldLocation: resolvedLocId, newLocation: homeLocId, reason: `Shift ended — going home (${newStatus})` });
        }
      }

      return Response.json({ updated: false, reason: 'No schedule change needed' });
    }

    // --- GLOBAL SCHEDULER MODE (no session) ---
    // OWNERSHIP ENFORCEMENT: Group by owner_email, process each in isolation
    const allCharacters = await base44.asServiceRole.entities.Character.filter({
      character_type: 'active_created_character',
      status: 'active'
    });

    console.log(`[enforceCharacterWorkSchedule] Found ${allCharacters.length} total active_created_character records`);

    // OWNERSHIP GROUPING: Group by owner_email
    const charactersByOwner = {};
    const blockedCharacters = [];

    for (const char of allCharacters) {
      // OWNERSHIP BLOCK: Missing owner_email
      if (!char.owner_email) {
        blockedCharacters.push({
          id: char.id,
          name: char.name,
          reason: 'OWNERSHIP_BLOCKED — owner_email missing',
        });
        console.warn(`[enforceCharacterWorkSchedule] BLOCKED: ${char.name} (${char.id}) — no owner_email`);
        continue;
      }

      // Group by owner_email (SOLE OWNERSHIP AUTHORITY)
      if (!charactersByOwner[char.owner_email]) {
        charactersByOwner[char.owner_email] = [];
      }
      charactersByOwner[char.owner_email].push(char);
    }

    const issues_found = [];
    const fixes_applied = [];
    let fixCount = 0;

    // PROCESS EACH OWNER_EMAIL GROUP IN ISOLATION
    for (const [ownerEmail, groupChars] of Object.entries(charactersByOwner)) {
      console.log(`[enforceCharacterWorkSchedule] Processing owner ${ownerEmail}: ${groupChars.length} characters`);

      // Load ONLY locations for this owner
      const ownerLocations = await base44.asServiceRole.entities.LocationReference.filter({
        owner_email: ownerEmail
      });
      const locMap = Object.fromEntries(ownerLocations.map(l => [l.id, l]));

      for (const char of groupChars) {
        const workLocId = char.current_work_location_id || char.occupation_location_id;
        const resolvedLocId = char.resolved_current_location_id;
        const isSleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';

        // Check if on shift
        if (!char.work_start_time || !char.work_end_time || !char.work_days) {
          continue;
        }

        const [startH, startM = 0] = char.work_start_time.split(':').map(Number);
        const [endH, endM = 0] = char.work_end_time.split(':').map(Number);
        const nowMins = currentHour * 60 + currentMinute;
        const startMins = startH * 60 + startM;
        const endMins = endH * 60 + endM;
        const isWorkDay = char.work_days.includes(dayOfWeek);
        const onShift = isWorkDay && nowMins >= startMins && nowMins < endMins;

        // CALLOUT GUARD: skip work enforcement for characters with valid callout today
        const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
          .toISOString().slice(0, 10);
        if (char.work_exception_status === 'called_out' && char.work_exception_date === todayET) {
          continue; // Called out — do not force to work
        }

        if (onShift && workLocId) {
          // OWNERSHIP CHECK: work location must be in same owner scope
          if (!locMap[workLocId]) {
            issues_found.push(`${char.name}: LOCATION_OUT_OF_SCOPE — work location not in owner scope`);
            continue;
          }
          if (resolvedLocId !== workLocId) {
            issues_found.push(`${char.name}: should be at work but location stale`);
            await base44.asServiceRole.entities.Character.update(char.id, {
              resolved_current_location_id: workLocId,
              resolved_presence_status: 'at_work',
              resolved_location_type: 'work',
              resolved_last_updated_at: new Date().toISOString(),
            });
            fixes_applied.push(`${char.name}: synced to work location`);
            fixCount++;
          }
        } else if (!onShift && resolvedLocId === workLocId) {
          // Character is at work but shift ended
          const homeLocId = char.current_home_location_id;
          if (!homeLocId) {
            issues_found.push(`${char.name}: shift ended, at work, no home location`);
            continue;
          }
          // OWNERSHIP CHECK: home location must be in same owner scope
          if (!locMap[homeLocId]) {
            issues_found.push(`${char.name}: LOCATION_OUT_OF_SCOPE — home location not in owner scope`);
            continue;
          }
          if (isSleeping) {
            issues_found.push(`${char.name}: SLEEPING_AT_WORK_INVALID — shift ended`);
          } else {
            issues_found.push(`${char.name}: POST_SHIFT_EXIT_NOT_TRIGGERED — still at work`);
          }
          const energy = char.energy_value || 75;
          const newStatus = energy < 40 ? 'sleeping' : 'home';
          await base44.asServiceRole.entities.Character.update(char.id, {
            resolved_current_location_id: homeLocId,
            resolved_presence_status: newStatus,
            resolved_location_type: 'home',
            resolved_last_updated_at: new Date().toISOString(),
          });
          fixes_applied.push(`${char.name}: relocated home (${newStatus})`);
          fixCount++;
        }
      }
    }

    const summary = issues_found.length === 0
      ? `✅ Processed ${allCharacters.length} active_created_character across ${Object.keys(charactersByOwner).length} owners — no issues.`
      : `⚠️ Found ${issues_found.length} issues, applied ${fixCount} fixes. Blocked: ${blockedCharacters.length} (missing owner_email).`;

    return Response.json({
      summary,
      issues_found,
      fixes_applied,
      owners_processed: Object.keys(charactersByOwner).length,
      blockedCharacters,
    });
  } catch (error) {
    console.error('Enforcement error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});