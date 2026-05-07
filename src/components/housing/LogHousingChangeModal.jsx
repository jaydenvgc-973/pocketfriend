import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Home, Check, ChevronRight, ChevronLeft, MapPin, Users, Clock, Moon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

const REASON_OPTIONS = [
  { value: "voluntary_move", label: "Voluntary move" },
  { value: "eviction", label: "Eviction" },
  { value: "could_not_afford", label: "Could not afford rent" },
  { value: "safety_concern", label: "Safety concern" },
  { value: "family_conflict", label: "Family conflict" },
  { value: "relationship_change", label: "Relationship change" },
  { value: "job_change", label: "Job change" },
  { value: "shelter_placement", label: "Shelter placement" },
  { value: "hotel_placement", label: "Hotel placement" },
  { value: "released_from_incarceration", label: "Released from incarceration/detention" },
  { value: "lost_housing", label: "Lost housing" },
  { value: "temporary_displacement", label: "Temporary displacement" },
  { value: "entered_homelessness", label: "Entered homelessness" },
  { value: "household_move", label: "Household move" },
  { value: "moving_in_with_someone", label: "Moving in with someone" },
  { value: "moving_out_from_someone", label: "Moving out from someone" },
  { value: "breakup_separation", label: "Breakup/separation" },
  { value: "unknown_reason", label: "Unknown reason" },
  { value: "other", label: "Other" },
];

const RELATIONSHIP_IMPACT_REASONS = new Set([
  "relationship_change", "family_conflict", "safety_concern",
  "moving_in_with_someone", "moving_out_from_someone", "breakup_separation",
]);

const TIMING_OPTIONS = [
  { value: "immediate", label: "Move immediately", desc: "Live presence changes now" },
  { value: "next_travel_cycle", label: "Move during next travel cycle", desc: "Queued for next autonomous movement" },
  { value: "on_wake", label: "Move when they wake up", desc: "Execute on next wake event" },
  { value: "housing_only", label: "Update housing only", desc: "Do not change live presence yet" },
];

const SLEEP_OPTIONS = [
  { value: "wake_and_relocate", label: "Wake and relocate immediately" },
  { value: "relocate_on_wake", label: "Keep sleeping, relocate when they wake up" },
  { value: "housing_only", label: "Update housing only, preserve sleep location" },
];

const CATEGORY_EMOJIS = {
  home: "🏠", hotel: "🏨", shelter: "🏥", workplace: "🏢",
  gym: "💪", social: "🎉", outdoor: "🌳", food_drink: "🍽️",
  medical: "🏥", education: "📚", grocery: "🛒", religion: "⛪",
  government: "🏛️", public: "🌍", business: "💼", school: "🎓",
  community: "🤝", generic: "📍",
};

function deriveHousingStatus(loc) {
  if (!loc) return "unknown";
  if (loc.value === "__homeless__") return "homeless";
  if (loc.value === "__unknown__") return "unknown";
  const cat = loc.category;
  if (cat === "shelter") return "sheltered";
  if (cat === "hotel") return "hotel_placement";
  if (cat === "home") return "stable_home";
  return "housed";
}

function deriveHousingContext(loc) {
  if (!loc) return null;
  if (loc.value === "__homeless__") return "homeless_unsheltered";
  if (loc.value === "__unknown__") return null;
  const cat = loc.category;
  if (cat === "shelter") return "temporary_shelter";
  if (cat === "hotel") return "temporary_shelter";
  return "stable_home";
}

