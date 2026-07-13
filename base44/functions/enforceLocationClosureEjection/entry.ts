/**
 * LOCATION CLOSURE ENFORCEMENT
 *
 * Runs periodically (triggered by scheduled automation or manually).
 * Identifies characters currently at closed locations and ejects them:
 * - active_created_character → return home
 * - npc_fictitious (VGC Towers resident) → return to VGC Towers
 * - npc_family_member/npc_regular → mark as away/rabbit_hole
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isInWindow(currentMinutes, openStr, closeStr) {
  const open = toMinutes(openStr);
  const close = toMinutes(closeStr);
  if (open == null || close == null) return false;
  if (open <= close) {
    return currentMinutes >= open && currentMinutes <= close;
  }
  return currentMinutes >= open || currentMinutes <= close;
}

function isLocationOpen(location) {
  if (!location?.operating_hours || location.operating_hours.length === 0) {
    return true;
  }
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nowET.getDay();
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);
  if (todayEntries.length > 0) {
    return todayEntries.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
  }
  if (daySpecific.length > 0 && todayEntries.length === 0) {
    return false;
  }
  if (dayAgnostic.length > 0) {
    return dayAgnostic.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
  }
  return true;
}

// Check if a location-specific shift for this character is active right now (ET)
function isLocationShiftActiveNow(shift, nowET) {
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

// Returns true only if the character has an ACTIVE shift at one of their work locations RIGHT NOW.
// worker_shifts[char.id] is authoritative per location.
// Falls back to character-level schedule only when no location-specific shift exists for that location.
function isWorkScheduleActive(char, locationMap) {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

  const allWorkLocIds = [];
  if (char.occupation_location_id) allWorkLocIds.push(char.occupation_location_id);
  if (char.current_work_location_id && !allWorkLocIds.includes(char.current_work_location_id)) {
    allWorkLocIds.push(char.current_work_location_id);
  }
  if (Array.isArray(char.additional_occupation_locations)) {
    for (const entry of char.additional_occupation_locations) {
      if (entry.location_id && !allWorkLocIds.includes(entry.location_id)) {
        allWorkLocIds.push(entry.location_id);
      }
    }
  }

  for (const locId of allWorkLocIds) {
    const loc = locationMap?.[locId];
    if (!loc) continue;
    const locationShift = loc.worker_shifts?.[char.id];
    if (locationShift) {
      if (isLocationShiftActiveNow(locationShift, nowET)) return true;
      // Shift defined but not active — do NOT fall back to character schedule for this location
      continue;
    }
    // No location-specific shift — fall back to character-level schedule
    if (!char.work_start_time || !char.work_end_time || !char.work_days) continue;
    const dayOfWeek = nowET.getDay();
    if (!char.work_days.includes(dayOfWeek)) continue;
    const [sh, sm] = char.work_start_time.split(':').map(Number);
    const [eh, em] = char.work_end_time.split(':').map(Number);
    const now = nowET.getHours() * 60 + nowET.getMinutes();
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const active = endMin < startMin ? (now >= startMin || now < endMin) : (now >= startMin && now < endMin);
    if (active) return true;
  }
  return false;
}

function isSchoolScheduleActive(char) {
  if (char.student_status !== 'enrolled' || !char.education_location_id) return false;
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const now = nowET.getHours() * 60 + nowET.getMinutes();
  return now >= 480 && now < 900; // 8:00 AM - 3:00 PM
}

function hasValidActiveTravel(char) {
  return char.travel_status && char.travel_status !== 'not_traveling' && char.travel_destination_location_id;
}

function shouldProtectFromHomeReturn(char, locationMap) {
  // MANDATORY GUARD: protect all active obligations before forcing home
  // isWorkScheduleActive now checks worker_shifts per location before falling back to character schedule
  if (isWorkScheduleActive(char, locationMap)) return true;
  if (isSchoolScheduleActive(char)) return true;
  if (hasValidActiveTravel(char)) return true;
  if (['sleeping', 'napping', 'hospitalized'].includes(char.resolved_presence_status)) return true;
  if (['user_confirmed_overnight', 'overnight_stay_approved', 'overnight_travel_approved'].includes(char.resolved_source_reason)) return true;
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled — no session */ }

    // Load all characters and locations
    let allCharacters = [];
    let allLocations = [];

    try {
      allCharacters = await base44.entities.Character.list('-updated_date', 1000);
      allLocations = await base44.entities.LocationReference.list('-updated_date', 1000);
    } catch {
      allCharacters = await base44.asServiceRole.entities.Character.list('-updated_date', 1000);
      allLocations = await base44.asServiceRole.entities.LocationReference.list('-updated_date', 1000);
    }

    // Build location map
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    // Find characters currently at closed locations
    const ejectionLog = [];
    const updatePromises = [];

    for (const char of allCharacters) {
      if (!char.resolved_current_location_id) continue;

      const currentLoc = locationMap[char.resolved_current_location_id];
      if (!currentLoc) continue;

      // Skip if location is open
      if (isLocationOpen(currentLoc)) continue;

      // Location is closed — character must be ejected
      console.log(`[ejection] ${char.name} (${char.character_type}) at closed location: ${currentLoc.name}`);

      let newLocationId = null;
      let newLocationName = null;
      let newStatus = 'rabbit_hole';
      let newReason = 'location_closed_safe_away';

      if (char.character_type === 'active_created_character') {
        // GUARD: Do NOT force home if character has active obligations
        if (shouldProtectFromHomeReturn(char, locationMap)) {
          console.log(`[ejection] ${char.name} protected by active obligation — skipping home return`);
          continue;
        }
        // active_created: return home
        newLocationId = char.current_home_location_id || char.home_location_id || char.residence_id || char.assigned_residence;
        if (newLocationId && locationMap[newLocationId]) {
          newLocationName = locationMap[newLocationId].name;
          newStatus = 'home';
          newReason = 'location_closed_returned_home';
        }
      } else if (char.character_type === 'npc_fictitious') {
        // npc_fictitious: check if VGC Towers resident, return there
        const vgcTowers = allLocations.find(l => l.name === 'VGC Towers' && (l.owner_email === char.owner_email || !l.owner_email));
        if (vgcTowers) {
          newLocationId = vgcTowers.id;
          newLocationName = vgcTowers.name;
          newStatus = 'visiting';
          newReason = 'location_closed_returned_to_vgc';
        }
      }

      // Update character
      const payload = {
        resolved_current_location_id: newLocationId || null,
        resolved_current_location_name: newLocationName,
        resolved_presence_status: newStatus,
        resolved_location_type: newStatus === 'home' ? 'home' : 'rabbit_hole',
        resolved_source_reason: newReason,
        resolved_last_updated_at: new Date().toISOString(),
        travel_status: 'not_traveling',
        travel_destination_location_id: null,
      };

      const updateFn = async () => {
        try {
          await base44.entities.Character.update(char.id, payload);
        } catch {
          await base44.asServiceRole.entities.Character.update(char.id, payload);
        }
      };

      updatePromises.push(updateFn());
      ejectionLog.push(`${char.name} ejected from ${currentLoc.name} → ${newLocationName || 'safe away'}`);
    }

    await Promise.all(updatePromises);

    return Response.json({
      success: true,
      ejected_count: ejectionLog.length,
      ejections: ejectionLog,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[enforceLocationClosureEjection]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});