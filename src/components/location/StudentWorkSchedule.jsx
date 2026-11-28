import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Briefcase } from 'lucide-react';
import { resolveJobShifts, jobLocationIds, formatTime, DAY_NAMES } from '@/lib/academicWorkConflicts';

/**
 * StudentWorkSchedule — the student's existing work assignments, shown directly under
 * their academic schedule so a class window that conflicts with a shift is visible.
 *
 * READ-ONLY. It reads the employment already recorded on the character (and the
 * workplace's own shift for that worker) and never creates, moves or reassigns a job.
 * A character with no work assignment shows a plain "No work assignment" line — no
 * default hours, no inferred employer, no invented schedule.
 *
 * Every job is listed separately, with the actual employer, the parent property it
 * operates inside when the two differ, the job title, the recorded days and hours, and
 * the days off for that job.
 */
export default function StudentWorkSchedule({ character }) {
  const ids = jobLocationIds(character);
  const { data: locations = [] } = useQuery({
    queryKey: ['studentWorkLocations', ids.join(',')],
    queryFn: () => base44.entities.LocationReference.filter({ id: { $in: ids } }),
    enabled: ids.length > 0,
  });

  // No character record for this student — nothing to show, and nothing invented.
  if (!character) return null;

  const jobs = resolveJobShifts(character, locations);

  return (
    <div className="rounded-lg bg-secondary/40 px-2 py-1.5">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
        <Briefcase className="w-2.5 h-2.5" /> Existing Work Schedules
      </p>
      {jobs.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/60 italic">No work assignment</p>
      ) : (
        <div className="space-y-1.5">
          {jobs.map((job, index) => {
            const hours = job.start && job.end
              ? `${formatTime(job.start)}–${formatTime(job.end)}`
              : null;
            const workDays = job.days ? job.days.map((d) => DAY_NAMES[d]).join('/') : null;
            // Days off are only stated when the job records its working days.
            const daysOff = job.days
              ? DAY_NAMES.map((name, day) => (job.days.includes(day) ? null : name)).filter(Boolean)
              : null;

            return (
              <div key={index} className="space-y-0.5">
                {job.job_title && (
                  <p className="text-[10px] text-foreground font-semibold">{job.job_title}</p>
                )}
                <p className="text-[10px] text-foreground font-medium">
                  {job.employer}
                  {job.parent_location && (
                    <span className="text-muted-foreground font-normal"> · inside {job.parent_location}</span>
                  )}
                </p>
                {hours ? (
                  <p className="text-[10px] text-foreground">
                    {workDays ? `${workDays} · ${hours}` : hours}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground/60 italic">No hours recorded</p>
                )}
                {daysOff && daysOff.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">Days off: {daysOff.join(', ')}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}