export default function LogHousingChangeModal({ character, currentUser, onClose, onSaved, queryClient }) {
  const [step, setStep] = useState(1); // 1=location, 2=reason, 3=who_else, 4=timing, 5=confirm
  const [locations, setLocations] = useState([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [allCharacters, setAllCharacters] = useState([]);
  const [loadingCharacters, setLoadingCharacters] = useState(true);

  // Form state
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [reasonForMove, setReasonForMove] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [movingCharacterIds, setMovingCharacterIds] = useState([]);
  const [presenceTiming, setPresenceTiming] = useState("housing_only");
  const [sleepHandling, setSleepHandling] = useState("relocate_on_wake");
  const [applyRelationshipImpact, setApplyRelationshipImpact] = useState(false);
  const [notes, setNotes] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const ownerEmail = currentUser?.email || character?.owner_email;

  // Load locations and characters on mount
  useEffect(() => {
    const load = async () => {
      setLoadingLocations(true);
      setLoadingCharacters(true);
      try {
        const [locRes, charRes] = await Promise.all([
          base44.functions.invoke("fetchAllLocationsForUser", {}),
          base44.entities.Character.filter({ owner_email: ownerEmail, status: "active" }),
        ]);
        const locs = locRes?.data?.locations || [];
        setLocations(locs);
        // Exclude primary character from "who else" list
        setAllCharacters((charRes || []).filter(c => c.id !== character.id));
      } catch (e) {
        // fail visible in UI
        setLocations([]);
        setAllCharacters([]);
      } finally {
        setLoadingLocations(false);
        setLoadingCharacters(false);
      }
    };
    load();
  }, [ownerEmail, character.id]);

  const isCharacterAsleep = (char) => {
    const status = char?.resolved_presence_status;
    return status === "sleeping" || status === "napping";
  };

  const anySelectedAsleep = [character, ...allCharacters.filter(c => movingCharacterIds.includes(c.id))]
    .some(c => isCharacterAsleep(c));

  const showSleepOptions = anySelectedAsleep && presenceTiming === "immediate";
  const showRelationshipOption = RELATIONSHIP_IMPACT_REASONS.has(reasonForMove);

  // Special location entries
  const specialLocations = [
    { value: "__homeless__", name: "Homeless / No fixed residence", category: "public", isSpecial: true },
    { value: "__unknown__", name: "Unknown", category: "generic", isSpecial: true },
  ];

  // Residential-priority sort
  const residentialCategories = new Set(["home", "hotel", "shelter"]);
  const sortedLocations = [...locations].sort((a, b) => {
    const aRes = residentialCategories.has(a.category) ? 0 : 1;
    const bRes = residentialCategories.has(b.category) ? 0 : 1;
    return aRes - bRes;
  });

  const allLocationOptions = [...specialLocations, ...sortedLocations];

  const toggleMovingChar = (id) => {
    setMovingCharacterIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!selectedLocation) { setSaveError("Please select a destination."); return; }
    if (!reasonForMove) { setSaveError("Please select a reason for the move."); return; }

    setIsSaving(true);
    setSaveError(null);

    const isHomeless = selectedLocation.value === "__homeless__";
    const isUnknown = selectedLocation.value === "__unknown__";

    const payload = {
      primaryCharacterId: character.id,
      movingCharacterIds: [character.id, ...movingCharacterIds],
      moveToLocationId: isHomeless || isUnknown ? null : selectedLocation.value,
      moveToLocationName: isHomeless ? "No fixed residence" : isUnknown ? null : selectedLocation.name,
      moveToLocationType: selectedLocation.category || null,
      housingStatus: deriveHousingStatus(selectedLocation),
      housingContext: deriveHousingContext(selectedLocation),
      reasonForMove,
      otherReasonNote: reasonForMove === "other" ? otherReason.trim() : null,
      presenceTransitionTiming: presenceTiming,
      sleepStateHandling: showSleepOptions ? sleepHandling : null,
      updateLivePresenceNow: presenceTiming === "immediate",
      applyRelationshipImpact: showRelationshipOption ? applyRelationshipImpact : false,
      previousHomeLocationId: character.current_home_location_id || null,
      previousHomeLocationName: character.resolved_current_location_name || null,
      previousHousingStatus: character.housing_context || null,
      isHomeless,
      isUnknown,
      ownerEmail,
      notes: notes.trim() || null,
    };

    try {
      await base44.functions.invoke("logHousingChange", payload);
      // Broad invalidation
      if (queryClient) {
        queryClient.invalidateQueries({ queryKey: ["character", character.id] });
        queryClient.invalidateQueries({ queryKey: ["characters"] });
        queryClient.invalidateQueries({ queryKey: ["characters", ownerEmail] });
        for (const cid of movingCharacterIds) {
          queryClient.invalidateQueries({ queryKey: ["character", cid] });
        }
        queryClient.invalidateQueries({ queryKey: ["locations"] });
        queryClient.invalidateQueries({ queryKey: ["allLocationsForUser"] });
        queryClient.invalidateQueries({ queryKey: ["lifeEvents"] });
        queryClient.invalidateQueries({ queryKey: ["memories"] });
      }
      onSaved?.();
    } catch (err) {
      setSaveError(err?.response?.data?.error || err?.message || "Failed to save housing change.");
    } finally {
      setIsSaving(false);
    }
  };

  const canAdvance = () => {
    if (step === 1) return !!selectedLocation;
    if (step === 2) return !!reasonForMove && (reasonForMove !== "other" || otherReason.trim().length > 0);
    return true;
  };

  const stepTitles = ["Move To", "Reason", "Who Else", "Timing", "Confirm"];

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <Home className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Log Housing Change</h3>
              <p className="text-xs text-muted-foreground">{character.name}</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Step progress */}
          <div className="flex gap-1 px-5 pt-3 pb-1 flex-shrink-0">
            {stepTitles.map((t, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div className={`h-1 w-full rounded-full transition-colors ${i + 1 <= step ? "bg-primary" : "bg-border"}`} />
                <span className={`text-[9px] transition-colors ${i + 1 === step ? "text-primary" : "text-muted-foreground/50"}`}>{t}</span>
              </div>
            ))}
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* STEP 1: Move To Location */}
            {step === 1 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-blue-400" />
                  <p className="text-sm font-semibold text-foreground">Where are they moving?</p>
                </div>
                {loadingLocations ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                    {allLocationOptions.map((loc) => {
                      const isSelected = selectedLocation?.value === loc.value;
                      return (
                        <button
                          key={loc.value || loc.id}
                          onClick={() => setSelectedLocation({ value: loc.value || loc.id, name: loc.name, category: loc.category })}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors flex items-center gap-2.5 ${
                            isSelected
                              ? "bg-primary/10 border-primary/30 text-foreground"
                              : "bg-secondary border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                          }`}
                        >
                          <span className="text-base">{CATEGORY_EMOJIS[loc.category] || "📍"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{loc.name}</p>
                            {loc.category && !loc.isSpecial && (
                              <p className="text-[10px] text-muted-foreground capitalize">{loc.category.replace(/_/g, " ")}</p>
                            )}
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Reason */}
            {step === 2 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Why are they moving?</p>
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {REASON_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setReasonForMove(opt.value)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors ${
                        reasonForMove === opt.value
                          ? "bg-primary/10 border-primary/30 text-foreground"
                          : "bg-secondary border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {reasonForMove === "other" && (
                  <input
                    autoFocus
                    type="text"
                    value={otherReason}
                    onChange={(e) => setOtherReason(e.target.value)}
                    placeholder="Describe the reason..."
                    className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                )}
                {showRelationshipOption && (
                  <button
                    onClick={() => setApplyRelationshipImpact(v => !v)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors flex items-center gap-2 ${
                      applyRelationshipImpact
                        ? "bg-amber-500/10 border-amber-500/30 text-foreground"
                        : "bg-secondary border-transparent text-muted-foreground"
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span>Apply relationship impact (trust, respect, bond changes)</span>
                    {applyRelationshipImpact && <Check className="w-3.5 h-3.5 text-amber-400 ml-auto" />}
                  </button>
                )}
              </div>
            )}

            {/* STEP 3: Who Else */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  <p className="text-sm font-semibold text-foreground">Who else is moving with them?</p>
                </div>
                <p className="text-xs text-muted-foreground">Select any characters moving to the same location. Leave empty if they're moving alone.</p>
                {loadingCharacters ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : allCharacters.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-4">No other characters on this account.</p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {allCharacters.map((c) => {
                      const isSelected = movingCharacterIds.includes(c.id);
                      const asleep = isCharacterAsleep(c);
                      return (
                        <button
                          key={c.id}
                          onClick={() => toggleMovingChar(c.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors flex items-center gap-2.5 ${
                            isSelected
                              ? "bg-primary/10 border-primary/30 text-foreground"
                              : "bg-secondary border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {c.avatar_url ? (
                            <img src={c.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-secondary border border-border flex items-center justify-center text-xs flex-shrink-0">
                              {c.name?.[0] || "?"}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{c.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {asleep ? "🌙 Sleeping" : c.resolved_current_location_name || "Location unknown"}
                            </p>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                {movingCharacterIds.length > 0 && (
                  <p className="text-xs text-primary font-medium">
                    {movingCharacterIds.length} additional character{movingCharacterIds.length > 1 ? "s" : ""} will move with {character.name}.
                  </p>
                )}
              </div>
            )}

            {/* STEP 4: Timing */}
            {step === 4 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  <p className="text-sm font-semibold text-foreground">When should their physical location change?</p>
                </div>
                <div className="space-y-1.5">
                  {TIMING_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setPresenceTiming(opt.value)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors ${
                        presenceTiming === opt.value
                          ? "bg-primary/10 border-primary/30 text-foreground"
                          : "bg-secondary border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <p className="font-medium">{opt.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Sleep state handling */}
                {showSleepOptions && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <div className="flex items-center gap-1.5">
                      <Moon className="w-3.5 h-3.5 text-indigo-400" />
                      <p className="text-xs font-semibold text-indigo-400">One or more characters is sleeping</p>
                    </div>
                    <div className="space-y-1.5">
                      {SLEEP_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setSleepHandling(opt.value)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-xs border transition-colors ${
                            sleepHandling === opt.value
                              ? "bg-indigo-500/10 border-indigo-500/30 text-foreground"
                              : "bg-secondary border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Notes (optional)</p>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add context about this housing change..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                </div>
              </div>
            )}

            {/* STEP 5: Confirm */}
            {step === 5 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Confirm housing change</p>
                <div className="rounded-xl bg-secondary border border-border p-4 space-y-2.5 text-xs">
                  <Row label="Primary character" value={character.name} />
                  <Row label="Moving to" value={selectedLocation?.name || "—"} />
                  <Row label="Housing status" value={deriveHousingStatus(selectedLocation)} />
                  <Row label="Reason" value={REASON_OPTIONS.find(r => r.value === reasonForMove)?.label || reasonForMove} />
                  {reasonForMove === "other" && otherReason && <Row label="Note" value={otherReason} />}
                  <Row label="Also moving" value={movingCharacterIds.length > 0 ? `${movingCharacterIds.length} other character(s)` : "No one else"} />
                  <Row label="Presence timing" value={TIMING_OPTIONS.find(t => t.value === presenceTiming)?.label || presenceTiming} />
                  {showSleepOptions && <Row label="Sleep handling" value={SLEEP_OPTIONS.find(s => s.value === sleepHandling)?.label || sleepHandling} />}
                  {applyRelationshipImpact && <Row label="Relationship impact" value="Will be applied" highlight />}
                  {notes && <Row label="Notes" value={notes} />}
                </div>
                {saveError && (
                  <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    {saveError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div className="px-5 pb-5 pt-3 border-t border-border flex gap-2 flex-shrink-0">
            {step > 1 ? (
              <Button variant="outline" size="sm" onClick={() => setStep(s => s - 1)} className="rounded-xl gap-1 text-xs">
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onClose} className="rounded-xl text-xs">Cancel</Button>
            )}
            <div className="flex-1" />
            {step < 5 ? (
              <Button
                size="sm"
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
                className="rounded-xl gap-1 text-xs"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-xl gap-1.5 text-xs min-w-[110px]"
              >
                <Check className="w-3.5 h-3.5" />
                {isSaving ? "Saving..." : "Confirm Move"}
              </Button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className={`text-right font-medium ${highlight ? "text-amber-400" : "text-foreground"}`}>{value}</span>
    </div>
  );
}