import React, { useState } from "react";
import { Plus, ChevronDown, ChevronRight, Trash2, X, UserPlus, Building2 } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import GroupedCharacterSelector from "@/components/location/GroupedCharacterSelector";
import PositionInput from "@/components/location/PositionInput";
import { Input } from "@/components/ui/input";

/**
 * WorkplaceManager — the individual businesses inside ONE location.
 *
 * A Home can contain several independent businesses. Each one is its own
 * establishment: its own name, its own business type chosen from the venue types
 * Pocketfriend already supports, its own zones, and its own employees.
 *
 * This adds no new employment system. A workplace employee is added to the
 * property's existing worker_character_ids, so shifts, pay rates, job titles and
 * schedule enforcement stay exactly where they already live. Living in the
 * property never employs anyone.
 *
 * Props:
 *   workplaces            array of { workplace_id, name, business_category, business_type, zone_names, worker_character_ids }
 *   onChange(workplaces)
 *   zones                 the location's existing zones (form.zones)
 *   subtypeOptions        existing SUBTYPE_OPTIONS map (category → venue types)
 *   subtypeLabels         existing SUBTYPE_LABELS map
 *   allCharacters         characters who may be employed here
 *   nameById              id → display name fallback
 *   shifts / jobTitles    the location's existing worker_shifts / worker_job_titles
 *   payType / payRates    the location's existing worker_pay_type / worker_pay_rates
 *   onUpdate(field, value) → the form's own update, used for those existing fields
 *   onToggleWorker(workplaceId, characterId, add)
 *   getCharacterAvailability(char) → existing availability result
 */
const BUSINESS_CATEGORIES = [
  { category: "food_drink", label: "Food & Drink" },
  { category: "gym", label: "Gym" },
  { category: "grocery", label: "Grocery" },
  { category: "business", label: "Retail / Shop" },
  { category: "workplace", label: "Office / Workplace" },
  { category: "social", label: "Bar / Nightlife" },
  { category: "medical", label: "Medical" },
  { category: "education", label: "Education" },
  { category: "community", label: "Community" },
  { category: "religion", label: "Worship" },
  { category: "government", label: "Government" },
  { category: "public", label: "Public venue" },
];

const labelOf = (value, labels) =>
  labels?.[value] || String(value || "").replace(/_/g, " ");

