import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import ApartmentManager from "@/components/location/ApartmentManager";
import UnhousedLivingSpacesSection from "@/components/location/UnhousedLivingSpacesSection";
import { isUnhousedLivingSpace, hasHousedVenueType } from "@/lib/unhousedLivingSpace";
import { lockedRecoveryYardZoneNames } from "@/lib/recoveryYardZones";
import { getActiveUnitOccupantIds, sortUnits, isEligibleSchoolHousingResident } from "@/lib/residentialUnits";

/**
 * ResidentialUnitsSections — the living arrangements inside one property.
 *
 * Two independent sections, never one combined list:
 *   Apartments & Homes      conventional residences and their residents.
 *   Unhoused Living Spaces  independently configured outdoor living arrangements and
 *                           their occupants, who remain unhoused.
 *
 * Both read and write the same existing `residential_units` array — a unit carries the
 * kind of arrangement it is in `living_space_kind`, so a property may hold apartments and
 * encampments at the same time without either list absorbing the other.
 */
export default function ResidentialUnitsSections({
  form,
  setForm,
  editingLocation,
  isAdmin = false,
  allCharacters = [],
  allAssignableCharacters = [],
  characterNameById = {},
  sharedResidencyConfig = null,
  presets = [],
  onAddPresetZone = null,
  onAddPropertyZoneImage = null,
  onRemovePropertyZoneImage = null,
  additionalCategories = [],
}) {
  const [apartmentsExpanded, setApartmentsExpanded] = useState(false);

  // A Generic parent shows the living arrangements its selected child categories allow.
  // A record with no recorded categories keeps every section it already had.
  const genericAllows = (...cats) => form.category !== 'generic'
    || additionalCategories.length === 0
    || cats.some(c => additionalCategories.includes(c));

  const isUnhoused = isUnhousedLivingSpace(form);
  const hasHousedVenue = hasHousedVenueType(form);
  // A space saved before the kind was recorded belongs to the location's own kind, so an
  // existing Unhoused Living Space keeps its living spaces after this correction.
  const isUnhousedUnit = (unit) => unit?.living_space_kind === 'unhoused_living_space' || (!unit?.living_space_kind && isUnhoused && !hasHousedVenue);

  const setHousedUnits = (units) => setForm(p => ({ ...p, residential_units: [...units, ...(p.residential_units || []).filter(isUnhousedUnit)] }));
  const setUnhousedUnits = (units) => setForm(p => ({ ...p, residential_units: [...(p.residential_units || []).filter(u => !isUnhousedUnit(u)), ...units] }));

  // A person staying in one kind of space is never offered as unassigned in the other.
  const unhousedOccupantIds = new Set((form.residential_units || []).filter(isUnhousedUnit).flatMap(u => u.occupant_character_ids || []));
  const housedOccupantIds = new Set((form.residential_units || []).filter(u => !isUnhousedUnit(u)).flatMap(u => u.occupant_character_ids || []));
  const unhousedEligibleIds = (form.resident_character_ids || []).filter(id => !housedOccupantIds.has(id));

  const lockedZoneNames = lockedRecoveryYardZoneNames(editingLocation, isAdmin);

  const isHomeBuilding = form.category === 'home' && (form.subtype || []).includes('building');
  const showsApartments = (isHomeBuilding || ['hotel', 'medical', 'jail_prison', 'school', 'generic'].includes(form.category))
    // A property whose only living arrangements are outdoor has them in the section below.
    && !(form.category === 'generic' && isUnhoused && !hasHousedVenue)
    // Only the child categories this Generic parent contains offer residential spaces.
    && genericAllows('home', 'hotel', 'medical', 'jail_prison', 'school');

  // A patient room and a prison cell are temporary: once the stay ends the occupant is no
  // longer assigned, so the space is free for someone else. Apartments, hotel rooms and
  // every other space are unchanged.
  const activeUnits = sortUnits((form.residential_units || []).filter(u => !isUnhousedUnit(u)).map(u => ({
    ...u,
    occupant_character_ids: getActiveUnitOccupantIds(editingLocation || form, u, allCharacters),
  })));

  const alreadyAssigned = new Set();
  activeUnits.forEach(u => (u.occupant_character_ids || []).forEach(id => alreadyAssigned.add(id)));

  // Who can be placed in a space at THIS facility. Someone staying in an outdoor living
  // space is not offered as unassigned in the apartments list.
  let assignableIds = (form.resident_character_ids || []).filter(id => !unhousedOccupantIds.has(id));
  let labels = {};
  if (form.category === 'medical') {
    assignableIds = [...new Set([
      // A patient room belongs to an admitted patient: only a character who is currently
      // hospitalized at this facility can be placed in one.
      ...allAssignableCharacters.filter(c =>
        c.resolved_presence_status === 'hospitalized' &&
        (!c.resolved_current_location_id || c.resolved_current_location_id === editingLocation?.id)
      ).map(c => c.id),
      ...alreadyAssigned,
    ])];
    labels = { sectionLabel: "Patient Rooms", unitSingular: "room", occupantNoun: "patient", contextNoun: "facility", addPlaceholder: "e.g. 204, ICU-3...", emptyHint: "Hospitalized characters at this facility can be assigned to a patient room." };
  } else if (form.category === 'jail_prison') {
    assignableIds = [...new Set([
      ...(form.inmates || []).filter(i => i.confinement_status !== 'released').map(i => i.character_id).filter(Boolean),
      ...allAssignableCharacters.filter(c => c.is_jailed === true && (!c.incarceration_facility_id || c.incarceration_facility_id === editingLocation?.id)).map(c => c.id),
      ...alreadyAssigned,
    ])];
    labels = { sectionLabel: "Inmate Cells", unitSingular: "cell", occupantNoun: "inmate", contextNoun: "facility", addPlaceholder: "e.g. B2, Cellblock C...", emptyHint: "Incarcerated characters at this facility can be assigned to a cell." };
  } else if (form.category === 'hotel') {
    labels = { sectionLabel: "Rooms / Units", unitSingular: "room", contextNoun: "hotel", addPlaceholder: "e.g. Room 101, Unit 4B...", emptyHint: "Add residents to the hotel first, then create rooms to organize them." };
  } else if (form.category === 'school') {
    // Only a residential student at THIS school, or a character whose established home is
    // this school, can be given a dorm room or apartment.
    const schoolRecord = editingLocation || form;
    assignableIds = [...new Set([
      ...allAssignableCharacters.filter(c => isEligibleSchoolHousingResident(c, schoolRecord)).map(c => c.id),
      ...alreadyAssigned,
    ])];
    labels = { sectionLabel: "Dorm Rooms / Apartments", unitSingular: "room", occupantNoun: "student", contextNoun: "school", addPlaceholder: "e.g. Dorm A1, Apartment 101...", emptyHint: "Residential students of this school and characters whose home is this school can be assigned to a dorm room or apartment." };
  } else if (form.category === 'generic') {
    // A Generic property may contain several distinct residences. Each unit keeps its own
    // occupants, so nobody in one apartment or house is treated as living in another.
    labels = { sectionLabel: "Apartments & Homes", unitSingular: "residence", contextNoun: "property", addPlaceholder: "e.g. Apartment 1A, Studio 3, Lakeview House...", emptyHint: "Add residents to this location first, then create each apartment or house they live in." };
  }

  return (
    <>
      {showsApartments && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setApartmentsExpanded(v => !v)}
            className="w-full flex items-start gap-2 text-left"
          >
            <span className="mt-0.5 text-muted-foreground flex-shrink-0">
              {apartmentsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                {labels.sectionLabel || "Apartments"}
              </span>
              <span className="text-[10px] text-muted-foreground mt-0.5 block">
                Organize {labels.contextNoun || "building"} residents into individual {labels.unitSingular || "apartment"}s.
              </span>
              {!apartmentsExpanded && (
                <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
                  {activeUnits.length} {activeUnits.length === 1 ? (labels.unitSingular || "apartment") : `${labels.unitSingular || "apartment"}s`} · tap to open
                </span>
              )}
            </span>
          </button>
          {apartmentsExpanded && (
            <ApartmentManager
              showHeader={false}
              residentialUnits={activeUnits}
              residentCharacterIds={assignableIds}
              allCharacters={allCharacters}
              nameById={characterNameById}
              maxUnits={form.category === 'home' ? (sharedResidencyConfig?.max_units || 0) : 0}
              zones={form.zones || []}
              suggestedZones={presets}
              lockedZoneNames={lockedZoneNames}
              onAddZone={onAddPresetZone}
              onAddPropertyZoneImage={onAddPropertyZoneImage}
              onRemovePropertyZoneImage={onRemovePropertyZoneImage}
              category={form.category}
              subtype={form.subtype}
              locationName={form.name}
              locationDescription={form.description}
              onChange={setHousedUnits}
              {...labels}
            />
          )}
        </div>
      )}

      {/* Outdoor living arrangements are their own section, never part of the list above. */}
      {isUnhoused && genericAllows('outdoor') && (
        <UnhousedLivingSpacesSection
          units={(form.residential_units || []).filter(isUnhousedUnit)}
          residentCharacterIds={unhousedEligibleIds}
          allCharacters={allCharacters}
          nameById={characterNameById}
          zones={form.zones || []}
          suggestedZones={presets}
          lockedZoneNames={lockedZoneNames}
          onAddZone={onAddPresetZone}
          onAddPropertyZoneImage={onAddPropertyZoneImage}
          onRemovePropertyZoneImage={onRemovePropertyZoneImage}
          category={form.category}
          subtype={form.subtype}
          locationName={form.name}
          locationDescription={form.description}
          onChange={setUnhousedUnits}
        />
      )}
    </>
  );
}