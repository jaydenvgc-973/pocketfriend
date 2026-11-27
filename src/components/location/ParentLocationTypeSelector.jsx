import { PARENT_LOCATION_TYPES } from "@/lib/genericParentLocation";

/**
 * PARENT LOCATION TYPE — what the Generic parent itself is.
 *
 * A city, a neighborhood, a building, a property. This describes only the parent: it never
 * makes the parent into one of the places inside it, and it never creates anything.
 */
export default function ParentLocationTypeSelector({ value, onChange }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Parent Location Type</label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        <option value="">Not set</option>
        {PARENT_LOCATION_TYPES.map((type) => (
          <option key={type.value} value={type.value}>{type.label}</option>
        ))}
      </select>
      <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
        What this location is as a whole — not what it contains. Its child places keep their own types.
      </p>
    </div>
  );
}