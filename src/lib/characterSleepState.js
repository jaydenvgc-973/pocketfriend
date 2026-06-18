/**
 * getCharacterSleepState — Evidence-Based Sleep Classification
 * 
 * CRITICAL RULE: Never classify sleep states from needs values alone.
 * Only classify as "valid" with proof:
 * - explicit sleep_state field
 * - explicit sleep_reason field
 * - scheduled sleep window check
 * - active nap record
 * - user-directed sleep
 * - recovery state with proof
 * - illness/injury state with proof
 * 
 * Without proof → "Unverified sleep state — needs diagnosis"
 */

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

const NPC_SLEEP_TYPES = new Set(['npc_regular', 'npc_family_member', 'npc_fictitious', 'npc']);

// VGC Towers NPC resident sleep window — mirrors sleepUtils.js constants
const VGC_RESIDENT_SLEEP_START_MIN = 2 * 60 + 30;  // 2:30 AM
const VGC_RESIDENT_WAKE_TIME_MIN   = 8 * 60 + 30;  // 8:30 AM

/**
 * Returns true if this character is an NPC resident of VGC Towers.
 * Residency proof: character.current_home_location_id → location.name === 'VGC Towers'.
 * Requires locationMap to be passed by the caller. Falls back to false when absent.
 * Applies only to NPC character types. active_created_character is never affected.
 */
function isVGCTowersNPCResident(character, locationMap) {
  if (!character || !locationMap) return false;
  if (!NPC_SLEEP_TYPES.has(character.character_type)) return false;
  const homeId = character.current_home_location_id;
  if (!homeId) return false;
  const homeLoc = locationMap[homeId];
  if (!homeLoc) return false;
  return homeLoc.name === 'VGC Towers';
}

/**
 * computeAdaptiveSleepWindow
 *
 * @param {object} character
 * @param {Date}   etTime     — current ET time
 * @param {object} [locationMap] — optional { [locationId]: LocationReference }
 *   When provided, enables VGC Towers residency detection so residents use
 *   'vgc_resident_schedule' (2:30–8:30 AM) instead of 'npc_forced_default' (0:00–8:00 AM).
 */
