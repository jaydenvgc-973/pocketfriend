import React from "react";
import { getUnitLabel, sortUnits } from "@/lib/residentialUnits";

/**
 * DwellingUnitGroups
 *
 * Organizes characters who are ACTUALLY PRESENT in the current Scene by the dwelling
 * assignments the Places page already defines (residential_units: apartments, rooms,
 * suites). Nothing is created, reassigned, or inferred.
 *
 * Only the participants passed in are shown. A resident who is not present never
 * appears merely because they belong to a household. A present character with no
 * dwelling assignment is returned separately so the caller keeps its existing section.
 */
export function splitByDwellingUnit(participants, residentialUnits) {
  const unitByCharacter = {};
  const unitOrder = [];
  sortUnits(residentialUnits || []).forEach((unit) => {
    if (unit?.unit_name) unitOrder.push(unit.unit_name);
    (unit?.occupant_character_ids || []).forEach((id) => {
      if (id && !unitByCharacter[id]) unitByCharacter[id] = unit.unit_name;
    });
  });

  const groups = {};
  const assigned = [];
  const unassigned = [];
  (participants || []).forEach((participant) => {
    const unitName = unitByCharacter[participant?.id];
    if (!unitName) {
      unassigned.push(participant);
      return;
    }
    assigned.push(participant);
    if (!groups[unitName]) groups[unitName] = [];
    groups[unitName].push(participant);
  });

  return { groups, order: unitOrder, assigned, unassigned };
}

// Unit names are shown exactly as stored. A bare number/letter ("1A") gets the
// property's own kind as a lead-in so the grouping reads as an apartment, a
// patient room or a cell.
function unitLabel(unitName, locationCategory) {
  return getUnitLabel(unitName, { category: locationCategory });
}

export default function DwellingUnitGroups({ groups = {}, order = [], renderParticipant, locationCategory = "home" }) {
  const unitNames = order.filter((name) => groups[name]?.length > 0);
  Object.keys(groups).forEach((name) => {
    if (!unitNames.includes(name) && groups[name]?.length > 0) unitNames.push(name);
  });
  if (unitNames.length === 0) return null;

  return (
    <div className="space-y-1">
      {unitNames.map((unitName) => (
        <div key={unitName}>
          <div className="px-3 py-1.5 border-b border-border/50">
            <p className="text-[9px] font-semibold text-green-400/80 uppercase tracking-wider">
              {unitLabel(unitName, locationCategory)}
            </p>
          </div>
          {groups[unitName].map(renderParticipant)}
        </div>
      ))}
    </div>
  );
}