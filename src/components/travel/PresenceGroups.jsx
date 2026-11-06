import React from "react";

/**
 * PresenceGroups
 *
 * Travel "who's here" list, organized by the dwelling units the Places page already
 * defines (apartments, rooms, suites) when the selected location has them.
 *
 * Grouping uses ONLY the location's existing residential_units occupant assignments.
 * Who is listed still comes from the existing presence resolution passed in `lines` —
 * a resident who is not physically there is never moved into the present list, and a
 * visitor is never made a resident. Characters with no unit assignment are listed
 * without an invented unit name.
 */
export default function PresenceGroups({ location, lines }) {
  if (!lines || lines.length === 0) return null;

  const unitByCharacter = {};
  (location?.residential_units || []).forEach(unit => {
    (unit.occupant_character_ids || []).forEach(id => {
      if (id && !unitByCharacter[id]) unitByCharacter[id] = unit.unit_name;
    });
  });
  const hasUnits = Object.keys(unitByCharacter).length > 0;

  const order = [];
  const groups = {};
  lines.forEach(line => {
    const key = (hasUnits && line.id && unitByCharacter[line.id]) || "__other__";
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(line);
  });

  const renderLine = (l, i) => (
    <p key={i} className="text-xs truncate">
      <span className="text-foreground font-medium">{l.name}</span>
      <span className={`ml-1 ${l.color}`}>is {l.status}</span>
    </p>
  );

  // No unit assignments on this location — unchanged flat list.
  if (!hasUnits || (order.length === 1 && order[0] === "__other__")) {
    return (
      <div className={lines.length > 4 ? "grid grid-cols-2 gap-x-3 gap-y-0.5" : "space-y-0.5"}>
        {lines.map(renderLine)}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {order.map(key => (
        <div key={key}>
          {key !== "__other__" && (
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{key}</p>
          )}
          <div className="space-y-0.5">
            {groups[key].map(renderLine)}
          </div>
        </div>
      ))}
    </div>
  );
}