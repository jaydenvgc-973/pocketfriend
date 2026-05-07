import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Home, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

const HOUSING_TYPES = [
  { value: "home", label: "Moved to a new home" },
  { value: "shelter", label: "Emergency shelter" },
  { value: "hotel", label: "Hotel / temporary lodging" },
  { value: "homeless", label: "Currently homeless" },
  { value: "public", label: "Public / other location" },
];

const TIMING_OPTIONS = [
  { value: "immediate", label: "Effective immediately" },
  { value: "next_cycle", label: "Next schedule cycle" },
  { value: "housing_only", label: "Housing record only (no presence change)" },
];

export default function LogHousingChangeModal({ character, onClose, onSaved }) {
  const [housingType, setHousingType] = useState("home");
  const [timing, setTiming] = useState("immediate");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await base44.functions.invoke("logHousingChange", {
        characterId: character.id,
        ownerEmail: character.owner_email,
        housingType,
        timing,
        notes: notes.trim() || null,
      });
      onSaved?.();
    } catch (err) {
      setSaveError(err?.response?.data?.error || err?.message || "Failed to save housing change.");
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-3 p-5 border-b border-border">
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

          <div className="p-5 space-y-4">
            {/* Housing type */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Housing Type</p>
              <div className="space-y-1.5">
                {HOUSING_TYPES.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setHousingType(opt.value)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors ${
                      housingType === opt.value
                        ? "bg-primary/10 border-primary/30 text-foreground"
                        : "bg-secondary border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Timing */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timing</p>
              <div className="space-y-1.5">
                {TIMING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTiming(opt.value)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors ${
                      timing === opt.value
                        ? "bg-primary/10 border-primary/30 text-foreground"
                        : "bg-secondary border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes (optional)</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add context about this housing change..."
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          </div>

          {saveError && (
            <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
              {saveError}
            </div>
          )}
          {/* Actions */}
          <div className="px-5 pb-5 flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="flex-1 rounded-xl text-xs">
              Cancel
            </Button>
            <Button size="sm" disabled={isSaving} onClick={handleSave} className="flex-1 rounded-xl gap-1.5 text-xs">
              <Check className="w-3.5 h-3.5" />
              {isSaving ? "Saving..." : "Save Change"}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}