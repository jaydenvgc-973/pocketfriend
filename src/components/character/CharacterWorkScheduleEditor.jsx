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
  // CRITICAL: Do NOT default to 09:00–17:00. An empty shift means "not configured yet".
  // Using 09:00–17:00 as default would write a false 9-5 schedule if user saves without editing.
  const initialShift = storedShift || { start: '', end: '', days: [] };
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
    // Update LocationReference with shift/pay/title data
    await base44.entities.LocationReference.update(location.id, {
      worker_shifts: { ...location.worker_shifts, [characterId]: form.shift },
      worker_pay_type: { ...location.worker_pay_type, [characterId]: form.payType },
      worker_pay_rates: { ...location.worker_pay_rates, [characterId]: parseFloat(form.payRate) || 0 },
      worker_job_titles: { ...location.worker_job_titles, [characterId]: form.jobTitle },
    });
    // Await sync so Character entity is fully updated before cache invalidation fires
    await base44.functions.invoke('syncLocationJobToCharacter', {
      locationId: location.id,
      characterId,
      syncType: 'work',
    }).catch(err => console.error('[WorkScheduleEditor] sync failed:', err?.message));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    queryClient.invalidateQueries({ queryKey: ['workLocations', characterId], exact: false });
    queryClient.invalidateQueries({ queryKey: ['character', characterId], exact: false });
    queryClient.invalidateQueries({ queryKey: ['characters'], exact: false });
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
                value={form.shift.start || ''}
                onChange={e => updateShift('start', e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Shift End</label>
              <Input
                type="time"
                value={form.shift.end || ''}
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
      // CANONICAL RESOLUTION — must match LocationDetailPanel's worker display exactly.
      // LocationDetailPanel uses: worker_character_ids OR fallback to Object.keys(worker_job_titles)
      // This resolver uses BOTH character-side fields AND location-side arrays so the two panels
      // always show the same workplaces.
      const locationIds = new Set();

      // Source 1: Character.occupation_location_id (primary job, character-side)
      if (character.occupation_location_id) locationIds.add(character.occupation_location_id);

      // Source 2: Character.additional_occupation_locations (secondary jobs, character-side)
      (character.additional_occupation_locations || []).forEach(l => {
        if (l.location_id) locationIds.add(l.location_id);
      });

      // Fetch character-side locations
      const charFileLocs = [];
      for (const id of locationIds) {
        const result = await base44.entities.LocationReference.filter({ id }).then(r => r[0]).catch(() => null);
        if (result) charFileLocs.push(result);
      }

      // Source 3: LocationReference.worker_character_ids contains this character (location-side roster)
      // This is what the arrow dropdown (LocationDetailPanel) reads — must be included here too
      const byWorkerList = await base44.entities.LocationReference.filter({ worker_character_ids: [character.id] }).catch(() => []);
      byWorkerList.forEach(l => { if (!locationIds.has(l.id)) locationIds.add(l.id); });

      // Source 4: Owner-email scan for locations where characterId appears as a key in
      // worker_job_titles / worker_shifts / worker_pay_rates — the EXACT same fallback
      // used by LocationDetailPanel's arrow dropdown. This resolves the data split where
      // a character has employment metadata on the location but no worker_character_ids entry
      // AND no occupation_location_id on the Character entity.
      const seen = new Set([...charFileLocs.filter(Boolean).map(l => l.id), ...byWorkerList.map(l => l.id)]);
      if (character.owner_email) {
        const ownerLocs = await base44.entities.LocationReference.filter({ owner_email: character.owner_email }).catch(() => []);
        for (const loc of ownerLocs) {
          if (seen.has(loc.id)) continue;
          const inJobTitles = loc.worker_job_titles && Object.prototype.hasOwnProperty.call(loc.worker_job_titles, character.id);
          const inShifts = loc.worker_shifts && Object.prototype.hasOwnProperty.call(loc.worker_shifts, character.id);
          const inPayRates = loc.worker_pay_rates && Object.prototype.hasOwnProperty.call(loc.worker_pay_rates, character.id);
          if (inJobTitles || inShifts || inPayRates) {
            seen.add(loc.id);
            byWorkerList.push(loc); // treat as worker-list loc for dedup below
          }
        }
      }

      const seenDedup = new Set();
      const combined = [...charFileLocs.filter(Boolean), ...byWorkerList];
      const deduped = combined.filter(l => {
        if (!l || seenDedup.has(l.id)) return false;
        seenDedup.add(l.id);
        return true;
      });

      // Non-destructive backfill: if character has employment on a location but no occupation_location_id,
      // trigger sync so profile and dashboard resolve correctly going forward. Fire-and-forget.
      if (!character.occupation_location_id && byWorkerList.length > 0) {
        const primaryLoc = byWorkerList[0];
        base44.functions.invoke('syncLocationJobToCharacter', {
          locationId: primaryLoc.id,
          characterId: character.id,
          syncType: 'work',
        }).catch(e => console.warn('[WorkScheduleEditor] auto-backfill sync failed:', e?.message));
      }

      return deduped;
    },
    enabled: !!character.id,
    staleTime: 120000,
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