import { useState } from "react";
import { Plus, X, Pencil, Trash2, UserPlus, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import PhysicalSettingToggle from "@/components/location/PhysicalSettingToggle";
import ResidenceSpacesEditor from "@/components/location/ResidenceSpacesEditor";
import SpaceDescriptionField from "@/components/location/SpaceDescriptionField";
import { roomDescription, spaceImageUrls, spaceZoneImageUrls, withRoomDescription } from "@/lib/spaceDescription";

const UNKNOWN_NAME = "Unknown resident";

/**
 * ApartmentManager — manages apartments within a Building venue type.
 *
 * Works with the EXISTING resident_character_ids from the form. Does not create
 * or delete characters. Only organizes existing building residents into
 * named apartments via the residential_units array.
 *
 * Props:
 *   residentialUnits: array of { unit_id, unit_name, occupant_character_ids }
 *   residentCharacterIds: array of character IDs (the building's residents)
 *   allCharacters: array of character records for name/avatar resolution
 *   onChange: (updatedUnits) => void
 */
export default function ApartmentManager({
  residentialUnits = [],
  residentCharacterIds = [],
  allCharacters = [],
  onChange,
  sectionLabel = "Apartments",
  unitSingular = "apartment",
  contextNoun = "building",
  occupantNoun = "resident",
  addPlaceholder = "e.g. Apartment 1, Unit 4B...",
  emptyHint = "Add residents to the building first, then create apartments to organize them.",
  maxUnits = 0,
  nameById = {},
  // The property's own zones, the spaces its venue types suggest, and the handlers that
  // create a space or store a space's picture on the property. A residence keeps every
  // space chosen for it — it is never limited to a single one.
  zones = [],
  suggestedZones = [],
  lockedZoneNames = [],
  onAddZone = null,
  onAddPropertyZoneImage = null,
  onRemovePropertyZoneImage = null,
  category = "",
  subtype = [],
  locationName = "",
  locationDescription = "",
  // When the editor draws this section's heading itself (so it can expand and collapse),
  // the card shows only its contents.
  showHeader = true,
  // Written onto every space created here, so a living space keeps the kind of arrangement
  // it was created as and its physical setting without the user setting either by hand.
  newUnitDefaults = {},
  // When set, this kind of living space always has that physical setting: the toggle is
  // replaced by the fixed value, and the parent location's own setting is untouched.
  forcePhysicalSetting = "",
  typeOptions = null,
}) {
  const [newUnitName, setNewUnitName] = useState("");
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [assignMenuUnitId, setAssignMenuUnitId] = useState(null);
  // Which residence's optional room descriptions are open. Purely a display choice.
  const [roomsOpenUnitId, setRoomsOpenUnitId] = useState(null);

  const units = residentialUnits || [];

  // All character IDs already assigned to some apartment
  const assignedIds = new Set();
  units.forEach(u => (u.occupant_character_ids || []).forEach(id => assignedIds.add(id)));

  // Unassigned residents = building residents not in any apartment
  const unassignedIds = (residentCharacterIds || []).filter(id => !assignedIds.has(id));

  const resolveChar = (id) => allCharacters.find(c => c.id === id);
  const resolveName = (id) => resolveChar(id)?.name || nameById[id] || UNKNOWN_NAME;

  const generateUnitId = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `unit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  };

  // Administrator-set apartment limit (0 = no limit)
  const unitLimitReached = maxUnits > 0 && units.length >= maxUnits;

  const handleAddUnit = () => {
    const name = newUnitName.trim();
    if (!name || unitLimitReached) return;
    const newUnit = {
      unit_id: generateUnitId(),
      unit_name: name,
      occupant_character_ids: [],
      zone_name: "",
      zone_names: [],
      zone_images: [],
      residence_type: "",
      physical_setting: forcePhysicalSetting || "",
      ...newUnitDefaults,
    };
    onChange([...units, newUnit]);
    setNewUnitName("");
  };

  const handleDeleteUnit = (unitId) => {
    // Removing an apartment does NOT delete its residents — they become unassigned.
    onChange(units.filter(u => u.unit_id !== unitId));
  };

  const handleStartEdit = (unit) => {
    setEditingUnitId(unit.unit_id);
    setEditNameValue(unit.unit_name);
  };

  const handleSaveEdit = (unitId) => {
    const name = editNameValue.trim();
    if (!name) return;
    onChange(units.map(u => u.unit_id === unitId ? { ...u, unit_name: name } : u));
    setEditingUnitId(null);
    setEditNameValue("");
  };

  // A dorm room and an apartment are different residential spaces, each with its own set
  // of rooms and its own reference images. zone_name stays the first chosen space so every
  // existing reader of a residence keeps working unchanged.
  const handleSetUnitZones = (unitId, names) => {
    onChange(units.map(u => u.unit_id === unitId
      ? { ...u, zone_names: names, zone_name: names[0] || "" }
      : u));
  };

  const handleSetUnitZoneImages = (unitId, images) => {
    onChange(units.map(u => u.unit_id === unitId ? { ...u, zone_images: images } : u));
  };

  const handleSetUnitType = (unitId, value) => {
    onChange(units.map(u => u.unit_id === unitId ? { ...u, residence_type: value } : u));
  };

  // This residence's own optional description, and each of its rooms' own. Both stay on
  // this exact unit: nothing here writes to another residence or to the property.
  const handleSetUnitDescription = (unitId, value) => {
    onChange(units.map(u => u.unit_id === unitId ? { ...u, description: value } : u));
  };

  const handleSetUnitRoomDescription = (unitId, zoneName, value) => {
    onChange(units.map(u => u.unit_id === unitId
      ? { ...u, zone_descriptions: withRoomDescription(u, zoneName, value) }
      : u));
  };

  // Where this residence physically is — independent of the property it belongs to.
  const handleSetUnitPhysicalSetting = (unitId, value) => {
    onChange(units.map(u => u.unit_id === unitId ? { ...u, physical_setting: value } : u));
  };

  const handleAssignResident = (unitId, charId) => {
    // Remove from any other unit first (a resident can only be in one apartment)
    const updated = units.map(u => {
      if (u.unit_id === unitId) {
        return { ...u, occupant_character_ids: [...(u.occupant_character_ids || []), charId] };
      }
      // Remove from any other unit that might have this resident
      if ((u.occupant_character_ids || []).includes(charId)) {
        return { ...u, occupant_character_ids: (u.occupant_character_ids || []).filter(id => id !== charId) };
      }
      return u;
    });
    onChange(updated);
    setAssignMenuUnitId(null);
  };

  const handleRemoveFromUnit = (unitId, charId) => {
    // Removing from apartment = back to unassigned. Resident stays in the building.
    const updated = units.map(u =>
      u.unit_id === unitId
        ? { ...u, occupant_character_ids: (u.occupant_character_ids || []).filter(id => id !== charId) }
        : u
    );
    onChange(updated);
  };

  const handleMoveResident = (fromUnitId, charId, toUnitId) => {
    const updated = units.map(u => {
      if (u.unit_id === fromUnitId) {
        return { ...u, occupant_character_ids: (u.occupant_character_ids || []).filter(id => id !== charId) };
      }
      if (u.unit_id === toUnitId) {
        return { ...u, occupant_character_ids: [...(u.occupant_character_ids || []), charId] };
      }
      return u;
    });
    onChange(updated);
  };

  // Available residents for assignment = unassigned + not already in this unit
  const getAvailableForUnit = (unitId) => {
    const unit = units.find(u => u.unit_id === unitId);
    const inThisUnit = new Set(unit?.occupant_character_ids || []);
    return unassignedIds.filter(id => !inThisUnit.has(id));
  };

  return (
    <div className="space-y-3 p-3 rounded-xl bg-secondary/30 border border-border">
      {showHeader && (
        <div>
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">{sectionLabel}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Organize {contextNoun} residents into individual {unitSingular}s. Residents remain {contextNoun} residents regardless of {unitSingular} assignment.
          </p>
        </div>
      )}

      {/* Existing apartments */}
      {units.length > 0 && (
        <div className="space-y-2">
          {units.map(unit => {
            const occupants = unit.occupant_character_ids || [];
            const isEditing = editingUnitId === unit.unit_id;
            const showAssignMenu = assignMenuUnitId === unit.unit_id;
            const available = getAvailableForUnit(unit.unit_id);

            return (
              <div key={unit.unit_id} className="rounded-lg bg-card border border-border p-2.5 space-y-2">
                {/* Unit header */}
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={e => setEditNameValue(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSaveEdit(unit.unit_id)}
                        autoFocus
                        className="flex-1 h-7 px-2 rounded-lg bg-secondary border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <button
                        onClick={() => handleSaveEdit(unit.unit_id)}
                        className="text-xs px-2 py-1 rounded-lg bg-primary text-primary-foreground"
                      >
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-medium text-foreground flex-1">{unit.unit_name}</span>
                      <span className="text-[10px] text-muted-foreground">{occupants.length} {occupants.length === 1 ? occupantNoun : `${occupantNoun}s`}</span>
                      <button
                        onClick={() => handleStartEdit(unit)}
                        title="Edit name"
                        className="p-1 text-muted-foreground hover:text-primary transition-colors rounded-lg"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDeleteUnit(unit.unit_id)}
                        title={`Remove ${unitSingular} (residents stay in ${contextNoun})`}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>

                {/* What kind of residence this is — chosen by the user, never assumed
                    from the residence name. */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">Type</span>
                  <select
                    value={unit.residence_type || ""}
                    onChange={e => handleSetUnitType(unit.unit_id, e.target.value)}
                    className="flex-1 h-6 px-1.5 rounded-lg bg-secondary border border-border text-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="">Not designated</option>
                    {(typeOptions || ["Apartment", "House", "Studio", "Condo", "Dorm room", "Room", "Suite", "Sleeping area", "Encampment", "Other"]).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                {/* What THIS residence actually looks like. Optional: blank is normal, and
                    the property's own description then applies to it. */}
                <SpaceDescriptionField
                  label="Description (optional)"
                  hint={`What ${unit.unit_name || `this ${unitSingular}`} actually looks like — furnishings, condition, atmosphere`}
                  value={unit.description || ""}
                  onChange={(value) => handleSetUnitDescription(unit.unit_id, value)}
                  locationName={locationName ? `${unit.unit_name || unitSingular} — inside ${locationName}` : (unit.unit_name || locationName)}
                  spaceLabel={unit.unit_name || unitSingular}
                  category={category}
                  subtype={subtype}
                  imageUrls={spaceImageUrls({ space: unit, zones })}
                />

                {/* Every space of THIS residence, with its own pictures. A residence is
                    never limited to a single zone, and two residences that both have a
                    Living Room keep their own. */}
                <ResidenceSpacesEditor
                  residenceLabel={unit.unit_name || unitSingular}
                  zoneNames={unit.zone_names || (unit.zone_name ? [unit.zone_name] : [])}
                  onChangeZoneNames={(names) => handleSetUnitZones(unit.unit_id, names)}
                  zoneImages={unit.zone_images || []}
                  onChangeZoneImages={(images) => handleSetUnitZoneImages(unit.unit_id, images)}
                  propertyZones={zones}
                  suggestedZones={suggestedZones}
                  lockedZoneNames={lockedZoneNames}
                  otherResidences={units.filter(u => u.unit_id !== unit.unit_id)}
                  locationName={locationName}
                  category={category}
                  subtype={subtype}
                  locationDescription={locationDescription}
                  onAddPropertyZone={onAddZone}
                  onAddPropertyZoneImage={onAddPropertyZoneImage}
                  onRemovePropertyZoneImage={onRemovePropertyZoneImage}
                  unit={unit}
                />

                {/* Each room of this residence may describe itself. A room left blank keeps
                    using the residence's description. */}
                {(() => {
                  const roomNames = unit.zone_names || (unit.zone_name ? [unit.zone_name] : []);
                  if (roomNames.length === 0) return null;
                  const open = roomsOpenUnitId === unit.unit_id;
                  return (
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => setRoomsOpenUnitId(open ? null : unit.unit_id)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                      >
                        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        Room descriptions (optional)
                      </button>
                      {open && roomNames.map(zoneName => (
                        <SpaceDescriptionField
                          key={zoneName}
                          label={zoneName}
                          hint="Optional — leave blank to use this residence's description"
                          value={roomDescription(unit, zoneName)}
                          onChange={(value) => handleSetUnitRoomDescription(unit.unit_id, zoneName, value)}
                          locationName={`${zoneName} — ${unit.unit_name || unitSingular}`}
                          spaceLabel={`${zoneName} in ${unit.unit_name || unitSingular}`}
                          category={category}
                          subtype={subtype}
                          imageUrls={spaceZoneImageUrls({ space: unit, zoneName, zones })}
                        />
                      ))}
                    </div>
                  );
                })()}

                {forcePhysicalSetting ? (
                  <p className="text-[10px] text-muted-foreground">
                    Outdoors — automatically set for this living space. The property's own physical setting is unchanged.
                  </p>
                ) : (
                  <PhysicalSettingToggle
                    value={unit.physical_setting}
                    onChange={(value) => handleSetUnitPhysicalSetting(unit.unit_id, value || "")}
                  />
                )}

                {/* Occupants */}
                {occupants.length > 0 && (
                  <div className="space-y-1">
                    {occupants.map(charId => {
                      const char = resolveChar(charId);
                      return (
                        <div key={charId} className="flex items-center gap-2 py-0.5 group">
                          {char ? <CharacterAvatar character={char} size="sm" /> : (
                            <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold text-muted-foreground flex-shrink-0">
                              ?
                            </div>
                          )}
                          <span className="text-xs text-foreground flex-1">{resolveName(charId)}</span>
                          {/* Move dropdown */}
                          {units.length > 1 && (
                            <select
                              value=""
                              onChange={e => {
                                if (e.target.value) handleMoveResident(unit.unit_id, charId, e.target.value);
                              }}
                              className="text-[10px] bg-transparent text-muted-foreground border-0 outline-none opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              title={`Move to another ${unitSingular}`}
                            >
                              <option value="" disabled>Move to…</option>
                              {units.filter(u => u.unit_id !== unit.unit_id).map(u => (
                                <option key={u.unit_id} value={u.unit_id}>{u.unit_name}</option>
                              ))}
                            </select>
                          )}
                          <button
                            onClick={() => handleRemoveFromUnit(unit.unit_id, charId)}
                            title={`Remove from ${unitSingular} (stays in ${contextNoun})`}
                            className="p-0.5 text-muted-foreground hover:text-destructive transition-colors rounded-lg opacity-0 group-hover:opacity-100"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Assign resident menu */}
                {showAssignMenu && (
                  <div className="space-y-1 pt-1 border-t border-border">
                    {available.length > 0 ? (
                      <div className="max-h-32 overflow-y-auto space-y-0.5">
                        {available.map(charId => {
                          const char = resolveChar(charId);
                          return (
                            <button
                              key={charId}
                              onClick={() => handleAssignResident(unit.unit_id, charId)}
                              className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-secondary text-left transition-colors"
                            >
                              {char ? <CharacterAvatar character={char} size="sm" /> : (
                                <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[8px] font-bold text-muted-foreground flex-shrink-0">?</div>
                              )}
                              <span className="text-xs text-foreground">{resolveName(charId)}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic py-1">No unassigned {occupantNoun}s available.</p>
                    )}
                    <button
                      onClick={() => setAssignMenuUnitId(null)}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Add resident button */}
                {!showAssignMenu && (
                  <button
                    onClick={() => setAssignMenuUnitId(unit.unit_id)}
                    disabled={available.length === 0}
                    className="w-full flex items-center gap-1.5 py-1 rounded-lg text-[10px] text-muted-foreground hover:text-primary border border-dashed border-border hover:border-primary/30 transition-colors disabled:opacity-40 disabled:cursor-default"
                  >
                    <UserPlus className="w-3 h-3" />
                    {available.length > 0 ? `Assign ${occupantNoun}` : `No unassigned ${occupantNoun}s`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add new apartment */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newUnitName}
          onChange={e => setNewUnitName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAddUnit()}
          placeholder={unitLimitReached ? "Apartment limit reached" : addPlaceholder}
          disabled={unitLimitReached}
          className="flex-1 h-8 px-2.5 rounded-lg bg-card border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
        />
        <button
          onClick={handleAddUnit}
          disabled={!newUnitName.trim() || unitLimitReached}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {unitLimitReached && (
        <p className="text-[10px] text-amber-400/80">
          All {maxUnits} {unitSingular}s at this residence are in use. Raise the limit in Settings to add more.
        </p>
      )}

      {/* Unassigned residents summary */}
      {unassignedIds.length > 0 && (
        <div className="pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            Unassigned ({unassignedIds.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unassignedIds.map(charId => {
              const char = resolveChar(charId);
              return (
                <div key={charId} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-secondary/60 border border-border">
                  {char?.avatar_url && <img src={char.avatar_url} alt={char.name} className="w-3.5 h-3.5 rounded-full object-cover" />}
                  <span className="text-[10px] text-muted-foreground">{resolveName(charId)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {units.length === 0 && unassignedIds.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic text-center py-1">
          {emptyHint}
        </p>
      )}
    </div>
  );
}