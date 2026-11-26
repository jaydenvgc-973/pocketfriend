import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import ApartmentManager from "@/components/location/ApartmentManager";

/**
 * UnhousedLivingSpacesSection — the outdoor living arrangements inside a location.
 *
 * An Unhoused Living Space is its own living arrangement, not an apartment and not a
 * single outdoor zone: Riverside Encampment and Underpass Living Area are two different
 * places where two different people stay. This section manages them independently of the
 * property's Apartments & Homes, using the same existing residential configuration: each
 * living space is one residential unit with its own name, its own occupants, its own
 * spaces and its own reference images.
 *
 * Living spaces created here are recorded as unhoused living spaces and always outdoors.
 * Assigning someone here says where they stay; it never makes them housed.
 */
export default function UnhousedLivingSpacesSection({
  units = [],
  residentCharacterIds = [],
  allCharacters = [],
  nameById = {},
  zones = [],
  suggestedZones = [],
  lockedZoneNames = [],
  onAddZone = null,
  onAddPropertyZoneImage = null,
  onRemovePropertyZoneImage = null,
  category = "",
  subtype = [],
  locationName = "",
  locationDescription = "",
  onChange,
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-2 text-left"
      >
        <span className="mt-0.5 text-muted-foreground flex-shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">
            Unhoused Living Spaces
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5 block">
            Organize unhoused occupants into individual living spaces.
          </span>
          {!expanded && (
            <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
              {units.length} {units.length === 1 ? "living space" : "living spaces"} · tap to open
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <ApartmentManager
          showHeader={false}
          residentialUnits={units}
          residentCharacterIds={residentCharacterIds}
          allCharacters={allCharacters}
          nameById={nameById}
          zones={zones}
          suggestedZones={suggestedZones}
          lockedZoneNames={lockedZoneNames}
          onAddZone={onAddZone}
          onAddPropertyZoneImage={onAddPropertyZoneImage}
          onRemovePropertyZoneImage={onRemovePropertyZoneImage}
          category={category}
          subtype={subtype}
          locationName={locationName}
          locationDescription={locationDescription}
          onChange={onChange}
          sectionLabel="Unhoused Living Spaces"
          unitSingular="living space"
          occupantNoun="occupant"
          contextNoun="property"
          addPlaceholder="e.g. Riverside Encampment, Underpass Living Area..."
          emptyHint="Add residents to this location first, then create each living space they stay in."
          typeOptions={["Tent", "Encampment", "Underpass", "Sleeping area", "Bench", "Vehicle", "Other"]}
          newUnitDefaults={{ living_space_kind: "unhoused_living_space", physical_setting: "outdoor" }}
          forcePhysicalSetting="outdoor"
        />
      )}
    </div>
  );
}