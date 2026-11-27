import { SUBTYPE_OPTIONS, SUBTYPE_LABELS, GENERIC_VENUE_GROUPS } from "@/lib/locationFormConfig";
import { getVenueSubtypeContext } from "@/lib/venueSubtypeContext";

/**
 * Venue Type chips for the location form. Multi-select; each selected venue type that
 * describes a kind of settlement also shows what it actually describes, so the location
 * is written from its real conditions instead of an assumption about the place.
 *
 * A Generic property can carry many venue types, so its chips are shown in groups for
 * scanning. The groups are display only — every chip is one of the same options, and a
 * second selection never replaces the first.
 */
export default function VenueTypeSelector({ category, subtype, onChange, options: optionsProp = null, groups: groupsProp = null }) {
  const options = optionsProp || SUBTYPE_OPTIONS[category];
  if (!options && !groupsProp) return null;
  const selected = Array.isArray(subtype) ? subtype : [];
  // A venue type already saved on this place stays visible even when the selected child
  // categories no longer offer it: a selection is never dropped by a display change.
  const offered = groupsProp ? groupsProp.flatMap(g => g.types) : (options || []);
  const kept = selected.filter(s => !offered.includes(s));

  const toggle = (option) =>
    onChange(selected.includes(option) ? selected.filter(s => s !== option) : [...selected, option]);

  const chip = (option) => (
    <button key={option}
      onClick={() => toggle(option)}
      className={`py-2 px-3 rounded-xl text-xs border transition-colors text-left capitalize ${selected.includes(option) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
      {SUBTYPE_LABELS[option] || option.replace(/_/g, ' ')}
    </button>
  );

  return (
    <div>
      <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Venue Type</label>
      {groupsProp ? (
        <div className="space-y-3">
          {groupsProp.map(group => (
            <div key={group.label}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{group.label}</p>
              <div className="grid grid-cols-2 gap-2">{group.types.map(chip)}</div>
            </div>
          ))}
          {kept.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Already selected</p>
              <div className="grid grid-cols-2 gap-2">{kept.map(chip)}</div>
            </div>
          )}
        </div>
      ) : category === 'generic' ? (
        <div className="space-y-3">
          {GENERIC_VENUE_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{group.label}</p>
              <div className="grid grid-cols-2 gap-2">{group.types.map(chip)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">{options.map(chip)}</div>
      )}
      {getVenueSubtypeContext(category, selected).map(({ subtype: key, context }) => (
        <p key={key} className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="text-foreground/80 font-medium capitalize">{SUBTYPE_LABELS[key] || key.replace(/_/g, ' ')}:</span> {context}
        </p>
      ))}
    </div>
  );
}