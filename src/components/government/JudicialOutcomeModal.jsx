import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GovernmentModalShell from "./GovernmentModalShell";

/**
 * JudicialOutcomeModal — the one place a court outcome becomes official.
 *
 * sentencing: a confirmed conviction, written into the character's existing criminal
 *             history, and — only when the sentence is custodial — the existing
 *             incarceration pipeline (facility, inmate status, duration, release).
 * contempt:   a warning, a fine, removal from the courtroom, or temporary custody.
 *             Only custody touches the jail; contempt never becomes a prison sentence.
 *
 * Nothing is written until the user confirms. A dismissed case, an acquittal or an
 * adjournment never reaches this modal, and witnesses, jurors and attorneys are never
 * offered as the person being sentenced.
 */
const SENTENCING_OUTCOMES = [
  { id: "incarceration", label: "Custodial sentence (jail or prison)" },
  { id: "probation", label: "Probation" },
  { id: "fine", label: "Fine" },
  { id: "community_service", label: "Community service" },
  { id: "suspended", label: "Suspended sentence" },
];

const CONTEMPT_OUTCOMES = [
  { id: "warning", label: "Warning (narrative only)" },
  { id: "fine", label: "Fine" },
  { id: "removal", label: "Removal from the courtroom (narrative only)" },
  { id: "custody", label: "Temporary custody (jail)" },
];

const DURATION_UNITS = [
  { id: "days", label: "days" },
  { id: "months", label: "months" },
  { id: "years", label: "years" },
  { id: "life", label: "life" },
];

function facilityKind(facility) {
  const subtypes = (Array.isArray(facility?.subtype) ? facility.subtype : [facility?.subtype]).filter(Boolean).map(String);
  if (subtypes.includes("jail") || subtypes.includes("holding_cell") || subtypes.includes("pretrial_detention")) return "Jail";
  if (subtypes.includes("prison") || subtypes.includes("correctional_facility")) return "Prison";
  return "Correctional facility";
}

