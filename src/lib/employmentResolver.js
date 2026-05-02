/**
 * SHARED EMPLOYMENT RESOLVER — Single source of truth for all employment context.
 *
 * Used by:
 *  - Chat prompt builder (pages/Chat)
 *  - Narrative prompt builder (functions/generateNarrative)
 *  - System prompt builder (lib/defaultCharacter.js)
 *  - Character Profile UI (pages/CharacterProfile)
 *  - Location Detail Panel (components/location/LocationDetailPanel)
 *  - Schedule enforcement
 *
 * RULES:
 *  - Employment comes from character file fields + location worker_shifts ONLY
 *  - Presence context is SEPARATE — never infer employment from current location
 *  - If no schedule is stored → schedule fields are null, label is null. NEVER fabricate a default.
 *  - Do NOT call this from presence/travel logic — it is employment ONLY
 *  - Do NOT write any schedule data back to the database from this resolver.
 */

// Kept as a reference constant for UI display purposes ONLY.
// NEVER inject these values as if they were real stored schedule data.
export const DEFAULT_SCHEDULE = {
  days: [1, 2, 3, 4, 5], // Mon–Fri
  start_time: '09:00',
  end_time: '17:00',
  label: 'Mon–Fri, 9:00am–5:00pm',
  is_default: true,
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatScheduleLabel(days, startTime, endTime, isDefault = false) {
  const daysStr = days?.length > 0
    ? days.map(d => DAY_LABELS[d]).join('/')
    : null;
  const fmt = (t) => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
  };
  const timeStr = (startTime && endTime) ? `${fmt(startTime)}–${fmt(endTime)}` : null;
  const label = [daysStr, timeStr].filter(Boolean).join(', ');
  return label || (isDefault ? DEFAULT_SCHEDULE.label : null);
}

/**
 * Resolve all employment for a character.
 *
 * @param {object} character - Full character record
 * @param {Array}  locationList - Array of LocationReference records (for worker_shifts lookup)
 * @returns {object} { jobs, has_any_job, default_schedule_applied }
 *
 * Each job in jobs[]:
 *   { job_title, location_id, location_name, schedule_days, start_time, end_time,
 *     schedule_label, is_default_schedule, source }
 */
