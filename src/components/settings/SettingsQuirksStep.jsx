import { Check } from "lucide-react";
import { QUIRK_ENTRIES, QUIRK_CATEGORY_ORDER, QUIRK_CATEGORY_META } from "@/lib/characterTraitRegistry";

/**
 * SettingsQuirksStep — quirks editor for the Edit Character Traits & Quirks
 * settings subpage. Mirrors CharacterTraitsStep's style but operates on the
 * character.quirks[] array instead of flat boolean trait fields.
 *
 * Local-state / single-Save pattern (owned by the parent page).
 * data = local quirks array; onChange(newArray) bubbles up.
 */
export default function SettingsQuirksStep({ data = [], onChange }) {
  const hasQuirk = (quirk_id) => data.some(q => q.quirk_id === quirk_id);

  const toggle = (entry) => {
    if (hasQuirk(entry.quirk_id)) {
      onChange(data.filter(q => q.quirk_id !== entry.quirk_id));
    } else {
      onChange([...data, {
        quirk_id: entry.quirk_id,
        label: entry.label,
        category: entry.category,
        intensity: "moderate",
        active: true,
        trigger_count: 0,
      }]);
    }
  };

  const grouped = QUIRK_CATEGORY_ORDER.map(cat => ({
    catKey: cat,
    label: QUIRK_CATEGORY_META[cat]?.label || cat,
    color: QUIRK_CATEGORY_META[cat]?.color || "text-primary",
    items: QUIRK_ENTRIES.filter(e => e.category === cat)
      .sort((a, b) => a.label.localeCompare(b.label)),
  })).filter(g => g.items.length > 0);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest mb-2">Quirks</p>
        <p className="text-xs text-muted-foreground">Quirks shape spending, habits, lifestyle, and emotional behavior. Stored separately from traits.</p>
      </div>

      {grouped.map(({ catKey, label, color, items }) => (
        <div key={catKey} className="space-y-2">
          <p className={`text-[10px] font-semibold uppercase tracking-widest ${color}`}>{label}</p>
          <div className="grid grid-cols-1 gap-2">
            {items.map((item) => {
              const selected = hasQuirk(item.quirk_id);
              return (
                <button
                  key={item.quirk_id}
                  onClick={() => toggle(item)}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                    selected
                      ? "bg-primary/10 border-primary/40"
                      : "bg-card border-border hover:border-primary/30"
                  }`}
                >
                  <span className="text-xl flex-shrink-0">{item.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${selected ? "text-primary" : "text-foreground"}`}>
                      {item.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                  {selected && (
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 bg-primary">
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