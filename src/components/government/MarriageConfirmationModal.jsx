import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GovernmentModalShell from "./GovernmentModalShell";
import GovernmentCharacterPicker from "./GovernmentCharacterPicker";
import {
  resolveGovernmentCrossAccountCharacters,
  isOwnAccountCharacter,
} from "@/lib/governmentCrossAccountCharacters";

/**
 * MarriageConfirmationModal — the one place a marriage becomes official.
 *
 * It records the marriage through commitMarriage, which writes the existing
 * relationship data (fictional_relationships, family_members, CharacterRelationship).
 * There is no separate marriage record and no household change: moving in together
 * stays with the existing move-in flow.
 *
 * The participant fields use GovernmentCharacterPicker, so the same organization as the
 * City Hall setup applies: the account's own characters first (alphabetical), then the
 * cross-account characters the user already knows (alphabetical, clearly marked).
 *
 * Used after a ceremony that actually took place (Scenes), or after a Story Event
 * that establishes a completed marriage. Nothing here is applied until the user
 * confirms, and cancelling changes no record.
 */
export default function MarriageConfirmationModal({
  open,
  characters = [],
  currentUser = null,
  initialSpouseIds = [],
  initialWitnessIds = [],
  locationName = null,
  ceremonyType = null,
  onClose,
  onConfirmed,
}) {
  const myEmail = currentUser?.email || null;
  const [spouseA, setSpouseA] = useState("");
  const [spouseB, setSpouseB] = useState("");
  const [witnessIds, setWitnessIds] = useState([]);
  const [crossAccount, setCrossAccount] = useState([]);
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

  const ownCharacters = useMemo(
    () => eligible.filter((c) => isOwnAccountCharacter(c, myEmail)),
    [eligible, myEmail]
  );
  const otherOwnedCharacters = useMemo(
    () => eligible.filter((c) => !isOwnAccountCharacter(c, myEmail)),
    [eligible, myEmail]
  );
  const eligibleKey = eligible.map((c) => c.id).sort().join(",");

  useEffect(() => {
    if (!open || !myEmail) { setCrossAccount([]); return; }
    let cancelled = false;
    setCrossAccount([]);
    resolveGovernmentCrossAccountCharacters({ ownCharacters: eligible, userEmail: myEmail })
      .then((list) => { if (!cancelled) setCrossAccount(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, myEmail, eligibleKey]);

  const crossPool = useMemo(() => {
    const seen = new Set();
    const list = [];
    [...crossAccount, ...otherOwnedCharacters].forEach((c) => {
      if (!c?.id || seen.has(c.id)) return;
      seen.add(c.id);
      list.push(c.is_cross_account ? c : { ...c, is_cross_account: true, account_email: c.owner_email });
    });
    return list.sort((a, b) =>
      (a.owner_email || "").localeCompare(b.owner_email || "") ||
      (a.name || "").localeCompare(b.name || "")
    );
  }, [crossAccount, otherOwnedCharacters]);

  const everyone = [...ownCharacters, ...crossPool];
  const nameOf = (id) => everyone.find((c) => c.id === id)?.name || null;
  const ready = spouseA && spouseB && spouseA !== spouseB;

  const spousePool = (excludeId) => ({
    own: ownCharacters.filter((c) => c.id !== excludeId),
    cross: crossPool.filter((c) => c.id !== excludeId),
  });

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
      <div className="space-y-1.5">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">First person getting married</label>
        <GovernmentCharacterPicker
          characters={spousePool(spouseB).own}
          crossAccountCharacters={spousePool(spouseB).cross}
          selectedIds={spouseA ? [spouseA] : []}
          onToggle={(id) => setSpouseA(id)}
          clearLabel="Select a character…"
          onClear={() => setSpouseA("")}
          maxHeightClass="max-h-40"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Second person getting married</label>
        <GovernmentCharacterPicker
          characters={spousePool(spouseA).own}
          crossAccountCharacters={spousePool(spouseA).cross}
          selectedIds={spouseB ? [spouseB] : []}
          onToggle={(id) => setSpouseB(id)}
          clearLabel="Select a character…"
          onClear={() => setSpouseB("")}
          maxHeightClass="max-h-40"
        />
        {spouseA && spouseB && spouseA === spouseB && (
          <p className="text-[11px] text-destructive">Choose two different people.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Witnesses (optional)</label>
        <GovernmentCharacterPicker
          characters={ownCharacters.filter((c) => c.id !== spouseA && c.id !== spouseB)}
          crossAccountCharacters={crossPool.filter((c) => c.id !== spouseA && c.id !== spouseB)}
          selectedIds={witnessIds}
          onToggle={toggleWitness}
          multiple
          maxHeightClass="max-h-40"
        />
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