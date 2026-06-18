import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════════
// readCharacterStateSnapshot
//
// Reads database state AND produces the exact same resolver output the UI pages
// use by duplicating the frontend resolver logic inlined below.
//
// SOURCE LABELS (assigned to every field):
//   "database_character_record"        — direct DB column, no transformation
//   "duplicated_resolver:<function>"   — exact copy of frontend function logic
//   "estimated_from_character_fields"  — best-effort inference, NOT verified
//   "missing_access"                   — could not determine, reported honestly
//
// NEVER label an estimate as verified UI state.
// NEVER hardcode a value the backend cannot prove.
// ═══════════════════════════════════════════════════════════════════════════════

// ── HELPERS ──────────────────────────────────────────────────────────────────
const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
function nowET() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); }
function nowETDay() { return nowET().getDay(); }
function nowETMin() { const d = nowET(); return d.getHours() * 60 + d.getMinutes(); }

const NPC_TYPES = new Set(['npc_regular', 'npc_family_member', 'npc_fictitious', 'npc']);
function isNPC(character) { return NPC_TYPES.has(character?.character_type); }

// ── computeAdaptiveSleepWindow (exact copy from sleepUtils.js:491-610) ───────
function computeAdaptiveSleepWindow(character, locationMap) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER = 60;
  const DECOMPRESSION_MIN = 60;

  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, source: 'stored_schedule' };
  }

  if (isNPC(character)) {
    const homeId = character.current_home_location_id;
    if (homeId && locationMap[homeId]?.name === 'VGC Towers') {
      return { sleepStartMin: 150, wakeMin: 510, source: 'vgc_resident_schedule' };
    }
    return { sleepStartMin: 0, wakeMin: 8 * 60, source: 'npc_forced_default' };
  }

  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const startMin = toMin(character.work_start_time);
    const endMin = toMin(character.work_end_time);
    if (startMin !== null && endMin !== null) {
      const day = nowETDay();
      const yesterday = (day + 6) % 7;
      const isOvernight = endMin < startMin;
      if (isOvernight) {
        if (character.work_days.includes(yesterday) || character.work_days.includes(day)) {
          const s = (endMin + DECOMPRESSION_MIN) % 1440;
          return { sleepStartMin: s, wakeMin: (s + SLEEP_DURATION_MIN) % 1440, source: 'overnight_work' };
        }
      } else {
        if (character.work_days.includes(day)) {
          const w = (startMin - PRE_SHIFT_BUFFER + 1440) % 1440;
          return { sleepStartMin: (w - SLEEP_DURATION_MIN + 1440) % 1440, wakeMin: w, source: 'work_schedule' };
        }
      }
    }
  }

  // School
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const day = nowETDay();
    let ss = null, se = null;
    if (Array.isArray(character.education_enrollments)) {
      const a = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
      if (a) { ss = toMin(a.start_time); se = toMin(a.end_time); }
    }
    if ((ss === null || se === null) && locationMap[character.education_location_id]) {
      const loc = locationMap[character.education_location_id];
      if (loc.operating_hours) {
        const e = (loc.operating_hours.filter(h => h.day_of_week === day || h.day_of_week == null))[0];
        if (e) { ss = toMin(e.open_time); se = toMin(e.close_time); }
      }
    }
    if (ss !== null && se !== null) {
      const w = (ss - 60 + 1440) % 1440;
      return { sleepStartMin: (w - SLEEP_DURATION_MIN + 1440) % 1440, wakeMin: w, source: 'school_resolved' };
    }
    return { sleepStartMin: null, wakeMin: null, source: 'school_schedule_unresolved' };
  }

  if (!isNPC(character)) return { sleepStartMin: null, wakeMin: null, source: 'no_structured_timing' };
  return { sleepStartMin: 23 * 60, wakeMin: 7 * 60, source: 'no_structured_timing' };
}

// ── isCharacterAsleep (exact copy from sleepUtils.js:634-786) ────────────────
function isCharacterAsleep(character, locationMap) {
  if (!character) return false;
  const status = character.resolved_presence_status || '';

  if (!isNPC(character)) {
    if (status === 'passed_out') return true;
    if (status !== 'sleeping' && status !== 'napping') return false;
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s === null || w === null) return false;
    const now = nowETMin();
    const inside = s > w ? (now >= s || now < w) : (now >= s && now < w);
    if (!inside) return false;
    const candidates = [character.last_sleep_start, character.resolved_last_updated_at, character.last_need_simulated_at].filter(Boolean);
    if (candidates.length > 0) {
      const earliest = Math.min(...candidates.map(t => new Date(t).getTime()));
      if ((nowET().getTime() - earliest) / 3_600_000 >= 8) return false;
    }
    const day = nowETDay();
    if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.includes(day)) {
      const ws = toMin(character.work_start_time);
      const we = toMin(character.work_end_time);
      if (ws !== null && we !== null) {
        const onShift = we < ws ? (now >= ws || now < we) : (now >= ws && now < we);
        if (onShift) return false;
      }
    }
    if (character.student_status === 'enrolled' && character.education_location_id && [1,2,3,4,5].includes(day)) {
      const enrolls = character.education_enrollments;
      if (Array.isArray(enrolls)) {
        const a = enrolls.find(e => e.status === 'active' && e.start_time && e.end_time);
        if (a) { const as = toMin(a.start_time); const ae = toMin(a.end_time); if (as !== null && ae !== null && now >= as && now < ae) return false; }
      }
    }
    return true;
  }

  // NPC path
  if (character.decided_to_stay_up_until && new Date() < new Date(character.decided_to_stay_up_until)) return false;
  const npcNow = nowETMin();
  const npcDay = nowETDay();
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.includes(npcDay)) {
    const ws = toMin(character.work_start_time);
    const we = toMin(character.work_end_time);
    if (ws !== null && we !== null) {
      const onShift = we < ws ? (npcNow >= ws || npcNow < we) : (npcNow >= ws && npcNow < we);
      if (onShift) return false;
    }
  }
  if (character.travel_status && character.travel_status !== 'not_traveling') return false;
  if (character.is_jailed || character.house_arrest_active) return false;
  const win = computeAdaptiveSleepWindow(character, locationMap);
  if (!win || win.sleepStartMin == null || win.wakeMin == null) return false;
  if (win.sleepStartMin > win.wakeMin) return npcNow >= win.sleepStartMin || npcNow < win.wakeMin;
  return npcNow >= win.sleepStartMin && npcNow < win.wakeMin;
}

