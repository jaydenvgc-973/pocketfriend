import { useState } from "react";
import { Plus, X, Pencil, Trash2, UserPlus, ArrowRight } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

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
}) {
  const [newUnitName, setNewUnitName] = useState("");
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [assignMenuUnitId, setAssignMenuUnitId] = useState(null);

  const units = residentialUnits || [];

  // All character IDs already assigned to some apartment
  const assignedIds = new Set();
  units.forEach(u => (u.occupant_character_ids || []).forEach(id => assignedIds.add(id)));

  // Unassigned residents = building residents not in any apartment
  const unassignedIds = (residentCharacterIds || []).filter(id => !assignedIds.has(id));

  const resolveChar = (id) => allCharacters.find(c => c.id === id);

  const generateUnitId = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `unit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  };

  const handleAddUnit = () => {
    const name = newUnitName.trim();
    if (!name) return;
    const newUnit = {
      unit_id: generateUnitId(),
      unit_name: name,
      occupant_character_ids: [],
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
      <div>
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Apartments</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Organize building residents into individual apartments. Residents remain building residents regardless of apartment assignment.
        </p>
      </div>

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
                      <span className="text-[10px] text-muted-foreground">{occupants.length} {occupants.length === 1 ? "resident" : "residents"}</span>
                      <button
                        onClick={() => handleStartEdit(unit)}
                        title="Edit name"
                        className="p-1 text-muted-foreground hover:text-primary transition-colors rounded-lg"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDeleteUnit(unit.unit_id)}
                        title="Remove apartment (residents stay in building)"
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>

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
                          <span className="text-xs text-foreground flex-1">{char?.name || charId}</span>
                          {/* Move dropdown */}
                          {units.length > 1 && (
                            <select
                              value=""
                              onChange={e => {
                                if (e.target.value) handleMoveResident(unit.unit_id, charId, e.target.value);
                              }}
                              className="text-[10px] bg-transparent text-muted-foreground border-0 outline-none opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              title="Move to another apartment"
                            >
                              <option value="" disabled>Move to…</option>
                              {units.filter(u => u.unit_id !== unit.unit_id).map(u => (
                                <option key={u.unit_id} value={u.unit_id}>{u.unit_name}</option>
                              ))}
                            </select>
                          )}
                          <button
                            onClick={() => handleRemoveFromUnit(unit.unit_id, charId)}
                            title="Remove from apartment (stays in building)"
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
                              <span className="text-xs text-foreground">{char?.name || charId}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic py-1">No unassigned residents available.</p>
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
                    {available.length > 0 ? "Assign resident" : "No unassigned residents"}
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
          placeholder="e.g. Apartment 1, Unit 4B..."
          className="flex-1 h-8 px-2.5 rounded-lg bg-card border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={handleAddUnit}
          disabled={!newUnitName.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

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
                  <span className="text-[10px] text-muted-foreground">{char?.name || charId}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {units.length === 0 && unassignedIds.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic text-center py-1">
          Add residents to the building first, then create apartments to organize them.
        </p>
      )}
    </div>
  );
}