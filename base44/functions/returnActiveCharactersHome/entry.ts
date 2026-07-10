import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RETURN-HOME BATCHING SYSTEM
 * 
 * Moves active_created_characters home in batches of 5.
 * Triggered when locations close or travel periods end.
 * 
 * PROTECTED FIELDS (never written):
 * - resolved_last_updated_at (system only)
 * - current_home_location_id, occupation_location_id (read-only sources of truth)
 * - travel_status, travel_destination_location_id (preserve if valid travel)
 * 
 * CONDITIONAL WRITES:
 * - current_activity: only cleared if verified conflict with resolved location
 * 
 * Processing order:
 * 1. Characters at closed locations
 * 2. Characters past 2.5 hour non-home limit
 * 3. Characters with work/school soon
 * 4. Remaining non-home characters
 */

function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isLocationOpen(location, nowET) {
  if (!location?.operating_hours || location.operating_hours.length === 0) return true;
  const dayOfWeek = nowET.getDay();
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);
  
  const isInWindow = (open, close) => {
    if (!open || !close) return false;
    const [oh, om] = open.split(':').map(Number);
    const [ch, cm] = close.split(':').map(Number);
    const oMin = oh * 60 + om;
    const cMin = ch * 60 + cm;
    if (oMin <= cMin) return currentMin >= oMin && currentMin <= cMin;
    return currentMin >= oMin || currentMin <= cMin;
  };
  
  if (todayEntries.length > 0) return todayEntries.some(h => isInWindow(h.open_time, h.close_time));
  if (daySpecific.length > 0) return false;
  if (dayAgnostic.length > 0) return dayAgnostic.some(h => isInWindow(h.open_time, h.close_time));
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