const generateWorkplaceId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `workplace_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

export default function WorkplaceManager({
  workplaces = [],
  onChange,
  zones = [],
  subtypeOptions = {},
  subtypeLabels = {},
  allCharacters = [],
  nameById = {},
  shifts = {},
  jobTitles = {},
  payType = {},
  payRates = {},
  onUpdate,
  onToggleWorker,
  getCharacterAvailability = null,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [pickingFor, setPickingFor] = useState(null);
  // Which employee's own employment controls are open. One at a time keeps the
  // section compact; it never changes what is saved.
  const [editingKey, setEditingKey] = useState(null);

  const list = workplaces || [];
  const zoneNames = (zones || []).map(z => z.zone_name).filter(Boolean);

  const updateWorkplace = (workplaceId, patch) =>
    onChange(list.map(w => (w.workplace_id === workplaceId ? { ...w, ...patch } : w)));

  const addWorkplace = () => {
    const created = {
      workplace_id: generateWorkplaceId(),
      name: "",
      business_category: "",
      business_type: "",
      zone_names: [],
      worker_character_ids: [],
    };
    onChange([...list, created]);
    setExpandedId(created.workplace_id);
  };

  const removeWorkplace = (workplaceId) => {
    // Removing the business does not delete anyone. Its employees stay on the
    // property's worker list and can be removed there.
    onChange(list.filter(w => w.workplace_id !== workplaceId));
    if (expandedId === workplaceId) setExpandedId(null);
    if (pickingFor === workplaceId) setPickingFor(null);
  };

  const toggleZone = (workplaceId, zoneName) => {
    const workplace = list.find(w => w.workplace_id === workplaceId);
    const current = workplace?.zone_names || [];
    updateWorkplace(workplaceId, {
      zone_names: current.includes(zoneName)
        ? current.filter(z => z !== zoneName)
        : [...current, zoneName],
    });
  };

  const chooseBusinessType = (workplaceId, rawValue) => {
    if (!rawValue) {
      updateWorkplace(workplaceId, { business_category: "", business_type: "" });
      return;
    }
    const [business_category, business_type] = rawValue.split("::");
    updateWorkplace(workplaceId, { business_category, business_type });
  };

  const resolveName = (id) =>
    allCharacters.find(c => c.id === id)?.name || nameById[id] || "Unknown character";

  return (
    <div className="space-y-3 p-3 rounded-xl bg-secondary/30 border border-border">
      <div>
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5" /> Workplaces
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Businesses inside this property. Each one is its own establishment with its own name,
          business type, zones and employees. The property stays a home — residents are not
          employees, and only the property's owner or an administrator can change these.
        </p>
      </div>

      {list.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic text-center py-1">
          No businesses added yet.
        </p>
      )}

      <div className="space-y-2">
        {list.map(workplace => {
          const isExpanded = expandedId === workplace.workplace_id;
          const employees = workplace.worker_character_ids || [];
          const selectedZones = workplace.zone_names || [];
          const typeValue = workplace.business_type
            ? `${workplace.business_category}::${workplace.business_type}`
            : "";

          return (
            <div key={workplace.workplace_id} className="rounded-lg bg-card border border-border overflow-hidden">
              <div className="flex items-center gap-2 p-2.5">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : workplace.workplace_id)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  {isExpanded
                    ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {workplace.name?.trim() || "Untitled workplace"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {workplace.business_type
                        ? labelOf(workplace.business_type, subtypeLabels)
                        : "No business type"}
                      {" · "}{employees.length} {employees.length === 1 ? "employee" : "employees"}
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => removeWorkplace(workplace.workplace_id)}
                  title="Remove this workplace"
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg flex-shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {isExpanded && (
                <div className="px-2.5 pb-2.5 space-y-2.5 border-t border-border pt-2.5">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</label>
                    <input
                      type="text"
                      value={workplace.name || ""}
                      onChange={e => updateWorkplace(workplace.workplace_id, { name: e.target.value })}
                      placeholder="e.g. Ground Floor Restaurant"
                      className="w-full h-8 px-2.5 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Business Type</label>
                    <select
                      value={typeValue}
                      onChange={e => chooseBusinessType(workplace.workplace_id, e.target.value)}
                      className="w-full text-xs px-2 py-1.5 bg-input border border-border rounded text-foreground capitalize"
                    >
                      <option value="">Choose a business type…</option>
                      {BUSINESS_CATEGORIES.map(group => {
                        const options = subtypeOptions[group.category] || [];
                        if (options.length === 0) return null;
                        return (
                          <optgroup key={group.category} label={group.label}>
                            {options.map(type => (
                              <option key={`${group.category}::${type}`} value={`${group.category}::${type}`}>
                                {labelOf(type, subtypeLabels)}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Zones of this property</label>
                    {zoneNames.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground italic">Add rooms / zones above first.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {zoneNames.map(zoneName => {
                          const active = selectedZones.includes(zoneName);
                          return (
                            <button
                              key={zoneName}
                              onClick={() => toggleZone(workplace.workplace_id, zoneName)}
                              className={`px-2 py-1 rounded-full text-[10px] border transition-colors ${active ? "bg-primary/10 border-primary/40 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
                            >
                              {active ? "✓ " : ""}{zoneName}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Employees</label>
                    {employees.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground italic">No employees yet.</p>
                    ) : (
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {employees.map(characterId => {
                          const character = allCharacters.find(c => c.id === characterId);
                          const shift = shifts?.[characterId] || {};
                          const shiftDays = shift.days || [1, 2, 3, 4, 5];
                          const shiftLabel = shift.start && shift.end ? `${shift.start}–${shift.end}` : null;
                          const rowKey = `${workplace.workplace_id}:${characterId}`;
                          const isEditing = editingKey === rowKey;
                          const category = workplace.business_category || "workplace";
                          return (
                            <div key={characterId} className="rounded-lg bg-secondary/40 border border-border">
                              <div className="flex items-center gap-2 py-1 px-1.5 group">
                                <button
                                  onClick={() => setEditingKey(isEditing ? null : rowKey)}
                                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                                >
                                  {isEditing
                                    ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                    : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                                  {character
                                    ? <CharacterAvatar character={character} size="sm" />
                                    : <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold text-muted-foreground flex-shrink-0">?</div>}
                                  <span className="text-xs text-foreground flex-1 truncate">
                                    {resolveName(characterId)}
                                    {jobTitles?.[characterId] ? <span className="text-muted-foreground/70"> · {jobTitles[characterId]}</span> : null}
                                    {shiftLabel ? <span className="text-muted-foreground/70"> · {shiftLabel}</span> : null}
                                  </span>
                                </button>
                                <button
                                  onClick={() => onToggleWorker?.(workplace.workplace_id, characterId, false)}
                                  title="Remove from this workplace"
                                  className="p-0.5 text-muted-foreground hover:text-destructive transition-colors rounded-lg flex-shrink-0"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>

                              {isEditing && (
                                <div className="px-1.5 pb-1.5 space-y-1.5 border-t border-border pt-1.5">
                                  <div className="grid grid-cols-3 gap-1.5">
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Type</label>
                                      <select
                                        value={payType?.[characterId] || "hourly"}
                                        onChange={e => onUpdate?.("worker_pay_type", { ...payType, [characterId]: e.target.value })}
                                        className="text-[10px] px-1.5 py-1 bg-input border border-border rounded text-foreground"
                                      >
                                        <option value="hourly">Hourly</option>
                                        <option value="annual">Annual</option>
                                      </select>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Rate</label>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[10px]">$</span>
                                        <Input
                                          type="number"
                                          value={payRates?.[characterId] || 0}
                                          onChange={e => onUpdate?.("worker_pay_rates", { ...payRates, [characterId]: parseFloat(e.target.value) || 0 })}
                                          className="h-7 text-[10px] flex-1"
                                          placeholder="15"
                                        />
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Position</label>
                                      <PositionInput
                                        category={category}
                                        value={jobTitles?.[characterId] || ""}
                                        onChange={val => onUpdate?.("worker_job_titles", { ...jobTitles, [characterId]: val })}
                                      />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Shift Start</label>
                                      <Input
                                        type="time"
                                        value={shift.start || "09:00"}
                                        onChange={e => onUpdate?.("worker_shifts", { ...shifts, [characterId]: { ...shift, start: e.target.value } })}
                                        className="h-7 text-[10px]"
                                      />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[9px] text-muted-foreground uppercase tracking-wider">Shift End</label>
                                      <Input
                                        type="time"
                                        value={shift.end || "17:00"}
                                        onChange={e => onUpdate?.("worker_shifts", { ...shifts, [characterId]: { ...shift, end: e.target.value } })}
                                        className="h-7 text-[10px]"
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 block">Work Days</label>
                                    <div className="flex gap-1 flex-wrap">
                                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d, i) => {
                                        const active = shiftDays.includes(i);
                                        return (
                                          <button
                                            key={i}
                                            type="button"
                                            onClick={() => {
                                              const nextDays = active ? shiftDays.filter(x => x !== i) : [...shiftDays, i].sort();
                                              onUpdate?.("worker_shifts", { ...shifts, [characterId]: { ...shift, days: nextDays } });
                                            }}
                                            className={`w-6 h-6 rounded-full text-[9px] font-medium border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
                                          >
                                            {d}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {pickingFor === workplace.workplace_id ? (
                      <div className="pt-1 space-y-2">
                        <GroupedCharacterSelector
                          allCharacters={allCharacters.filter(c => !employees.includes(c.id))}
                          selectedIds={[]}
                          onSelect={(characterId, isSelected) => {
                            if (!isSelected) return;
                            onToggleWorker?.(workplace.workplace_id, characterId, true);
                          }}
                          placeholder="Search to add an employee..."
                          getCharacterAvailability={getCharacterAvailability}
                        />
                        <button
                          onClick={() => setPickingFor(null)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Done
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPickingFor(workplace.workplace_id)}
                        className="w-full flex items-center justify-center gap-1.5 py-1 rounded-lg text-[10px] text-muted-foreground hover:text-primary border border-dashed border-border hover:border-primary/30 transition-colors"
                      >
                        <UserPlus className="w-3 h-3" /> Add employee
                      </button>
                    )}
                    <p className="text-[10px] text-muted-foreground/70">
                      Tap an employee to set their shift, pay and position for this business. Business
                      hours follow this property's Mixed-Use Environments — residential access is unaffected.
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={addWorkplace}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium"
      >
        <Plus className="w-3 h-3" /> Add workplace
      </button>
    </div>
  );
}