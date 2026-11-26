import React from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Car } from "lucide-react";
import { carLabel, hasCar } from "@/lib/ownerBelongings";

/**
 * RideVehiclePicker — "Whose ride is it?"
 *
 * Only the people actually in this scene, plus the account holder when they are present.
 * Each row shows whether that owner has a car on their own profile — nothing is assumed and
 * the first person in the scene is never used as a default.
 */
export default function RideVehiclePicker({ open, userPresent = true, currentUser, displayName, participants = [], belongings = [], onSelect, onClose }) {
  if (!open) return null;

  const carFor = (ownerType, ownerId) => belongings.find((r) => r.owner_type === ownerType && r.owner_id === ownerId)?.car || null;

  const rows = [
    ...(userPresent ? [{ type: "user", id: currentUser?.id || "user", name: displayName || "You", avatar_url: currentUser?.avatar_url }] : []),
    ...participants.map((p) => ({ type: "character", id: p.id, name: p.name, avatar_url: p.avatar_url })),
  ];

  return createPortal(
    <div className="fixed inset-0 z-[196] flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-card border border-border p-4 space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Take a Ride</p>
            <h3 className="text-sm font-bold text-foreground">Whose ride is it?</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground">Only people in this scene. The car comes from that owner's own profile.</p>

        <div className="rounded-xl border border-border divide-y divide-border">
          {rows.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-muted-foreground">Nobody is here to drive.</p>
          ) : rows.map((row) => {
            const car = carFor(row.type, row.id);
            const ok = hasCar(car);
            return (
              <button key={`${row.type}_${row.id}`} onClick={() => onSelect(row)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary transition-colors">
                <div className="w-7 h-7 rounded-full bg-secondary overflow-hidden flex-shrink-0">
                  {row.avatar_url ? <img src={row.avatar_url} alt={row.name} className="w-full h-full object-cover" /> : <span className="text-[10px] font-bold text-foreground flex items-center justify-center h-full">{row.name?.[0]}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground truncate">{row.name}</p>
                  <p className={`text-[10px] truncate ${ok ? "text-muted-foreground" : "text-amber-500"}`}>{ok ? carLabel(car) : "No car on their profile"}</p>
                </div>
                <Car className={`w-3.5 h-3.5 flex-shrink-0 ${ok ? "text-primary" : "text-muted-foreground/40"}`} />
              </button>
            );
          })}
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed">A car is added in the owner's profile under Property / Belongings. Cancelling leaves the scene exactly as it is.</p>
      </motion.div>
    </div>,
    document.body
  );
}