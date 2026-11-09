import { createClientFromRequest } from 'npm:@base44/sdk@0.8.59';

/**
 * fetchSharedResidencyOccupancy
 *
 * Read-only view of the administrator-shared residence (Gateway House) for every
 * signed-in user: who actually lives there and which apartment each resident
 * occupies — across accounts.
 *
 * Why it is server-side: Character reads are owner-scoped, so a resident on
 * another account cannot be resolved in the browser. The shared property's
 * resident list is the authoritative cross-account record, so this function
 * reads it with service role and resolves names/avatars for the ids it lists.
 *
 * Returns a sanitized projection only (id, name, avatar, unit) — never another
 * account's profile, memories, needs, finances or private fields.
 */
const GATEWAY_HOUSE_KEY = 'gateway_house';

const asArray = (res) => (Array.isArray(res) ? res : (res?.items || []));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { location_id = null } = await req.json().catch(() => ({}));

    const found = await base44.asServiceRole.entities.LocationReference
      .filter(location_id ? { id: location_id } : { canonical_location_key: GATEWAY_HOUSE_KEY })
      .catch(() => []);
    const loc = asArray(found).find((l) => l.canonical_location_key === GATEWAY_HOUSE_KEY) || null;
    if (!loc) {
      return Response.json({ found: false, residents: [], units: [], resident_count: 0, unit_count: 0 });
    }

    const units = (loc.residential_units || []).map((u) => ({
      unit_id: u.unit_id,
      unit_name: u.unit_name,
      occupant_ids: u.occupant_character_ids || [],
    }));

    const nameById = new Map();
    (loc.residents || []).forEach((r) => {
      if (r.character_id && r.character_name) nameById.set(r.character_id, r.character_name);
    });

    const residentIds = Array.from(new Set([
      ...(loc.resident_character_ids || []),
      ...(loc.residents || []).map((r) => r.character_id).filter(Boolean),
      ...units.flatMap((u) => u.occupant_ids),
    ]));

    let chars = [];
    if (residentIds.length > 0) {
      const res = await base44.asServiceRole.entities.Character
        .filter({ id: { $in: residentIds } })
        .catch(() => []);
      chars = asArray(res);
    }
    const byId = new Map(chars.map((c) => [c.id, c]));

    const person = (id) => {
      const c = byId.get(id);
      return {
        id,
        name: c?.name || nameById.get(id) || 'Resident',
        avatar_url: c?.avatar_url || c?.image_avatar_url || null,
      };
    };

    const unitByChar = new Map();
    units.forEach((u) => u.occupant_ids.forEach((id) => unitByChar.set(id, u)));

    const residents = residentIds
      .map((id) => {
        const unit = unitByChar.get(id);
        return { ...person(id), unit_id: unit?.unit_id || null, unit_name: unit?.unit_name || null };
      })
      .sort((a, b) => String(a.unit_name || '~').localeCompare(String(b.unit_name || '~'))
        || String(a.name).localeCompare(String(b.name)));

    const outUnits = units.map((u) => ({
      unit_id: u.unit_id,
      unit_name: u.unit_name,
      occupants: u.occupant_ids.map(person),
    }));

    const cfgRes = await base44.asServiceRole.entities.SharedResidency
      .filter({ location_id: loc.id })
      .catch(() => []);
    const cfg = asArray(cfgRes)[0] || null;

    return Response.json({
      found: true,
      location_id: loc.id,
      location_name: loc.name,
      residents,
      units: outUnits,
      resident_count: residents.length,
      unit_count: outUnits.length,
      max_residents: Number(cfg?.max_residents) || 0,
      max_units: Number(cfg?.max_units) || 0,
    });
  } catch (error) {
    console.error('[fetchSharedResidencyOccupancy]', error.message);
    return Response.json({ found: false, error: error.message, residents: [], units: [] }, { status: 500 });
  }
});