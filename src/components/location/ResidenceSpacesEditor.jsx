import React, { useState } from "react";
import { X, Plus } from "lucide-react";
import ResidenceZoneImages from "@/components/location/ResidenceZoneImages";

/**
 * ResidenceSpacesEditor — the spaces of ONE residence, and their reference images.
 *
 * The same shape the Workspaces section uses for a business's rooms: the spaces already
 * chosen, the ones the property already has, the ones typical for this kind of residence,
 * and a field for a custom space. Choosing a space never removes another, and a residence
 * is never limited to a single room — an apartment keeps its living room, kitchen, bedroom
 * and bathroom; an encampment keeps its tent, bridge and sidewalk.
 *
 * Every space here is one of the property's existing zones: adding a new one creates it on
 * the property through the same handler the Rooms / Zones section uses, so nothing is
 * stored twice.
 */
export default function ResidenceSpacesEditor({
  residenceLabel = "this residence",
  zoneNames = [],
  onChangeZoneNames,
  zoneImages = [],
  onChangeZoneImages,
  propertyZones = [],
  suggestedZones = [],
  lockedZoneNames = [],
  otherResidences = [],
  locationName = "",
  category = "",
  subtype = [],
  locationDescription = "",
  // The residence itself, so its own description and its rooms' descriptions reach the
  // picture generated for each space.
  unit = null,
  onAddPropertyZone,
  onAddPropertyZoneImage,
  onRemovePropertyZoneImage,
}) {
  const [draft, setDraft] = useState("");

  const propertyZoneNames = (propertyZones || []).map(z => z?.zone_name).filter(Boolean);
  const isLocked = (name) => (lockedZoneNames || []).some(n => String(n).toLowerCase() === String(name).toLowerCase());
  const has = (name) => zoneNames.some(z => String(z).toLowerCase() === String(name).toLowerCase());

  const setZones = (next) => onChangeZoneNames?.(next);

  const toggleZone = (name) => {
    if (!name || isLocked(name)) return;
    setZones(has(name) ? zoneNames.filter(z => String(z).toLowerCase() !== String(name).toLowerCase()) : [...zoneNames, name]);
  };

  // A space that does not exist on the property yet is created there, then chosen here.
  const addZone = (rawName) => {
    const name = String(rawName || "").trim();
    if (!name || isLocked(name)) return;
    const existingName = propertyZoneNames.find(z => z.toLowerCase() === name.toLowerCase()) || name;
    if (!propertyZoneNames.some(z => z.toLowerCase() === name.toLowerCase())) onAddPropertyZone?.(existingName);
    if (!has(existingName)) setZones([...zoneNames, existingName]);
  };

  const unselectedPropertyZones = propertyZoneNames.filter(name => !has(name));
  const presetZones = (suggestedZones || [])
    .filter(name => name && !has(name) && !propertyZoneNames.some(z => z.toLowerCase() === String(name).toLowerCase()));

  const handleAddImage = (zoneName, url) => {
    if (!url || !zoneName) return;
    onChangeZoneImages?.([...(zoneImages || []).filter(i => !(i.zone_name === zoneName && i.url === url)), { zone_name: zoneName, url }]);
    onAddPropertyZoneImage?.(zoneName, url);
  };

  const handleRemoveImage = (zoneName, url) => {
    const next = (zoneImages || []).filter(i => !(i.zone_name === zoneName && i.url === url));
    onChangeZoneImages?.(next);
    // The property's own list only loses the picture when no other residence uses it.
    const stillUsedElsewhere = (otherResidences || []).some(r => (r?.zone_images || []).some(zi => zi?.url === url));
    if (!stillUsedElsewhere) onRemovePropertyZoneImage?.(zoneName, url);
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Spaces of this residence</label>
        <p className="text-[11px] text-muted-foreground/80">
          Every room, area or outdoor space that belongs to {residenceLabel}. Choosing one never removes another.
        </p>
      </div>

      {zoneNames.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">
          No spaces yet. Add this residence's rooms or areas below — no need to leave this section.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {zoneNames.map(name => (
            <button
              key={name}
              type="button"
              onClick={() => toggleZone(name)}
              title={isLocked(name) ? "Managed by the facility" : "Remove this space from the residence"}
              className="px-2 py-1 rounded-full text-[10px] border bg-primary/10 border-primary/40 text-primary flex items-center gap-1"
            >
              {name}
              {!isLocked(name) && <X className="w-2.5 h-2.5" />}
            </button>
          ))}
        </div>
      )}

      {unselectedPropertyZones.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Already on this property</p>
          <div className="flex flex-wrap gap-1.5">
            {unselectedPropertyZones.map(name => (
              <button
                key={name}
                type="button"
                onClick={() => toggleZone(name)}
                disabled={isLocked(name)}
                className="px-2 py-1 rounded-full text-[10px] border bg-card border-border text-muted-foreground hover:border-primary/40 disabled:opacity-40"
              >
                + {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {presetZones.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Typical for this kind of residence</p>
          <div className="flex flex-wrap gap-1.5">
            {presetZones.slice(0, 24).map(name => (
              <button
                key={name}
                type="button"
                onClick={() => addZone(name)}
                className="px-2 py-1 rounded-full text-[10px] border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                + {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key !== "Enter") return;
            addZone(draft);
            setDraft("");
          }}
          placeholder="Custom space — e.g. Primary Bedroom, Tent 3, North Side of the Bridge"
          className="flex-1 h-7 px-2 rounded-lg bg-secondary border border-border text-[11px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          type="button"
          onClick={() => { addZone(draft); setDraft(""); }}
          disabled={!draft.trim()}
          className="px-2.5 h-7 rounded-lg bg-primary text-primary-foreground text-[10px] font-medium disabled:opacity-40 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      <ResidenceZoneImages
        residenceLabel={residenceLabel}
        zoneNames={zoneNames}
        zoneImages={zoneImages}
        propertyZones={propertyZones}
        otherResidences={otherResidences}
        locationName={locationName}
        category={category}
        subtype={subtype}
        locationDescription={locationDescription}
        unit={unit}
        onAddImage={handleAddImage}
        onRemoveImage={handleRemoveImage}
      />
    </div>
  );
}