// ── isCharacterOnWorkShift (exact copy from locationResolutionEngine:564-567) ─
function isCharacterOnWorkShift(character) {
  if (!character.work_start_time || !character.work_end_time || !Array.isArray(character.work_days) || character.work_days.length === 0) return false;
  const day = nowETDay();
  if (!character.work_days.includes(day)) return false;
  const s = toMin(character.work_start_time);
  const e = toMin(character.work_end_time);
  if (s === null || e === null) return false;
  const now = nowETMin();
  if (e < s) return now >= s || now < e;
  return now >= s && now < e;
}

// ── isOnShiftNow (exact copy from locationResolutionEngine:501-523) ──────────
function isOnShiftNow(shift) {
  if (!shift?.start || !shift?.end) return false;
  const day = nowETDay();
  if (shift.days && shift.days.length > 0 && !shift.days.includes(day)) return false;
  const now = nowETMin();
  const s = toMin(shift.start);
  const e = toMin(shift.end);
  if (s === null || e === null) return false;
  if (e < s) return now >= s || now < e;
  return now >= s && now < e;
}

// ── resolveHousingLocationForCharacter (exact copy) ──────────────────────
function resolveHousingForCharacter(character, locationMap) {
  if (!character) return { housing_location_id: null, housing_location_name: null, housing_context: 'stable_home', source_reason: 'no_character', home_resolution_failed: false, may_assign_temporary_housing: false };

  const homeId = character.current_home_location_id || character.home_location_id;
  if (homeId) {
    const hl = locationMap[homeId];
    if (hl) return { housing_location_id: homeId, housing_location_name: hl.name || 'Home', housing_context: 'stable_home', source_reason: 'permanent_home_valid', home_resolution_failed: false, may_assign_temporary_housing: false };
    return { housing_location_id: homeId, housing_location_name: null, housing_context: 'stable_home', source_reason: 'home_id_exists_lookup_failed', home_resolution_failed: true, may_assign_temporary_housing: false };
  }

  // Last known home from resolved presence
  if (character.resolved_current_location_id && character.resolved_location_type === 'home') {
    const ll = locationMap[character.resolved_current_location_id];
    if (ll) return { housing_location_id: character.resolved_current_location_id, housing_location_name: ll.name || 'Home', housing_context: 'stable_home', source_reason: 'last_known_home', home_resolution_failed: false, may_assign_temporary_housing: false };
  }

  // Resident scan fallback
  const homeLocs = Object.values(locationMap).filter(
    loc => (loc.category === 'home' || loc.category === 'generic') &&
           ((loc.resident_character_ids || []).includes(character.id) ||
            (loc.residents || []).some(r => r.character_id === character.id))
  );
  if (homeLocs.length > 0) {
    const f = homeLocs[0];
    return { housing_location_id: f.id, housing_location_name: f.name || 'Home', housing_context: 'stable_home', source_reason: 'home_from_resident_scan', home_resolution_failed: false, may_assign_temporary_housing: false };
  }

  return { housing_location_id: null, housing_location_name: null, housing_context: null, source_reason: 'homeless', home_resolution_failed: false, may_assign_temporary_housing: true };
}

// ── isLocationOpen (exact copy from locationHoursUtils.js:24-54) ──────────
function isLocationOpen(location) {
  if (!location?.operating_hours || location.operating_hours.length === 0) return null;
  const day = nowETDay();
  const now = nowETMin();
  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const today = daySpecific.filter(h => h.day_of_week === day);
  if (today.length > 0) return today.some(h => { const o = toMin(h.open_time); const c = toMin(h.close_time); return o !== null && c !== null && (c < o ? (now >= o || now < c) : (now >= o && now < c)); });
  if (daySpecific.length > 0) return false;
  if (dayAgnostic.length > 0) return dayAgnostic.some(h => { const o = toMin(h.open_time); const c = toMin(h.close_time); return o !== null && c !== null && (c < o ? (now >= o || now < c) : (now >= o && now < c)); });
  return null;
}