export function resolveEmployment(character, locationList = []) {
  if (!character) return { jobs: [], has_any_job: false, default_schedule_applied: false };

  const jobs = [];
  let default_schedule_applied = false;

  // Build location lookup for worker_shifts
  const locMap = {};
  for (const loc of locationList) {
    if (loc?.id) locMap[loc.id] = loc;
  }

  const hasCharFileSchedule = !!(
    character.work_start_time || character.work_end_time || character.work_days?.length > 0
  );

  // ── 1. PRIMARY JOB (character file) ──────────────────────────────────────
  const hasAnyPrimaryJob = !!(
    character.work_details?.job_title ||
    character.occupation ||
    character.occupation_location_id ||
    character.occupation_location_name
  );

  if (hasAnyPrimaryJob) {
    // Try to get shift from location record first
    const loc = character.occupation_location_id ? locMap[character.occupation_location_id] : null;
    const workerShift = loc?.worker_shifts?.[character.id];

    let schedule_days, start_time, end_time, source, is_default_schedule = false;

    if (workerShift?.days?.length > 0) {
      // Location has an explicit shift for this worker
      schedule_days = workerShift.days;
      start_time = workerShift.start;
      end_time = workerShift.end;
      source = 'worker_shift';
    } else if (hasCharFileSchedule) {
      // Character file has explicit schedule fields
      schedule_days = character.work_days;
      start_time = character.work_start_time;
      end_time = character.work_end_time;
      source = 'character_file';
    } else {
      // No schedule stored anywhere — leave null. Do NOT fabricate a default.
      schedule_days = null;
      start_time = null;
      end_time = null;
      source = 'none';
      is_default_schedule = false;
    }

    jobs.push({
      job_title: character.work_details?.job_title || character.occupation || null,
      location_id: character.occupation_location_id || null,
      location_name: character.occupation_location_name || loc?.name || null,
      location_type: loc?.category || null,
      schedule_days,
      start_time,
      end_time,
      schedule_label: formatScheduleLabel(schedule_days, start_time, end_time, is_default_schedule),
      is_default_schedule,
      source,
    });
  }

  // ── 2. ADDITIONAL OCCUPATION LOCATIONS ───────────────────────────────────
  for (const addlLoc of (character.additional_occupation_locations || [])) {
    if (!addlLoc.location_id && !addlLoc.location_name && !addlLoc.job_title) continue;
    const loc = addlLoc.location_id ? locMap[addlLoc.location_id] : null;
    const workerShift = loc?.worker_shifts?.[character.id];

    let schedule_days, start_time, end_time, source, is_default_schedule = false;
    if (workerShift?.days?.length > 0) {
      schedule_days = workerShift.days;
      start_time = workerShift.start;
      end_time = workerShift.end;
      source = 'worker_shift';
    } else {
      // No shift stored — leave null. Do NOT fabricate a default.
      schedule_days = null;
      start_time = null;
      end_time = null;
      source = 'none';
      is_default_schedule = false;
    }

    jobs.push({
      job_title: addlLoc.job_title || null,
      location_id: addlLoc.location_id || null,
      location_name: addlLoc.location_name || loc?.name || null,
      location_type: loc?.category || null,
      schedule_days,
      start_time,
      end_time,
      schedule_label: formatScheduleLabel(schedule_days, start_time, end_time, is_default_schedule),
      is_default_schedule,
      source,
    });
  }

  // ── 3. LOCATION WORKER LIST (catch any jobs on locations not yet on the character) ──
  for (const loc of locationList) {
    if (!(loc.worker_character_ids || []).includes(character.id)) continue;
    // Skip if already covered above
    const alreadyCovered =
      character.occupation_location_id === loc.id ||
      (character.additional_occupation_locations || []).some(a => a.location_id === loc.id);
    if (alreadyCovered) continue;

    const workerShift = loc.worker_shifts?.[character.id];
    // Only use stored shift data — do NOT fabricate defaults
    const schedule_days = workerShift?.days?.length > 0 ? workerShift.days : null;
    const start_time = workerShift?.start || null;
    const end_time = workerShift?.end || null;
    const is_default_schedule = false;

    jobs.push({
      job_title: loc.worker_job_titles?.[character.id] || null,
      location_id: loc.id,
      location_name: loc.name || null,
      location_type: loc.category || null,
      schedule_days,
      start_time,
      end_time,
      schedule_label: formatScheduleLabel(schedule_days, start_time, end_time, is_default_schedule),
      is_default_schedule,
      source: workerShift ? 'worker_shift' : 'location_resource',
    });
  }

  return {
    jobs,
    has_any_job: jobs.length > 0,
    default_schedule_applied,
  };
}

/**
 * Build a presence context object from character fields.
 * Strictly separate from employment.
 */
export function resolvePresence(character) {
  return {
    current_location_id: character.resolved_current_location_id || null,
    current_location_name: character.resolved_current_location_name || null,
    presence_reason: character.resolved_presence_status || null,
    movement_source: character.resolved_source_reason || null,
    is_at_assigned_workplace:
      !!(character.occupation_location_id &&
         character.resolved_current_location_id === character.occupation_location_id),
  };
}

/**
 * Build an employment context block string for LLM prompts.
 * This is the authoritative string injected into chat/narrative prompts.
 */
export function buildEmploymentPromptBlock(character, locationList = []) {
  const { jobs } = resolveEmployment(character, locationList);
  const presence = resolvePresence(character);

  if (jobs.length === 0 && !presence.current_location_name) return '';

  const jobLines = jobs.length > 0
    ? jobs.map(j => {
        const schedPart = j.schedule_label ? ` | Schedule: ${j.schedule_label}` : '';
        return `  • ${j.job_title || 'Employee'} at ${j.location_name || 'unlisted workplace'}${schedPart}`;
      }).join('\n')
    : '  • No job assigned';

  const mismatch = jobs.length > 0 &&
    presence.current_location_name &&
    !jobs.some(j => j.location_id === presence.current_location_id);

  return `\n\nEMPLOYMENT vs PRESENCE — HARD SEPARATION (NON-NEGOTIABLE):
EMPLOYMENT (character file — immutable identity):
${jobLines}

PRESENCE (where you are RIGHT NOW — physical only):
  Current location: ${presence.current_location_name || 'Unknown'}
  At assigned workplace: ${presence.is_at_assigned_workplace ? 'YES' : 'NO'}

⛔ RULES:
  - Work questions → use EMPLOYMENT location(s) only
  - Location questions → use current PRESENCE location only
  - NEVER call a visited location your workplace unless location_id matches employment
${mismatch ? `\n⚠️ MISMATCH ACTIVE: You are visiting "${presence.current_location_name}" but your job is at "${jobs[0].location_name}". You may say "I'm here right now" but NEVER "I work/manage here."` : ''}`;
}