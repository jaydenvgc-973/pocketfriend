import React, { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Building, AlertCircle, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { describeCharacterResidence } from "@/lib/residenceDisplay";

/**
 * GatewayResidencyModal — the ONE thing a non-owner may do at the shared
 * residence: place their own characters in an existing apartment.
 *
 * The property itself (name, zones, images, costs, apartment structure, limits)
 * stays with the administrator. Units are only ever chosen from the existing
 * list; nothing structural is created, renamed or removed from here.
 */
export default function GatewayResidencyModal({ location, occupancy, characters = [], locations = [], onClose, onChanged }) {
  const units = occupancy?.units || [];
  const residents = occupancy?.residents || [];
  const maxResidents = Number(occupancy?.max_residents) || 0;
  const residentCount = Number(occupancy?.resident_count) || residents.length;
  const openSlots = maxResidents > 0 ? Math.max(0, maxResidents - residentCount) : null;

  const [selectedIds, setSelectedIds] = useState([]);
  const [unitId, setUnitId] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  const toggle = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setErrors([]);
  };

  const handleAssign = async () => {
    if (selectedIds.length === 0) return;
    setSaving(true);
    setErrors([]);
    try {
      // Existing established pathway for moving a character into a home —
      // it writes the shared resident list with service role, records the
      // move, and enforces the administrator's capacity.
      const res = await base44.functions.invoke("moveCharactersToNewHome", {
        sourceHomeId: null,
        destinationHomeId: location.id,
        moversToMove: selectedIds,
        npcMovers: [],
        destinationUnitId: unitId || null,
      });
      const failures = (res?.data?.per_character_results || []).filter(r => r.status === 'failed');
      if (failures.length > 0) {
        setErrors(failures.map(f => f.error).filter(Boolean));
        setSaving(false);
        return;
      }
      onChanged?.();
      onClose();
    } catch (err) {
      setErrors([err?.message || "That move could not be completed."]);
      setSaving(false);
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-purple-950/95 border border-purple-500/40 rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[88vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-purple-300" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">{location?.name}</h3>
              <p className="text-[10px] text-purple-300/80 uppercase tracking-wider">Shared residence · move in</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
          <p className="text-xs text-foreground">
            Choose an apartment and the characters moving in. The property itself is managed by the
            administrator — only residency is yours to set.
          </p>
          {maxResidents > 0 && (
            <p className="text-[10px] text-purple-300/80 mt-1">
              {residentCount} of {maxResidents} resident openings filled
              {openSlots === 0 ? " · full" : ""}
            </p>
          )}
        </div>

        {/* Apartments (existing only) */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Apartment</p>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg bg-secondary/70 border border-border text-sm text-foreground outline-none focus:border-purple-400/60"
          >
            <option value="">No specific apartment</option>
            {units.map(unit => (
              <option key={unit.unit_id} value={unit.unit_id}>
                {unit.unit_name}{(unit.occupants || []).length ? ` · ${unit.occupants.length} resident${unit.occupants.length === 1 ? "" : "s"}` : " · empty"}
              </option>
            ))}
          </select>
          {units.length === 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">No apartments have been set up yet.</p>
          )}
        </div>

        {/* Your characters */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Your characters ({selectedIds.length} selected)
          </p>
          {characters.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">You have no characters to place.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {characters.map(char => {
                const isSelected = selectedIds.includes(char.id);
                const residence = describeCharacterResidence(char, locations, location?.id);
                return (
                  <button
                    key={char.id}
                    onClick={() => toggle(char.id)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border-2 transition-all text-left ${
                      isSelected ? "bg-purple-500/15 border-purple-400/70" : "bg-secondary/50 border-border"
                    }`}
                  >
                    <CharacterAvatar character={char} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{char.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {residence.label}
                      </p>
                    </div>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      isSelected ? "bg-purple-400 border-purple-400" : "border-border"
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-purple-950" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 flex gap-2">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-destructive">{errors.join(" ")}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-lg" disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={saving || selectedIds.length === 0}
            className="flex-1 rounded-lg bg-purple-500 hover:bg-purple-400 text-white"
          >
            {saving ? "Moving in…" : `Move in (${selectedIds.length})`}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}