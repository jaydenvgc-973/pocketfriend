import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINE RESOLVER (identical logic to Phase 4A enforceCharacterLocationPresence) ──

// Check if character is on a location-specific shift right now
// Supports shift.days, shift.start, shift.end, and overnight shifts
function isOnShiftNow(shift, etTime) {
  if (!shift?.start || !shift?.end) return false;
  if (shift.days && shift.days.length > 0) {
    if (!shift.days.includes(etTime.getDay())) return false;
  }
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  // Overnight shift (e.g. 22:00 -> 06:00)
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

// Check if character is on their own work schedule right now (character-level fields)
function isOnWorkSchedule(character, etTime) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) return false;
  const dayOfWeek = etTime.getDay();
  if (!character.work_days.includes(dayOfWeek)) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const [sh, sm] = character.work_start_time.split(':').map(Number);
  const [eh, em] = character.work_end_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return now >= startMin && now < endMin;
}

/**
 * ADAPTIVE SLEEP WINDOW — active_created_character only.
 *
 * Returns { sleepStartMin, wakeMin } in minutes-since-midnight (ET),
 * computed from the character's NEXT major obligation (work or school),
 * energy level, and stored schedule as a baseline.
 *
 * Rules:
 * - If the character has an upcoming work shift, sleep is planned so they
 *   wake up ~60 min before that shift starts.
 * - If the character works overnight (shift spans midnight), sleep is placed
 *   BEFORE the shift (daytime), not during or after it.
 * - If no work/school obligation exists, fall back to stored schedule.
 * - Minimum sleep duration: 6 hours. Maximum: 10 hours.
 *
 * Returns null if no sleep window can be determined.
 */
function computeAdaptiveSleepWindow(character, etTime) {
  const SLEEP_DURATION_MIN = 7 * 60;   // 7 hours default
  const PRE_SHIFT_BUFFER   = 60;       // wake up 60 min before shift

  // Collect the character's next shift start/end in minutes-since-midnight
  let nextShiftStartMin = null;
  let nextShiftEndMin   = null;

  // Helper: parse "HH:MM" to minutes
  const toMin = (t) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const dayOfWeek = etTime.getDay();

  // Check location-specific shift first, then character-level fields
  // We only need the start/end times — day matching is handled by the work layer
  const workLocId = character.occupation_location_id || character.current_work_location_id;
  // NOTE: locationMap is NOT available here (helper is called before locationMap lookup)
  // So we rely on character-level work_start_time / work_end_time / work_days
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    // Check if any of the next 2 days is a work day to determine "upcoming" shift
    const isWorkDayToday = character.work_days.includes(dayOfWeek);
    const isWorkDayTomorrow = character.work_days.includes((dayOfWeek + 1) % 7);

    if (isWorkDayToday || isWorkDayTomorrow) {
      nextShiftStartMin = toMin(character.work_start_time);
      nextShiftEndMin   = toMin(character.work_end_time);
    }
  }

  // School obligation
  if (!nextShiftStartMin && character.student_status === 'enrolled' && character.education_location_id) {
    // Default school hours if no explicit time stored
    nextShiftStartMin = 8 * 60;   // 8:00 AM
    nextShiftEndMin   = 15 * 60;  // 3:00 PM
  }

  // ── OVERNIGHT WORKER DETECTION ─────────────────────────────────────────────
  // An overnight shift is one where the shift END crosses midnight relative to start.
  // e.g. start=22:00 (1320), end=06:00 (360) → endMin < startMin
  const isOvernightShift = nextShiftStartMin !== null && nextShiftEndMin !== null &&
    nextShiftEndMin < nextShiftStartMin;

  const nowMin = etTime.getHours() * 60 + etTime.getMinutes();

  if (nextShiftStartMin !== null) {
    if (isOvernightShift) {
      // Overnight worker: sleep window goes from after shift end → before shift start
      // e.g. shift 22:00–06:00 → sleep 07:00–15:00 (daytime sleep)
      const sleepStart = (nextShiftEndMin + 60) % 1440;  // 1hr after shift ends
      const wakeTime   = (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440;
      return { sleepStartMin: sleepStart, wakeMin: wakeTime, isOvernightWorker: true };
    } else {
      // Daytime/standard worker: sleep at night, wake before shift
      const wakeTime   = (nextShiftStartMin - PRE_SHIFT_BUFFER + 1440) % 1440;
      const sleepStart = (wakeTime - SLEEP_DURATION_MIN + 1440) % 1440;
      return { sleepStartMin: sleepStart, wakeMin: wakeTime, isOvernightWorker: false };
    }
  }

  // ── NO OBLIGATION — fall back to stored schedule ───────────────────────────
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) {
      return { sleepStartMin: s, wakeMin: w, isOvernightWorker: false };
    }
  }

  return null; // No sleep schedule determinable
}

