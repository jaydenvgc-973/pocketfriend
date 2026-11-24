import { SUBTYPE_OPTIONS, SUBTYPE_LABELS } from "@/lib/locationFormConfig";
import { getVenueSubtypeContext } from "@/lib/venueSubtypeContext";

/**
 * Venue Type chips for the location form. Multi-select; each selected venue type that
 * describes a kind of settlement also shows what it actually describes, so the location
 * is written from its real conditions instead of an assumption about the place.
 */
export default function VenueTypeSelector({ category, subtype, onChange }) {
  const options = SUBTYPE_OPTIONS[category];
  if (!options) return null;
  const selected = Array.isArray(subtype) ? subtype : [];

  return (
    <div>
      <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Venue Type</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map(option => (
          <button key={option}
            onClick={() => onChange(selected.includes(option) ? selected.filter(s => s !== option) : [...selected, option])}
            className={`py-2 px-3 rounded-xl text-xs border transition-colors text-left capitalize ${selected.includes(option) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
            {SUBTYPE_LABELS[option] || option.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      {getVenueSubtypeContext(category, selected).map(({ subtype: key, context }) => (
        <p key={key} className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="text-foreground/80 font-medium capitalize">{SUBTYPE_LABELS[key] || key.replace(/_/g, ' ')}:</span> {context}
        </p>
      ))}
    </div>
  );
}