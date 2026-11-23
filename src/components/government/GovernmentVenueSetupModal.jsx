import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import GovernmentModalShell from "./GovernmentModalShell";
import GovernmentCharacterPicker from "./GovernmentCharacterPicker";
import { CITY_HALL_PURPOSES, COURT_CASE_TYPES, getCourtRolesForCaseType } from "@/lib/governmentVenues";
import { isIncarceratedCharacter } from "@/lib/jailSceneRules";
import {
  resolveGovernmentCrossAccountCharacters,
  isOwnAccountCharacter,
} from "@/lib/governmentCrossAccountCharacters";

/**
 * GovernmentVenueSetupModal — establishes what a City Hall or Courthouse visit is
 * before the scene begins. It is a setup, not a decision: nothing official happens
 * here, and cancelling leaves every record untouched.
 *
 * Every participant field uses GovernmentCharacterPicker, which follows Pocketfriend's
 * established selection organization: the account's own characters first (alphabetical),
 * then the cross-account characters the user already knows (alphabetical, clearly
 * marked). Defendant and Plaintiff are the exception — only characters this account owns
 * may hold a role that carries legal consequences. Jurors exclude anyone currently in
 * custody; witnesses may include them, because a witness can testify remotely.
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
  currentUser = null,
  onClose,
  onBegin,
}) {
  const isCourthouse = venueType === "courthouse";
  const myEmail = currentUser?.email || null;

  const [purpose, setPurpose] = useState("general_visit");
  const [spouseA, setSpouseA] = useState("");
  const [spouseB, setSpouseB] = useState("");
  const [witnessIds, setWitnessIds] = useState([]);

  const [caseType, setCaseType] = useState("criminal");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState({});

  const [crossAccount, setCrossAccount] = useState([]);

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

  // Group 1 — the account's own characters. Legacy records without an owner_email that
  // are visible in this roster are the account's own; they are never hidden.
  const ownCharacters = useMemo(
    () => eligible.filter((c) => isOwnAccountCharacter(c, myEmail)),
    [eligible, myEmail]
  );

  // Already-visible characters owned by another account (e.g. staff of a shared location
  // that is in this roster) belong with the cross-account group, labelled by owner.
  const otherOwnedCharacters = useMemo(
    () => eligible.filter((c) => !isOwnAccountCharacter(c, myEmail)),
    [eligible, myEmail]
  );

  const eligibleKey = eligible.map((c) => c.id).sort().join(",");

  // Group 2 — cross-account characters this account already knows, resolved through the
  // existing contact graph. Nothing outside it is offered.
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

  /** The two groups a role may draw from, after that role's own eligibility rules. */
  const poolFor = (role) => {
    const keep = (c) => !role?.excludeIncarcerated || !isIncarceratedCharacter(c);
    return {
      own: ownCharacters.filter(keep),
      cross: role?.ownAccountOnly ? [] : crossPool.filter(keep),
    };
  };

  const courtRoles = getCourtRolesForCaseType(caseType);

  const setRole = (key, value) => setRoles((prev) => ({ ...prev, [key]: value }));
  const toggleMulti = (key, id) => setRoles((prev) => {
    const current = Array.isArray(prev[key]) ? prev[key] : [];
    return { ...prev, [key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] };
  });

  // A person holds one role. Anyone already committed elsewhere is offered disabled
  // instead of being duplicated into a conflicting role.
  const conflictIds = (key) => {
    const ids = new Set();
    Object.entries(roles).forEach(([k, v]) => {
      if (k === key) return;
      (Array.isArray(v) ? v : [v]).filter(Boolean).forEach((id) => ids.add(id));
    });
    return [...ids];
  };

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

  const marriagePool = {
    own: ownCharacters,
    cross: crossPool,
  };
  const spouseOptions = (excludeId) => ({
    own: marriagePool.own.filter((c) => c.id !== excludeId),
    cross: marriagePool.cross.filter((c) => c.id !== excludeId),
  });

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

              <div className="space-y-1.5">
                <label className="text-[11px] text-foreground/80">Person 1</label>
                <GovernmentCharacterPicker
                  characters={spouseOptions(spouseB).own}
                  crossAccountCharacters={spouseOptions(spouseB).cross}
                  selectedIds={spouseA ? [spouseA] : []}
                  onToggle={(id) => setSpouseA(id)}
                  clearLabel="Choose who…"
                  onClear={() => setSpouseA("")}
                  maxHeightClass="max-h-40"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-foreground/80">Person 2</label>
                <GovernmentCharacterPicker
                  characters={spouseOptions(spouseA).own}
                  crossAccountCharacters={spouseOptions(spouseA).cross}
                  selectedIds={spouseB ? [spouseB] : []}
                  onToggle={(id) => setSpouseB(id)}
                  clearLabel="Choose who…"
                  onClear={() => setSpouseB("")}
                  maxHeightClass="max-h-40"
                />
              </div>

              {spouseA && spouseB && spouseA === spouseB && <p className="text-[11px] text-destructive">Choose two different people.</p>}

              <div className="space-y-1.5">
                <label className="text-[11px] text-foreground/80">Witnesses <span className="text-muted-foreground">— optional</span></label>
                <GovernmentCharacterPicker
                  characters={marriagePool.own.filter((c) => c.id !== spouseA && c.id !== spouseB)}
                  crossAccountCharacters={marriagePool.cross.filter((c) => c.id !== spouseA && c.id !== spouseB)}
                  selectedIds={witnessIds}
                  onToggle={(id) => setWitnessIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
                  multiple
                  maxHeightClass="max-h-40"
                />
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
            {courtRoles.map((role) => {
              const { own, cross } = poolFor(role);
              const selected = role.multiple
                ? (Array.isArray(roles[role.key]) ? roles[role.key] : [])
                : (roles[role.key] ? [roles[role.key]] : []);
              return (
                <div key={role.key} className="space-y-1.5">
                  <label className="text-[11px] text-foreground/80">
                    {role.label}
                    {role.optional && <span className="text-muted-foreground"> — optional</span>}
                  </label>
                  <GovernmentCharacterPicker
                    characters={own}
                    crossAccountCharacters={cross}
                    selectedIds={selected}
                    onToggle={(id) => { if (role.multiple) toggleMulti(role.key, id); else setRole(role.key, id); }}
                    multiple={role.multiple}
                    disabledIds={conflictIds(role.key)}
                    clearLabel={role.multiple ? null : "Filled by a temporary court official"}
                    onClear={() => setRole(role.key, "")}
                    maxHeightClass={role.multiple ? "max-h-44" : "max-h-40"}
                  />
                  {role.ownAccountOnly && (
                    <p className="text-[10px] text-muted-foreground">Only characters on your own account can hold this role.</p>
                  )}
                  {role.excludeIncarcerated && (
                    <p className="text-[10px] text-muted-foreground">A character currently in custody cannot serve on a jury. A past record alone does not disqualify them.</p>
                  )}
                  {role.key === "witnesses" && (
                    <p className="text-[10px] text-muted-foreground">A witness who is in custody testifies remotely and is not released by testifying.</p>
                  )}
                </div>
              );
            })}
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Witnesses and jurors are never required. A case still proceeds without them, and no one is made a witness or juror just because they are in the building.
            </p>
          </div>
        </>
      )}
    </GovernmentModalShell>
  );
}