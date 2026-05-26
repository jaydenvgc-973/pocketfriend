import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertCircle, Check, Loader2, X, Calendar } from 'lucide-react';
import { format } from 'date-fns';

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * UI for enrolling a character into a college/university location.
 * Shows conflicts, availability, schedule customization, and campus residency option.
 */
export default function CollegeEnrollmentEditor({ character, location, onEnrollmentComplete }) {
  const queryClient = useQueryClient();
  const [enrolling, setEnrolling] = useState(false);
  const [programName, setProgramName] = useState(location.name);
  const [gradDate, setGradDate] = useState('');
  const [liveOnCampus, setLiveOnCampus] = useState(false);
  const [customSchedule, setCustomSchedule] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Check for existing conflicts
  const { data: conflictData, isLoading: conflictsLoading } = useQuery({
    queryKey: ['scheduleConflicts', character.id],
    queryFn: () => base44.functions.invoke('detectScheduleConflicts', { character_id: character.id }),
  });

  // Get available time blocks
  const { data: availabilityData } = useQuery({
    queryKey: ['availableTimeBlocks', character.id],
    queryFn: () => base44.functions.invoke('calculateAvailableTimeBlocks', { character_id: character.id }),
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      return base44.functions.invoke('enrollCharacterInCollege', {
        character_id: character.id,
        location_id: location.id,
        program_name: programName,
        institution: location.name,
        expected_graduation_date: gradDate || null,
        lives_on_campus: liveOnCampus,
        custom_schedule: customSchedule,
      });
    },
    onSuccess: (result) => {
      setEnrolling(false);
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      onEnrollmentComplete?.(result);
    },
    onError: (error) => {
      setEnrolling(false);
      console.error('Enrollment failed:', error);
    },
  });

  const hasConflicts = conflictData?.conflicts && conflictData.conflicts.length > 0;

  return (
    <div className="space-y-4 bg-card border border-border rounded-2xl p-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">Enroll in {location.name}</h3>

        {/* Program Info */}
        <div className="space-y-3 mb-6">
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Program Name</label>
            <input
              type="text"
              value={programName}
              onChange={e => setProgramName(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="e.g. Bachelor of Science in Computer Science"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Expected Graduation Date (Optional)</label>
            <input
              type="date"
              value={gradDate}
              onChange={e => setGradDate(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Conflict Alert */}
        {!conflictsLoading && hasConflicts && (
          <div className="mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/30 space-y-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <p className="text-xs font-medium text-red-500">Schedule Conflicts Detected</p>
            </div>
            <div className="text-xs text-red-400 space-y-1">
              {conflictData.conflicts.map((conflict, idx) => (
                <div key={idx} className="flex justify-between">
                  <span>
                    {conflict.schedule1.label} ↔ {conflict.schedule2.label}
                  </span>
                  <span>{conflict.overlap.days} · {conflict.overlap.time_range}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-red-400/80">Customize schedule below or adjust existing commitments.</p>
          </div>
        )}

        {/* Availability Summary */}
        {availabilityData && (
          <div className="mb-6 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30">
            <p className="text-xs font-medium text-blue-400 mb-2">Free Time Blocks</p>
            <div className="grid grid-cols-7 gap-1">
              {Object.entries(availabilityData.availability).map(([day, info]) => (
                <div key={day} className="text-center">
                  <p className="text-[10px] font-medium text-foreground">{DAY_LABELS[info.day_number]}</p>
                  {info.is_completely_free ? (
                    <span className="text-[10px] text-green-400">Free</span>
                  ) : (
                    <span className="text-[10px] text-amber-400">{info.blocks.filter(b => b.is_free).length} blocks</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom Schedule */}
        <div className="mb-6">
          <button
            onClick={() => setScheduleOpen(!scheduleOpen)}
            className="flex items-center gap-2 w-full p-3 rounded-lg bg-secondary hover:bg-secondary/80 text-sm font-medium text-foreground transition-colors"
          >
            <Calendar className="w-4 h-4" />
            {customSchedule ? 'Edit Schedule' : 'Set Custom Schedule'}
          </button>

          {scheduleOpen && (
            <ScheduleEditor
              schedule={customSchedule}
              onChange={setCustomSchedule}
              availability={availabilityData?.availability}
            />
          )}
        </div>

        {/* Campus Residency */}
        {(location.school_type === 'college' || location.school_type === 'university') && (
          <div className="mb-6 p-3 rounded-lg bg-secondary/40 border border-border">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={liveOnCampus}
                onChange={e => setLiveOnCampus(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-foreground">Lives on campus</span>
            </label>
            {liveOnCampus && (
              <p className="text-xs text-muted-foreground mt-2">
                Will be set as resident of {location.name} for housing/presence purposes.
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => enrollMutation.mutate()}
            disabled={enrolling || !programName}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {enrolling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Enrolling...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> Enroll
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleEditor({ schedule, onChange, availability }) {
  const defaultSchedule = schedule || {
    start_time: '09:00',
    end_time: '17:00',
    days: [1, 2, 3, 4, 5],
  };

  const toggleDay = (dayNum) => {
    const newDays = defaultSchedule.days.includes(dayNum)
      ? defaultSchedule.days.filter(d => d !== dayNum)
      : [...defaultSchedule.days, dayNum].sort();
    onChange({ ...defaultSchedule, days: newDays });
  };

  return (
    <div className="mt-2 p-3 rounded-lg bg-secondary/60 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Start Time</label>
          <input
            type="time"
            value={defaultSchedule.start_time}
            onChange={e => onChange({ ...defaultSchedule, start_time: e.target.value })}
            className="w-full h-8 px-2 rounded-lg bg-card border border-border text-sm outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">End Time</label>
          <input
            type="time"
            value={defaultSchedule.end_time}
            onChange={e => onChange({ ...defaultSchedule, end_time: e.target.value })}
            className="w-full h-8 px-2 rounded-lg bg-card border border-border text-sm outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-2">Days</label>
        <div className="flex gap-1">
          {DAY_LABELS.map((label, i) => {
            const isSelected = defaultSchedule.days.includes(i);
            const dayAvail = availability?.[i];
            const isBusy = dayAvail && !dayAvail.is_completely_free;
            return (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary'
                    : isBusy
                    ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400 cursor-not-allowed opacity-60'
                    : 'bg-card border-border text-muted-foreground hover:border-primary/50'
                }`}
                disabled={isBusy && !isSelected}
              >
                {label}
              </button>
            );
          })}
        </div>
        {availability && (
          <p className="text-[10px] text-muted-foreground/60 mt-2">
            Dimmed days have existing commitments
          </p>
        )}
      </div>
    </div>
  );
}