function isSleeping(character, etTime) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin, wakeMin } = window;
  // Window crosses midnight
  if (sleepStartMin > wakeMin) return now >= sleepStartMin || now < wakeMin;
  return now >= sleepStartMin && now < wakeMin;
}

// Returns true if within PRE_SLEEP_WINDOW_MINUTES before adaptive sleep start
const PRE_SLEEP_WINDOW_MINUTES = 60;
function isInPreSleepWindow(character, etTime) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin } = window;
  const windowStart = (sleepStartMin - PRE_SLEEP_WINDOW_MINUTES + 1440) % 1440;
  if (windowStart > sleepStartMin) return now >= windowStart || now < sleepStartMin;
  return now >= windowStart && now < sleepStartMin;
}

// Returns true if within `bufferMinutes` of the adaptive sleep start
function isNearSleepWindow(character, etTime, bufferMinutes) {
  const window = computeAdaptiveSleepWindow(character, etTime);
  if (!window) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin } = window;
  const windowStart = (sleepStartMin - bufferMinutes + 1440) % 1440;
  if (windowStart > sleepStartMin) return now >= windowStart || now < sleepStartMin;
  return now >= windowStart && now < sleepStartMin;
}

// Valid sleep locations — categories that are acceptable for sleeping
const VALID_SLEEP_CATEGORIES = new Set(['home', 'hotel', 'shelter', 'generic']);

function isValidSleepLocation(location) {
  if (!location) return false;
  return VALID_SLEEP_CATEGORIES.has(location.category || '');
}

function resolveValidSleepLocationId(character, locationMap) {
  if (character.temporary_housing_location_id && locationMap[character.temporary_housing_location_id]) {
    return character.temporary_housing_location_id;
  }
  if (character.current_home_location_id && locationMap[character.current_home_location_id]) {
    return character.current_home_location_id;
  }
  if (character.home_location_id && locationMap[character.home_location_id]) {
    return character.home_location_id;
  }
  return null;
}

function isNapTime(etTime) {
  const h = etTime.getHours();
  return h >= 13 && h < 16;
}

function hasSleepDebt(character) {
  return character.sleep_debt_hours && character.sleep_debt_hours > 0;
}

