import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { ADDITIONAL_CATEGORY_OPTIONS } from "@/lib/genericParentLocation";

/**
 * ADDITIONAL CATEGORIES — which kinds of child places this Generic parent may contain.
 *
 * One compact line when collapsed; opens to the existing location categories. Selecting one
 * never removes another, and the parent's own category stays Generic.
 */
export default function AdditionalCategoriesSelector({ value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value) ? value : [];

  const labels = selected.map((v) => ADDITIONAL_CATEGORY_OPTIONS.find((o) => o.value === v)?.label || v);
  const summary = labels.length === 0
    ? "None selected"
    : labels.length <= 2 ? labels.join(", ") : `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;

  const toggle = (option) => onChange(selected.includes(option)
    ? selected.filter((s) => s !== option)
    : [...selected, option]);

  return (
    <div>
      <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Additional Categories</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-sm text-left text-foreground hover:border-primary/40 transition-colors"
      >
        <span className={`flex-1 truncate ${labels.length === 0 ? "text-muted-foreground" : ""}`}>{summary}</span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {ADDITIONAL_CATEGORY_OPTIONS.map((option) => {
            const active = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className={`flex items-center gap-1.5 py-2 px-2.5 rounded-xl text-xs border transition-colors text-left ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
              >
                {active && <Check className="w-3 h-3 flex-shrink-0" />}
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
        The kinds of places that may exist inside this one. The parent stays Generic.
      </p>
    </div>
  );
}