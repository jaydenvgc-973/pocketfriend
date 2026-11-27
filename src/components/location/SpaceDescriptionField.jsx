import React from "react";
import LocationDescriptionGenerator from "@/components/location/LocationDescriptionGenerator";

/**
 * SpaceDescriptionField — the optional description of ONE configured space.
 *
 * Used for a residence (apartment, house, unit), a workspace, and each of their rooms.
 * The text belongs to exactly this space: nothing here writes to another unit, another
 * room or the parent location. Leaving it blank is normal — the broader description then
 * applies, and the space still saves and still generates images.
 *
 * "Generate" is the existing location description generator, given this space's own
 * reference images, and it writes its result into the field for the user to review, edit
 * or clear before saving. It never silently replaces what is already there.
 */
export default function SpaceDescriptionField({
  label,
  hint,
  value,
  onChange,
  locationName = "",
  spaceLabel = "",
  category = "",
  subtype = [],
  imageUrls = [],
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint || "Optional — leave blank to use the broader description"}
        rows={2}
        className="w-full px-2.5 py-1.5 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 resize-y"
      />
      <LocationDescriptionGenerator
        locationName={locationName}
        category={category}
        subtype={subtype}
        currentDescription={value}
        imageUrls={imageUrls}
        spaceLabel={spaceLabel}
        onGenerate={onChange}
      />
    </div>
  );
}