// ── resolveCharacterLocation (exact copy from locationResolutionEngine:39-495) ─
function resolveCharacterLocation(character, locationMap) {
  if (!character) return { resolved_current_location_id: null, resolved_current_location_name: 'Unknown', resolved_location_type: null, resolved_presence_status: 'unknown', resolved_source_reason: 'no_character', resolved_zone: null };

  const mapSize = Object.keys(locationMap).length;
  if (mapSize === 0) {
    const db = character.resolved_presence_status;
    const dbId = character.resolved_current_location_id;
    if (db && dbId) return { resolved_current_location_id: dbId, resolved_current_location_name: character.resolved_current_location_name || 'Location unavailable', resolved_location_type: character.resolved_location_type || 'unknown', resolved_presence_status: db, resolved_source_reason: 'location_map_unavailable_preserved_db_state', resolved_zone: null };
  }

  // Callout guard
  const todayET = nowET().toISOString().slice(0, 10);
  const hasCallout = character.work_exception_status === 'called_out' && character.work_exception_date === todayET;

  if (!hasCallout) {
    // LAYER 1: Work schedule
    const allWorkLocs = [];
    if (character.occupation_location_id) allWorkLocs.push(character.occupation_location_id);
    if (character.current_work_location_id && !allWorkLocs.includes(character.current_work_location_id)) allWorkLocs.push(character.current_work_location_id);
    if (character.additional_occupation_locations?.length > 0) {
      character.additional_occupation_locations.forEach(loc => { if (loc.location_id && !allWorkLocs.includes(loc.location_id)) allWorkLocs.push(loc.location_id); });
    }
    for (const wid of allWorkLocs) {
      const wl = locationMap[wid];
      if (!wl) {
        const dbWork = character.resolved_presence_status === 'at_work' && character.resolved_current_location_id === wid;
        if (dbWork || isCharacterOnWorkShift(character)) {
          return { resolved_current_location_id: wid, resolved_current_location_name: character.resolved_current_location_name || character.occupation_location_name || 'Work', resolved_location_type: 'work', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule_location_temporarily_unavailable', resolved_zone: null };
        }
        continue;
      }
      if (isLocationOpen(wl) === false) continue;
      const shift = wl.worker_shifts?.[character.id];
      if (shift && isOnShiftNow(shift)) {
        return { resolved_current_location_id: wid, resolved_current_location_name: wl.name || 'Work', resolved_location_type: 'work', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule', resolved_zone: null };
      }
      if (!shift && isCharacterOnWorkShift(character)) {
        return { resolved_current_location_id: wid, resolved_current_location_name: wl.name || 'Work', resolved_location_type: 'work', resolved_presence_status: 'at_work', resolved_source_reason: 'work_schedule', resolved_zone: null };
      }
    }
  }

  // LAYER 2: School
  if (character.student_status === 'enrolled' && character.education_location_id && !isCharacterAsleep(character, locationMap)) {
    const sl = locationMap[character.education_location_id];
    if (sl && isLocationOpen(sl) !== false) {
      return { resolved_current_location_id: character.education_location_id, resolved_current_location_name: sl.name || 'School', resolved_location_type: 'school', resolved_presence_status: 'at_school', resolved_source_reason: 'school_schedule', resolved_zone: null };
    }
    if (!sl) {
      if (character.resolved_presence_status === 'at_school' && character.resolved_current_location_id === character.education_location_id) {
        return { resolved_current_location_id: character.education_location_id, resolved_current_location_name: character.resolved_current_location_name || character.education_location_name || 'School', resolved_location_type: 'school', resolved_presence_status: 'at_school', resolved_source_reason: 'school_schedule_location_temporarily_unavailable', resolved_zone: null };
      }
    }
  }

  // LAYER 2.5: Rabbit hole
  if (character.resolved_presence_status === 'rabbit_hole' || character.is_rabbit_hole === true) {
    return { resolved_current_location_id: null, resolved_current_location_name: character.rabbit_hole_label || character.resolved_current_location_name || 'Off-screen', resolved_location_type: 'rabbit_hole', resolved_presence_status: 'rabbit_hole', resolved_source_reason: character.resolved_source_reason || 'rabbit_hole', resolved_zone: null };
  }

  // LAYER 3.5A: Sleep enforcement
  const sleepHomeId = (character.temporary_housing_location_id && locationMap[character.temporary_housing_location_id])
    ? character.temporary_housing_location_id
    : (character.current_home_location_id && locationMap[character.current_home_location_id])
      ? character.current_home_location_id
      : (character.home_location_id && locationMap[character.home_location_id])
        ? character.home_location_id
        : null;

  if (isCharacterAsleep(character, locationMap)) {
    if (sleepHomeId) {
      const shLoc = locationMap[sleepHomeId];
      return { resolved_current_location_id: sleepHomeId, resolved_current_location_name: shLoc?.name || 'Home', resolved_location_type: 'home', resolved_presence_status: 'sleeping', resolved_source_reason: isNPC(character) ? 'npc_forced_sleep_window' : 'home_sleeping', resolved_zone: null };
    }
    return { resolved_current_location_id: null, resolved_current_location_name: 'Unresolved', resolved_location_type: 'sleep_unresolved', resolved_presence_status: 'sleeping', resolved_source_reason: 'no_valid_sleep_location', resolved_zone: null };
  }

  // LAYER 3.5D: Social visit
  const homeForVisit = character.current_home_location_id || character.home_location_id;
  const visitLoc = character.resolved_current_location_id;
  const away = visitLoc && visitLoc !== homeForVisit;
  const isSystemVisit = character.presence_state === 'social_visit' || character.resolved_presence_status === 'visiting' || /autonomous/.test(character.resolved_source_reason || '') || character.resolved_source_reason === 'user_travel';
  if (away && isSystemVisit) {
    const svLoc = locationMap[visitLoc];
    if (svLoc) return { resolved_current_location_id: visitLoc, resolved_current_location_name: svLoc.name || character.resolved_current_location_name || 'Visiting', resolved_location_type: 'visit', resolved_presence_status: character.resolved_presence_status || 'visiting', resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system', resolved_zone: null };
    if (!svLoc && character.resolved_current_location_name) return { resolved_current_location_id: visitLoc, resolved_current_location_name: character.resolved_current_location_name + ' (temporarily unavailable)', resolved_location_type: 'visit', resolved_presence_status: character.resolved_presence_status || 'visiting', resolved_source_reason: 'visit_location_temporarily_unavailable', resolved_zone: null };
  }

  // Home resolution
  let homeId = character.temporary_housing_location_id || character.current_home_location_id || character.home_location_id || null;
  if (character.is_temporarily_housed && character.temporary_housing_location_id) homeId = character.temporary_housing_location_id;

  const housing = resolveHousingForCharacter(character, locationMap);
  if (housing.home_resolution_failed && housing.housing_location_id) {
    return { resolved_current_location_id: housing.housing_location_id, resolved_current_location_name: character.resolved_current_location_name || 'Home (temporarily unavailable)', resolved_location_type: 'home', resolved_presence_status: 'home', resolved_source_reason: 'home_location_temporarily_unavailable', resolved_zone: null };
  }
  if (housing.housing_location_id && !housing.home_resolution_failed) {
    return { resolved_current_location_id: housing.housing_location_id, resolved_current_location_name: housing.housing_location_name || 'Home', resolved_location_type: housing.housing_context === 'stable_home' ? 'home' : 'visit', resolved_presence_status: housing.housing_context === 'stable_home' ? 'home' : 'visiting', resolved_source_reason: housing.source_reason, resolved_zone: null };
  }

  // Temporary housing
  if (housing.housing_location_id === null && housing.may_assign_temporary_housing && !housing.home_resolution_failed && character.owner_email) {
    const balance = character.current_balance ?? 6000;
    const hotel = Object.values(locationMap).find(l => l.owner_email === character.owner_email && l.is_system_managed && l.system_location_role === 'temporary_hotel');
    const shelter = Object.values(locationMap).find(l => l.owner_email === character.owner_email && l.is_system_managed && l.system_location_role === 'emergency_shelter');
    const temp = (balance >= 150 && hotel) ? hotel : shelter;
    if (temp) return { resolved_current_location_id: temp.id, resolved_current_location_name: temp.name || 'Temporary Housing', resolved_location_type: 'home', resolved_presence_status: 'home', resolved_source_reason: 'temporary_housing_assignment', resolved_zone: null };
  }

  const h2 = resolveHousingForCharacter(character, locationMap);
  if (h2.housing_location_id) return { resolved_current_location_id: h2.housing_location_id, resolved_current_location_name: h2.housing_location_name || 'Home', resolved_location_type: 'home', resolved_presence_status: 'home', resolved_source_reason: 'fallback_to_home_base', resolved_zone: null };

  return { resolved_current_location_id: null, resolved_current_location_name: 'Unresolved', resolved_location_type: 'location_unresolved', resolved_presence_status: 'location_unresolved', resolved_source_reason: 'no_valid_home_or_temporary_location', resolved_zone: null };
}

// ── getCharacterLivePresence (exact copy from locationResolutionEngine:778-924) ─
function getCharacterLivePresence(character, locationMap) {
  if (!character) return { status: 'unknown', label: 'Unknown', sublabel: null, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };

  const loc = locationMap[character.resolved_current_location_id];
  const locName = loc?.name || character.resolved_current_location_name || null;
  const presenceStatus = character.resolved_presence_status || character.location_status;
  const dbSleepStatus = presenceStatus === 'sleeping' || presenceStatus === 'napping' || presenceStatus === 'resting';
  const charAsleep = isCharacterAsleep(character, locationMap);

  if (dbSleepStatus) {
    const label = presenceStatus === 'napping' ? 'Napping' : presenceStatus === 'resting' ? 'Resting' : 'Sleeping';
    return { status: presenceStatus, label, sublabel: locName, isSleeping: true, source: 'duplicated_resolver:getCharacterLivePresence' };
  }
  if (charAsleep) {
    const label = presenceStatus === 'napping' ? 'Napping' : 'Sleeping';
    return { status: presenceStatus === 'napping' ? 'napping' : 'sleeping', label, sublabel: locName, isSleeping: true, source: 'duplicated_resolver:getCharacterLivePresence' };
  }

  const hungerCritical = (character.hunger_value ?? 70) < 15;
  const healthCritical = (character.health_value ?? 80) < 20;
  const energyCritical = (character.energy_value ?? 75) < 10;

  if (healthCritical) return { status: 'health_critical', label: 'Health Emergency', sublabel: locName, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
  if (energyCritical && presenceStatus !== 'at_work') return { status: 'energy_critical', label: 'Exhausted', sublabel: locName, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
  if (hungerCritical) return { status: 'hunger_critical', label: 'Looking for food', sublabel: locName, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };

  if (character.resolved_presence_status === 'rabbit_hole' || character.is_rabbit_hole === true) {
    const label = character.rabbit_hole_label || character.resolved_current_location_name || 'Off-screen';
    return { status: 'rabbit_hole', label, sublabel: character.rabbit_hole_subtype || null, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
  }

  // Live schedule pre-check
  const live = resolveCharacterLocation(character, locationMap);
  if (live.resolved_presence_status === 'at_work') {
    const wln = locationMap[live.resolved_current_location_id]?.name || live.resolved_current_location_name || 'Work';
    return { status: 'at_work', label: 'At work', sublabel: wln, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
  }
  if (live.resolved_presence_status === 'at_school') {
    const sln = locationMap[live.resolved_current_location_id]?.name || live.resolved_current_location_name || 'School';
    return { status: 'at_school', label: 'At school', sublabel: sln, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
  }

  if (presenceStatus === 'at_work') {
    const isSchedule = character.resolved_source_reason === 'work_schedule' || character.resolved_source_reason === 'work_schedule_enforced';
    if (isSchedule && character.resolved_current_location_id) {
      return { status: 'at_work', label: 'At work', sublabel: loc?.name || character.resolved_current_location_name || 'Work', isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
    }
    const lwc = resolveCharacterLocation(character, locationMap);
    if (lwc.resolved_presence_status === 'at_work') {
      return { status: 'at_work', label: 'At work', sublabel: locationMap[lwc.resolved_current_location_id]?.name || lwc.resolved_current_location_name || 'Work', isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
    }
  }
  if (presenceStatus === 'at_school') {
    const sl = locationMap[character.education_location_id];
    return { status: 'at_school', label: 'At school', sublabel: sl?.name || 'School', isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
  }
  if (presenceStatus === 'visiting') return { status: 'visiting', label: `At ${locName}`, sublabel: null, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
  if (presenceStatus === 'home') {
    if (character.current_home_location_id || character.home_location_id) {
      return { status: 'home', label: 'At home', sublabel: locName, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
    }
  }

  const hasValid = !!character.resolved_current_location_id && !!locName;
  return hasValid
    ? { status: 'at_location', label: `At ${locName}`, sublabel: null, isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' }
    : { status: 'away', label: 'Away', sublabel: 'No valid location assigned', isSleeping: false, source: 'duplicated_resolver:getCharacterLivePresence' };
}

// ── getCharacterTravelAvailability (exact copy from travelAvailability.js:13-139) ─
function getCharacterTravelAvailability(character, locationMap) {
  if (!character) return { available: false, reason: 'Unknown status', source: 'duplicated_resolver:getCharacterTravelAvailability' };

  if (character.is_jailed) {
    return { available: false, reason: `Incarcerated at ${character.incarceration_facility_name || 'a confinement facility'}`, source: 'duplicated_resolver:getCharacterTravelAvailability' };
  }

  if (isNPC(character)) {
    const dbStatus = character.resolved_presence_status;
    if (dbStatus === 'sleeping' || dbStatus === 'napping') {
      return { available: false, reason: 'Asleep', source: 'duplicated_resolver:getCharacterTravelAvailability' };
    }
    return { available: true, reason: null, source: 'duplicated_resolver:getCharacterTravelAvailability' };
  }

  const resolved = resolveCharacterLocation(character, locationMap);
  const locationObj = locationMap[resolved.resolved_current_location_id];
  const SLEEP_SOURCES = new Set(['home_sleeping', 'sleep_location_correction', 'adaptive_sleep_location_lock', 'pass_out_recovery']);

  const isSleeping = resolved.resolved_presence_status === 'sleeping' || resolved.resolved_presence_status === 'napping' || SLEEP_SOURCES.has(resolved.resolved_source_reason);
  const isPraying = resolved.resolved_source_reason === 'praying_at_home';
  const category = locationObj?.category || 'generic';

  let iconType = 'calm';
  if (isSleeping) iconType = 'sleep';
  else if (isPraying) iconType = 'prayer';
  else if (resolved.resolved_source_reason === 'work_schedule') iconType = 'work';
  else if (resolved.resolved_source_reason === 'school_schedule') iconType = 'school';
  else if (category === 'medical') iconType = 'hospital';

  if (iconType === 'sleep') return { available: false, reason: 'Asleep', source: 'duplicated_resolver:getCharacterTravelAvailability' };
  if (iconType === 'work') {
    const hasJob = character?.work_details?.job_title || character?.occupation_location_id;
    if (!hasJob) return { available: true, reason: null, source: 'duplicated_resolver:getCharacterTravelAvailability' };
    return { available: false, reason: `At work`, source: 'duplicated_resolver:getCharacterTravelAvailability' };
  }
  if (iconType === 'school') return { available: false, reason: 'At school', source: 'duplicated_resolver:getCharacterTravelAvailability' };
  if (iconType === 'hospital') return { available: false, reason: 'At the hospital', source: 'duplicated_resolver:getCharacterTravelAvailability' };
  if (iconType === 'prayer') return { available: false, reason: 'Praying', source: 'duplicated_resolver:getCharacterTravelAvailability' };

  return { available: true, reason: null, source: 'duplicated_resolver:getCharacterTravelAvailability' };
}

// ── WHO'S COMING CHECK (duplicates the roster-level location grouping) ────
function computeWhoIsComing(targetCharId, allCharacters, locationMap) {
  const byLocation = {};
  for (const c of allCharacters) {
    if (!c.id || c.status !== 'active') continue;
    const res = resolveCharacterLocation(c, locationMap);
    const locId = res.resolved_current_location_id;
    if (!locId) continue;
    if (!byLocation[locId]) byLocation[locId] = [];
    byLocation[locId].push(c.id);
  }

  const target = allCharacters.find(c => c.id === targetCharId);
  if (!target) return { listed: false, reason: 'character_not_found_in_roster', source: 'duplicated_resolver:whoIsComingCheck' };

  const targetRes = resolveCharacterLocation(target, locationMap);
  const targetLocId = targetRes.resolved_current_location_id;

  if (!targetLocId) return { listed: false, reason: 'no_resolved_location', source: 'duplicated_resolver:whoIsComingCheck' };

  const others = (byLocation[targetLocId] || []).filter(id => id !== targetCharId);
  return {
    listed: true,
    location_id: targetLocId,
    location_name: locationMap[targetLocId]?.name || targetRes.resolved_current_location_name,
    others_at_same_location: others.length,
    other_character_ids: others,
    source: 'duplicated_resolver:whoIsComingCheck',
  };
}

// ── ROSTER MEMBERSHIP CHECKS (does the LocationReference actually list them?) ──
function inWorkerRoster(loc, charId) {
  if (!loc) return null;
  return (loc.worker_character_ids || []).includes(charId) || !!(loc.worker_shifts && loc.worker_shifts[charId]);
}
function inResidentRoster(loc, charId) {
  if (!loc) return null;
  return (loc.resident_character_ids || []).includes(charId) || (loc.residents || []).some(r => r.character_id === charId);
}
function inStudentRoster(loc, charId) {
  if (!loc) return null;
  return (loc.enrolled_students || []).some(s => s.character_id === charId);
}

// ── SCHEDULE-BASED EXPECTED STATE (computed from schedule + current Eastern time) ─
// This is the source that was previously NOT collected — the reason schedule
// contradictions could not be detected. Computes what SHOULD be true right now.
function computeScheduleState(character, locationMap) {
  const day = nowETDay();
  const nowMin = nowETMin();
  const et = nowET();
  const etLabel = et.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', weekday: 'short', hour12: true });

  const onShiftNow = isCharacterOnWorkShift(character);

  const sleepWin = computeAdaptiveSleepWindow(character, locationMap);
  let inSleepWindow = false;
  if (sleepWin && sleepWin.sleepStartMin != null && sleepWin.wakeMin != null) {
    inSleepWindow = sleepWin.sleepStartMin > sleepWin.wakeMin
      ? (nowMin >= sleepWin.sleepStartMin || nowMin < sleepWin.wakeMin)
      : (nowMin >= sleepWin.sleepStartMin && nowMin < sleepWin.wakeMin);
  }

  let schoolInSession = false;
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const sl = locationMap[character.education_location_id];
    if (sl && [1, 2, 3, 4, 5].includes(day) && isLocationOpen(sl) === true) schoolInSession = true;
  }

  let expectedState = 'free';
  if (onShiftNow) expectedState = 'at_work';
  else if (schoolInSession) expectedState = 'at_school';
  else if (inSleepWindow) expectedState = 'sleeping';

  const fmt = (m) => m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  return {
    available: true,
    app_time_et: etLabel,
    has_schedule_data: !!(character.work_start_time || character.sleep_start_time || character.student_status === 'enrolled'),
    on_work_shift_now: onShiftNow,
    in_sleep_window: inSleepWindow,
    sleep_window: (sleepWin && sleepWin.sleepStartMin != null) ? `${fmt(sleepWin.sleepStartMin)}-${fmt(sleepWin.wakeMin)} (${sleepWin.source})` : null,
    school_in_session: schoolInSession,
    expected_state: expectedState,
    expected_source: 'schedule_plus_eastern_time',
    work_schedule: character.work_start_time ? `${character.work_start_time}-${character.work_end_time} days[${(character.work_days || []).join(',')}]` : 'none',
    sleep_schedule: character.sleep_start_time ? `${character.sleep_start_time}-${character.wake_up_time}` : 'none',
    student_status: character.student_status || 'not_student',
  };
}

function computeRosterState(character, locationMap) {
  const occLoc = character.occupation_location_id ? locationMap[character.occupation_location_id] : null;
  const homeLoc = character.current_home_location_id ? locationMap[character.current_home_location_id] : null;
  const eduLoc = character.education_location_id ? locationMap[character.education_location_id] : null;

  return {
    occupation: character.occupation_location_id ? {
      location_id: character.occupation_location_id,
      location_name: occLoc?.name || character.occupation_location_name || null,
      location_found: !!occLoc,
      listed_as_worker: occLoc ? inWorkerRoster(occLoc, character.id) : null,
    } : null,
    home: character.current_home_location_id ? {
      location_id: character.current_home_location_id,
      location_name: homeLoc?.name || null,
      location_found: !!homeLoc,
      listed_as_resident: homeLoc ? inResidentRoster(homeLoc, character.id) : null,
    } : null,
    school: character.education_location_id ? {
      location_id: character.education_location_id,
      location_name: eduLoc?.name || character.education_location_name || null,
      location_found: !!eduLoc,
      listed_as_student: eduLoc ? inStudentRoster(eduLoc, character.id) : null,
    } : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    const characterId = payload.characterId || payload.character_id;
    const ownerEmail = payload.ownerEmail || payload.owner_email || null;

    if (!characterId) {
      return new Response(JSON.stringify({ error: 'characterId is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // ── FETCH TARGET CHARACTER ──────────────────────────────────────────
    const query = ownerEmail ? { id: characterId, owner_email: ownerEmail } : { id: characterId };
    const chars = await base44.entities.Character.filter(query);
    const character = chars[0] || null;

    if (!character) {
      return new Response(JSON.stringify({ error: `Character not found` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    // ── FETCH LOCATIONS ─────────────────────────────────────────────────
    const locations = await base44.entities.LocationReference.list(null, 500).catch(() => []);
    const locationMap = {};
    for (const loc of locations) locationMap[loc.id] = loc;

    // ── FETCH ALL ACTIVE CHARACTERS FOR WHO'S COMING ────────────────────
    const allChars = await base44.entities.Character.list(null, 200).catch(() => []);
    const activeChars = allChars.filter(c => c.status === 'active');

    const et = nowET();

    // ═════════════════════════════════════════════════════════════════════
    // DATABASE STATE
    // ═════════════════════════════════════════════════════════════════════
    const db = {};
    const dbFields = [
      'resolved_presence_status', 'resolved_current_location_id', 'resolved_current_location_name',
      'resolved_location_type', 'resolved_source_reason', 'travel_status', 'traveling_to_location_id',
      'is_jailed', 'house_arrest_active', 'energy_value', 'health_value', 'hunger_value',
      'student_status', 'sleep_start_time', 'wake_up_time', 'work_start_time', 'work_end_time',
      'work_days', 'current_home_location_id', 'occupation_location_id', 'education_location_id',
      'last_sleep_start', 'last_pass_out_at', 'pass_out_count', 'presence_stay_lock',
      'presence_stay_lock_reason', 'character_type',
    ];
    for (const f of dbFields) {
      db[f] = { value: character[f] ?? null, source: 'database_character_record' };
    }

    // ═════════════════════════════════════════════════════════════════════
    // PAGE-FACING STATE (duplicated resolver output)
    // ═════════════════════════════════════════════════════════════════════
    const homeCard = getCharacterLivePresence(character, locationMap);
    const travelAvailability = getCharacterTravelAvailability(character, locationMap);
    const whoIsComing = computeWhoIsComing(characterId, activeChars, locationMap);

    const pageFacing = {
      home_card: {
        displayed_status: { value: homeCard.label, source: homeCard.source },
        displayed_location: { value: homeCard.sublabel, source: homeCard.source },
        is_sleeping: { value: homeCard.isSleeping, source: homeCard.source },
      },
      travel_page: {
        available_for_travel: { value: travelAvailability.available, source: travelAvailability.source },
        unavailable_reason: { value: travelAvailability.reason, source: travelAvailability.source },
      },
      who_is_coming: {
        listed: { value: whoIsComing.listed, source: whoIsComing.source },
        location_name: { value: whoIsComing.location_name || null, source: whoIsComing.source },
        others_at_location: { value: whoIsComing.others_at_same_location, source: whoIsComing.source },
      },
      map_page: {
        displayed_location: db.resolved_current_location_name,
        marker_presence: db.resolved_presence_status,
      },
      locations_page: {
        shown_location: db.resolved_current_location_name,
        presence: db.resolved_presence_status,
      },
      profile_page: {
        displayed_status: { value: homeCard.label, source: homeCard.source },
        displayed_location: db.resolved_current_location_name,
      },
    };

    // ═════════════════════════════════════════════════════════════════════
    // CONTRADICTIONS
    // ═════════════════════════════════════════════════════════════════════
    const contradictions = [];
    const dbPresence = db.resolved_presence_status.value;

    // DB sleep vs resolver sleep
    const dbSleepy = dbPresence === 'sleeping' || dbPresence === 'napping' || dbPresence === 'resting';
    if (dbSleepy && !homeCard.isSleeping) {
      contradictions.push({
        field: 'sleep_state',
        database_value: dbPresence,
        resolver_value: homeCard.label,
        affected_page: 'Home',
        severity: 'high',
        source: 'duplicated_resolver:getCharacterLivePresence',
      });
    }
    if (!dbSleepy && homeCard.isSleeping) {
      contradictions.push({
        field: 'sleep_state',
        database_value: dbPresence || 'not_sleeping',
        resolver_value: 'Sleeping (resolver says yes, DB says no)',
        affected_page: 'Home',
        severity: 'medium',
        source: 'duplicated_resolver:getCharacterLivePresence',
      });
    }

    // DB at_work vs resolver at_work
    if (dbPresence === 'at_work' && homeCard.status !== 'at_work') {
      contradictions.push({
        field: 'work_state',
        database_value: 'at_work',
        resolver_value: homeCard.label,
        affected_page: 'Home',
        severity: 'medium',
        source: 'duplicated_resolver:getCharacterLivePresence',
      });
    }

    // DB at_work but travel says available
    if (dbPresence === 'at_work' && travelAvailability.available) {
      contradictions.push({
        field: 'travel_availability',
        database_value: 'at_work (should be unavailable)',
        resolver_value: 'available',
        affected_page: 'Travel',
        severity: 'high',
        source: 'duplicated_resolver:getCharacterTravelAvailability',
      });
    }

    // ── SCHEDULE-BASED EXPECTED STATE + ROSTER MEMBERSHIP ──────────────────
    const scheduleState = computeScheduleState(character, locationMap);
    const rosterState = computeRosterState(character, locationMap);

    // Work schedule says on-shift now, but neither UI nor backend shows at_work
    if (scheduleState.on_work_shift_now && homeCard.status !== 'at_work' && dbPresence !== 'at_work') {
      contradictions.push({
        field: 'work_schedule_vs_state',
        database_value: dbPresence || 'not at work',
        resolver_value: `Home card: ${homeCard.label}`,
        affected_page: 'Home/Profile/Travel',
        severity: 'high',
        source: 'schedule_plus_eastern_time',
        detail: `Work schedule (${scheduleState.work_schedule}) places this character on-shift at ${scheduleState.app_time_et} Eastern, but they are not shown at work.`,
      });
    }

    // Sleep window active for current Eastern time, but shown awake/active
    if (scheduleState.in_sleep_window && !homeCard.isSleeping && !dbSleepy && scheduleState.expected_state === 'sleeping') {
      contradictions.push({
        field: 'sleep_schedule_vs_state',
        database_value: dbPresence || 'awake',
        resolver_value: `Home card: ${homeCard.label}`,
        affected_page: 'Home',
        severity: 'medium',
        source: 'schedule_plus_eastern_time',
        detail: `Sleep window (${scheduleState.sleep_window}) is active at ${scheduleState.app_time_et} Eastern, but the character is shown awake.`,
      });
    }

    // Occupation assigned on character file, but LocationReference roster doesn't list them
    if (rosterState.occupation?.location_found && rosterState.occupation.listed_as_worker === false) {
      contradictions.push({
        field: 'occupation_roster_mismatch',
        database_value: `assigned to ${rosterState.occupation.location_name}`,
        resolver_value: 'NOT in that location\'s worker roster',
        affected_page: 'Location',
        severity: 'high',
        source: 'location_roster',
        detail: 'Character file lists occupation_location_id, but the LocationReference worker roster does not include this character — employment link is broken.',
      });
    }

    // School enrolled on character file, but school roster doesn't list them
    if (rosterState.school?.location_found && rosterState.school.listed_as_student === false) {
      contradictions.push({
        field: 'school_roster_mismatch',
        database_value: `enrolled at ${rosterState.school.location_name}`,
        resolver_value: 'NOT in that school\'s enrolled_students roster',
        affected_page: 'Location',
        severity: 'high',
        source: 'location_roster',
        detail: 'Character file marks student_status enrolled with an education_location_id, but the school roster does not list this character.',
      });
    }

    // Home assigned on character file, but residents roster doesn't list them
    if (rosterState.home?.location_found && rosterState.home.listed_as_resident === false) {
      contradictions.push({
        field: 'home_roster_mismatch',
        database_value: `home set to ${rosterState.home.location_name}`,
        resolver_value: 'NOT in that location\'s residents roster',
        affected_page: 'Location',
        severity: 'medium',
        source: 'location_roster',
        detail: 'Character file lists current_home_location_id, but the LocationReference residents roster does not include this character.',
      });
    }

    // ═════════════════════════════════════════════════════════════════════
    // MISSING ACCESS
    // ═════════════════════════════════════════════════════════════════════
    const missingAccess = [];
    if (Object.keys(locationMap).length === 0) {
      missingAccess.push({
        resolver: 'location_map',
        reason: 'Location records could not be loaded. All location-dependent resolvers are operating on preserved DB state.',
        affected_pages: ['home_card', 'travel_page', 'map_page', 'locations_page', 'who_is_coming'],
      });
    }

    // ═════════════════════════════════════════════════════════════════════
    // ASSEMBLE
    // ═════════════════════════════════════════════════════════════════════
    return new Response(JSON.stringify({
      character_id: character.id,
      character_name: character.name,
      character_type: character.character_type || 'unknown',
      checked_at_app_time_et: et.toISOString(),
      database_state: db,
      page_facing_state: pageFacing,
      schedule_state: scheduleState,
      roster_state: rosterState,
      contradictions,
      missing_access: missingAccess,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});