function computeAdaptiveSleepWindow(character, etTime, locationMap) {
  const SLEEP_DURATION_MIN = 7 * 60;  // 7 hours
  const PRE_SHIFT_BUFFER   = 60;       // 1h prep before shift (used for wake time of day workers)
  const DECOMPRESSION_MIN  = 60;       // 1h wind-down after overnight shift
  const toMin = toMinutes;

  // PRIORITY 1: Stored schedule — always wins for ALL character types
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, source: 'stored_schedule' };
  }

  // PRIORITY 2 (NPC types): VGC Towers residents use a dedicated window; generic NPCs use fallback.
  //
  //   VGC Towers residents → 2:30 AM–8:30 AM ('vgc_resident_schedule')
  //     Residents return home at ~1 AM, need wind-down, sleep 2:30, wake 8:30.
  //     DEPARTURE travel block fires at 10 AM — fully clear of sleep window by then.
  //
  //   Generic NPCs (non-VGC-resident) → 0:00 AM–8:00 AM ('npc_forced_default')
  //     Unchanged behavior for background world NPCs.
  //
  if (NPC_SLEEP_TYPES.has(character.character_type)) {
    if (isVGCTowersNPCResident(character, locationMap)) {
      return {
        sleepStartMin: VGC_RESIDENT_SLEEP_START_MIN,
        wakeMin: VGC_RESIDENT_WAKE_TIME_MIN,
        source: 'vgc_resident_schedule',
      };
    }
    return { sleepStartMin: 0, wakeMin: 8 * 60, source: 'npc_forced_default' };
  }

  // PRIORITY 3: Derive from work schedule.
  // Work-derived sleep timing applies ONLY on selected work days (and the overnight adjacency case).
  // Non-selected days are not "no schedule" — but they are also not work days.
  // Do NOT apply work sleep timing on a non-work day just because work_days is populated.
  // Exception: overnight shift that started on a selected work day and crossed midnight.
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const startMin = toMin(character.work_start_time);
    const endMin   = toMin(character.work_end_time);
    if (startMin !== null && endMin !== null) {
      const today     = etTime.getDay();
      const yesterday = (today + 6) % 7;
      const tomorrow  = (today + 1) % 7;
      const isOvernightShift = endMin < startMin;

      if (isOvernightShift) {
        // 22:00–02:00 → sleep 03:00 → wake 10:00 (sleepStart + 7h)
        // Only applies when yesterday or today is an actual selected overnight work day.
        // Saturday on a Mon–Fri overnight schedule: neither yesterday (Fri start) nor today (Sat)
        // connects via overnight logic unless Fri is a work day — which it is, so Sat morning qualifies.
        // But Sat afternoon/evening does NOT qualify — fall through.
        const workedLastNight = character.work_days.includes(yesterday);
        const worksTonight    = character.work_days.includes(today);
        if (workedLastNight || worksTonight) {
          const sleepStartMin = (endMin + DECOMPRESSION_MIN) % 1440;
          const wakeMin       = (sleepStartMin + SLEEP_DURATION_MIN) % 1440;
          return { sleepStartMin, wakeMin, source: 'overnight_work' };
        }
        // No overnight connection to a selected work day — fall through
      } else {
        // 09:00–17:00 → wake 08:00 → sleep 01:00
        // Applies only when today or tomorrow is a selected work day.
        // Sat/Sun for Mon–Fri worker: only Sunday qualifies (tomorrow = Monday is a work day).
        // Saturday does not qualify (tomorrow = Sunday, not a work day).
        const worksToday    = character.work_days.includes(today);
        const worksTomorrow = character.work_days.includes(tomorrow);
        if (worksToday || worksTomorrow) {
          const wakeMin       = (startMin - PRE_SHIFT_BUFFER + 1440) % 1440;
          const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
          return { sleepStartMin, wakeMin, source: 'work_schedule' };
        }
        // Non-work day, no work tomorrow — fall through to school or explicit schedule.
        // IMPORTANT: This is NOT "no_structured_timing". The character has structure (work schedule exists),
        // but work is inactive today. The character remains autonomous unless another real obligation,
        // explicit sleep setting, active commitment, school schedule, or needs/wants logic determines behavior.
      }
    }
  }

  // PRIORITY 4: School-enrolled character (no work schedule).
  // Uses canonical school schedule resolver (enrollment override → location hours → unresolved)
  if (character.student_status === 'enrolled' && character.education_location_id) {
    // Inline the school schedule resolver here to avoid module imports in characterSleepState
    const dayOfWeek = etTime.getDay();
    const schoolSched = (() => {
      // Check enrollment override first
      if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
        const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
        if (active) {
          const s = toMinutes(active.start_time);
          const e = toMinutes(active.end_time);
          if (s !== null && e !== null) return { startMin: s, endMin: e, source: 'enrollment_override' };
        }
      }
      // Check school location operating hours
      if (locationMap && locationMap[character.education_location_id]) {
        const schoolLoc = locationMap[character.education_location_id];
        if (schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
          const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
          const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);
          const entry = todayEntries[0] || dayAgnosticEntries[0];
          if (entry) {
            const s = toMinutes(entry.open_time);
            const e = toMinutes(entry.close_time);
            if (s !== null && e !== null) return { startMin: s, endMin: e, source: 'school_location_hours' };
          }
        }
      }
      // No valid hours
      return { startMin: null, endMin: null, source: 'school_schedule_unresolved' };
    })();

    if (schoolSched.startMin !== null && schoolSched.endMin !== null) {
      const wakeMin       = (schoolSched.startMin - 60 + 1440) % 1440;
      const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
      return { sleepStartMin, wakeMin, source: `school_${schoolSched.source}` };
    }
    // No valid school schedule
    return { sleepStartMin: null, wakeMin: null, source: 'school_schedule_unresolved' };
  }

  // PRIORITY 5: No structured timing at all.
  // Only reaches here when: no explicit sleep schedule, no work, no school enrollment.
  return { sleepStartMin: 23 * 60, wakeMin: 7 * 60, source: 'no_structured_timing' };
}