function computeResolved(character, locationMap, etTime) {
  const todayET = etTime.toISOString().slice(0, 10);

  // ── LAYER 0: SLEEP HARD LOCK (HIGHEST PRIORITY) ───────────────────────────
  const sleepHomeId = resolveValidSleepLocationId(character, locationMap);
  const sleepHomeLoc = sleepHomeId ? locationMap[sleepHomeId] : null;

  if (isSleeping(character, etTime)) {
    if (sleepHomeId) {
      const currentLocId = character.resolved_current_location_id;
      const currentLoc = currentLocId ? locationMap[currentLocId] : null;
      const alreadyCorrect = currentLocId === sleepHomeId || isValidSleepLocation(currentLoc);
      return {
        resolved_current_location_id: sleepHomeId,
        resolved_current_location_name: sleepHomeLoc?.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: alreadyCorrect ? 'sleep_location_lock' : 'sleep_location_correction',
        resolved_zone: null,
        home_resolution_failed: !sleepHomeLoc,
      };
    }
    return {
      resolved_current_location_id: null,
      resolved_current_location_name: 'Away',
      resolved_location_type: 'rabbit_hole',
      resolved_presence_status: 'sleeping',
      resolved_source_reason: 'sleep_no_valid_home',
      resolved_zone: null,
      home_resolution_failed: true,
    };
  }

  // ── LAYER 0B: RECOVERY NAP LOCK ──────────────────────────────────────────
  if (hasSleepDebt(character) && isNapTime(etTime) && sleepHomeId) {
    return {
      resolved_current_location_id: sleepHomeId,
      resolved_current_location_name: sleepHomeLoc?.name || 'Home',
      resolved_location_type: 'recovery_nap',
      resolved_presence_status: 'napping',
      resolved_source_reason: 'recovery_nap',
      resolved_zone: null,
      home_resolution_failed: !sleepHomeLoc,
    };
  }

  // ── LAYER 0C: PRE-SLEEP RETURN WINDOW (60 min before sleep) ─────────────
  if (isInPreSleepWindow(character, etTime) && sleepHomeId) {
    return {
      resolved_current_location_id: sleepHomeId,
      resolved_current_location_name: sleepHomeLoc?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'returning_home_for_sleep',
      resolved_source_reason: 'pre_sleep_return_home',
      resolved_zone: null,
      home_resolution_failed: !sleepHomeLoc,
    };
  }

  // ── LAYERS 1+: Normal schedule logic (only reached when NOT sleeping) ─────
  const hasValidCallout =
    character.work_exception_status === 'called_out' &&
    character.work_exception_date === todayET;

  // LAYER 1: Work schedule
  // Checks ALL work locations: primary + current + additional jobs.
  // Per location: uses location.worker_shifts[character.id] first; falls back to character's own schedule.
  if (!hasValidCallout) {
    const allWorkLocIds = [];
    if (character.occupation_location_id) allWorkLocIds.push(character.occupation_location_id);
    if (character.current_work_location_id && !allWorkLocIds.includes(character.current_work_location_id)) {
      allWorkLocIds.push(character.current_work_location_id);
    }
    if (Array.isArray(character.additional_occupation_locations)) {
      for (const loc of character.additional_occupation_locations) {
        if (loc.location_id && !allWorkLocIds.includes(loc.location_id)) {
          allWorkLocIds.push(loc.location_id);
        }
      }
    }

    for (const workLocId of allWorkLocIds) {
      const workLoc = locationMap[workLocId];
      if (!workLoc) continue;

      // Check location-specific shift for this character first
      const locationShift = workLoc.worker_shifts?.[character.id];
      if (locationShift) {
        if (isOnShiftNow(locationShift, etTime)) {
          return {
            resolved_current_location_id: workLocId,
            resolved_current_location_name: workLoc.name || 'Work',
            resolved_location_type: 'work',
            resolved_presence_status: 'at_work',
            resolved_source_reason: 'work_schedule',
            resolved_zone: null,
            home_resolution_failed: false,
          };
        }
        // Shift defined but not active — skip character's own schedule for this location
        continue;
      }

      // No location-specific shift — fall back to character's own work_days/start/end
      if (isOnWorkSchedule(character, etTime)) {
        return {
          resolved_current_location_id: workLocId,
          resolved_current_location_name: workLoc.name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule',
          resolved_zone: null,
          home_resolution_failed: false,
        };
      }
    }
  }

  // LAYER 2: School schedule
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolLoc = locationMap[character.education_location_id];
    if (schoolLoc) {
      return {
        resolved_current_location_id: character.education_location_id,
        resolved_current_location_name: schoolLoc.name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: 'school_schedule',
        resolved_zone: null,
        home_resolution_failed: false,
      };
    }
  }

  // LAYER 3: Active travel
  if (character.travel_status && character.travel_status !== 'not_traveling' && character.travel_destination_location_id) {
    const destLoc = locationMap[character.travel_destination_location_id];
    if (destLoc) {
      return {
        resolved_current_location_id: character.travel_destination_location_id,
        resolved_current_location_name: destLoc.name || 'Traveling',
        resolved_location_type: 'traveling',
        resolved_presence_status: 'traveling',
        resolved_source_reason: character.travel_status,
        resolved_zone: null,
        home_resolution_failed: false,
      };
    }
  }

  // LAYER 4: Active system-placed visit
  // ONLY honoured outside sleep and pre-sleep windows (guarded above by Layers 0A/0B/0C).
  // Additionally, visits at invalid sleep locations (bar, gym, club, etc.) are NEVER preserved
  // if the character is within 2 hours of their sleep window.
  const homeId = character.current_home_location_id || character.home_location_id;
  const resolvedLocId = character.resolved_current_location_id;
  const isAwayFromHome = resolvedLocId && resolvedLocId !== homeId;
  const isSystemVisit =
    character.presence_state === 'social_visit' ||
    character.resolved_presence_status === 'visiting' ||
    character.resolved_source_reason === 'autonomous_needs_driven' ||
    character.resolved_source_reason === 'autonomous_movement' ||
    character.resolved_source_reason === 'user_travel';

  if (isAwayFromHome && isSystemVisit) {
    const visitLoc = locationMap[resolvedLocId];
    // Block stale visits at non-sleep-valid locations if near sleep window (2hr buffer)
    if (visitLoc && isValidSleepLocation(visitLoc)) {
      // At a valid sleep location (hotel/shelter/home) — preserve it
      return {
        resolved_current_location_id: resolvedLocId,
        resolved_current_location_name: visitLoc.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
        resolved_zone: null,
        home_resolution_failed: false,
      };
    } else if (visitLoc && !isNearSleepWindow(character, etTime, 120)) {
      // At a non-sleep location but still far enough from sleep — allow visit
      return {
        resolved_current_location_id: resolvedLocId,
        resolved_current_location_name: visitLoc.name || character.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: character.resolved_presence_status || 'visiting',
        resolved_source_reason: character.resolved_source_reason || 'social_visit_from_system',
        resolved_zone: null,
        home_resolution_failed: false,
      };
    }
    // Otherwise: within 2hr of sleep at invalid sleep location → fall through to home fallback
  }

  // Resolve home base for fallback
  let resolvedHomeId = null;
  if (character.is_temporarily_housed === true && character.temporary_housing_location_id) {
    resolvedHomeId = character.temporary_housing_location_id;
  } else {
    resolvedHomeId = character.current_home_location_id || character.home_location_id || null;
  }

  // LAYER 7 (old 6 removed — nap now handled above): Home base fallback
  if (resolvedHomeId) {
    const homeLoc = locationMap[resolvedHomeId];
    return {
      resolved_current_location_id: resolvedHomeId,
      resolved_current_location_name: homeLoc?.name || 'Home',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'fallback_to_home_base',
      resolved_zone: null,
      home_resolution_failed: !homeLoc,
    };
  }

  // LAYER 8: No home
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Away',
    resolved_location_type: 'rabbit_hole',
    resolved_presence_status: 'rabbit_hole',
    resolved_source_reason: 'no_home_no_temp_housing',
    resolved_zone: null,
    home_resolution_failed: false,
  };
}

