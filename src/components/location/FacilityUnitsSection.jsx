import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, DoorOpen, Plus, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { getUnitKind, getUnitLabel, getActiveUnitOccupantIds } from "@/lib/residentialUnits";

/**
 * FacilityUnitsSection
 *
 * A medical or correctional facility's internal spaces — patient rooms in a hospital or
 * clinic, cells in a prison or jail — from the same `residential_units` assignments the
 * Places page maintains.
 *
 * Places is where a character is ASSIGNED to a room or cell. Here the user places only
 * their OWN patient or inmate, and only into an existing space of a facility they can see.
 * A shared facility's rooms, cells and layout stay with its owner: this never edits the
 * facility's structure.
 *
 * Entering the space is a separate act — the Scenes page opens on that room or cell.
 */
export default function FacilityUnitsSection({ location, characters = [], currentUserEmail = null, onChanged = null }) {
  const navigate = useNavigate();
  const [roster, setRoster] = useState({});
  const [menuUnitId, setMenuUnitId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const units = (location?.residential_units || []).filter((u) => u?.unit_id && u?.unit_name);
  const kind = getUnitKind(location);

  // A room or cell is only occupied while that character is still hospitalized or
  // incarcerated here. Once the stay ends, the space shows as free and can be assigned
  // again — the space and its other occupants are untouched. Inmates whose full character
  // record is not loaded fall back to the facility's own inmate list.
  const seatRecords = useMemo(() => (location?.inmates || [])
    .filter((i) => i.character_id && !characters.some((c) => c.id === i.character_id))
    .map((i) => ({
      id: i.character_id,
      is_jailed: i.confinement_status !== 'released',
      resolved_presence_status: 'incarcerated',
      incarceration_facility_id: location.id,
    })), [location?.id, (location?.inmates || []).length, characters.length]);

  const occupantSource = useMemo(() => [...characters, ...seatRecords], [characters, seatRecords]);

  const activeIdsByUnit = useMemo(
    () => new Map(units.map((u) => [u.unit_id, getActiveUnitOccupantIds(location, u, occupantSource)])),
    [location?.id, units.map((u) => `${u.unit_id}:${(u.occupant_character_ids || []).join(',')}`).join('|'), occupantSource]
  );
  const assignedAnywhere = new Set([...activeIdsByUnit.values()].flat());

  // A shared facility's patient or inmate may belong to another account, so their name
  // comes from the facility roster rather than the caller's own character list.
  const unresolvedKey = [...assignedAnywhere]
    .filter((id) => !characters.some((c) => c.id === id)
      && !(location?.inmates || []).some((i) => i.character_id === id)
      && !roster[id])
    .sort()
    .join(',');
  useEffect(() => {
    if (!unresolvedKey) return;
    let cancelled = false;
    base44.functions.invoke('assignCharacterToFacilityUnit', {
      action: 'roster', location_id: location.id, character_ids: unresolvedKey.split(','),
    }).then((res) => {
      if (cancelled) return;
      const people = res?.data?.characters || [];
      if (people.length === 0) return;
      setRoster((prev) => ({ ...prev, ...Object.fromEntries(people.map((p) => [p.id, p])) }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [unresolvedKey, location?.id]);

  const resolveOccupant = (id) => {
    const char = characters.find((c) => c.id === id);
    if (char) return { id, name: char.name || char.display_name, avatar_url: char.avatar_url, isOwn: true };
    const inmate = (location?.inmates || []).find((i) => i.character_id === id);
    if (inmate) return { id, name: inmate.character_name, avatar_url: null, isOwn: false };
    if (roster[id]) return { id, name: roster[id].name, avatar_url: roster[id].avatar_url, isOwn: false };
    return { id, name: "Unknown character", avatar_url: null, isOwn: false };
  };

  // The caller's own characters who are actually a patient or inmate at this facility,
  // and are not already assigned to one of its spaces.
  const ownEligible = characters.filter((c) => {
    if (!c?.id || c.owner_email !== currentUserEmail) return false;
    if (assignedAnywhere.has(c.id)) return false;
    if (location.category === 'medical') {
      return c.resolved_presence_status === 'hospitalized'
        && (!c.resolved_current_location_id || c.resolved_current_location_id === location.id);
    }
    const confined = c.is_jailed === true || ['incarcerated', 'confined'].includes(c.resolved_presence_status);
    const facilityId = c.incarceration_facility_id || c.resolved_current_location_id;
    return confined && (!facilityId || facilityId === location.id);
  });

  const run = async (payload) => {
    setBusy(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('assignCharacterToFacilityUnit', { location_id: location.id, ...payload });
      if (res?.data?.error) setError(res.data.error);
      else { setMenuUnitId(null); onChanged?.(); }
    } catch (err) {
      setError(err?.response?.data?.error || 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (units.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 mt-3">
        <DoorOpen className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{kind.plural}</span>
      </div>
      <div className="space-y-1.5">
        {units.map((unit) => {
          const occupants = (activeIdsByUnit.get(unit.unit_id) || []).map(resolveOccupant);
          const showMenu = menuUnitId === unit.unit_id;
          return (
            <div key={unit.unit_id} className="bg-secondary/30 rounded-lg p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-medium text-foreground">{getUnitLabel(unit.unit_name, location)}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {occupants.length} assigned
                </span>
                {ownEligible.length > 0 && (
                  <button
                    onClick={() => { setError(null); setMenuUnitId(showMenu ? null : unit.unit_id); }}
                    disabled={busy}
                    className="text-[10px] text-primary font-medium flex items-center gap-0.5 hover:underline flex-shrink-0 disabled:opacity-40"
                  >
                    <Plus className="w-3 h-3" /> Assign
                  </button>
                )}
                <button
                  onClick={() => navigate(`/scene?locationId=${location.id}&unitId=${unit.unit_id}`)}
                  className="text-[10px] text-primary font-medium flex items-center gap-0.5 hover:underline flex-shrink-0"
                >
                  Visit <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {occupants.length > 0 ? (
                <div className="space-y-0.5">
                  {occupants.map((o) => (
                    <div key={o.id} className="flex items-center gap-1.5">
                      {o.avatar_url
                        ? <img src={o.avatar_url} alt={o.name} className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        : <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-[8px] font-bold text-primary">{o.name?.[0]?.toUpperCase()}</div>}
                      <span className="text-xs text-foreground flex-1 truncate">{o.name}</span>
                      {o.isOwn && (
                        <button
                          onClick={() => run({ action: 'remove', unit_id: unit.unit_id, character_id: o.id })}
                          disabled={busy}
                          title={`Remove from this ${kind.label.toLowerCase()}`}
                          className="p-0.5 text-muted-foreground hover:text-destructive rounded transition-colors disabled:opacity-40 flex-shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic">Nobody assigned</p>
              )}
              {showMenu && ownEligible.length > 0 && (
                <div className="mt-1.5 border-t border-border pt-1.5 space-y-0.5">
                  {ownEligible.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => run({ action: 'assign', unit_id: unit.unit_id, character_id: c.id })}
                      disabled={busy}
                      className="w-full flex items-center gap-1.5 text-left px-1 py-0.5 rounded hover:bg-secondary disabled:opacity-40"
                    >
                      {c.avatar_url
                        ? <img src={c.avatar_url} alt={c.name} className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        : <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-[8px] font-bold text-primary">{c.name?.[0]?.toUpperCase()}</div>}
                      <span className="text-xs text-foreground truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="text-[10px] text-destructive mt-1.5">{error}</p>}
    </div>
  );
}