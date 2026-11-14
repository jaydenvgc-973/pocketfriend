import { getUnitForCharacter, getUnitKind, getUnitLabel } from "@/lib/residentialUnits";

/**
 * ResidentPresenceList
 *
 * Shows who lives where in a multi-dwelling property. Residents are grouped under their
 * apartment so the right unit can be chosen before travelling, while each person keeps
 * their existing presence wording and colour. The whole list scrolls inside a fixed
 * height instead of stretching the travel panel.
 *
 * Residency comes from the property's own unit assignments — a resident who is out is
 * still listed under their apartment, marked as out.
 */

const LIST_MAX_HEIGHT = "11rem";

const renderLine = (line, i) => (
  <p key={`${line.name}-${i}`} className="text-xs truncate">
    <span className="text-foreground font-medium">{line.name}</span>
    <span className={`ml-1 ${line.color}`}>is {line.status}</span>
  </p>
);

export default function ResidentPresenceList({ lines = [], units = [], location = null, residentIds = [] }) {
  if (lines.length === 0) return null;

  if (units.length === 0) {
    return (
      <div className="overflow-y-auto pr-1" style={{ maxHeight: LIST_MAX_HEIGHT }}>
        <div className={lines.length > 4 ? "grid grid-cols-2 gap-x-3 gap-y-0.5" : "space-y-0.5"}>
          {lines.map(renderLine)}
        </div>
      </div>
    );
  }

  const grouped = [];
  const placed = new Set();
  units.forEach((unit) => {
    const residents = lines.filter((line) => {
      if (!line.id) return false;
      return getUnitForCharacter(location, line.id)?.unit_id === unit.unit_id;
    });
    if (residents.length === 0) return;
    residents.forEach((r) => placed.add(r));
    grouped.push({ key: unit.unit_id, label: getUnitLabel(unit.unit_name, location), lines: residents });
  });

  // Anyone not attached to a unit: residents without an apartment assignment stay
  // listed as residents; visitors and staff present right now are not residents.
  const residentSet = new Set(residentIds);
  const unplaced = lines.filter((line) => !placed.has(line));
  const unassigned = unplaced.filter((line) => !line.id || residentSet.has(line.id));
  const others = unplaced.filter((line) => line.id && !residentSet.has(line.id));
  if (unassigned.length > 0) grouped.push({ key: "__unassigned", label: getUnitKind(location).unassigned, lines: unassigned });
  if (others.length > 0) grouped.push({ key: "__others", label: "Others here", lines: others });

  return (
    <div className="overflow-y-auto pr-1 space-y-1.5" style={{ maxHeight: LIST_MAX_HEIGHT }}>
      {grouped.map((group) => (
        <div key={group.key}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
            {group.label}
            <span className="ml-1 text-muted-foreground/70">{group.lines.length}</span>
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {group.lines.map(renderLine)}
          </div>
        </div>
      ))}
    </div>
  );
}