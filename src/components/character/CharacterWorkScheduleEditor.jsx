import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Briefcase, Clock, DollarSign, ChevronDown, ChevronUp, Check } from "lucide-react";
import { Input } from "@/components/ui/input";

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')}${period}`;
}

function formatShift(shift) {
  if (!shift?.start || !shift?.end) return null;
  const days = shift.days?.map(d => DAY_LABELS[d]).join('/') || '';
  return `${formatTime(shift.start)}–${formatTime(shift.end)}${days ? ' · ' + days : ''}`;
}

function WorkLocationEditor({ location, characterId, onSaved }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const storedShift = location.worker_shifts?.[characterId];
  const initialShift = storedShift || { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] };
  const payType = location.worker_pay_type?.[characterId] || 'hourly';
  const payRate = location.worker_pay_rates?.[characterId] || 0;
  const jobTitle = location.worker_job_titles?.[characterId] || '';

  const [form, setForm] = useState({ shift: initialShift, payType, payRate, jobTitle });

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));
  const updateShift = (field, val) => setForm(p => ({ ...p, shift: { ...p.shift, [field]: val } }));

  const toggleDay = (i) => {
    const cur = form.shift.days || [];
    const newDays = cur.includes(i) ? cur.filter(d => d !== i) : [...cur, i].sort();
    updateShift('days', newDays);
  };

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.LocationReference.update(location.id, {
      worker_shifts: { ...location.worker_shifts, [characterId]: form.shift },
      worker_pay_type: { ...location.worker_pay_type, [characterId]: form.payType },
      worker_pay_rates: { ...location.worker_pay_rates, [characterId]: parseFloat(form.payRate) || 0 },
      worker_job_titles: { ...location.worker_job_titles, [characterId]: form.jobTitle },
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Invalidate all workLocations queries for this character regardless of exact key shape,
    // so CharacterProfile and any other consumer re-fetches fresh data from the Location resource.
    queryClient.invalidateQueries({ queryKey: ['workLocations', characterId], exact: false });
    queryClient.invalidateQueries({ queryKey: ['character', characterId], exact: false });
    onSaved?.();
  };

  return (
    <div className="bg-secondary/40 border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-secondary/60 transition-colors"
      >
        <Briefcase className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{location.name}</p>
          {form.jobTitle && <p className="text-xs text-muted-foreground">{form.jobTitle}</p>}
          {form.shift?.start && form.shift?.end ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <Clock className="w-3 h-3" /> {formatShift(form.shift)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground/50 italic mt-0.5">No schedule set — expand to configure</p>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          {/* Job Title */}
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Job Title / Position</label>
            <Input
              value={form.jobTitle}
              onChange={e => update('jobTitle', e.target.value)}
              placeholder="e.g. Cashier, Manager, Barista"
              className="h-9 rounded-lg text-sm"
            />
          </div>

          {/* Pay */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Pay Type</label>
              <select
                value={form.payType}
                onChange={e => update('payType', e.target.value)}
                className="w-full h-9 px-2 bg-input border border-border rounded-lg text-sm text-foreground"
              >
                <option value="hourly">Hourly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
                Rate <span className="normal-case text-muted-foreground/60">({form.payType === 'hourly' ? '$/hr' : '$/yr'})</span>
              </label>
              <div className="flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <Input
                  type="number"
                  value={form.payRate}
                  onChange={e => update('payRate', e.target.value)}
                  className="h-9 rounded-lg text-sm"
                />
              </div>
            </div>
          </div>

          {/* Shift Times */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Shift Start</label>
              <Input
                type="time"
                value={form.shift.start || '09:00'}
                onChange={e => updateShift('start', e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Shift End</label>
              <Input
                type="time"
                value={form.shift.end || '17:00'}
                onChange={e => updateShift('end', e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Work Days */}
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Work Days</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAY_LABELS.map((d, i) => {
                const active = (form.shift.days || []).includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`w-8 h-8 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:border-primary/40'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saved ? <><Check className="w-4 h-4" /> Saved</> : saving ? 'Saving...' : 'Save Changes'}
          </button>
          <p className="text-xs text-muted-foreground/60 text-center">Changes also update the Locations page</p>
        </div>
      )}
    </div>
  );
}

export default function CharacterWorkScheduleEditor({ character }) {
  const { data: workLocations = [] } = useQuery({
    queryKey: ['workLocations', character.id, character.occupation_location_id, (character.additional_occupation_locations || []).map(l => l.location_id).join(',')],
    queryFn: async () => {
      // worker_character_ids arrays are empty in DB — resolve from character employment fields first.
      // Then try worker_character_ids as a secondary check for any stragglers.
      const locationIds = new Set();
      if (character.occupation_location_id) locationIds.add(character.occupation_location_id);
      (character.additional_occupation_locations || []).forEach(l => {
        if (l.location_id) locationIds.add(l.location_id);
      });

      const charFileLocs = locationIds.size > 0
        ? await Promise.all(
            [...locationIds].map(id =>
              base44.entities.LocationReference.filter({ id }).then(r => r[0]).catch(() => null)
            )
          )
        : [];

      const byWorkerList = await base44.entities.LocationReference.filter({ worker_character_ids: [character.id] }).catch(() => []);
      byWorkerList.forEach(l => locationIds.add(l.id));

      const combined = [...charFileLocs.filter(Boolean), ...byWorkerList];
      const seen = new Set();
      return combined.filter(l => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      });
    },
    enabled: !!character.id,
    staleTime: 30000,
  });

  if (workLocations.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">Work Schedule</p>
      {workLocations.map(loc => (
        <WorkLocationEditor key={loc.id} location={loc} characterId={character.id} />
      ))}
    </div>
  );
}