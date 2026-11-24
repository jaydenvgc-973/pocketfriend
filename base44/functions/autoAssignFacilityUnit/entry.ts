/**
 * autoAssignFacilityUnit
 *
 * Gives a patient their patient room, or an inmate their cell, using the facility's
 * EXISTING `residential_units` — the same rooms and cells the Places panel maintains and
 * the same assignments Travel, Who's Here and Scenes already read.
 *
 * It is not a new room system: it only fills the space the facility already provides.
 *
 * Rules, all from the established facility behavior:
 *   • a patient room holds one patient; a cell holds at most TWO inmates,
 *   • an existing room or cell with space is used before another is created,
 *   • a new space continues the facility's own naming sequence (P1..P3 → P4, C1..C3 → C4),
 *   • a character already assigned a space at this facility keeps it — this never moves
 *     anyone between rooms or cells, so a manual assignment stays authoritative,
 *   • house arrest is its own placement at the character's home and is never assigned a cell.
 *
 * payload: { character_id, location_id? }
 *   location_id is the facility the caller already established (a sentence). Without it the
 *   facility is read from the character's own incarceration or resolved location.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const CELL_CAPACITY = 2;
const PATIENT_ROOM_CAPACITY = 1;

const isConfinedHere = (character, location) => {
  const confined = character.is_jailed === true || ['incarcerated', 'confined'].includes(character.resolved_presence_status);
  if (!confined) return false;
  const facilityId = character.incarceration_facility_id || character.resolved_current_location_id;
  return !facilityId || facilityId === location.id;
};

const isPatientHere = (character, location) => {
  if (character.resolved_presence_status !== 'hospitalized') return false;
  return !character.resolved_current_location_id || character.resolved_current_location_id === location.id;
};

const livesHere = (character, location) => character.current_home_location_id === location.id;

/** Whether this space still counts its occupant — the same rule the UI reads. */
const holdsOccupant = (location, occupant) => {
  if (!occupant) return true;
  if (occupant.current_home_location_id === location.id) return true;
  if (location.category === 'medical') {
    if (occupant.resolved_presence_status !== 'hospitalized') return false;
    return !occupant.resolved_current_location_id || occupant.resolved_current_location_id === location.id;
  }
  const confined = occupant.is_jailed === true || ['incarcerated', 'confined'].includes(occupant.resolved_presence_status);
  if (!confined) return false;
  const facilityId = occupant.incarceration_facility_id || occupant.resolved_current_location_id;
  return !facilityId || facilityId === location.id;
};

const unitLabel = (location) => (location.category === 'medical' ? 'Room' : 'Cell');

/** The next name in the facility's own sequence — never a restart, never a duplicate. */
function nextUnitName(location, units) {
  const numbered = units
    .map((u) => ({ name: String(u.unit_name || ''), match: /^(.*?)(\d+)\s*$/.exec(String(u.unit_name || '')) }))
    .filter((x) => x.match);

  if (numbered.length === 0) return `${unitLabel(location)} 1`;

  const counts = new Map();
  numbered.forEach((x) => counts.set(x.match[1], (counts.get(x.match[1]) || 0) + 1));
  const prefix = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const highest = Math.max(...numbered.filter((x) => x.match[1] === prefix).map((x) => Number(x.match[2])));
  return `${prefix}${highest + 1}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));

    const body = await req.json().catch(() => ({}));
    const characterId = body.character_id;
    if (!characterId) return Response.json({ error: 'character_id is required' }, { status: 400 });

    const character = await base44.asServiceRole.entities.Character.get(characterId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    // A signed-in caller may only place their own character. An internal call from the
    // hospitalization or sentencing authority carries no user and acts on the character
    // that authority just placed.
    if (user) {
      const owns = character.owner_email === user.email || (!character.owner_email && character.created_by === user.email);
      if (!owns && user.role !== 'admin') return Response.json({ error: 'You can only assign your own characters.' }, { status: 403 });
    }

    // House arrest is served at the character's own home — never a cell.
    if (character.house_arrest_active === true) {
      return Response.json({ success: true, skipped: 'house_arrest' });
    }

    const facilityId = body.location_id
      || character.incarceration_facility_id
      || character.resolved_current_location_id
      || null;
    if (!facilityId) return Response.json({ success: true, skipped: 'no_facility' });

    const facility = await base44.asServiceRole.entities.LocationReference.get(facilityId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!facility) return Response.json({ success: true, skipped: 'facility_not_found' });
    if (!['medical', 'jail_prison'].includes(facility.category)) {
      return Response.json({ success: true, skipped: 'not_a_facility' });
    }

    const eligible = livesHere(character, facility)
      || (facility.category === 'medical' ? isPatientHere(character, facility) : isConfinedHere(character, facility));
    if (!eligible) return Response.json({ success: true, skipped: 'not_a_patient_or_inmate' });

    const units = Array.isArray(facility.residential_units) ? facility.residential_units : [];

    // An assignment that already stands is never replaced: the room or cell the character
    // holds — automatic or chosen by the user — stays theirs.
    const existing = units.find((u) => (u.occupant_character_ids || []).includes(characterId));
    if (existing) {
      return Response.json({ success: true, preserved: true, unit_id: existing.unit_id, unit_name: existing.unit_name });
    }

    const capacity = facility.category === 'medical' ? PATIENT_ROOM_CAPACITY : CELL_CAPACITY;

    // Occupants that still count toward capacity, so a released inmate or discharged
    // patient never blocks a space they no longer hold.
    const occupantIds = [...new Set(units.flatMap((u) => u.occupant_character_ids || []))];
    const occupants = occupantIds.length > 0
      ? await base44.asServiceRole.entities.Character.filter({ id: { $in: occupantIds.slice(0, 500) } }, null, 500).catch(() => [])
      : [];
    const byId = new Map((occupants || []).map((c) => [c.id, c]));

    const withSpace = [...units]
      .sort((a, b) => new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(a.unit_name || '', b.unit_name || ''))
      .find((u) => (u.occupant_character_ids || []).filter((id) => holdsOccupant(facility, byId.get(id))).length < capacity);

    let unitId;
    let unitName;
    let created = false;

    if (withSpace) {
      unitId = withSpace.unit_id;
      unitName = withSpace.unit_name;
    } else {
      unitName = nextUnitName(facility, units);
      unitId = `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      created = true;
    }

    const updatedUnits = created
      ? [...units, { unit_id: unitId, unit_name: unitName, occupant_character_ids: [characterId] }]
      : units.map((u) => (u.unit_id === unitId
        ? { ...u, occupant_character_ids: [...new Set([...(u.occupant_character_ids || []), characterId])] }
        : u));

    await base44.asServiceRole.entities.LocationReference.update(facility.id, { residential_units: updatedUnits });

    return Response.json({
      success: true,
      facility_id: facility.id,
      facility_name: facility.name,
      unit_id: unitId,
      unit_name: unitName,
      created,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});