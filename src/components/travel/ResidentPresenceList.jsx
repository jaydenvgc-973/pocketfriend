import { getUnitForCharacter, getUnitKind, getUnitLabel } from "@/lib/residentialUnits";
import { getLocationWorkplaces } from "@/lib/locationWorkspaces";

/**
 * ResidentPresenceList
 *
 * Shows who lives where in a multi-dwelling property. Residents are grouped under their
 * apartment so the right unit can be chosen before travelling, while each person keeps
 * their existing presence wording and colour. The whole list scrolls inside a fixed
 * height instead of stretching the travel panel.
 *
 * Residency comes from the property's own unit assignments — a resident who is out is
 * still listed under their apartment, marked as out. People physically at one of the
 * property's own Workspaces are listed under that Workspace; "Others here" is only for
 * people genuinely present in the property's general space.
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

  const grouped = [];
  const placed = new Set();

  // 1. Residents under the apartment, room or cell they are assigned to.
  units.forEach((unit) => {
    const residents = lines.filter((line) => {
      if (!line.id) return false;
      return getUnitForCharacter(location, line.id)?.unit_id === unit.unit_id;
    });
    if (residents.length === 0) return;
    residents.forEach((r) => placed.add(r));
    grouped.push({ key: unit.unit_id, label: getUnitLabel(unit.unit_name, location), lines: residents });
  });

  // 2. PEOPLE PHYSICALLY AT A NAMED WORKSPACE.
  // A property can keep its own businesses (Agency (NJ) inside Gateway House). Someone
  // on shift inside one of them is at that workspace — not standing in the building's
  // general area. A line qualifies only when the authoritative presence already put them
  // at this location on shift AND the property's own workplace record already claims them
  // as its employee. Employment alone never places anyone here: a worker who is home,
  // out, hospitalized or elsewhere is not in this list at all.
  getLocationWorkplaces(location).forEach((workplace) => {
    const onShift = lines.filter((line) => {
      if (!line.id || placed.has(line)) return false;
      if (line.status !== "working") return false;
      return (workplace.worker_character_ids || []).includes(line.id);
    });
    if (onShift.length === 0) return;
    onShift.forEach((line) => placed.add(line));
    grouped.push({ key: workplace.workplace_id, label: workplace.name, lines: onShift });
  });

  // Nothing to group under — no unit and no workspace — keeps the plain compact list.
  if (grouped.length === 0) {
    return (
      <div className="overflow-y-auto pr-1" style={{ maxHeight: LIST_MAX_HEIGHT }}>
        <div className={lines.length > 4 ? "grid grid-cols-2 gap-x-3 gap-y-0.5" : "space-y-0.5"}>
          {lines.map(renderLine)}
        </div>
      </div>
    );
  }

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