export default function JudicialOutcomeModal({
  open,
  mode = "sentencing",
  characters = [],
  facilities = [],
  ownerEmail = null,
  initialDefendantId = "",
  initialOffense = "",
  courtName = null,
  caseType = "criminal",
  onClose,
  onResolved,
  onNarrativeOnly,
}) {
  const isContempt = mode === "contempt";
  const [defendantId, setDefendantId] = useState("");
  const [offense, setOffense] = useState("");
  const [outcome, setOutcome] = useState(isContempt ? "warning" : "incarceration");
  const [durationValue, setDurationValue] = useState("5");
  const [durationUnit, setDurationUnit] = useState("years");
  const [facilityId, setFacilityId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDefendantId(initialDefendantId || "");
    setOffense(initialOffense || "");
    setOutcome(isContempt ? "warning" : "incarceration");
    setDurationValue("5");
    setDurationUnit("years");
    setFacilityId("");
    setNotes("");
    setError(null);
    setSaving(false);
  }, [open, mode, initialDefendantId, initialOffense]);

  // A sentence changes criminal history and custody, so only a character this account
  // owns may be sentenced here. The same ownership is verified again by
  // applyJudicialSentence before anything is written.
  const eligible = useMemo(
    () => (characters || [])
      .filter((c) =>
        c?.id && !c.isNpc && !String(c.id).startsWith("npc_")
        && !["deleted", "soft_deleted", "merged", "deceased"].includes(c.status)
        && c.life_status !== "deceased"
        && (!ownerEmail || !c.owner_email || c.owner_email.toLowerCase() === ownerEmail.toLowerCase())
      )
      .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [characters, ownerEmail]
  );

  const outcomes = isContempt ? CONTEMPT_OUTCOMES : SENTENCING_OUTCOMES;
  const custody = outcome === "custody" || outcome === "incarceration";
  // Contempt custody is a jail hold, never a prison commitment: only jail-type
  // facilities are offered for it. A custodial sentence offers every facility.
  const facilityOptions = useMemo(() => {
    const list = facilities || [];
    if (!isContempt) return list;
    const jails = list.filter((f) => {
      const subtypes = (Array.isArray(f.subtype) ? f.subtype : [f.subtype]).filter(Boolean).map(String);
      return subtypes.some((s) => ["jail", "holding_cell", "pretrial_detention", "adult_detention", "juvenile_detention", "detention_center"].includes(s));
    });
    return jails.length > 0 ? jails : list;
  }, [facilities, isContempt]);
  const narrativeOnly = isContempt && (outcome === "warning" || outcome === "removal");
  const defendant = eligible.find((c) => c.id === defendantId) || null;
  const offenseRequired = !narrativeOnly;
  const ready = !!defendant
    && (!offenseRequired || offense.trim().length > 0)
    && (!custody || (facilityId && (durationUnit === "life" || Number(durationValue) > 0)));

  const submit = async () => {
    if (!ready || saving) return;
    const outcomeLabel = outcomes.find((o) => o.id === outcome)?.label || outcome;
    if (narrativeOnly) {
      onNarrativeOnly?.({
        characterId: defendant.id,
        characterName: defendant.name,
        outcome,
        label: outcomeLabel,
        text: isContempt
          ? `${defendant.name} is held in contempt of court — ${outcome === "warning" ? "a formal warning from the bench" : "removed from the courtroom"}.`
          : `${defendant.name}: ${outcomeLabel}.`,
      });
      onClose?.();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("applyJudicialSentence", {
        character_id: defendant.id,
        outcome,
        offense: offense.trim(),
        sentence_value: custody && durationUnit !== "life" ? Number(durationValue) : null,
        sentence_unit: custody ? durationUnit : null,
        facility_id: custody ? facilityId : null,
        notes: notes.trim() || null,
        court_name: courtName || "the court",
        case_type: caseType,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      onResolved?.(res.data);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "The outcome could not be recorded.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <GovernmentModalShell
      open={open}
      onClose={saving ? () => {} : onClose}
      wide
      title={isContempt ? "Contempt of court" : "Sentencing"}
      subtitle={isContempt
        ? "Contempt does not always mean confinement. Choose what the court actually does."
        : "A confirmed sentence is written into this character's criminal history. Only a custodial sentence sends them to a facility."}
      footer={
        <div className="space-y-2">
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <Button onClick={submit} disabled={!ready || saving} className="w-full rounded-xl">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Recording…</> : (isContempt ? "Confirm contempt outcome" : "Confirm sentence")}
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {isContempt ? "Character held in contempt" : "Defendant being sentenced"}
        </label>
        <select
          value={defendantId}
          onChange={(e) => setDefendantId(e.target.value)}
          className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground"
        >
          <option value="">Select a character…</option>
          {eligible.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className="text-[10px] text-muted-foreground">Only this person's records change. Witnesses, jurors and attorneys are never affected.</p>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {isContempt ? "What the contempt was for" : "Offence or conviction"}
        </label>
        <input
          value={offense}
          onChange={(e) => setOffense(e.target.value)}
          placeholder={isContempt ? "e.g. disrupting the court" : "e.g. burglary in the second degree"}
          className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Outcome</label>
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground"
        >
          {outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>

      {custody && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Duration</label>
              <input
                type="number"
                min="1"
                value={durationValue}
                disabled={durationUnit === "life"}
                onChange={(e) => setDurationValue(e.target.value)}
                className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground disabled:opacity-40"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Unit</label>
              <select
                value={durationUnit}
                onChange={(e) => setDurationUnit(e.target.value)}
                className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground"
              >
                {DURATION_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Facility</label>
            <select
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
              className="w-full h-9 rounded-xl bg-secondary border border-border px-3 text-sm text-foreground"
            >
              <option value="">Select a jail or prison…</option>
              {facilityOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.name} — {facilityKind(f)}</option>
              ))}
            </select>
            {facilityOptions.length === 0 && (
              <p className="text-[10px] text-destructive">No correctional facility is set up. Add a Jail / Prison location in Places first.</p>
            )}
          </div>
        </>
      )}

      <div className="space-y-2">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything the record should carry…"
          className="w-full rounded-xl bg-secondary border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none"
        />
      </div>

      {defendant && !narrativeOnly && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {defendant.name} will be recorded as {outcome === "incarceration" || outcome === "custody"
            ? `serving ${durationUnit === "life" ? "life" : `${durationValue} ${durationUnit}`} at ${facilityOptions.find((f) => f.id === facilityId)?.name || "a facility"}`
            : outcomes.find((o) => o.id === outcome)?.label.toLowerCase()}.
          {" "}Release and sentence completion keep running through the existing system.
        </p>
      )}
    </GovernmentModalShell>
  );
}