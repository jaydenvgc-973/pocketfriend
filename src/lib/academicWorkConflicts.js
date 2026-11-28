/**
 * ACADEMIC vs EMPLOYMENT — read-only comparison helpers.
 *
 * The authoritative employment records stay exactly where they already are: the
 * character's own employment fields and the workplace's recorded shift for that worker.
 * Nothing here writes, moves or reassigns employment, and no shift is ever invented.
 *
 * A job with no recorded days or no recorded hours produces no comparison at all: a day
 * without scheduled employment is a day off for that job, never a default shift.
 */
import { resolveEmployment } from '@/lib/employmentResolver';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "09:00" → "9:00am". Only stored times are ever formatted. */
export function formatTime(time) {
  if (!time) return null;
  const [h, m] = String(time).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

function toMinutes(time) {
  if (!time) return null;
  const [h, m] = String(time).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

/** The workplaces already recorded on this character. Nothing is inferred. */
export function jobLocationIds(character) {
  const ids = [];
  if (character?.occupation_location_id) ids.push(character.occupation_location_id);
  for (const entry of character?.additional_occupation_locations || []) {
    if (entry?.location_id) ids.push(entry.location_id);
  }
  return [...new Set(ids)];
}

/**
 * Every existing job for this character, read from the authoritative employment records.
 * Each job keeps its own employer, parent property, job title, days and hours.
 */
export function resolveJobShifts(character, locations = []) {
  if (!character) return [];
  const { jobs } = resolveEmployment(character, locations);
  const additional = character.additional_occupation_locations || [];

  return jobs.map((job) => {
    // No workplace recorded — not a work assignment, so it is never listed.
    if (!job.location_name) return null;

    let { schedule_days: days, start_time: start, end_time: end } = job;

    // An additional job keeps its own hours on the character's entry for it. The resolver
    // reports the workplace's worker shift, so that entry is read when the workplace
    // records none. Only stored hours are ever used.
    if (!start && !end) {
      const entry =
        additional.find((a) => a?.location_id && a.location_id === job.location_id) ||
        additional.find((a) => !a?.location_id && a?.location_name === job.location_name);
      if (entry?.shift_start && entry?.shift_end) {
        start = entry.shift_start;
        end = entry.shift_end;
        days = entry.work_days?.length ? entry.work_days : null;
      }
    }

    return {
      job_title: job.job_title || null,
      employer: job.location_name,
      // Only set when the employer is a business inside a differently named property.
      parent_location: job.parent_location_name || null,
      days: Array.isArray(days) && days.length > 0 ? days : null,
      start: start || null,
      end: end || null,
    };
  }).filter(Boolean);
}

/**
 * Compare a proposed academic schedule ({ dayOfWeek: { start_time, end_time } }) against
 * every existing employment shift. Purely derived from state already on screen.
 */
export function findAcademicWorkConflicts(character, locations, scheduleMap) {
  const jobs = resolveJobShifts(character, locations);
  const conflicts = [];

  for (const job of jobs) {
    const workStart = toMinutes(job.start);
    const workEnd = toMinutes(job.end);
    // No recorded hours, or no recorded days: nothing to compare, nothing assumed.
    if (workStart == null || workEnd == null || workStart === workEnd) continue;
    if (!job.days) continue;
    // A shift that runs past midnight is compared up to the end of its own day.
    const effectiveWorkEnd = workEnd < workStart ? 1440 : workEnd;

    for (const dayKey of Object.keys(scheduleMap || {})) {
      const day = Number(dayKey);
      if (!job.days.includes(day)) continue;
      const classWindow = scheduleMap[dayKey];
      const classStart = toMinutes(classWindow?.start_time);
      const classEnd = toMinutes(classWindow?.end_time);
      if (classStart == null || classEnd == null || classStart === classEnd) continue;

      const overlapStart = Math.max(workStart, classStart);
      const overlapEnd = Math.min(effectiveWorkEnd, classEnd);
      if (overlapEnd <= overlapStart) continue;

      conflicts.push({
        day,
        job_title: job.job_title,
        employer: job.employer,
        parent_location: job.parent_location,
        work_start: job.start,
        work_end: job.end,
        class_start: classWindow.start_time,
        class_end: classWindow.end_time,
        overlap_start: overlapStart,
        overlap_end: overlapEnd,
      });
    }
  }

  return conflicts.sort((a, b) => a.day - b.day || a.overlap_start - b.overlap_start);
}

/** Minutes back to "3:00pm" for display in the warning. */
export function minutesToLabel(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}