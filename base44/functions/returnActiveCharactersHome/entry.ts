import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RETURN-HOME BATCHING SYSTEM
 * 
 * Moves active_created_characters home in batches of 5.
 * Triggered when locations close or travel periods end.
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

function getCharacterWorkLocation(char, locationsByUser) {
  const email = char.owner_email || char.created_by;
  const locations = locationsByUser[email] || [];
  
  // Check primary work location
  if (char.occupation_location_id) {
    const loc = locations.find(l => l.id === char.occupation_location_id);
    if (loc) return { id: loc.id, name: loc.name };
  }
  
  // Check current work location
  if (char.current_work_location_id) {
    const loc = locations.find(l => l.id === char.current_work_location_id);
    if (loc) return { id: loc.id, name: loc.name };
  }
  
  // Check additional occupation locations
  if (char.additional_occupation_locations?.length > 0) {
    const loc = locations.find(l => l.id === char.additional_occupation_locations[0].location_id);
    if (loc) return { id: loc.id, name: loc.name };
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

    // Load characters
    let characters = [];
    try {
      if (useServiceRole) {
        characters = await base44.asServiceRole.entities.Character.filter(
          { character_type: 'active_created_character', status: 'active' },
          '-updated_date',
          500
        );
      } else {
        characters = await base44.entities.Character.filter(
          { character_type: 'active_created_character', status: 'active' },
          '-updated_date',
          500
        );
      }
    } catch (e) {
      return Response.json({ error: `Character load failed: ${e.message}` }, { status: 500 });
    }

    // Filter to user scope if authenticated
    if (user) {
      characters = characters.filter(c => c.owner_email === user.email || c.created_by === user.email);
    }

    // Load locations (user-scoped)
    const locationsByUser = {};
    for (const char of characters) {
      const email = char.owner_email || char.created_by;
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
        const destLoc = locationsByUser[char.owner_email || char.created_by]?.find(l => l.id === char.travel_destination_location_id);
        if (destLoc) continue; // Valid travel — skip
      }
      // Skip hard blocks
      if (['sleeping', 'napping', 'hospitalized'].includes(char.resolved_presence_status)) continue;
      if (char.is_jailed) continue;

      const currentLoc = locationsByUser[char.owner_email || char.created_by]?.find(l => l.id === char.resolved_current_location_id);
      const isClosed = currentLoc && !isLocationOpen(currentLoc, nowET);
      const isWorkActive = isWorkScheduleActive(char, nowET);
      const isWorkSoon = isWorkScheduleSoon(char, nowET, 120);
      const nonHomeDurationMin = char.last_arrived_time 
        ? Math.floor((nowET.getTime() - new Date(char.last_arrived_time).getTime()) / 60000)
        : null;
      const pastLimit = nonHomeDurationMin && nonHomeDurationMin > 150; // 2.5 hours (non-home leisure only)
      const isAtHome = char.resolved_current_location_id === char.current_home_location_id;

      // DISPATCH TO WORK (priority over home)
      if (isWorkActive && !isAtHome) {
        const workLoc = getCharacterWorkLocation(char, locationsByUser);
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

      // RETURN HOME (for closed locations or expired leisure time)
      if (isClosed || pastLimit || isWorkSoon) {
        candidates.push({
          id: char.id,
          name: char.name,
          currentLocId: char.resolved_current_location_id,
          currentLocName: char.resolved_current_location_name,
          destLocId: char.current_home_location_id,
          destLocName: locationsByUser[char.owner_email || char.created_by]?.find(l => l.id === char.current_home_location_id)?.name || 'Home',
          category: isClosed ? 'closed_location' : pastLimit ? 'time_limit' : 'work_soon',
          isWorkActive: false,
          isClosed,
          pastLimit,
        });
      }
    }

    // Sort by category priority: work_active first, then closed, time_limit, work_soon
    const categoryOrder = { work_active: 0, closed_location: 1, time_limit: 2, work_soon: 3 };
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
          const presenceStatus = cand.category === 'work_active' ? 'at_work' : 'home';
          const locationType = cand.category === 'work_active' ? 'work' : 'home';
          const reason = cand.category === 'work_active' ? 'work_schedule_dispatch' : `${cand.category}_auto`;

          const updatePayload = {
            resolved_current_location_id: destLocId,
            resolved_current_location_name: destLocName,
            resolved_presence_status: presenceStatus,
            resolved_location_type: locationType,
            resolved_source_reason: reason,
            resolved_last_updated_at: new Date().toISOString(),
            // Clear stale travel/activity fields
            travel_status: 'not_traveling',
            travel_destination_location_id: null,
            current_activity: null,
          };

          if (useServiceRole) {
            await base44.asServiceRole.entities.Character.update(cand.id, updatePayload);
          } else {
            await base44.entities.Character.update(cand.id, updatePayload);
          }

          if (cand.category === 'work_active') {
            batchResult.characters.push({
              name: cand.name,
              from: cand.currentLocName,
              to: destLocName,
              reason: 'work_schedule_dispatch',
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