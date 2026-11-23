import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import GovernmentModalShell from "./GovernmentModalShell";
import { CITY_HALL_PURPOSES, COURT_CASE_TYPES, getCourtRolesForCaseType } from "@/lib/governmentVenues";

/**
 * GovernmentVenueSetupModal — establishes what a City Hall or Courthouse visit is
 * before the scene begins. It is a setup, not a decision: nothing official happens
 * here, and cancelling leaves every record untouched.
 *
 * City Hall: why the characters are there, and — for a civil marriage — the two people
 * getting married plus optional witnesses. The ceremony itself still has to take place.
 * Courthouse: the case type, what the case is about, and who holds each role. Roles the
 * user leaves unassigned are filled by the court's own temporary people; witnesses and
 * jurors stay optional.
 */
export default function GovernmentVenueSetupModal({
  open,
  venueType,
  location,
  characters = [],
  onClose,
  onBegin,
}) {
  const isCourthouse = venueType === "courthouse";

  const [purpose, setPurpose] = useState("general_visit");
  const [spouseA, setSpouseA] = useState("");
  const [spouseB, setSpouseB] = useState("");
  const [witnessIds, setWitnessIds] = useState([]);

  const [caseType, setCaseType] = useState("criminal");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState({});

  useEffect(() => {
    if (!open) return;
    setPurpose("general_visit");
    setSpouseA("");
    setSpouseB("");
    setWitnessIds([]);
    setCaseType("criminal");
    setDescription("");
    setRoles({});
  }, [open, venueType]);

  const eligible = useMemo(
    () => (characters || []).filter((c) =>
      c?.id && !c.isNpc && !String(c.id).startsWith("npc_")
      && !["deleted", "soft_deleted", "merged", "deceased"].includes(c.status)
      && c.life_status !== "deceased"
    ),
    [characters]
  );

  const courtRoles = getCourtRolesForCaseType(caseType);

  const setRole = (key, value) => setRoles((prev) => ({ ...prev, [key]: value }));
  const toggleMulti = (key, id) => setRoles((prev) => {
    const current = Array.isArray(prev[key]) ? prev[key] : [];
    return { ...prev, [key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] };
  });

  const marriageReady = spouseA && spouseB && spouseA !== spouseB;
  const courtReady = description.trim().length >= 4;

  const begin = () => {
    if (isCourthouse) {
      if (!courtReady) return;
      onBegin?.({
        venue: "courthouse",
        case_type: caseType,
        description: description.trim(),
        roles,
      });
      onClose?.();
      return;
    }
    if (purpose === "civil_marriage" && !marriageReady) return;
    onBegin?.({
      venue: "city_hall",
      purpose,
      marriage: purpose === "civil_marriage"
        ? { spouse_a_id: spouseA, spouse_b_id: spouseB, witness_ids: witnessIds }
        : null,
    });
    onClose?.();
  };

  const personOptions = (exclude = []) => eligible.filter((c) => !exclude.includes(c.id));

  const footer = (
    <Button onClick={begin} disabled={isCourthouse ? !courtReady : (purpose === "civil_marriage" && !marriageReady)} className="w-full rounded-xl">
      {isCourthouse ? "Begin Court Case" : "Begin City Hall Scene"}
    </Button>
  );

  return (
    <GovernmentModalShell
      open={open}
      onClose={onClose}
      wide
      title={isCourthouse ? "Set Up Your Court Case" : "Welcome to City Hall"}
      subtitle={isCourthouse
        ? "Decide what's being tried and who will participate. Roles you leave unassigned are filled by temporary people of the court."
        : "What brings you here today? Choose an activity and the characters involved, or continue with a general visit."}
      footer={footer}
    >
      {!isCourthouse && (
        <>
          <div className="space-y-1.5">
            {CITY_HALL_PURPOSES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPurpose(p.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition-colors ${purpose === p.id ? "bg-primary/10 border-primary/50" : "bg-secondary border-border hover:border-primary/30"}`}
              >
                <span className="text-base leading-none">{p.emoji}</span>
                <span className="text-xs font-medium text-foreground">{p.label}</span>
              </button>
            ))}
          </div>

          {purpose === "civil_marriage" && (
            <div className="space-y-3 pt-1 border-t border-border">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground pt-2">Characters getting married</p>
              <select value={spouseA} onChange={(e) => setSpouseA(e.target.value)} className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground">
                <option value="">Person 1…</option>
                {personOptions([spouseB]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={spouseB} onChange={(e) => setSpouseB(e.target.value)} className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground">
                <option value="">Person 2…</option>
                {personOptions([spouseA]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {spouseA && spouseB && spouseA === spouseB && <p className="text-[11px] text-destructive">Choose two different people.</p>}

              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Witnesses (optional)</p>
              <div className="max-h-32 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                {personOptions([spouseA, spouseB]).length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No one else available.</p>
                ) : personOptions([spouseA, spouseB]).map((c) => (
                  <button key={c.id} onClick={() => setWitnessIds((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])} className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${witnessIds.includes(c.id) ? "bg-primary/10" : "hover:bg-secondary"}`}>
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${witnessIds.includes(c.id) ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{witnessIds.includes(c.id) ? "✓" : ""}</span>
                    <span className="text-xs text-foreground">{c.name}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                The ceremony is played out in the scene. The marriage is recorded through the existing marriage system when the ceremony actually takes place, so no second confirmation appears afterwards.
              </p>
            </div>
          )}
        </>
      )}

      {isCourthouse && (
        <>
          <div className="space-y-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Case type</label>
            <select value={caseType} onChange={(e) => { setCaseType(e.target.value); setRoles({}); }} className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground">
              {COURT_CASE_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">What is the case about?</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="e.g. A defendant is on trial for burglary. / Two neighbours are disputing property damage. / A character is appearing for sentencing following a conviction."
              className="w-full rounded-xl bg-secondary border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none"
            />
            <p className="text-[10px] text-muted-foreground">Your description guides the courtroom narrative. It is never replaced with an unrelated case.</p>
          </div>

          <div className="space-y-3 pt-1 border-t border-border">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground pt-2">Courtroom roles</p>
            {courtRoles.map((role) => (
              <div key={role.key} className="space-y-1.5">
                <label className="text-[11px] text-foreground/80">
                  {role.label}
                  {role.optional && <span className="text-muted-foreground"> — optional</span>}
                </label>
                {role.multiple ? (
                  <div className="max-h-32 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                    {eligible.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No characters available.</p>
                    ) : eligible.map((c) => {
                      const selected = (roles[role.key] || []).includes(c.id);
                      return (
                        <button key={c.id} onClick={() => toggleMulti(role.key, c.id)} className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${selected ? "bg-primary/10" : "hover:bg-secondary"}`}>
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${selected ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{selected ? "✓" : ""}</span>
                          <span className="text-xs text-foreground">{c.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <select
                    value={roles[role.key] || ""}
                    onChange={(e) => setRole(role.key, e.target.value)}
                    className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground"
                  >
                    <option value="">Temporary court official</option>
                    {eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Witnesses and jurors are never required. A case still proceeds without them, and no one is made a witness or juror just because they are in the building.
            </p>
          </div>
        </>
      )}
    </GovernmentModalShell>
  );
}