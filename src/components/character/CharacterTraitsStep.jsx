import { Check, AlertTriangle, Lock } from "lucide-react";
import { TRAIT_ENTRIES, TRAIT_CATEGORY_ORDER, detectConflicts } from "@/lib/characterTraitRegistry";

// Re-export for backwards compatibility (EditCharacterTraits imports CHARACTER_TRAITS)
export const CHARACTER_TRAITS = TRAIT_ENTRIES.map(t => ({
  key: t.key,
  label: t.label,
  emoji: t.emoji,
  category: t.category,
  desc: t.desc,
}));

export default function CharacterTraitsStep({ data, onChange, showConflicts = true }) {
  const toggle = (key) => {
    onChange(key, !data[key]);
  };

  // Group traits by category (order from canonical registry)
  const grouped = TRAIT_CATEGORY_ORDER.map(cat => ({
    category: cat,
    traits: TRAIT_ENTRIES.filter(t => t.category === cat),
  }));

  // Detect conflicts from currently active traits
  const activeKeys = TRAIT_ENTRIES.filter(t => !!data[t.key]).map(t => t.key);
  const conflicts = showConflicts ? detectConflicts(activeKeys, []) : [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Character Traits & Quirks</h2>
        <p className="text-xs text-muted-foreground mb-1">
          Pick any traits that fit. These shape how they communicate, behave, and what makes them feel real.
        </p>
        <p className="text-xs text-muted-foreground/60">Select as many as you want — or none.</p>
      </div>

      {/* Conflict warnings */}
      {conflicts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-xs font-semibold text-amber-400">Conflicting traits selected</p>
          </div>
          {conflicts.map((c, i) => (
            <p key={i} className="text-xs text-amber-300/80 ml-6">
              <span className="font-medium">{c.a_label}</span> conflicts with <span className="font-medium">{c.b_label}</span> — these may create contradictory behavior. You can keep both as internal conflict.
            </p>
          ))}
        </div>
      )}

      {grouped.map(({ category, traits }) => (
        <div key={category} className="space-y-2">
          <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">{category}</p>
          <div className="grid grid-cols-1 gap-2">
            {traits.map((trait) => {
              const isProtected = trait.protected === true;
              // CRITICAL: selected is always driven by the actual data value — never auto-true
              const selected = !!data[trait.key];
              const inConflict = !isProtected && conflicts.some(c => c.a === trait.key || c.b === trait.key);

              if (isProtected) {
                if (selected) {
                  // ASSIGNED + PROTECTED: locked, non-removable, clearly active
                  return (
                    <div
                      key={trait.key}
                      className="flex items-center gap-3 p-3 rounded-xl border bg-amber-500/10 border-amber-500/40 text-left cursor-default"
                    >
                      <span className="text-xl flex-shrink-0">{trait.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-amber-400">{trait.label}</p>
                          <span className="text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            Active — Protected
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{trait.desc}</p>
                      </div>
                      {/* Both checkmark and lock: clearly selected AND locked */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center bg-amber-500">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                    </div>
                  );
                } else {
                  // UNASSIGNED + PROTECTED: available to add, with warning styling
                  return (
                    <button
                      key={trait.key}
                      onClick={() => {
                        if (window.confirm(
                          `Assign "${trait.label}" to this character?\n\nThis is a permanent protected trait. Once assigned, it cannot be removed through normal editing. The character will be permanently prohibited from revealing the nature of the world to other characters.`
                        )) {
                          onChange(trait.key, true);
                        }
                      }}
                      className="flex items-center gap-3 p-3 rounded-xl border bg-card border-amber-500/20 hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors text-left"
                    >
                      <span className="text-xl flex-shrink-0">{trait.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-foreground">{trait.label}</p>
                          <span className="text-[9px] font-bold bg-amber-500/10 text-amber-500/70 border border-amber-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            Protected
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{trait.desc}</p>
                      </div>
                      <Lock className="w-3.5 h-3.5 text-amber-500/50 flex-shrink-0" />
                    </button>
                  );
                }
              }

              return (
                <button
                  key={trait.key}
                  onClick={() => toggle(trait.key)}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                    selected
                      ? inConflict
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-primary/10 border-primary/40"
                      : "bg-card border-border hover:border-primary/30"
                  }`}
                >
                  <span className="text-xl flex-shrink-0">{trait.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={`text-sm font-medium ${selected ? (inConflict ? "text-amber-400" : "text-primary") : "text-foreground"}`}>
                        {trait.label}
                      </p>
                      {inConflict && selected && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{trait.desc}</p>
                  </div>
                  {selected && (
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${inConflict ? "bg-amber-500" : "bg-primary"}`}>
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}