function isShiftActiveNow(shift, nowET) {
  if (!shift?.start || !shift?.end) return false;
  if (shift.days && shift.days.length > 0) {
    if (!shift.days.includes(nowET.getDay())) return false;
  }
  const now = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

function getCharacterWorkLocation(char, locationsByUser, nowET) {
  const email = char.owner_email;
  const locations = locationsByUser[email] || [];

  // Collect ALL work location IDs for this character
  const allWorkLocIds = [];
  if (char.occupation_location_id) allWorkLocIds.push(char.occupation_location_id);
  if (char.current_work_location_id && !allWorkLocIds.includes(char.current_work_location_id)) {
    allWorkLocIds.push(char.current_work_location_id);
  }
  if (char.additional_occupation_locations?.length > 0) {
    for (const entry of char.additional_occupation_locations) {
      if (entry.location_id && !allWorkLocIds.includes(entry.location_id)) {
        allWorkLocIds.push(entry.location_id);
      }
    }
  }

  // For each location, check if character has an active shift there RIGHT NOW.
  // If a location-specific shift exists for this character, it is AUTHORITATIVE —
  // the character-level work_days/start/end do NOT apply for that location.
  for (const locId of allWorkLocIds) {
    const loc = locations.find(l => l.id === locId);
    if (!loc) continue;

    const locationShift = loc.worker_shifts?.[char.id];
    if (locationShift) {
      // Location has an explicit shift for this character — use it as sole authority
      if (isShiftActiveNow(locationShift, nowET)) {
        return { id: loc.id, name: loc.name };
      }
      // Shift defined but not active — skip character-level fallback for this location
      continue;
    }

    // No location-specific shift — fall back to character's own work_days/start/end
    if (isWorkScheduleActive(char, nowET)) {
      return { id: loc.id, name: loc.name };
    }
  }

  return null;
}

function isWorkScheduleSoon(char, nowET, minutesWindow = 120) {
   if (!char.work_start_time || !char.work_days) return false;
   const dayOfWeek = nowET.getDay();
   if (!char.work_days.includes(dayOfWeek)) return false;
   const [sh, sm] = char.work_start_time.split(':').map(Number);
   const now = nowET.getHours() * 60 + nowET.getMinutes();
   const startMin = sh * 60 + sm;
   const minutesUntilWork = startMin - now;
   return minutesUntilWork > 0 && minutesUntilWork <= minutesWindow;
}

function isSchoolScheduleActive(char, nowET) {
    if (char.student_status !== 'enrolled' || !char.education_location_id) return false;
    // If school schedule details not available, assume standard 8 AM - 3 PM
    const now = nowET.getHours() * 60 + nowET.getMinutes();
    return now >= 480 && now < 900; // 8:00 AM - 3:00 PM
}

function hasValidActiveTravel(char) {
  return char.travel_status && char.travel_status !== 'not_traveling' && char.travel_destination_location_id;
}

function shouldProtectFromHomeReturn(char) {
  // MANDATORY GUARD: protect all active obligations before forcing home
  if (isWorkScheduleActive(char, new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })))) return true;
  if (isSchoolScheduleActive(char, new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })))) return true;
  if (hasValidActiveTravel(char)) return true;
  // PROTECTED STATES: passed_out, sleeping, napping, hospitalized must NEVER be overridden.
  // Also check presence_stay_lock_reason — even if resolved_presence_status was externally
  // cleared to 'home', a pass_out_recovery stay lock proves the character is still in recovery.
  if (['sleeping', 'napping', 'hospitalized', 'passed_out'].includes(char.resolved_presence_status)) return true;
  if (char.presence_stay_lock === true && char.presence_stay_lock_reason === 'pass_out_recovery') return true;
  if (['user_confirmed_overnight', 'overnight_stay_approved', 'overnight_travel_approved'].includes(char.resolved_source_reason)) return true;
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Allow scheduled automation (no user) via service role
    const useServiceRole = !user;
    const userEmail = user?.email || null;

    const nowET = getNowET();
    const results = {
      success: true,
      timestamp: nowET.toISOString(),
      batches_processed: 0,
      total_returned: 0,
      batches: [],
    };

    // Load characters — cap at 100 (was 500) to reduce query load.
    // Characters are sorted by most-recently-updated so the most active ones
    // (those most likely to need movement) are processed first.
    let characters = [];
    try {
      if (useServiceRole) {
        characters = await base44.asServiceRole.entities.Character.filter(
          { character_type: 'active_created_character', status: 'active' },
          '-updated_date',
          100
        );
      } else {
        characters = await base44.entities.Character.filter(
          { character_type: 'active_created_character', status: 'active' },
          '-updated_date',
          100
        );
      }
    } catch (e) {
      return Response.json({ error: `Character load failed: ${e.message}` }, { status: 500 });
    }

    // Filter to user scope if authenticated
    if (user) {
      characters = characters.filter(c => c.owner_email === user.email);
    }

    // ── FAST EXIT: if no characters have home assignments, skip location fetch entirely ──
    const charsWithHome = characters.filter(c => c.current_home_location_id);
    if (charsWithHome.length === 0) {
      return Response.json({ ...results, skipped: 'no_characters_with_home_assignment' });
    }

    // Load locations (user-scoped)
    const locationsByUser = {};
    for (const char of characters) {
      const email = char.owner_email;
      if (!email) continue;
      if (!locationsByUser[email]) {
        try {
          if (useServiceRole) {
            locationsByUser[email] = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: email });
          } else {
            locationsByUser[email] = await base44.entities.LocationReference.filter({ owner_email: email });
          }
        } catch {
          locationsByUser[email] = [];
        }
      }
    }

    // Identify candidates for return-home or dispatch-to-work
    const candidates = [];
    for (const char of characters) {
      // Skip if no home assigned
      if (!char.current_home_location_id) continue;
      // Skip if in valid travel
      if (char.travel_status && char.travel_status !== 'not_traveling' && char.travel_destination_location_id) {
        const destLoc = locationsByUser[char.owner_email]?.find(l => l.id === char.travel_destination_location_id);
        if (destLoc) continue; // Valid travel — skip
      }
      // Skip hard blocks — passed_out is a protected recovery state that must NEVER
      // be overridden by return-home dispatch. Also check pass_out_recovery stay lock
      // in case resolved_presence_status was externally cleared to 'home'.
      if (['sleeping', 'napping', 'hospitalized', 'passed_out'].includes(char.resolved_presence_status)) continue;
      if (char.presence_stay_lock === true && char.presence_stay_lock_reason === 'pass_out_recovery') continue;
      if (char.is_jailed) continue;

      const currentLoc = locationsByUser[char.owner_email]?.find(l => l.id === char.resolved_current_location_id);
      const isClosed = currentLoc && !isLocationOpen(currentLoc, nowET);
      const isWorkActive = isWorkScheduleActive(char, nowET);
      const isWorkSoon = isWorkScheduleSoon(char, nowET, 120);
      const nonHomeDurationMin = char.last_arrived_time 
        ? Math.floor((nowET.getTime() - new Date(char.last_arrived_time).getTime()) / 60000)
        : null;
      const pastLimit = nonHomeDurationMin && nonHomeDurationMin > 150; // 2.5 hours (non-home leisure only)
      const isAtHome = char.resolved_current_location_id === char.current_home_location_id;

      // CALLOUT GUARD: skip work dispatch if character has a valid callout for today
      const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
        .toISOString().slice(0, 10);
      const hasValidCallout = char.work_exception_status === 'called_out' && char.work_exception_date === todayET;

      // DISPATCH TO WORK (priority over home)
      if (isWorkActive && !isAtHome && !hasValidCallout) {
         const workLoc = getCharacterWorkLocation(char, locationsByUser, nowET);
         if (workLoc && char.resolved_current_location_id !== workLoc.id) {
           candidates.push({
             id: char.id,
             name: char.name,
             currentLocId: char.resolved_current_location_id,
             currentLocName: char.resolved_current_location_name,
             destLocId: workLoc.id,
             destLocName: workLoc.name,
             category: 'work_active',
             isWorkActive: true,
             isClosed: false,
             pastLimit: false,
           });
         }
         continue; // Process work dispatch, don't check other conditions
      }

      // DISPATCH TO SCHOOL (priority equal to work)
      const isSchoolActive = isSchoolScheduleActive(char, nowET);
      if (isSchoolActive && !isAtHome && char.education_location_id) {
         const schoolLoc = locationsByUser[char.owner_email]?.find(l => l.id === char.education_location_id);
         if (schoolLoc && char.resolved_current_location_id !== schoolLoc.id && isLocationOpen(schoolLoc, nowET) !== false) {
           candidates.push({
             id: char.id,
             name: char.name,
             currentLocId: char.resolved_current_location_id,
             currentLocName: char.resolved_current_location_name,
             destLocId: schoolLoc.id,
             destLocName: schoolLoc.name,
             category: 'school_active',
             isWorkActive: false,
             isClosed: false,
             pastLimit: false,
           });
         }
         continue; // Process school dispatch, don't check other conditions
      }

      // RETURN HOME (for closed locations or expired leisure time)
      // GUARD: DO NOT force home if character has active obligations
      // Also: if called out, 'work_soon' no longer applies
      const effectiveWorkSoon = isWorkSoon && !hasValidCallout;
      if ((isClosed || pastLimit || effectiveWorkSoon) && !shouldProtectFromHomeReturn(char)) {
        candidates.push({
          id: char.id,
          name: char.name,
          currentLocId: char.resolved_current_location_id,
          currentLocName: char.resolved_current_location_name,
          destLocId: char.current_home_location_id,
          destLocName: locationsByUser[char.owner_email]?.find(l => l.id === char.current_home_location_id)?.name || 'Home',
          category: isClosed ? 'closed_location' : pastLimit ? 'time_limit' : 'work_soon',
          isWorkActive: false,
          isClosed,
          pastLimit,
        });
      }
    }

    // Sort by category priority: work_active and school_active first (priority 0), then closed, time_limit, work_soon
    const categoryOrder = { work_active: 0, school_active: 0, closed_location: 1, time_limit: 2, work_soon: 3 };
    candidates.sort((a, b) => categoryOrder[a.category] - categoryOrder[b.category]);

    // Process in batches of 5
    const batchSize = 5;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, Math.min(i + batchSize, candidates.length));
      const batchNum = Math.floor(i / batchSize) + 1;

      const batchResult = {
        batch_number: batchNum,
        characters: [],
        dispatched: 0,
        returned: 0,
        failed: 0,
      };

      for (const cand of batch) {
        const char = characters.find(c => c.id === cand.id);
        const destLocId = cand.destLocId;
        const destLocName = cand.destLocName;

        try {
           const presenceStatus = cand.category === 'work_active' ? 'at_work' : (cand.category === 'school_active' ? 'at_school' : 'home');
           const locationType = cand.category === 'work_active' ? 'work' : (cand.category === 'school_active' ? 'school' : 'home');
           const reason = cand.category === 'work_active' ? 'work_schedule_dispatch' : (cand.category === 'school_active' ? 'school_schedule_dispatch' : `${cand.category}_auto`);

           // Detect stale current_activity conflict with resolved location
           let hasActivityConflict = false;
           if (char.current_activity) {
             // Conflict: new location contradicts current_activity narrative
             // (e.g., moving home but current_activity = "At Rumba Cubano")
             if (cand.category !== 'work_active' && cand.category !== 'school_active') {
               // Non-work/school dispatch: if going home and activity isn't home-oriented, it's stale
               hasActivityConflict = true;
             }
           }

           const updatePayload = {
             resolved_current_location_id: destLocId,
             resolved_current_location_name: destLocName,
             resolved_presence_status: presenceStatus,
             resolved_location_type: locationType,
             resolved_source_reason: hasActivityConflict ? 'stale_activity_conflict' : reason,
           };

           // Only write current_activity if conflict detected
           if (hasActivityConflict) {
             updatePayload.current_activity = null;
           }

          if (useServiceRole) {
            await base44.asServiceRole.entities.Character.update(cand.id, updatePayload);
          } else {
            await base44.entities.Character.update(cand.id, updatePayload);
          }

          if (cand.category === 'work_active' || cand.category === 'school_active') {
            batchResult.characters.push({
              name: cand.name,
              from: cand.currentLocName,
              to: destLocName,
              reason: reason,
            });
            batchResult.dispatched++;
          } else {
            batchResult.characters.push({
              name: cand.name,
              from: cand.currentLocName,
              to: destLocName,
              reason: cand.category,
            });
            batchResult.returned++;
          }
          results.total_returned++;
        } catch (e) {
          batchResult.failed++;
          console.error(`[returnHome] Failed to move ${cand.name}:`, e.message);
        }
      }

      results.batches.push(batchResult);
      results.batches_processed++;
    }

    return Response.json(results);

  } catch (error) {
    console.error('[returnActiveCharactersHome]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});