import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import {
  findAcademicWorkConflicts,
  jobLocationIds,
  formatTime,
  minutesToLabel,
  DAY_NAMES,
} from '@/lib/academicWorkConflicts';

/**
 * AcademicWorkConflictWarning — compares the academic hours currently being chosen in
 * the enrollment interface against this character's existing employment shifts.
 *
 * Read-only and advisory: it never blocks a save, never changes a shift, and never
 * resolves anything on its own. The comparison is derived from the schedule already in
 * state, so it updates as the proposed days and hours change — no polling.
 */
export default function AcademicWorkConflictWarning({ character, scheduleMap }) {
  const ids = jobLocationIds(character);
  const { data: locations = [] } = useQuery({
    queryKey: ['studentWorkLocations', ids.join(',')],
    queryFn: () => base44.entities.LocationReference.filter({ id: { $in: ids } }),
    enabled: ids.length > 0,
  });

  if (!character) return null;

  const conflicts = findAcademicWorkConflicts(character, locations, scheduleMap);
  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 space-y-1.5">
      <p className="text-[10px] font-semibold text-amber-400 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> Scheduling Conflict
      </p>
      {conflicts.map((conflict, index) => (
        <div key={index} className="space-y-0.5">
          <p className="text-[10px] text-amber-200/90">
            {DAY_NAMES[conflict.day]}'s proposed academic schedule overlaps with the character's
            scheduled shift at {conflict.employer}.
          </p>
          <p className="text-[10px] text-amber-200/80">
            Work: {formatTime(conflict.work_start)} to {formatTime(conflict.work_end)}
          </p>
          <p className="text-[10px] text-amber-200/80">
            Class: {formatTime(conflict.class_start)} to {formatTime(conflict.class_end)}
          </p>
          <p className="text-[10px] text-amber-200/80">
            Overlap: {minutesToLabel(conflict.overlap_start)} to {minutesToLabel(conflict.overlap_end)}
          </p>
        </div>
      ))}
    </div>
  );
}