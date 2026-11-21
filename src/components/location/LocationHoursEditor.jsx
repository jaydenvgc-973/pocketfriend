import { useMemo, useState } from 'react';
import { Plus, X, Clock, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toDisplay12h } from '@/lib/timeFormat';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const EVERY_DAY = 'every';

const keyOf = (day) => (day === null || day === undefined ? EVERY_DAY : day);
const groupKeyOf = (h) => `${keyOf(h.day_of_week)}|${h.open_time}|${h.close_time}|${h.note || ''}`;

const dayLabel = (days) => {
  if (days.includes(EVERY_DAY)) return 'Every day';
  return [...days]
    .sort((a, b) => a - b)
    .map(d => DAYS[d])
    .join(', ');
};

const emptyDraft = () => ({ days: [], open: '09:00', close: '17:00', note: '' });

/**
 * Hours of operation.
 *
 * Days are picked together and one opening/closing time is applied to all of them.
 * Only the days selected are written: a day the user did not select keeps the hours
 * it already had, and a day with no hours stays closed.
 */
export default function LocationHoursEditor({ hours = [], onChange, label = 'Hours of Operation' }) {
  const [draft, setDraft] = useState(null);

  const list = Array.isArray(hours) ? hours : [];

  // Days sharing the same times read as one line (Mon–Fri 9–5), while staying the
  // separate per-day records the existing enforcement already reads.
  const groups = useMemo(() => {
    const map = new Map();
    list.forEach(h => {
      const key = groupKeyOf(h);
      if (!map.has(key)) {
        map.set(key, { key, open_time: h.open_time, close_time: h.close_time, note: h.note || '', days: [] });
      }
      map.get(key).days.push(keyOf(h.day_of_week));
    });
    return [...map.values()];
  }, [list]);

  const toggleDay = (day) => {
    setDraft(prev => {
      const current = prev || emptyDraft();
      if (day === EVERY_DAY) {
        return { ...current, days: current.days.includes(EVERY_DAY) ? [] : [EVERY_DAY] };
      }
      const withoutEvery = current.days.filter(d => d !== EVERY_DAY);
      return {
        ...current,
        days: withoutEvery.includes(day) ? withoutEvery.filter(d => d !== day) : [...withoutEvery, day],
      };
    });
  };

  const apply = () => {
    if (!draft || draft.days.length === 0) return;
    const selected = draft.days;
    const kept = list.filter(h => !selected.includes(keyOf(h.day_of_week)));
    const added = selected.map(day => ({
      day_of_week: day === EVERY_DAY ? null : day,
      open_time: draft.open,
      close_time: draft.close,
      note: draft.note.trim(),
    }));
    onChange([...kept, ...added]);
    setDraft(null);
  };

  const editGroup = (group) => {
    setDraft({
      days: group.days,
      open: group.open_time || '09:00',
      close: group.close_time || '17:00',
      note: group.note || '',
    });
  };

  const removeGroup = (group) => {
    onChange(list.filter(h => groupKeyOf(h) !== group.key));
    if (draft) {
      const stillSelected = draft.days.filter(d => !group.days.includes(d));
      setDraft(stillSelected.length ? { ...draft, days: stillSelected } : null);
    }
  };

  const selectedDays = draft?.days || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <label className="text-xs font-semibold text-foreground uppercase">{label}</label>
      </div>

      {groups.length === 0 && !draft && (
        <p className="text-xs text-muted-foreground italic">No hours set. A day with no hours is closed.</p>
      )}

      <div className="space-y-2">
        {groups.map(group => (
          <div key={group.key} className="flex items-center gap-2 bg-secondary/50 p-2 rounded-lg">
            <span className="text-xs flex-1">
              {dayLabel(group.days)}
              <span className="text-muted-foreground ml-2">
                {toDisplay12h(group.open_time)} – {toDisplay12h(group.close_time)}
              </span>
              {group.note && <span className="text-muted-foreground/60 ml-2">({group.note})</span>}
            </span>
            <button
              onClick={() => editGroup(group)}
              title="Edit these days"
              className="p-1 hover:bg-secondary rounded text-muted-foreground hover:text-foreground"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => removeGroup(group)}
              title="Remove these hours"
              className="p-1 hover:bg-destructive/20 rounded text-destructive"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {draft ? (
        <div className="bg-secondary/30 border border-border rounded-lg p-3 space-y-2.5">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
              Days — pick every day that shares these hours
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => toggleDay(EVERY_DAY)}
                className={`px-2 h-7 rounded-full text-[10px] font-medium border transition-colors ${
                  selectedDays.includes(EVERY_DAY)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border text-muted-foreground hover:border-primary/40'
                }`}
              >
                Every day
              </button>
              {DAY_SHORT.map((short, i) => {
                const active = selectedDays.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    title={DAYS[i]}
                    className={`w-7 h-7 rounded-full text-[10px] font-medium border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    {short}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {selectedDays.length === 0
                ? 'Select at least one day.'
                : `Applying to ${dayLabel(selectedDays)}.`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Opens</label>
              <Input
                type="time"
                value={draft.open}
                onChange={e => setDraft({ ...draft, open: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Closes</label>
              <Input
                type="time"
                value={draft.close}
                onChange={e => setDraft({ ...draft, close: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <Input
            placeholder="Optional label (e.g., Morning Service)"
            value={draft.note}
            onChange={e => setDraft({ ...draft, note: e.target.value })}
            className="h-8 text-xs"
          />

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={apply}
              disabled={selectedDays.length === 0}
              className="flex-1 h-7 text-xs"
            >
              Apply to selected days
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraft(null)} className="flex-1 h-7 text-xs">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setDraft(emptyDraft())}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 text-xs transition-colors"
        >
          <Plus className="w-3 h-3" /> Add hours
        </button>
      )}
    </div>
  );
}