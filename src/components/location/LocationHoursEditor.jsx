import { Plus, X, Clock } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function LocationHoursEditor({ hours = [], onChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newHour, setNewHour] = useState({
    day_of_week: null,
    open_time: '09:00',
    close_time: '17:00',
    note: '',
  });

  const addHour = () => {
    const updated = [...hours, { ...newHour }];
    onChange(updated);
    setNewHour({ day_of_week: null, open_time: '09:00', close_time: '17:00', note: '' });
    setShowAdd(false);
  };

  const removeHour = (idx) => {
    onChange(hours.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <label className="text-xs font-semibold text-foreground uppercase">Hours of Operation</label>
      </div>

      {hours.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground italic">No hours set. Click + to add.</p>
      )}

      <div className="space-y-2">
        {hours.map((hour, idx) => (
          <div key={idx} className="flex items-center gap-2 bg-secondary/50 p-2 rounded-lg">
            <span className="text-xs flex-1">
              {hour.day_of_week !== null ? DAYS[hour.day_of_week] : 'All Days'}
              <span className="text-muted-foreground ml-2">
                {hour.open_time} – {hour.close_time}
              </span>
              {hour.note && <span className="text-muted-foreground/60 ml-2">({hour.note})</span>}
            </span>
            <button
              onClick={() => removeHour(idx)}
              className="p-1 hover:bg-destructive/20 rounded text-destructive"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="bg-secondary/30 border border-border rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <select
              value={newHour.day_of_week === null ? '' : newHour.day_of_week}
              onChange={(e) => setNewHour({ ...newHour, day_of_week: e.target.value === '' ? null : parseInt(e.target.value) })}
              className="text-xs px-2 py-1.5 bg-input border border-border rounded text-foreground"
            >
              <option value="">All Days</option>
              {DAYS.map((day, i) => (
                <option key={i} value={i}>{day}</option>
              ))}
            </select>
            <Input
              type="time"
              value={newHour.open_time}
              onChange={(e) => setNewHour({ ...newHour, open_time: e.target.value })}
              className="h-8 text-xs"
            />
            <Input
              type="time"
              value={newHour.close_time}
              onChange={(e) => setNewHour({ ...newHour, close_time: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <Input
            placeholder="Optional label (e.g., Morning Service)"
            value={newHour.note}
            onChange={(e) => setNewHour({ ...newHour, note: e.target.value })}
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={addHour} className="flex-1 h-7 text-xs">Add</Button>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {!showAdd && (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/40 text-xs transition-colors"
        >
          <Plus className="w-3 h-3" /> Add Hours
        </button>
      )}
    </div>
  );
}