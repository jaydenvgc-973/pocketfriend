import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GovernmentModalShell from "./GovernmentModalShell";

/**
 * MarriageConfirmationModal — the one place a marriage becomes official.
 *
 * It records the marriage through commitMarriage, which writes the existing
 * relationship data (fictional_relationships, family_members, CharacterRelationship).
 * There is no separate marriage record and no household change: moving in together
 * stays with the existing move-in flow.
 *
 * Used after a ceremony that actually took place (Scenes), or after a Story Event
 * that establishes a completed marriage. Nothing here is applied until the user
 * confirms, and cancelling changes no record.
 */
export default function MarriageConfirmationModal({
  open,
  characters = [],
  initialSpouseIds = [],
  initialWitnessIds = [],
  locationName = null,
  ceremonyType = null,
  onClose,
  onConfirmed,
}) {
  const [spouseA, setSpouseA] = useState("");
  const [spouseB, setSpouseB] = useState("");
  const [witnessIds, setWitnessIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSpouseA(initialSpouseIds?.[0] || "");
    setSpouseB(initialSpouseIds?.[1] || "");
    setWitnessIds(Array.isArray(initialWitnessIds) ? initialWitnessIds : []);
    setError(null);
    setSaving(false);
  }, [open, initialSpouseIds.join(","), initialWitnessIds.join(",")]);

  const eligible = useMemo(
    () => (characters || []).filter((c) =>
      c?.id && !c.isNpc && !String(c.id).startsWith("npc_")
      && !["deleted", "soft_deleted", "merged", "deceased"].includes(c.status)
      && c.life_status !== "deceased"
    ),
    [characters]
  );

  const nameOf = (id) => eligible.find((c) => c.id === id)?.name || null;
  const ready = spouseA && spouseB && spouseA !== spouseB;

  const toggleWitness = (id) => {
    if (id === spouseA || id === spouseB) return;
    setWitnessIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const confirm = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("commitMarriage", {
        spouse_a_id: spouseA,
        spouse_b_id: spouseB,
        witness_ids: witnessIds,
        location_id: null,
        location_name: locationName || "City Hall",
        ceremony_type: ceremonyType || "civil",
      });
      if (res?.data?.error) throw new Error(res.data.error);
      onConfirmed?.(res.data);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "The marriage could not be recorded.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <GovernmentModalShell
      open={open}
      onClose={saving ? () => {} : onClose}
      title="Confirm the marriage"
      subtitle="This records the marriage in both characters' existing relationships. It does not move anyone's home."
      footer={
        <div className="space-y-2">
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <Button onClick={confirm} disabled={!ready || saving} className="w-full rounded-xl">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Recording…</> : "Confirm marriage"}
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">First person getting married</label>
        <select
          value={spouseA}
          onChange={(e) => setSpouseA(e.target.value)}
          className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground"
        >
          <option value="">Select a character…</option>
          {eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Second person getting married</label>
        <select
          value={spouseB}
          onChange={(e) => setSpouseB(e.target.value)}
          className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground"
        >
          <option value="">Select a character…</option>
          {eligible.filter((c) => c.id !== spouseA).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {spouseA && spouseB && spouseA === spouseB && (
          <p className="text-[11px] text-destructive">Choose two different people.</p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Witnesses (optional)</label>
        <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {eligible.filter((c) => c.id !== spouseA && c.id !== spouseB).length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No one else available to witness.</p>
          ) : eligible.filter((c) => c.id !== spouseA && c.id !== spouseB).map((c) => (
            <button
              key={c.id}
              onClick={() => toggleWitness(c.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${witnessIds.includes(c.id) ? "bg-primary/10" : "hover:bg-secondary"}`}
            >
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${witnessIds.includes(c.id) ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                {witnessIds.includes(c.id) ? "✓" : ""}
              </span>
              <span className="text-xs text-foreground">{c.name}</span>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">A witness may attend and remember the ceremony. None is required.</p>
      </div>

      {ready && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {nameOf(spouseA)} and {nameOf(spouseB)} will be recorded as married{witnessIds.length > 0 ? `, witnessed by ${witnessIds.map(nameOf).filter(Boolean).join(", ")}` : ""}.
        </p>
      )}
    </GovernmentModalShell>
  );
}