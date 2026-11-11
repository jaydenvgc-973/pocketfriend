import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Skull, AlertTriangle, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";

/**
 * CharacterDeathModal
 *
 * The Character Death option on a character profile. Nothing here is committed
 * until the user goes through the confirmation step and presses the confirm
 * button — closing or cancelling the interface makes no changes.
 */

const CAUSES = [
  { value: "natural_causes", label: "Natural Causes", hint: "Old age, natural decline, or death during sleep." },
  { value: "illness_medical", label: "Illness or Medical Complications", hint: "Cancer, heart attack, stroke, infection, organ failure, surgical complications." },
  { value: "accident", label: "Accidental Death", hint: "Vehicle accident, drowning, falling, fire, workplace accident." },
  { value: "violence", label: "Violent Death", hint: "Murder, assault, shooting, stabbing, another fatal act of violence." },
  { value: "overdose_poisoning", label: "Overdose or Poisoning", hint: "Accidental overdose, poisoning, substance-related death." },
  { value: "suicide", label: "Suicide", hint: "Death by suicide." },
  { value: "disaster", label: "Disaster or Environmental Event", hint: "Building collapse, flooding, severe weather, another catastrophic event." },
  { value: "unknown", label: "Unexplained or Unknown", hint: "A death where the cause has not been established." },
  { value: "custom", label: "Custom Cause", hint: "Write exactly what happened." },
];

const DELETION_OPTIONS = [
  { value: "immediate", label: "Delete Immediately", hint: "Deceased now, record removed now." },
  { value: "after_24h", label: "Delete After 24 Hours", hint: "Deceased now, record kept for 24 hours." },
  { value: "after_48h", label: "Delete After 48 Hours", hint: "Deceased now, record kept for 48 hours." },
];

const easternLabel = (iso) => iso
  ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  : "";

const deletionSummary = (mode) => {
  if (mode === "immediate") return "Delete immediately";
  if (mode === "after_24h") return "Delete after 24 hours";
  if (mode === "after_48h") return "Delete after 48 hours";
  return "";
};

export default function CharacterDeathModal({ isOpen, character, onClose, onDeceased }) {
  const [step, setStep] = useState("form");
  const [category, setCategory] = useState("natural_causes");
  const [customCause, setCustomCause] = useState("");
  const [circumstances, setCircumstances] = useState("");
  const [deletionMode, setDeletionMode] = useState("after_24h");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !character) return null;

  const selectedCause = CAUSES.find((c) => c.value === category);
  const causeText = category === "custom" ? customCause.trim() : selectedCause?.label || "";
  const canContinue = causeText.length > 0;

  const close = () => {
    if (isSubmitting) return;
    setStep("form");
    setCategory("natural_causes");
    setCustomCause("");
    setCircumstances("");
    setDeletionMode("after_24h");
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("confirmCharacterDeath", {
        characterId: character.id,
        deathCategory: category,
        deathCause: causeText,
        deathCircumstances: circumstances.trim(),
        deletionMode,
      });
      const data = res?.data || {};
      if (data.success !== true) {
        throw new Error(data.error || "The death could not be recorded.");
      }
      onDeceased?.(data);
      close();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "The death could not be recorded.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
        onClick={close}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto"
        >
          <div className="sticky top-0 bg-card px-4 py-3 border-b border-border flex items-center gap-2">
            <Skull className="w-4 h-4 text-destructive" />
            <h3 className="text-sm font-semibold flex-1">
              {step === "confirm" ? "Confirm the death" : `Character Death — ${character.name}`}
            </h3>
            <button onClick={close} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {step === "form" ? (
            <div className="px-4 py-4 space-y-4">
              <div>
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest mb-2">Cause of death</p>
                <div className="grid grid-cols-2 gap-2">
                  {CAUSES.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setCategory(c.value)}
                      className={`text-left px-2.5 py-2 rounded-xl border transition-colors ${category === c.value ? "bg-destructive/10 border-destructive/50" : "bg-background border-border hover:border-primary/30"}`}
                    >
                      <span className="text-[11px] font-medium text-foreground leading-tight block">{c.label}</span>
                      <span className="text-[9px] text-muted-foreground leading-tight block mt-0.5">{c.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {category === "custom" && (
                <div>
                  <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest mb-1.5">Write the cause</p>
                  <textarea
                    value={customCause}
                    onChange={(e) => setCustomCause(e.target.value)}
                    rows={3}
                    placeholder={`Exactly what happened to ${character.name}…`}
                    className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>
              )}

              <div>
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest mb-1.5">Additional context (optional)</p>
                <textarea
                  value={circumstances}
                  onChange={(e) => setCircumstances(e.target.value)}
                  rows={3}
                  placeholder="Where they were, who was with them, anything the world should know…"
                  className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>

              <div>
                <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest mb-2">What happens to the character record</p>
                <div className="space-y-2">
                  {DELETION_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setDeletionMode(o.value)}
                      className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${deletionMode === o.value ? "bg-primary/10 border-primary/50" : "bg-background border-border hover:border-primary/30"}`}
                    >
                      <span className="text-xs font-medium text-foreground block">{o.label}</span>
                      <span className="text-[10px] text-muted-foreground block">{o.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setStep("confirm")}
                disabled={!canContinue}
                className="w-full py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          ) : (
            <div className="px-4 py-4 space-y-4">
              <div className="space-y-2 rounded-xl border border-border bg-background p-3">
                <div className="flex justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground">Character</span>
                  <span className="text-[11px] text-foreground font-medium text-right">{character.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground">Cause of death</span>
                  <span className="text-[11px] text-foreground font-medium text-right">{causeText}</span>
                </div>
                {circumstances.trim() && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[11px] text-muted-foreground">Context</span>
                    <span className="text-[11px] text-foreground text-right">{circumstances.trim()}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-[11px] text-muted-foreground">Record</span>
                  <span className="text-[11px] text-foreground font-medium text-right">
                    {deletionSummary(deletionMode)}
                    {deletionMode !== "immediate" && (
                      <span className="block text-[10px] text-muted-foreground">
                        {deletionMode === "after_24h" ? "Kept 24 hours in deceased status" : "Kept 48 hours in deceased status"}
                      </span>
                    )}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 space-y-1.5">
                <p className="text-[11px] text-foreground flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                  {character.name} will immediately stop taking part in the living world: no travel, no messages, no scenes, no work, and no new activity.
                </p>
                <p className="text-[11px] text-foreground flex gap-1.5">
                  <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                  Surviving characters keep their memories of {character.name}, including the relationship and the fact that they died.
                </p>
                <p className="text-[11px] text-muted-foreground">The death is permanent and cannot be undone.</p>
              </div>

              {error && <p className="text-[11px] text-destructive">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep("form")}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl border border-border text-sm text-foreground disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={confirm}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold disabled:opacity-50"
                >
                  {isSubmitting ? "Recording…" : `Confirm ${character.name}'s death`}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}