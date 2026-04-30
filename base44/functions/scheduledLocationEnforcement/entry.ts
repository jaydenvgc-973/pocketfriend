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

function isSleeping(character, etTime) {
  if (!character.sleep_start_time || !character.wake_up_time) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const [sh, sm] = character.sleep_start_time.split(':').map(Number);
  const [wh, wm] = character.wake_up_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const wakeMin = wh * 60 + wm;
  if (startMin > wakeMin) return now >= startMin || now < wakeMin;
  return now >= startMin && now < wakeMin;
}

// Returns true if within PRE_SLEEP_WINDOW_MINUTES before scheduled sleep start
const PRE_SLEEP_WINDOW_MINUTES = 60;
function isInPreSleepWindow(character, etTime) {
  if (!character.sleep_start_time) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const [sh, sm] = character.sleep_start_time.split(':').map(Number);
  const sleepStart = sh * 60 + sm;
  // Handle midnight rollover: e.g. sleep at 23:00, window starts at 22:00
  const windowStart = (sleepStart - PRE_SLEEP_WINDOW_MINUTES + 1440) % 1440;
  // If window straddles midnight
  if (windowStart > sleepStart) return now >= windowStart || now < sleepStart;
  return now >= windowStart && now < sleepStart;
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

  // LAYER 1: Active system-placed visit (only allowed outside sleep/pre-sleep windows — guarded above)
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
    if (visitLoc) {
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