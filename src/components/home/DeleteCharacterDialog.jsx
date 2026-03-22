import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

const CAUSES = [
  { value: "unknown", label: "Just gone", desc: "No explanation. They stopped being around." },
  { value: "moved_away", label: "Moved away", desc: "Left the area. New life somewhere else." },
  { value: "drifted", label: "Drifted apart", desc: "Nothing dramatic. The connection just faded." },
  { value: "falling_out", label: "Falling out", desc: "Things ended badly between them." },
  { value: "died", label: "They died", desc: "A loss. Real grief territory." },
];

const CLOSENESS = [
  { value: "close", label: "Close" },
  { value: "complicated", label: "Complicated" },
  { value: "acquaintance", label: "Acquaintance" },
  { value: "distant", label: "Distant" },
];

export default function DeleteCharacterDialog({ character, onConfirm, onCancel }) {
  const [cause, setCause] = useState("unknown");
  const [closeness, setCloseness] = useState("acquaintance");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-6"
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="w-full max-w-md bg-card border border-border rounded-2xl p-5 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">Remove {character.name}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Other characters will process this in their own way — based on who they are and how close they were.
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">What happened?</p>
          <div className="space-y-2">
            {CAUSES.map(c => (
              <button
                key={c.value}
                onClick={() => setCause(c.value)}
                className={`w-full text-left p-3 rounded-xl border transition-colors ${cause === c.value ? "bg-primary/10 border-primary/40 text-foreground" : "bg-background border-border text-foreground hover:border-primary/30"}`}
              >
                <span className="text-sm font-medium block">{c.label}</span>
                <span className="text-xs text-muted-foreground">{c.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">How close were they?</p>
          <div className="grid grid-cols-4 gap-2">
            {CLOSENESS.map(c => (
              <button
                key={c.value}
                onClick={() => setCloseness(c.value)}
                className={`py-2 rounded-xl text-xs border font-medium transition-colors ${closeness === c.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-foreground"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
          <Button
            onClick={() => onConfirm({ cause, closeness })}
            className={`flex-1 rounded-xl ${cause === "died" ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""}`}
          >
            {cause === "died" ? "They're gone" : "Remove"}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}