function buildStored(character) {
  return {
    resolved_current_location_id: character.resolved_current_location_id || null,
    resolved_current_location_name: character.resolved_current_location_name || null,
    resolved_location_type: character.resolved_location_type || null,
    resolved_presence_status: character.resolved_presence_status || null,
    resolved_source_reason: character.resolved_source_reason || null,
    resolved_zone: character.resolved_zone || null,
    home_resolution_failed: character.home_resolution_failed || false,
  };
}

function hasChanged(resolved, stored) {
  return (
    resolved.resolved_current_location_id !== stored.resolved_current_location_id ||
    resolved.resolved_current_location_name !== stored.resolved_current_location_name ||
    resolved.resolved_location_type !== stored.resolved_location_type ||
    resolved.resolved_presence_status !== stored.resolved_presence_status ||
    resolved.resolved_source_reason !== stored.resolved_source_reason ||
    (resolved.resolved_zone || null) !== stored.resolved_zone ||
    (resolved.home_resolution_failed || false) !== stored.home_resolution_failed
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // NO base44.auth.me() — this function is service-role only, no user session assumed

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true;
    const max_owners = typeof body.max_owners === 'number' ? body.max_owners : null;
    const max_chars = typeof body.max_characters_per_owner === 'number' ? body.max_characters_per_owner : null;

    // STEP 1: Discover all active_created_character records (service role — sees all accounts)
    let allCharacters = [];
    try {
      allCharacters = await base44.asServiceRole.entities.Character.filter({
        character_type: 'active_created_character'
      });
    } catch (err) {
      if (err?.status === 429) {
        return Response.json({ error: 'Rate limit hit during character discovery', status: 429 }, { status: 429 });
      }
      throw err;
    }

    // STEP 2: Extract distinct owner_email values — skip records missing owner_email
    const ownerEmailSet = new Set();
    const skippedNoOwner = [];
    for (const c of allCharacters) {
      if (!c.owner_email) {
        skippedNoOwner.push({ character_id: c.id, name: c.name, reason: 'missing_owner_email' });
      } else {
        ownerEmailSet.add(c.owner_email);
      }
    }

    let ownerEmails = Array.from(ownerEmailSet);
    if (max_owners !== null) {
      ownerEmails = ownerEmails.slice(0, max_owners);
    }

    // STEP 3: Process each owner in isolation
    const results = [];
    let owners_checked = 0;
    let characters_checked = 0;
    let would_update = 0;
    let updated = 0;
    let no_change = 0;
    let errors = 0;
    const skipped = [...skippedNoOwner];

    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    for (const owner_email of ownerEmails) {
      owners_checked++;

      // Load characters scoped to this owner only
      let ownerChars = [];
      try {
        ownerChars = await base44.asServiceRole.entities.Character.filter({
          owner_email,
          character_type: 'active_created_character'
        });
      } catch (err) {
        if (err?.status === 429) {
          return Response.json({
            dry_run, owners_checked, characters_checked,
            would_update, updated, no_change,
            skipped: skipped.length, errors,
            results,
            aborted: true,
            abort_reason: 'rate_limit_429_on_character_fetch',
            abort_at_owner: owner_email,
          });
        }
        errors++;
        results.push({ owner_email, error: err.message });
        continue;
      }

      if (max_chars !== null) {
        ownerChars = ownerChars.slice(0, max_chars);
      }

      // Load locations scoped to this owner only
      let locations = [];
      try {
        locations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email });
      } catch (err) {
        if (err?.status === 429) {
          return Response.json({
            dry_run, owners_checked, characters_checked,
            would_update, updated, no_change,
            skipped: skipped.length, errors,
            results,
            aborted: true,
            abort_reason: 'rate_limit_429_on_location_fetch',
            abort_at_owner: owner_email,
          });
        }
        errors++;
        results.push({ owner_email, error: `Location fetch failed: ${err.message}` });
        continue;
      }

      const locationMap = {};
      for (const loc of locations) {
        locationMap[loc.id] = loc;
      }

      // Process each character serially
      for (const character of ownerChars) {
        characters_checked++;

        try {
          const resolved = computeResolved(character, locationMap, etTime);
          const stored = buildStored(character);
          const changed = hasChanged(resolved, stored);

          const entry = {
            character_id: character.id,
            name: character.name,
            owner_email,
            changed,
            resolved_presence_status: resolved.resolved_presence_status,
            resolved_source_reason: resolved.resolved_source_reason,
            resolved_current_location_id: resolved.resolved_current_location_id,
            stored_presence_status: stored.resolved_presence_status,
            stored_location_id: stored.resolved_current_location_id,
          };

          if (!changed) {
            no_change++;
            entry.action = 'no_change';
          } else if (dry_run) {
            would_update++;
            entry.action = 'would_update';
          } else {
            // WRITE: only changed fields, only if not dry_run
            const timestamp = etTime.toISOString();
            await base44.asServiceRole.entities.Character.update(character.id, {
              resolved_current_location_id: resolved.resolved_current_location_id,
              resolved_current_location_name: resolved.resolved_current_location_name,
              resolved_location_type: resolved.resolved_location_type,
              resolved_presence_status: resolved.resolved_presence_status,
              resolved_source_reason: resolved.resolved_source_reason,
              resolved_zone: resolved.resolved_zone,
              resolved_last_updated_at: timestamp,
              home_resolution_failed: resolved.home_resolution_failed,
            });
            updated++;
            entry.action = 'updated';
          }

          results.push(entry);
        } catch (err) {
          if (err?.status === 429) {
            return Response.json({
              dry_run, owners_checked, characters_checked,
              would_update, updated, no_change,
              skipped: skipped.length, errors,
              results,
              aborted: true,
              abort_reason: 'rate_limit_429_on_character_write',
              abort_at_character: character.id,
              abort_at_owner: owner_email,
            });
          }
          errors++;
          results.push({ character_id: character.id, name: character.name, owner_email, error: err.message, action: 'error' });
        }

        // 300ms delay between characters — serial only
        await sleep(300);
      }
    }

    return Response.json({
      dry_run,
      owners_checked,
      characters_checked,
      would_update,
      updated,
      no_change,
      skipped: skipped.length,
      skipped_details: skippedNoOwner,
      errors,
      results,
      aborted: false,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});