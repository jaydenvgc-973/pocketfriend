import { useState } from "react";
import { Heart, ChevronDown, X } from "lucide-react";
import { RELATIONSHIP_OPTIONS, getRelationshipLabel } from "@/lib/relationshipUtils";

/**
 * Inline relationship selector for a single character.
 * Shows current tag with an edit button, or a picker when editing.
 */
export default function UserCharacterRelationshipSelector({ character, currentValue, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);

  const label = currentValue ? getRelationshipLabel(currentValue) : null;

  if (!editing && label) {
    return (
      <div className="flex items-center gap-2 ml-11 mt-1">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20">
          <Heart className="w-3 h-3 text-pink-400 fill-current" />
          <span className="text-xs text-pink-400 font-medium capitalize">{label}</span>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Change
        </button>
        <button
          onClick={onRemove}
          className="text-xs text-destructive/70 hover:text-destructive transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (editing || !label) {
    const groups = [
      {
        label: "Family",
        options: RELATIONSHIP_OPTIONS.filter(o =>
          ["parent", "child", "sibling", "cousin", "mother", "father", "son", "daughter", "aunt", "uncle", "niece", "nephew"].includes(o.value)
        ),
      },
      {
        label: "Partner",
        options: RELATIONSHIP_OPTIONS.filter(o =>
          ["spouse", "significant_other", "engaged"].includes(o.value)
        ),
      },
    ];

    return (
      <div className="ml-11 mt-1.5 space-y-2">
        {groups.map(group => (
          <div key={group.label}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.options.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onSave(opt.value);
                    setEditing(false);
                  }}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    currentValue === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {editing && (
          <button
            onClick={() => setEditing(false)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  return null;
}