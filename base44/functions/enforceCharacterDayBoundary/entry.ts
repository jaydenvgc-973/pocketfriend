import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ENFORCE CHARACTER DAY BOUNDARY
 * 
 * Runs daily at midnight (3:00 AM UTC = 11:00 PM ET previous day).
 * Purpose: prevent characters from staying away indefinitely across day changes.
 * 
 * Rules:
 * 1. If character is NOT at home, NOT sleeping, and NOT at active work → return home
 * 2. If character is traveling but destination is unreachable → clear travel, send home
 * 3. If character is at a location with closed operating hours → return home
 * 4. Do NOT interrupt valid work shifts or sleep periods
 * 
 * This is the hard boundary that prevents overnight outings without explicit context.
 */

function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isLocationOpen(location, nowET) {
  if (!location?.operating_hours || location.operating_hours.length === 0) return true;
  const dayOfWeek = nowET.getDay();
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  
  const toMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const isInWindow = (open, close) => {
    const o = toMinutes(open);
    const c = toMinutes(close);
    if (o == null || c == null) return false;
    if (o <= c) return currentMin >= o && currentMin <= c;
    return currentMin >= o || currentMin <= c;
  };

  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);

  if (todayEntries.length > 0) {
    return todayEntries.some(h => isInWindow(h.open_time, h.close_time));
  }
  if (daySpecific.length > 0 && todayEntries.length === 0) return false;
  if (dayAgnostic.length > 0) {
    return dayAgnostic.some(h => isInWindow(h.open_time, h.close_time));
  }
  return true;
}

function isWorkScheduleActive(char, nowET) {
  if (!char.work_start_time || !char.work_end_time || !char.work_days) return false;
  const dayOfWeek = nowET.getDay();
  if (!char.work_days.includes(dayOfWeek)) return false;
  const [sh, sm] = char.work_start_time.split(':').map(Number);
  const [eh, em] = char.work_end_time.split(':').map(Number);
  const now = nowET.getHours() * 60 + nowET.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled */ }

    const nowET = getNowET();
    const log = [];
    let returnedCount = 0;

    // Load all active characters
    let characters = [];
    try {
      characters = await base44.entities.Character.filter({ status: 'active' }, '-updated_date', 500);
    } catch {
      characters = await base44.asServiceRole.entities.Character.filter({ status: 'active' }, '-updated_date', 500);
    }

    // Load all locations
    let allLocations = [];
    try {
      allLocations = await base44.entities.LocationReference.list('-updated_date', 1000);
    } catch {
      allLocations = await base44.asServiceRole.entities.LocationReference.list('-updated_date', 1000);
    }
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const toReturn = [];

    for (const char of characters) {
      // Skip if no home
      if (!char.current_home_location_id) continue;

      // Skip if already home
      if (char.resolved_current_location_id === char.current_home_location_id) continue;

      // Skip if hospitalized (valid medical state)
      if (char.resolved_presence_status === 'hospitalized') continue;

      // Skip if passed_out — protected recovery state. Only the authorized
      // recovery path in simulateActiveCharacterNeeds/autonomousCharacterMovement
      // may end a pass-out occurrence. Day-boundary must not clear it.
      if (char.resolved_presence_status === 'passed_out') continue;

      // Stale sleep: if sleeping/napping but past wake_up_time, WAKE and return home
      if (['sleeping', 'napping'].includes(char.resolved_presence_status)) {
        const wakeTime = char.wake_up_time || '07:00';
        const [wakeH, wakeM] = wakeTime.split(':').map(Number);
        const wakeMinutes = wakeH * 60 + wakeM;
        const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
        if (currentMinutes >= wakeMinutes + 30) {
          // Stale sleep detected — wake and return home
          toReturn.push({
            id: char.id,
            name: char.name,
            reason: 'stale_sleep_day_boundary',
            from: char.resolved_current_location_name || char.resolved_presence_status,
          });
        }
        continue;
      }

      // Skip if in valid work shift
      if (isWorkScheduleActive(char, nowET)) continue;

      // Skip if jailed
      if (char.is_jailed) continue;

      // Rule 1: If at closed location → return home
      const currentLoc = locationMap[char.resolved_current_location_id];
      if (currentLoc && !isLocationOpen(currentLoc, nowET)) {
        toReturn.push({
          id: char.id,
          name: char.name,
          reason: 'location_closed',
          from: currentLoc.name,
        });
        continue;
      }

      // Rule 2: If traveling but destination unreachable → return home
      if (char.travel_status && char.travel_status !== 'not_traveling') {
        const destLoc = locationMap[char.travel_destination_location_id];
        if (!destLoc) {
          toReturn.push({
            id: char.id,
            name: char.name,
            reason: 'stale_travel_destination',
            from: char.resolved_current_location_name || 'Unknown',
          });
          continue;
        }
        // Valid active travel destination exists — protect this state, do not return home
        continue;
      }

      // Rule 3: General day boundary — no infinite outings
      // Only return characters without explicit overnight approval
      const hasOvernightApproval = 
        char.overnight_travel_approved === true ||
        char.overnight_stay_approved === true ||
        char.user_confirmed_overnight === true ||
        char.resolved_source_reason === 'overnight_travel_approved' ||
        char.resolved_source_reason === 'overnight_stay_approved' ||
        char.resolved_source_reason === 'user_confirmed_overnight';
      if (hasOvernightApproval) {
        continue;
      }

      // No approval — return to home
      toReturn.push({
        id: char.id,
        name: char.name,
        reason: 'day_boundary_overnight_outing',
        from: char.resolved_current_location_name || 'Unknown',
      });
    }

    // Execute returns
    for (const item of toReturn) {
      const char = characters.find(c => c.id === item.id);
      const homeLocId = char.current_home_location_id;
      const homeLoc = locationMap[homeLocId];
      const homeLocName = homeLoc?.name || 'Home';

      try {
         // Only clear travel fields if returning from stale travel destination
         const travelClears = item.reason === 'stale_travel_destination'
           ? { travel_status: 'not_traveling', travel_destination_location_id: null }
           : {};

         // Check if current_activity references the old location
         const currentLoc = locationMap[char.resolved_current_location_id];
         const activityConflict = currentLoc && char.current_activity &&
           char.current_activity.toLowerCase().includes(currentLoc.name.toLowerCase());

         // Check if current_activity is sleep-related (for stale sleep wake)
         const isSleepActivity = char.current_activity &&
           (char.current_activity.toLowerCase().includes('sleep') ||
            char.current_activity.toLowerCase().includes('nap') ||
            char.current_activity.toLowerCase().includes('exhausted'));

         const activityClear = (activityConflict || isSleepActivity) ? { current_activity: null } : {};

         const payload = {
           resolved_current_location_id: homeLocId,
           resolved_current_location_name: homeLocName,
           resolved_presence_status: 'home',
           resolved_location_type: 'home',
           resolved_source_reason: `day_boundary_${item.reason}`,
           ...travelClears,
           ...activityClear,
         };

         await base44.asServiceRole.entities.Character.updateMany(
           { id: item.id, resolved_presence_status: { $nin: ['passed_out','sleeping','napping','hospitalized'] } },
           { $set: payload }
         );

        log.push(`${item.name}: ${item.from} → Home (${item.reason})`);
        returnedCount++;
      } catch (e) {
        console.error(`[dayBoundary] Failed to return ${item.name}:`, e.message);
      }
    }

    return Response.json({
      success: true,
      timestamp: nowET.toISOString(),
      characters_returned: returnedCount,
      log,
    });

  } catch (error) {
    console.error('[enforceCharacterDayBoundary]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});