import React from 'react';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';

/**
 * Displays schedule conflicts and availability for a character.
 * Used in work assignment and school enrollment UIs.
 */
export default function ScheduleConflictDisplay({ 
  character, 
  conflicts, 
  availability,
  proposedSchedule = null,
  isLoading = false 
}) {
  if (isLoading) {
    return (
      <div className="p-4 rounded-lg bg-secondary/40 border border-border flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Checking availability...</span>
      </div>
    );
  }

  const hasConflicts = conflicts && conflicts.length > 0;
  const hasAvailability = availability && Object.keys(availability).length > 0;

  return (
    <div className="space-y-3">
      {/* Conflict Alert */}
      {hasConflicts && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <h4 className="text-xs font-semibold text-red-500">Schedule Conflicts</h4>
          </div>
          <div className="space-y-1">
            {conflicts.map((conflict, idx) => (
              <div key={idx} className="text-xs bg-red-500/5 rounded p-2 space-y-0.5">
                <p className="font-medium text-red-400">
                  {conflict.schedule1.type === 'work' ? '🏢' : conflict.schedule1.type === 'school' ? '📚' : '🏛️'}{' '}
                  {conflict.schedule1.label}
                </p>
                <p className="text-[10px] text-red-400/70">overlaps with</p>
                <p className="font-medium text-red-400">
                  {conflict.schedule2.type === 'work' ? '🏢' : conflict.schedule2.type === 'school' ? '📚' : '🏛️'}{' '}
                  {conflict.schedule2.label}
                </p>
                <p className="text-[10px] text-red-400/60 pt-1">
                  {conflict.overlap.days} · {conflict.overlap.time_range}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Conflicts Alert */}
      {!hasConflicts && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
          <p className="text-xs text-green-400">No schedule conflicts detected</p>
        </div>
      )}

      {/* Availability Breakdown */}
      {hasAvailability && (
        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-blue-400" />
            <h4 className="text-xs font-semibold text-blue-400">Availability by Day</h4>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Object.entries(availability).map(([dayName, dayInfo]) => (
              <div key={dayName} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-foreground">{dayName.slice(0, 2)}</span>
                {dayInfo.is_completely_free ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">
                    Free
                  </span>
                ) : (
                  <div className="text-[10px] space-y-0.5">
                    {dayInfo.blocks.filter(b => b.is_free).length > 0 ? (
                      <>
                        <span className="block text-amber-400 font-medium">
                          {dayInfo.blocks.filter(b => b.is_free).length}
                        </span>
                        <span className="block text-[9px] text-muted-foreground/60">blocks</span>
                      </>
                    ) : (
                      <span className="text-red-400">Full</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Detailed Time Blocks */}
          <div className="mt-3 space-y-2">
            {Object.entries(availability).map(([dayName, dayInfo]) => {
              const freeBlocks = dayInfo.blocks.filter(b => b.is_free);
              if (freeBlocks.length === 0) return null;
              if (dayInfo.is_completely_free) return null;

              return (
                <div key={dayName} className="text-[10px]">
                  <p className="text-muted-foreground/70 font-medium mb-1">{dayName}:</p>
                  <div className="flex flex-wrap gap-1">
                    {freeBlocks.map((block, idx) => (
                      <span key={idx} className="px-2 py-1 rounded bg-green-500/20 text-green-400">
                        {block.start} - {block.end}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Proposed Schedule Check */}
      {proposedSchedule && (
        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 space-y-2">
          <h4 className="text-xs font-semibold text-purple-400">Proposed Schedule Compatibility</h4>
          <p className="text-[10px] text-purple-400/80">
            {proposedSchedule.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}{' '}
            · {proposedSchedule.start_time} - {proposedSchedule.end_time}
          </p>
        </div>
      )}
    </div>
  );
}