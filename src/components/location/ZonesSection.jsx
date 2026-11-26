import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ZoneEditor from "@/components/location/ZoneEditor";

/**
 * ZonesSection — the property's own Rooms / Zones, with their reference images.
 *
 * The heading expands and collapses the section so a property with many zone images can be
 * worked on one part at a time. Collapsing is display only: nothing is removed, cleared or
 * re-saved, and every selection and image is exactly as it was when reopened.
 */
export default function ZonesSection({
  zones = [],
  presets = [],
  existingZoneNames = [],
  expanded = true,
  onToggle = null,
  onAddPreset,
  showCustomInput = false,
  onToggleCustomInput,
  customZoneName = "",
  onCustomZoneNameChange,
  onAddCustomZone,
  onUpdateZoneImages,
  onTogglePrimaryCategory,
  onRemoveZone,
  isZoneReadOnly,
  isGenericHome = false,
  lockedNotice = null,
  locationName = "",
  category = "",
  subtype = [],
  locationDescription = "",
  workplaceByImageUrl = {},
}) {
  const imageCount = zones.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0);

  const presetChip = (name) => {
    const already = existingZoneNames.includes(name.toLowerCase());
    return (
      <button key={name} onClick={() => onAddPreset?.(name)} disabled={already}
        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${already ? "bg-primary/10 border-primary/30 text-primary cursor-default" : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
        {already ? "✓ " : "+ "}{name}
      </button>
    );
  };

  const customZoneButton = (
    <button onClick={onToggleCustomInput}
      className="px-3 py-1.5 rounded-full text-xs border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors">
      + Custom zone
    </button>
  );

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-2 text-left"
      >
        <span className="mt-0.5 text-muted-foreground flex-shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">
            Rooms / Zones <span className="text-destructive">*</span>
          </span>
          <span className="text-xs text-muted-foreground mt-0.5 block">
            Each uploaded set of images must be assigned to a specific room or zone.
          </span>
          {!expanded && (
            <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
              {zones.length} {zones.length === 1 ? "zone" : "zones"}
              {imageCount > 0 ? ` · ${imageCount} ${imageCount === 1 ? "image" : "images"}` : ""} · tap to open
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <>
          {lockedNotice}
          <div className="flex flex-wrap gap-2">
            {presets.map(presetChip)}
            {customZoneButton}
          </div>
          {showCustomInput && (
            <div className="flex gap-2">
              <Input value={customZoneName} onChange={e => onCustomZoneNameChange?.(e.target.value)} placeholder="e.g. Rooftop, Garage, Studio..." className="h-9 rounded-xl text-sm" onKeyDown={e => e.key === "Enter" && onAddCustomZone?.()} />
              <Button size="sm" onClick={onAddCustomZone} disabled={!customZoneName.trim()} className="rounded-xl px-4">Add</Button>
            </div>
          )}
          {zones.length === 0 && !isGenericHome && (
            <div className="py-4 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 text-center">
              <p className="text-xs text-destructive font-medium">At least one zone is required before uploading images.</p>
            </div>
          )}
          <div className="space-y-3">
            {zones.map((zone, i) => (
              <ZoneEditor
                key={i}
                zone={zone}
                onUpdateImages={(urls) => onUpdateZoneImages?.(i, urls)}
                onTogglePrimaryCategory={(value) => onTogglePrimaryCategory?.(i, value)}
                onDelete={() => onRemoveZone?.(i)}
                readOnly={isZoneReadOnly ? isZoneReadOnly(zone.zone_name) : false}
                locationName={locationName}
                category={category}
                subtype={subtype}
                locationDescription={locationDescription}
                workplaceByImageUrl={workplaceByImageUrl}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}