/**
 * ResidentialUnitManager — UI for creating, naming, and assigning residential units.
 *
 * Extends the existing residential location system with household management.
 * Allows the user to:
 * - View all building residents
 * - Create and name residential units (apartments, suites, etc.)
 * - Assign residents to units (forming households)
 * - Move residents between units
 * - Remove unit assignments without removing building residency
 * - See unassigned residents
 * - Optionally configure unit-specific rent/utilities
 *
 * Units reuse existing zone images from the parent location — no image duplication.
 * Unit-specific zone image overrides are optional and explicitly assigned.
 */

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Plus, X, Pencil, Trash2, Users, ChevronDown, ChevronUp, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import {
  getResidentialUnits,
  getUnassignedResidentIds,
  generateUnitId,
} from "@/lib/residentialUnitResolver";

export default function ResidentialUnitManager({
  location,
  characters = [],
  currentUserId = null,
  currentUserEmail = null,
  onChange,
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState(null);
  const [newUnitName, setNewUnitName] = useState("");
  const [showAddUnit, setShowAddUnit] = useState(false);

  if (!location) return null;

  const isResidentialCategory =
    location.category === 'home' || location.category === 'generic' ||
    location.category === 'hotel' || location.category === 'shelter';

  if (!isResidentialCategory) return null;

  const units = getResidentialUnits(location);
  const buildingResidentIds = location.resident_character_ids || [];
  const unassignedIds = getUnassignedResidentIds(location);

  const resolveName = (charId) => {
    if (charId === currentUserId) return currentUserEmail?.split('@')[0] || 'You';
    const char = characters.find(c => c.id === charId);
    return char?.name || 'Unknown';
  };

  const resolveAvatar = (charId) => {
    if (charId === currentUserId) return null;
    const char = characters.find(c => c.id === charId);
    return char;
  };

  const handleAddUnit = () => {
    const name = newUnitName.trim();
    if (!name) return;
    const newUnit = {
      unit_id: generateUnitId(),
      unit_name: name,
      occupant_character_ids: [],
      occupant_character_names: [],
    };
    const updatedUnits = [...units, newUnit];
    onChange?.({ residential_units: updatedUnits });
    setNewUnitName("");
    setShowAddUnit(false);
    setEditingUnitId(newUnit.unit_id);
  };

  const handleDeleteUnit = (unitId) => {
    const unit = units.find(u => u.unit_id === unitId);
    if (!unit) return;
    if (unit.occupant_character_ids?.length > 0) {
      if (!confirm(`"${unit.unit_name}" has ${unit.occupant_character_ids.length} occupant(s). They will become unassigned but remain building residents. Delete this unit?`)) return;
    } else {
      if (!confirm(`Delete "${unit.unit_name}"?`)) return;
    }
    const updatedUnits = units.filter(u => u.unit_id !== unitId);
    onChange?.({ residential_units: updatedUnits });
    if (editingUnitId === unitId) setEditingUnitId(null);
  };

  const handleRenameUnit = (unitId, newName) => {
    const updatedUnits = units.map(u =>
      u.unit_id === unitId ? { ...u, unit_name: newName } : u
    );
    onChange?.({ residential_units: updatedUnits });
  };

  const handleAssignResident = (unitId, charId) => {
    // Remove from any other unit first, then add to target
    const updatedUnits = units.map(u => {
      const occupants = u.occupant_character_ids || [];
      const names = u.occupant_character_names || [];
      if (u.unit_id === unitId) {
        if (occupants.includes(charId)) return u;
        return {
          ...u,
          occupant_character_ids: [...occupants, charId],
          occupant_character_names: [...names, resolveName(charId)],
        };
      }
      // Remove from other units
      if (occupants.includes(charId)) {
        const idx = occupants.indexOf(charId);
        return {
          ...u,
          occupant_character_ids: occupants.filter(id => id !== charId),
          occupant_character_names: names.filter((_, i) => i !== idx),
        };
      }
      return u;
    });
    onChange?.({ residential_units: updatedUnits });
  };

  const handleRemoveFromUnit = (unitId, charId) => {
    const updatedUnits = units.map(u => {
      if (u.unit_id !== unitId) return u;
      const occupants = u.occupant_character_ids || [];
      const names = u.occupant_character_names || [];
      const idx = occupants.indexOf(charId);
      return {
        ...u,
        occupant_character_ids: occupants.filter(id => id !== charId),
        occupant_character_names: names.filter((_, i) => i !== idx),
      };
    });
    onChange?.({ residential_units: updatedUnits });
  };

  const handleSetUnitRent = (unitId, rent) => {
    const updatedUnits = units.map(u =>
      u.unit_id === unitId ? { ...u, rent: rent || undefined } : u
    );
    onChange?.({ residential_units: updatedUnits });
  };

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 group"
      >
        <Home className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider flex-1 text-left">
          Residential Units & Households
        </span>
        {units.length > 0 && (
          <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full font-medium">
            {units.length} unit{units.length !== 1 ? 's' : ''}
          </span>
        )}
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-3"
          >
            {/* Info banner */}
            <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/15">
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Assign residents to distinct living units to form separate households.
                Residents sharing a unit are household members. Unassigned residents
                remain building residents without a household grouping.
                Units reuse existing zone images — no image duplication required.
              </p>
            </div>

            {/* Existing units */}
            {units.map(unit => {
              const occupants = unit.occupant_character_ids || [];
              const isEditing = editingUnitId === unit.unit_id;
              return (
                <div key={unit.unit_id} className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground flex-1">
                      {isEditing ? (
                        <Input
                          value={unit.unit_name}
                          onChange={e => handleRenameUnit(unit.unit_id, e.target.value)}
                          onBlur={() => setEditingUnitId(null)}
                          onKeyDown={e => e.key === 'Enter' && setEditingUnitId(null)}
                          className="h-7 text-sm"
                          autoFocus
                        />
                      ) : (
                        unit.unit_name
                      )}
                    </span>
                    <button
                      onClick={() => setEditingUnitId(isEditing ? null : unit.unit_id)}
                      className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDeleteUnit(unit.unit_id)}
                      className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Occupants */}
                  {occupants.length > 0 ? (
                    <div className="space-y-1">
                      {occupants.map(charId => {
                        const char = resolveAvatar(charId);
                        const name = resolveName(charId);
                        return (
                          <div key={charId} className="flex items-center gap-2 py-0.5 group/occ">
                            {char ? (
                              <CharacterAvatar character={char} size="sm" />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary flex-shrink-0">
                                {name[0]?.toUpperCase()}
                              </div>
                            )}
                            <span className="text-xs text-foreground flex-1">{name}</span>
                            <button
                              onClick={() => handleRemoveFromUnit(unit.unit_id, charId)}
                              className="opacity-0 group-hover/occ:opacity-100 p-0.5 text-muted-foreground hover:text-destructive rounded transition-all"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground italic">No occupants assigned</p>
                  )}

                  {/* Add occupant dropdown */}
                  <AddOccupantDropdown
                    unitId={unit.unit_id}
                    buildingResidentIds={buildingResidentIds}
                    assignedIds={getAllAssignedIds(units, unit.unit_id)}
                    onAssign={handleAssignResident}
                    resolveName={resolveName}
                    resolveAvatar={resolveAvatar}
                  />

                  {/* Optional rent */}
                  <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
                    <DollarSign className="w-3 h-3 text-muted-foreground" />
                    <Input
                      type="number"
                      placeholder="Unit rent (optional)"
                      value={unit.rent || ''}
                      onChange={e => handleSetUnitRent(unit.unit_id, parseFloat(e.target.value) || undefined)}
                      className="h-7 text-xs flex-1"
                    />
                    <span className="text-[10px] text-muted-foreground">/mo</span>
                  </div>
                </div>
              );
            })}

            {/* Add new unit */}
            {showAddUnit ? (
              <div className="flex gap-2">
                <Input
                  value={newUnitName}
                  onChange={e => setNewUnitName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddUnit()}
                  placeholder="e.g. Apartment 1, Unit 4B, Suite 210"
                  className="h-9 text-sm"
                  autoFocus
                />
                <Button size="sm" onClick={handleAddUnit} disabled={!newUnitName.trim()} className="rounded-xl px-3">
                  Add
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowAddUnit(false); setNewUnitName(""); }} className="rounded-xl px-3">
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddUnit(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Residential Unit
              </button>
            )}

            {/* Unassigned residents */}
            {unassignedIds.length > 0 && (
              <div className="rounded-xl border border-dashed border-border bg-card p-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Unassigned Residents
                </p>
                <p className="text-[10px] text-muted-foreground/60 mb-1">
                  Building residents not yet assigned to a specific unit
                </p>
                {unassignedIds.map(charId => {
                  const char = resolveAvatar(charId);
                  const name = resolveName(charId);
                  return (
                    <div key={charId} className="flex items-center gap-2 py-0.5">
                      {char ? (
                        <CharacterAvatar character={char} size="sm" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-muted-foreground/20 flex items-center justify-center text-[8px] font-bold text-muted-foreground flex-shrink-0">
                          {name[0]?.toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs text-muted-foreground">{name}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {units.length === 0 && !showAddUnit && (
              <div className="text-center py-3">
                <Users className="w-6 h-6 text-muted-foreground/30 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">
                  No residential units configured. All residents are treated as building residents.
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Add units to separate households within this location.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Helper: get all character IDs assigned to any unit, optionally excluding one unit.
 */
function getAllAssignedIds(units, excludeUnitId = null) {
  const ids = new Set();
  units.forEach(u => {
    if (u.unit_id === excludeUnitId) return;
    (u.occupant_character_ids || []).forEach(id => ids.add(id));
  });
  return ids;
}

/**
 * Dropdown for assigning a building resident to a unit.
 */
function AddOccupantDropdown({ unitId, buildingResidentIds, assignedIds, onAssign, resolveName, resolveAvatar }) {
  const [open, setOpen] = useState(false);
  const available = buildingResidentIds.filter(id => !assignedIds.has(id));

  if (available.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-center gap-1 py-1 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-[10px]"
      >
        <Plus className="w-3 h-3" />
        Assign resident
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute z-[101] left-0 right-0 mt-1 rounded-xl border border-border bg-card shadow-xl max-h-48 overflow-y-auto"
            >
              {available.map(charId => {
                const char = resolveAvatar(charId);
                const name = resolveName(charId);
                return (
                  <button
                    key={charId}
                    onClick={() => { onAssign(unitId, charId); setOpen(false); }}
                    className="w-full flex items-center gap-2 p-2 hover:bg-secondary transition-colors text-left"
                  >
                    {char ? (
                      <CharacterAvatar character={char} size="sm" />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary flex-shrink-0">
                        {name[0]?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-xs text-foreground">{name}</span>
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}