function isScheduledSleeping(character, etTime, locationMap) {
  const window = computeAdaptiveSleepWindow(character, etTime, locationMap);
  if (!window || window.sleepStartMin == null || window.wakeMin == null) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) return now >= sleepStartMin || now < wakeMin;
  return now >= sleepStartMin && now < wakeMin;
}

/**
 * getCharacterSleepState
 *
 * @param {object} character
 * @param {object} [locationMap] — optional { [locationId]: LocationReference }
 *   When provided, enables VGC Towers residency detection so NPC residents of
 *   VGC Towers use the correct 2:30 AM–8:30 AM sleep window rather than the
 *   generic 0:00–8:00 AM npc_forced_default window.
 *   Callers with location map access (Travel page, CharacterCard, etc.) should pass it.
 *   Callers without location data may omit it — VGC residents safely fall through to
 *   npc_forced_default (conservative, never causes false-awake state).
 */
export function getCharacterSleepState(character, locationMap) {
  if (!character) {
    return {
      isSleeping: false,
      isNapping: false,
      isAsleep: false,
      isResting: false,
      displayLabel: 'unknown',
      contextLabel: null,
      visible_label: 'No character data',
      confirmed_reason: null,
      evidence_source: null,
      confidence: 0,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const status = character.resolved_presence_status || '';
  const reason = character.resolved_source_reason || '';

  // ── SLEEP CLASSIFICATION: window-first, not DB-first ──
  // For active_created_character: ordinary sleep is valid ONLY when inside the explicit
  // sleep_start_time → wake_up_time window AND all blockers pass (8h cap, work, school).
  // DB sleeping/napping alone is NOT accepted — it must be corroborated by a valid window.
  // NPCs and untyped characters: DB truth is accepted (schedule-window governs them below).
  // ── ACTIVE_CREATED_CHARACTER: window-first sleep validation ──────────────────
  // Ordinary sleep is valid ONLY when inside the explicit window AND all blockers pass.
  // DB sleeping/napping is a hint, not proof. The window is required.
  if (character.character_type === 'active_created_character') {
    const toMinLocal = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
    const nowMin    = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();

    // passed_out is a medical consequence state — always trust DB for it, never a window check
    if (status === 'passed_out') {
      return {
        isSleeping: true,
        isNapping: false,
        isAsleep: true,
        displayLabel: 'sleeping',
        contextLabel: 'Collapsed',
        visible_label: 'Collapsed',
        confirmed_reason: 'passed_out_medical',
        evidence_source: 'resolved_presence_status',
        confidence: 1,
        stale_risk: false,
        isLikelyStale: false,
        blockingCondition: null,
      };
    }

    // resting is a low-energy home state — trust DB, no window required
    if (status === 'resting') {
      return {
        isSleeping: false,
        isNapping: false,
        displayLabel: 'resting',
        contextLabel: 'Resting',
        visible_label: 'Resting',
        confirmed_reason: reason || 'low_energy_resting',
        evidence_source: 'resolved_presence_status',
        confidence: 1,
        stale_risk: false,
        isLikelyStale: false,
        blockingCondition: null,
      };
    }

    // ── SLEEPING VALIDATION: require sleep window ────────────────────
    if (status === 'sleeping') {
      const sleepStartMin = toMinLocal(character.sleep_start_time);
      const wakeMin = toMinLocal(character.wake_up_time);

      // No explicit window → sleep is invalid
      if (sleepStartMin === null || wakeMin === null) {
        return {
          isSleeping: false, isNapping: false, displayLabel: 'awake',
          contextLabel: null, visible_label: null, confidence: 1,
          stale_risk: false, isLikelyStale: false, blockingCondition: 'no_explicit_sleep_window',
        };
      }

      // Check if inside window
      const insideWindow = sleepStartMin > wakeMin
        ? (nowMin >= sleepStartMin || nowMin < wakeMin)
        : (nowMin >= sleepStartMin && nowMin < wakeMin);

      if (!insideWindow) {
        return {
          isSleeping: false, isNapping: false, displayLabel: 'awake',
          contextLabel: null, visible_label: null, confidence: 1,
          stale_risk: false, isLikelyStale: false, blockingCondition: 'outside_sleep_window',
        };
      }

      // 8-hour cap (uses last_sleep_start only — authoritative sleep timestamp)
      if (character.last_sleep_start) {
        const sleepDuration = (nowET.getTime() - new Date(character.last_sleep_start).getTime()) / 3_600_000;
        if (sleepDuration >= 8) {
          return {
            isSleeping: false, isNapping: false, displayLabel: 'awake',
            contextLabel: null, visible_label: null, confidence: 1,
            stale_risk: false, isLikelyStale: false, blockingCondition: 'sleep_cap_8h',
          };
        }
      }

      // Work shift override
      if (character.work_start_time && character.work_end_time &&
          Array.isArray(character.work_days) && character.work_days.includes(dayOfWeek)) {
        const s = toMinLocal(character.work_start_time);
        const e = toMinLocal(character.work_end_time);
        if (s !== null && e !== null) {
          const onShift = e < s ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
          if (onShift) {
            return {
              isSleeping: false, isNapping: false, displayLabel: 'awake',
              contextLabel: 'At Work', visible_label: 'At Work', confidence: 1,
              stale_risk: false, isLikelyStale: false, blockingCondition: 'work_shift_active',
            };
          }
        }
      }

      // School window override
      if (character.student_status === 'enrolled' && character.education_location_id &&
          [1, 2, 3, 4, 5].includes(dayOfWeek)) {
        const enrollments = character.education_enrollments;
        if (Array.isArray(enrollments) && enrollments.length > 0) {
          const active = enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
          if (active) {
            const s = toMinLocal(active.start_time);
            const e = toMinLocal(active.end_time);
            if (s !== null && e !== null && nowMin >= s && nowMin < e) {
              return {
                isSleeping: false, isNapping: false, displayLabel: 'awake',
                contextLabel: 'At School', visible_label: 'At School', confidence: 1,
                stale_risk: false, isLikelyStale: false, blockingCondition: 'school_window_active',
              };
            }
          }
        }
      }

      // All checks passed — sleep is valid
      return {
        isSleeping: true,
        isNapping: false,
        isAsleep: true,
        displayLabel: 'sleeping',
        contextLabel: 'Sleeping',
        visible_label: 'Sleeping',
        confirmed_reason: reason || 'db_sleeping_window_valid',
        evidence_source: 'sleep_window_validated',
        confidence: 0.95,
        stale_risk: false,
        isLikelyStale: false,
        blockingCondition: null,
      };
    }

    // ── NAPPING VALIDATION: nap-specific (NO sleep window) ──────────
    if (status === 'napping') {
      // ── NAP REQUIRES last_nap_time ─────────────────────────────────
      // Without last_nap_time, the nap start is unverifiable → stale
      if (!character.last_nap_time) {
        return {
          isSleeping: false, isNapping: false, displayLabel: 'awake',
          contextLabel: null, visible_label: null, confidence: 1,
          stale_risk: true, isLikelyStale: true,
          blockingCondition: 'missing_last_nap_time',
        };
      }

      // ── 3-HOUR NAP CAP ────────────────────────────────────────────
      const napDuration = (nowET.getTime() - new Date(character.last_nap_time).getTime()) / 3_600_000;
      if (napDuration >= 3) {
        return {
          isSleeping: false, isNapping: false, displayLabel: 'awake',
          contextLabel: null, visible_label: null, confidence: 1,
          stale_risk: true, isLikelyStale: true,
          blockingCondition: `nap_cap_3h_exceeded`,
        };
      }

      // ── BLOCKERS ──────────────────────────────────────────────────
      // Work shift override
      if (character.work_start_time && character.work_end_time &&
          Array.isArray(character.work_days) && character.work_days.includes(dayOfWeek)) {
        const s = toMinLocal(character.work_start_time);
        const e = toMinLocal(character.work_end_time);
        if (s !== null && e !== null) {
          const onShift = e < s ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
          if (onShift) {
            return {
              isSleeping: false, isNapping: false, displayLabel: 'awake',
              contextLabel: 'At Work', visible_label: 'At Work', confidence: 1,
              stale_risk: false, isLikelyStale: false, blockingCondition: 'work_shift_active',
            };
          }
        }
      }

      // School window override
      if (character.student_status === 'enrolled' && character.education_location_id &&
          [1, 2, 3, 4, 5].includes(dayOfWeek)) {
        const enrollments = character.education_enrollments;
        if (Array.isArray(enrollments) && enrollments.length > 0) {
          const active = enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
          if (active) {
            const s = toMinLocal(active.start_time);
            const e = toMinLocal(active.end_time);
            if (s !== null && e !== null && nowMin >= s && nowMin < e) {
              return {
                isSleeping: false, isNapping: false, displayLabel: 'awake',
                contextLabel: 'At School', visible_label: 'At School', confidence: 1,
                stale_risk: false, isLikelyStale: false, blockingCondition: 'school_window_active',
              };
            }
          }
        }
      }

      // Travel blocker
      if (character.travel_status && character.travel_status !== 'not_traveling') {
        return {
          isSleeping: false, isNapping: false, displayLabel: 'awake',
          contextLabel: null, visible_label: null, confidence: 1,
          stale_risk: false, isLikelyStale: false, blockingCondition: 'traveling',
        };
      }

      // Jail / house arrest blocker
      if (character.is_jailed || character.house_arrest_active) {
        return {
          isSleeping: false, isNapping: false, displayLabel: 'awake',
          contextLabel: null, visible_label: null, confidence: 1,
          stale_risk: false, isLikelyStale: false, blockingCondition: 'confinement',
        };
      }

      // ── VALID NAP ─────────────────────────────────────────────────
      // Nap passed all checks: has last_nap_time, within 3h cap, no blockers.
      // NO sleep-window proximity check — naps are valid any time of day.
      return {
        isSleeping: false,
        isNapping: true,
        isAsleep: true,
        displayLabel: 'napping',
        contextLabel: 'Napping',
        visible_label: 'Napping',
        confirmed_reason: reason || 'db_napping_nap_validated',
        evidence_source: 'nap_validated',
        confidence: 0.95,
        stale_risk: false,
        isLikelyStale: false,
        blockingCondition: null,
      };
    }

    // DB not sleeping → not sleeping
    // (falls through to NOT-SLEEPING branch below)
  }

  // ── NPCs / untyped: accept DB truth — schedule-window governs them below ──
  if (status === 'sleeping') {
    return {
      isSleeping: true, isNapping: false, isAsleep: true, displayLabel: 'sleeping',
      contextLabel: 'Asleep', visible_label: 'Asleep',
      confirmed_reason: reason || 'db_sleeping', evidence_source: 'resolved_presence_status',
      confidence: 1, stale_risk: false, isLikelyStale: false, blockingCondition: null,
    };
  }
  if (status === 'napping') {
    return {
      isSleeping: false, isNapping: true, isAsleep: true, displayLabel: 'napping',
      contextLabel: 'Napping', visible_label: 'Napping',
      confirmed_reason: reason || 'db_napping', evidence_source: 'resolved_presence_status',
      confidence: 1, stale_risk: false, isLikelyStale: false, blockingCondition: null,
    };
  }
  if (status === 'resting') {
    return {
      isSleeping: false, isNapping: false, displayLabel: 'resting',
      contextLabel: 'Resting', visible_label: 'Resting',
      confirmed_reason: reason || 'db_resting', evidence_source: 'resolved_presence_status',
      confidence: 1, stale_risk: false, isLikelyStale: false, blockingCondition: null,
    };
  }

  // ── NOT SLEEPING: Route by character type ──────────────────────────────────
  if (status !== 'sleeping' && status !== 'napping') {
    const isActiveCreated = character.character_type === 'active_created_character';

    // OBLIGATION GUARD: resolve active obligations before any sleep classification.
    // Fallback sleep logic must never run while the character has an active obligation.
    const nowMin    = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();
    const toMinLocal = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

    // Work shift
    const isLiveOnWorkShift = (() => {
      if (!character.work_start_time || !character.work_end_time || !Array.isArray(character.work_days) || character.work_days.length === 0) return false;
      if (!character.work_days.includes(dayOfWeek)) return false;
      const s = toMinLocal(character.work_start_time);
      const e = toMinLocal(character.work_end_time);
      if (s === null || e === null) return false;
      return e < s ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
    })();

    // School attendance window
    const isInSchoolWindow = (() => {
      if (character.student_status !== 'enrolled' || !character.education_location_id) return false;
      if (![1, 2, 3, 4, 5].includes(dayOfWeek)) return false;
      const enrollments = character.education_enrollments;
      if (Array.isArray(enrollments) && enrollments.length > 0) {
        const active = enrollments.find(e => e.status === 'active' && e.start_time);
        if (active) {
          const s = toMinLocal(active.start_time);
          const e = active.end_time ? toMinLocal(active.end_time) : null;
          if (s !== null && e !== null) {
            return nowMin >= s && nowMin < e;
          }
        }
      }
      return false;
    })();

    // Active travel or commitment
    const isActivelyTraveling = !!(character.travel_status && character.travel_status !== 'not_traveling');

    const isConfinedOrWorking = character.is_jailed ||
      character.house_arrest_active ||
      status === 'at_work' ||
      status === 'at_school' ||
      status === 'house_arrest' ||
      isLiveOnWorkShift ||
      isInSchoolWindow ||
      isActivelyTraveling;

    if (!isConfinedOrWorking) {
      if (isActiveCreated) {
        // ACTIVE CREATED CHARACTERS: check schedule window first (same as Travel page),
        // then fall back to autonomous evidence for late-night slowdown hours.
        const hasAwakeOverride = character.decided_to_stay_up_until &&
          new Date(character.decided_to_stay_up_until) > nowET;

        // ACTIVE CREATED CHARACTERS: DB truth is authoritative (checked above).
        // Schedule windows and energy values are NOT used to invent isSleeping=true
        // for active_created_characters when the DB does not say sleeping.
        // The backend (simulateActiveCharacterNeeds) writes resolved_presence_status
        // based on energy thresholds — that is the single source of truth.
        // Local clock-window inference is removed to prevent Chat/Home/Travel divergence.

        // Awake — no schedule window, no energy evidence
        return {
          isSleeping: false,
          isNapping: false,
          displayLabel: 'awake',
          contextLabel: null,
          visible_label: null,
          confirmed_reason: null,
          evidence_source: null,
          confidence: 1,
          stale_risk: false,
          isLikelyStale: false,
          blockingCondition: null,
        };
      } else {
        // NPC / FAMILY / UNTYPED: schedule-window override is appropriate for these character types.
        // locationMap is passed so VGC Towers residents get 'vgc_resident_schedule' (2:30–8:30 AM)
        // instead of 'npc_forced_default' (0:00–8:00 AM).
        const scheduleAsleep = isScheduledSleeping(character, nowET, locationMap);
        if (scheduleAsleep) {
          const window = computeAdaptiveSleepWindow(character, nowET, locationMap);
          const wakeMin = window?.wakeMin ?? null;
          const wakeHour = wakeMin !== null ? Math.floor(wakeMin / 60) : null;
          const wakeMinPart = wakeMin !== null ? wakeMin % 60 : null;
          const wakeLabel = wakeHour !== null
            ? `${wakeHour % 12 || 12}:${String(wakeMinPart).padStart(2, '0')} ${wakeHour >= 12 ? 'PM' : 'AM'}`
            : null;
          return {
            isSleeping: true,
            isNapping: false,
            isResting: false,
            displayLabel: 'sleeping',
            contextLabel: '🌙 sleeping (scheduled window)',
            visible_label: '🌙 sleeping',
            wake_label: wakeLabel,
            confirmed_reason: 'scheduled_sleep_window_stale_db',
            evidence_source: `schedule_window_source:${window?.source || 'unknown'}`,
            confidence: 0.85,
            stale_risk: false,
            isLikelyStale: false,
            blockingCondition: null,
            stale_db_detected: true,
          };
        }
      }
    }

    // Confined/working or no sleep evidence — awake
    return {
      isSleeping: false,
      isNapping: false,
      isResting: false,
      displayLabel: 'awake',
      contextLabel: null,
      visible_label: null,
      confirmed_reason: null,
      evidence_source: null,
      confidence: 1,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── SLEEPING: Check if within scheduled window ───────────────────────────────
  const scheduledAsleep = isScheduledSleeping(character, nowET, locationMap);
  if (scheduledAsleep) {
    return {
      isSleeping: true,
      isNapping: false,
      displayLabel: 'sleeping',
      contextLabel: '🌙 sleeping (scheduled)',
      visible_label: '🌙 sleeping',
      confirmed_reason: 'scheduled_sleep_window',
      evidence_source: 'sleep_schedule',
      confidence: 0.9,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── SLEEPING: Not in window — check for valid oversleep reason ──────────────
  // Valid reasons include: user-directed sleep, recovery, etc.
  const validOversleepReasons = [
    'user_directed_nap',
    'illness_sleep',
    'emotional_crash_recovery',
    'interrupted_sleep_recovery',
  ];

  const hasValidOversleep = (() => {
    if (character.decided_to_stay_up_until && new Date(character.decided_to_stay_up_until) > nowET) return false;
    if (validOversleepReasons.some(r => reason.includes(r))) return true;
    // sleep_interrupted_at: if the character's sleep was cut short by an alarm, message, or
    // emergency within the last 3 hours, their ongoing sleep is still valid recovery rest.
    // This is NOT sleep debt — it is a record that their normal rest cycle was interrupted.
    // The 3-hour window allows them to fall back asleep and complete partial recovery.
    if (character.sleep_interrupted_at) {
      const hoursSinceInterrupt = (nowET.getTime() - new Date(character.sleep_interrupted_at).getTime()) / 3600000;
      if (hoursSinceInterrupt < 3) return true;
    }
    if (character.health_value !== undefined && character.health_value < 30) return true;
    if (character.mental_value !== undefined && character.mental_value < 25) return true;
    return false;
  })();

  if (hasValidOversleep) {
    const proofType = character.health_value < 30 ? 'illness' :
      character.mental_value < 25 ? 'emotional_state' : 'unknown';

    return {
      isSleeping: true,
      isNapping: status === 'napping',
      displayLabel: status === 'napping' ? 'napping' : 'sleeping',
      contextLabel: status === 'napping' ? '💤 napping (recovery)' : '🌙 sleeping (recovery)',
      visible_label: status === 'napping' ? '💤 napping' : '🌙 sleeping',
      confirmed_reason: `valid_oversleep_${proofType}`,
      evidence_source: proofType,
      confidence: 0.85,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── SLEEPING: No valid reason — UNVERIFIED / STALE ──────────────────────────
  // Character is marked sleeping past their window with no proof.
  // This is potentially stale system error unless proven otherwise.
  const minutesPastWake = (() => {
    const wakeMin = toMinutes(character.wake_up_time);
    if (wakeMin === null) return null;
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    let past = nowMin - wakeMin;
    if (past < 0) past += 1440;
    return past;
  })();

  return {
    isSleeping: true,
    isNapping: status === 'napping',
    displayLabel: 'sleeping (unverified)',
    contextLabel: '⚠️ Unverified sleep state',
    visible_label: 'Unverified sleep state',
    confirmed_reason: null,
    evidence_source: null,
    evidence_record_id: null,
    confidence: 0,  // no proof
    stale_risk: true,
    isLikelyStale: true,
    blockingCondition: `past_wake_${minutesPastWake}min`,
    diagnosticClues: {
      db_status: status,
      db_reason: reason,
      scheduled_window: isScheduledSleeping(character, nowET, locationMap),
      minutes_past_wake: minutesPastWake,
      energy: character.energy_value ?? 75,
      health: character.health_value ?? 100,
      mental: character.mental_value ?? 70,
    },
  };
}