import React, { useState } from "react";
import { Plus, ChevronDown, ChevronRight, Trash2, X, UserPlus, Building2 } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import GroupedCharacterSelector from "@/components/location/GroupedCharacterSelector";
import PositionInput from "@/components/location/PositionInput";
import WorkplaceZoneImages from "@/components/location/WorkplaceZoneImages";
import SpaceDescriptionField from "@/components/location/SpaceDescriptionField";
import { roomDescription, spaceZoneImageUrls, withRoomDescription } from "@/lib/spaceDescription";
import LocationHoursEditor from "@/components/location/LocationHoursEditor";
import { Input } from "@/components/ui/input";
import { ZONE_PRESETS } from "@/lib/locationFormConfig";
import PhysicalSettingToggle from "@/components/location/PhysicalSettingToggle";

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
  locationName = "",
  category = "",
  subtype = [],
  locationDescription = "",
  onAddZoneImage,
  onRemoveZoneImage,
  // Adds a room / zone to the property's own existing zone list, so a business's zone is
  // the same record the Rooms / Zones section and Scenes already read.
  onAddLocationZone = null,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [pickingFor, setPickingFor] = useState(null);
  const [zoneDraft, setZoneDraft] = useState("");
  // Which business's optional room descriptions are open. A display choice only.
  const [roomsOpenId, setRoomsOpenId] = useState(null);
  // Which employee's own employment controls are open. One at a time keeps the
  // section compact; it never changes what is saved.
  const [editingKey, setEditingKey] = useState(null);

  const list = workplaces || [];
  const zoneNames = (zones || []).map(z => z.zone_name).filter(Boolean);

  const updateWorkplace = (workplaceId, patch) =>
    onChange(list.map(w => (w.workplace_id === workplaceId ? { ...w, ...patch } : w)));

  // A business can be several kinds of establishment at once — a sneaker store that is also
  // a clothing store. business_types holds them all; the first one stays the primary type in
  // business_category / business_type so every existing reader is unchanged.
  const typesOf = (workplace) => {
    if (Array.isArray(workplace?.business_types) && workplace.business_types.length > 0) return workplace.business_types;
    return workplace?.business_type ? [{ category: workplace.business_category || "", type: workplace.business_type }] : [];
  };
  const withTypes = (workplace, types) => {
    const primary = types[0] || {};
    return {
      ...workplace,
      business_types: types,
      business_category: primary.category || "",
      business_type: primary.type || "",
    };
  };

  // The rooms / zones the existing venue classification already offers for this business's
  // selected types — the same ZONE_PRESETS every other location form uses.
  const presetZonesFor = (types) => {
    const categories = types.map(t => t.category).filter(Boolean);
    const source = categories.length > 0 ? categories : ["other"];
    const names = Array.from(new Set(source.flatMap(cat => ZONE_PRESETS[cat] || ZONE_PRESETS.other || [])));
    return names.filter(name => !zoneNames.some(z => z.toLowerCase() === name.toLowerCase()));
  };

  const addWorkplace = () => {
    const created = {
      workplace_id: generateWorkplaceId(),
      name: "",
      business_category: "",
      business_type: "",
      business_types: [],
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

  // Adding a type keeps the ones already chosen; removing one leaves the rest in place.
  const toggleBusinessType = (workplaceId, category, type) => {
    const workplace = list.find(w => w.workplace_id === workplaceId);
    if (!workplace || !type) return;
    const current = typesOf(workplace);
    const isSelected = current.some(t => t.category === category && t.type === type);
    const next = isSelected
      ? current.filter(t => !(t.category === category && t.type === type))
      : [...current, { category, type }];
    onChange(list.map(w => (w.workplace_id === workplaceId ? withTypes(w, next) : w)));
  };

  // A zone added here joins the property's existing zone list and this business's zones in
  // the same action, so its images attach to the right business and room immediately.
  const addZoneToWorkplace = (workplaceId, rawName) => {
    const name = String(rawName || "").trim();
    if (!name) return;
    const workplace = list.find(w => w.workplace_id === workplaceId);
    const current = workplace?.zone_names || [];
    const existingZone = zoneNames.find(z => z.toLowerCase() === name.toLowerCase());
    const finalName = existingZone || name;
    if (!existingZone) onAddLocationZone?.(name);
    if (!current.some(z => z.toLowerCase() === finalName.toLowerCase())) {
      updateWorkplace(workplaceId, { zone_names: [...current, finalName] });
    }
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
          const businessTypes = typesOf(workplace);
          const unselectedPropertyZones = zoneNames.filter(z => !selectedZones.some(s => s.toLowerCase() === z.toLowerCase()));
          const presetZones = presetZonesFor(businessTypes);

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
                      {businessTypes.length > 0
                        ? businessTypes.map(t => labelOf(t.type, subtypeLabels)).join(" · ")
                        : "No business type"}
                      {" · "}{employees.length} {employees.length === 1 ? "employee" : "employees"}
                      {selectedZones.length > 0 ? ` · ${selectedZones.length} ${selectedZones.length === 1 ? "zone" : "zones"}` : ""}
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

                  {/* This business's own description — already its own field, now also
                      generated from its own reference images. Separate from the property. */}
                  <SpaceDescriptionField
                    label="Description"
                    hint={`What is ${workplace.name?.trim() || "this business"} — separate from the property itself`}
                    value={workplace.description || ""}
                    onChange={(value) => updateWorkplace(workplace.workplace_id, { description: value })}
                    locationName={locationName ? `${workplace.name?.trim() || "This business"} — inside ${locationName}` : (workplace.name?.trim() || locationName)}
                    spaceLabel={workplace.name?.trim() || "this business"}
                    category={workplace.business_category || category}
                    subtype={workplace.business_type ? [workplace.business_type] : subtype}
                    imageUrls={(workplace.zone_images || []).map(i => i?.url).filter(Boolean)}
                  />

                  {/* Where this business physically is — independent of the property it
                      belongs to. An outdoor patio or yard stays connected to its property
                      while operating outdoors. */}
                  <PhysicalSettingToggle
                    value={workplace.physical_setting}
                    onChange={(value) => updateWorkplace(workplace.workplace_id, { physical_setting: value || "" })}
                    hint="Independent of the property: an outdoor patio, yard or stand stays connected to it."
                  />

                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Business Type{businessTypes.length > 1 ? "s" : ""}
                    </label>
                    {businessTypes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {businessTypes.map(t => (
                          <button
                            key={`${t.category}::${t.type}`}
                            onClick={() => toggleBusinessType(workplace.workplace_id, t.category, t.type)}
                            title="Remove this business type"
                            className="px-2 py-1 rounded-full text-[10px] border bg-primary/10 border-primary/40 text-primary flex items-center gap-1"
                          >
                            {labelOf(t.type, subtypeLabels)}
                            <X className="w-2.5 h-2.5" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic">No business type chosen yet.</p>
                    )}
                    <select
                      value=""
                      onChange={e => {
                        const value = e.target.value;
                        if (!value) return;
                        const [groupCategory, groupType] = value.split("::");
                        toggleBusinessType(workplace.workplace_id, groupCategory, groupType);
                        e.target.value = "";
                      }}
                      className="w-full text-xs px-2 py-1.5 bg-input border border-border rounded text-foreground capitalize"
                    >
                      <option value="">{businessTypes.length > 0 ? "Add another business type…" : "Choose a business type…"}</option>
                      {BUSINESS_CATEGORIES.map(group => {
                        const options = (subtypeOptions[group.category] || []).filter(type =>
                          !businessTypes.some(t => t.category === group.category && t.type === type));
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
                    <p className="text-[10px] text-muted-foreground/70">
                      A business can be more than one kind of establishment — a sneaker store that is
                      also a clothing store. Tap a chosen type to remove it; the others stay.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Rooms / Zones of this business</label>
                    {selectedZones.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground italic">
                        No rooms yet. Add this business's zones below — no need to go back to the property's section.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedZones.map(zoneName => (
                          <button
                            key={zoneName}
                            onClick={() => toggleZone(workplace.workplace_id, zoneName)}
                            title="Remove this zone from the business"
                            className="px-2 py-1 rounded-full text-[10px] border bg-primary/10 border-primary/40 text-primary flex items-center gap-1"
                          >
                            {zoneName}
                            <X className="w-2.5 h-2.5" />
                          </button>
                        ))}
                      </div>
                    )}

                    {unselectedPropertyZones.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Already on this property</p>
                        <div className="flex flex-wrap gap-1.5">
                          {unselectedPropertyZones.map(zoneName => (
                            <button
                              key={zoneName}
                              onClick={() => toggleZone(workplace.workplace_id, zoneName)}
                              className="px-2 py-1 rounded-full text-[10px] border bg-card border-border text-muted-foreground hover:border-primary/40"
                            >
                              + {zoneName}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {presetZones.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Typical for this kind of business</p>
                        <div className="flex flex-wrap gap-1.5">
                          {presetZones.map(zoneName => (
                            <button
                              key={zoneName}
                              onClick={() => addZoneToWorkplace(workplace.workplace_id, zoneName)}
                              className="px-2 py-1 rounded-full text-[10px] border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            >
                              + {zoneName}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={zoneDraft}
                        onChange={e => setZoneDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key !== "Enter") return;
                          addZoneToWorkplace(workplace.workplace_id, zoneDraft);
                          setZoneDraft("");
                        }}
                        placeholder="Custom zone — e.g. Sneaker Wall"
                        className="flex-1 h-7 px-2 rounded-lg bg-secondary border border-border text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <button
                        onClick={() => {
                          addZoneToWorkplace(workplace.workplace_id, zoneDraft);
                          setZoneDraft("");
                        }}
                        disabled={!zoneDraft.trim()}
                        className="px-2.5 h-7 rounded-lg bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-40"
                      >
                        Add zone
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70">
                      A zone added here becomes part of this property's own rooms, so Scenes and the
                      property's Rooms / Zones section see the same record.
                    </p>
                  </div>

                  <div className="rounded-lg bg-secondary/30 border border-border p-2.5">
                    <LocationHoursEditor
                      hours={workplace.operating_hours || []}
                      onChange={(nextHours) => updateWorkplace(workplace.workplace_id, { operating_hours: nextHours })}
                      label={`${workplace.name?.trim() || "This workplace"} hours`}
                    />
                    <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                      These hours belong to this business, not to the property. A day left
                      without hours is a closed day for this business.
                    </p>
                  </div>

                  <WorkplaceZoneImages
                    workplace={workplace}
                    locationZones={zones}
                    locationName={locationName}
                    category={category}
                    subtype={subtype}
                    locationDescription={locationDescription}
                    otherWorkplaces={workplaces.filter(w => w.workplace_id !== workplace.workplace_id)}
                    onAddImage={(zoneName, url) => onAddZoneImage?.(workplace.workplace_id, zoneName, url)}
                    onRemoveImage={(zoneName, url) => onRemoveZoneImage?.(workplace.workplace_id, zoneName, url)}
                  />

                  {/* Each room of this business may describe itself. A room left blank keeps
                      using the business's own description. */}
                  {(workplace.zone_names || []).length > 0 && (() => {
                    const open = roomsOpenId === workplace.workplace_id;
                    return (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setRoomsOpenId(open ? null : workplace.workplace_id)}
                          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                        >
                          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          Room descriptions (optional)
                        </button>
                        {open && (workplace.zone_names || []).map(zoneName => (
                          <SpaceDescriptionField
                            key={zoneName}
                            label={zoneName}
                            hint="Optional — leave blank to use this business's description"
                            value={roomDescription(workplace, zoneName)}
                            onChange={(value) => updateWorkplace(workplace.workplace_id, {
                              zone_descriptions: withRoomDescription(workplace, zoneName, value),
                            })}
                            locationName={`${zoneName} — ${workplace.name?.trim() || "this business"}`}
                            spaceLabel={`${zoneName} in ${workplace.name?.trim() || "this business"}`}
                            category={workplace.business_category || category}
                            subtype={workplace.business_type ? [workplace.business_type] : subtype}
                            imageUrls={spaceZoneImageUrls({ space: workplace, zoneName, zones })}
                          />
                        ))}
                      </div>
                    );
                  })()}

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
                      Tap an employee to set their shift, pay and position for this business. A shift is
                      when someone is expected to work; this business's hours decide when it is open.
                      Closing this business never closes the rest of the property.
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