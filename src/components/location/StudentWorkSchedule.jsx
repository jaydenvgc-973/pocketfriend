import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import { resolveEmployment } from '@/lib/employmentResolver';

/**
 * StudentWorkSchedule — the student's existing work assignments, shown directly under
 * their academic schedule so a class window that conflicts with a shift is visible.
 *
 * READ-ONLY. It reads the employment already recorded on the character (and the
 * workplace's own shift for that worker) and never creates, moves or reassigns a job.
 * A character with no work assignment shows a plain "No work assignment" line — no
 * default hours, no inferred employer, no invented schedule.
 *
 * Format: "Agency NJ: 9:00am-4:00pm S/M/W/F". Every job is listed.
 */

const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function fmtTime(time) {
  if (!time) return null;
  const [h, m] = String(time).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

/** The workplaces already recorded on this character. Nothing is inferred. */
function jobLocationIds(character) {
  const ids = [];
  if (character?.occupation_location_id) ids.push(character.occupation_location_id);
  for (const entry of character?.additional_occupation_locations || []) {
    if (entry?.location_id) ids.push(entry.location_id);
  }
  return [...new Set(ids)];
}

function workRows(character, locations) {
  if (!character) return [];
  const { jobs } = resolveEmployment(character, locations);
  const additional = character.additional_occupation_locations || [];

  return jobs.map((job) => {
    // No workplace recorded — this is not a work assignment, so it is never listed.
    if (!job.location_name) return null;

    let { schedule_days: days, start_time: start, end_time: end } = job;

    // An additional job keeps its own hours on the character's entry for it. The resolver
    // reports the workplace's worker shift, so that entry is read when the workplace
    // records none. Only stored hours are ever shown.
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

    const time = start && end ? `${fmtTime(start)}-${fmtTime(end)}` : null;
    const dayStr = days?.length ? days.map((d) => DAY_INITIALS[d]).join('/') : null;

    return {
      name: job.location_name,
      detail: [time, dayStr].filter(Boolean).join(' '),
    };
  }).filter(Boolean);
}

export default function StudentWorkSchedule({ character }) {
  const ids = jobLocationIds(character);
  const { data: locations = [] } = useQuery({
    queryKey: ['studentWorkLocations', ids.join(',')],
    queryFn: () => base44.entities.LocationReference.filter({ id: { $in: ids } }),
    enabled: ids.length > 0,
  });

  // No character record for this student — nothing to show, and nothing invented.
  if (!character) return null;

  const rows = workRows(character, locations);

  return (
    <div className="rounded-lg bg-secondary/40 px-2 py-1.5">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5 flex items-center gap-1">
        <Briefcase className="w-2.5 h-2.5" /> Work Schedule
      </p>
      {rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/60 italic">No work assignment</p>
      ) : (
        <div className="space-y-0.5">
          {rows.map((row, index) => (
            <p key={index} className="text-[10px] text-foreground font-medium">
              {row.detail ? `${row.name}: ${row.detail}` : row.name}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}