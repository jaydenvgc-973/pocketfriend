import { Check, AlertTriangle } from "lucide-react";
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
              const selected = !!data[trait.key];
              const inConflict = conflicts.some(c => c.a === trait.key || c.b === trait.key);
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