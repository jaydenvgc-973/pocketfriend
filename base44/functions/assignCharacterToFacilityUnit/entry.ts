/**
 * assignCharacterToFacilityUnit
 *
 * Places or removes the CALLER'S OWN character in a patient room or prison cell of a
 * hospital, clinic, prison or jail — including a facility shared across accounts.
 *
 * A shared facility is readable by every account, but its structure (rooms, cells, names)
 * belongs to its owner. This function never touches the facility's structure: it writes
 * only the occupant list of the ONE existing room or cell it was asked about, and only
 * the caller's own character, which must already be a patient or inmate there.
 *
 * action: 'assign' | 'remove' | 'roster'
 *   roster is a read-only name resolution for the people already assigned to the
 *   facility's rooms or cells (a shared facility's patients can belong to another
 *   account, so their names are not readable through the caller's own scope).
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'assign';
    const locationId = body.location_id;
    const characterId = body.character_id;
    const unitId = body.unit_id;

    if (!locationId) return Response.json({ error: 'location_id is required' }, { status: 400 });
    if (action !== 'roster' && (!unitId || !characterId)) {
      return Response.json({ error: 'unit_id and character_id are required' }, { status: 400 });
    }

    const location = await base44.asServiceRole.entities.LocationReference.get(locationId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!location) return Response.json({ error: 'Location not found' }, { status: 404 });

    // A facility shared across accounts is visible to everyone; its own record is only
    // editable by its owner. Assignment is not structural editing.
    const canSee = location.scope === 'shared'
      || location.created_by === user.email
      || location.owner_email === user.email
      || user.role === 'admin';
    if (!canSee) return Response.json({ error: 'Forbidden' }, { status: 403 });

    if (!['medical', 'jail_prison'].includes(location.category)) {
      return Response.json({ error: 'This location has no patient rooms or cells.' }, { status: 400 });
    }

    const units = location.residential_units || [];

    // ── READ-ONLY ROSTER ──────────────────────────────────────────────────────
    // Names/avatars for the people already assigned to this facility's spaces.
    // Only IDs that are actually assigned here are returned.
    if (action === 'roster') {
      const assignedIds = new Set();
      units.forEach((u) => (u.occupant_character_ids || []).forEach((id) => assignedIds.add(id)));
      const requested = Array.isArray(body.character_ids) ? body.character_ids.filter((id) => assignedIds.has(id)) : [...assignedIds];
      if (requested.length === 0) return Response.json({ characters: [] });
      const records = await base44.asServiceRole.entities.Character.filter({ id: { $in: requested.slice(0, 200) } }, null, 200);
      return Response.json({
        characters: records.map((c) => ({ id: c.id, name: c.name || c.display_name, avatar_url: c.avatar_url || null })),
      });
    }

    const unit = units.find((u) => u.unit_id === unitId);
    if (!unit) return Response.json({ error: 'Room or cell not found' }, { status: 404 });

    const character = await base44.asServiceRole.entities.Character.get(characterId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    // Only the caller's own character can be placed or removed here.
    const owns = character.owner_email === user.email || (!character.owner_email && character.created_by === user.email);
    if (!owns && user.role !== 'admin') {
      return Response.json({ error: 'You can only assign your own characters.' }, { status: 403 });
    }

    // A room or cell belongs to someone who is actually a patient or inmate here.
    const eligible = location.category === 'medical'
      ? isPatientHere(character, location)
      : isConfinedHere(character, location);
    if (!eligible) {
      return Response.json({ error: `${character.name || 'That character'} is not currently a patient or inmate at ${location.name}.` }, { status: 400 });
    }

    // One room or cell per person at this facility: assigning moves the assignment,
    // it never puts the same patient in two rooms. Every other unit, and every other
    // occupant, is left exactly as it is.
    const updatedUnits = units.map((u) => {
      const ids = new Set(u.occupant_character_ids || []);
      if (u.unit_id === unitId) {
        if (action === 'remove') ids.delete(characterId);
        else ids.add(characterId);
      } else if (action === 'assign') {
        ids.delete(characterId);
      }
      return { ...u, occupant_character_ids: [...ids] };
    });

    await base44.asServiceRole.entities.LocationReference.update(location.id, { residential_units: updatedUnits });

    return Response.json({ success: true, action, unit_id: unitId, character_id: characterId });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});