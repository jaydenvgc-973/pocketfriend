import React, { useState } from "react";
import { Heart, ChevronDown, X } from "lucide-react";
import { RELATIONSHIP_OPTIONS, getRelationshipLabel, getReciprocalLabel } from "@/lib/relationshipUtils";

/**
 * Inline relationship selector for a single character on the user's profile page.
 */
export default function UserCharacterRelationshipSelector({ char, currentValue, userGender, onAssign, onRemove }) {
  const [open, setOpen] = useState(false);

  const reciprocal = currentValue ? getReciprocalLabel(currentValue, userGender) : null;
  const currentLabel = currentValue ? getRelationshipLabel(currentValue) : null;

  return (
    <div className="ml-11 mt-1">
      {currentValue ? (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20">
            <Heart className="w-3 h-3 text-pink-400 fill-current" />
            <span className="text-xs text-pink-300 font-medium capitalize">{currentLabel}</span>
            {reciprocal && (
              <span className="text-xs text-pink-400/60">→ they see you as <span className="text-pink-300 font-medium capitalize">{reciprocal}</span></span>
            )}
          </div>
          <button
            onClick={() => onRemove(char.id)}
            className="p-1 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
            title="Remove relationship"
          >
            <X className="w-3 h-3" />
          </button>
          <button
            onClick={() => setOpen(o => !o)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
          >
            Change <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(o => !o)}
          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
        >
          <Heart className="w-3 h-3" /> Assign relationship <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}

      {open && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {RELATIONSHIP_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onAssign(char.id, opt.value); setOpen(false); }}
              className={`text-xs px-2 py-1.5 rounded-lg border transition-colors text-left ${
                currentValue === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}