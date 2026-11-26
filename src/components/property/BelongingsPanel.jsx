import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Car, PawPrint } from "lucide-react";
import CarBelongingsEditor from "@/components/property/CarBelongingsEditor";
import PetBelongingsEditor from "@/components/property/PetBelongingsEditor";
import { emptyCar, emptyPet, loadBelongings, saveBelongings } from "@/lib/ownerBelongings";

/**
 * BelongingsPanel — the Property / Belongings section of a profile.
 *
 * One owner, one record: the account holder's own belongings or one character's. Two
 * choices, Car and Pet, each edited in place and saved against that owner's id. Nothing is
 * ever assigned automatically — an owner who has not added a car has no car.
 */
export default function BelongingsPanel({ ownerType, ownerId, ownerEmail, ownerName, isUser = false }) {
  const queryClient = useQueryClient();
  const [record, setRecord] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [choice, setChoice] = useState(null); // "car" | "pet" | null
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!ownerEmail || !ownerId) { setLoaded(true); return () => { cancelled = true; }; }
    loadBelongings(ownerEmail, ownerType, ownerId)
      .then((rec) => { if (!cancelled) { setRecord(rec); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [ownerEmail, ownerType, ownerId]);

  const persist = async (patch) => {
    setSaving(true);
    try {
      const saved = await saveBelongings({ existing: record, ownerType, ownerId, ownerEmail, ownerName, patch });
      setRecord(saved);
      queryClient.invalidateQueries({ queryKey: ["ownerBelongings"] });
    } finally {
      setSaving(false);
    }
  };

  const saveCar = (car) => persist({ car: car || {} });
  const savePet = (pet) => persist({ pet: pet || {} });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        What {isUser ? "you own" : "they own"}. A car here is the vehicle used when {isUser ? "you take" : "they take"} a ride; a pet here is the animal walked at the park and sometimes seen at home.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setChoice(choice === "car" ? null : "car")}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-medium transition-colors ${choice === "car" ? "bg-primary/10 border-primary/50 text-primary" : "bg-secondary border-border text-foreground hover:border-primary/40"}`}
        >
          <Car className="w-3.5 h-3.5" /> Car
        </button>
        <button
          onClick={() => setChoice(choice === "pet" ? null : "pet")}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-medium transition-colors ${choice === "pet" ? "bg-primary/10 border-primary/50 text-primary" : "bg-secondary border-border text-foreground hover:border-primary/40"}`}
        >
          <PawPrint className="w-3.5 h-3.5" /> Pet
        </button>
      </div>

      {!loaded ? (
        <p className="text-[10px] text-muted-foreground">Loading…</p>
      ) : (
        <>
          {choice === "car" && <CarBelongingsEditor car={record?.car} onChange={saveCar} />}
          {choice === "pet" && <PetBelongingsEditor pet={record?.pet} onChange={savePet} />}
          {!choice && (
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <p>Car: {record?.car?.label ? record.car.label : "not added"}</p>
              <p>Pet: {record?.pet?.name || record?.pet?.pet_type ? `${record.pet.name || ""} ${record.pet.pet_type_custom || record.pet.pet_type || ""}`.trim() : "not added"}</p>
            </div>
          )}
        </>
      )}

      {saving && <p className="text-[10px] text-muted-foreground">Saving…</p>}
    </div>
  );
}