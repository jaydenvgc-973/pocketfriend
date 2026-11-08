import { createClientFromRequest } from 'npm:@base44/sdk@0.8.59';

/**
 * configureSharedResidency
 *
 * Administrator control for Gateway House — the one shared residential property
 * where characters belonging to different user accounts may live together.
 *
 * The property is identified by its stable canonical location key, never by name.
 * Loading is idempotent: if the property or its configuration record does not
 * exist yet, they are created. Capacity limits are optional and are only ever
 * set by the administrator — an empty or 0 limit means no limit.
 */
const GATEWAY_HOUSE_KEY = 'gateway_house';

async function loadOrCreate(base44, user) {
  const locations = await base44.asServiceRole.entities.LocationReference
    .filter({ canonical_location_key: GATEWAY_HOUSE_KEY }, null, 5);
  let location = locations[0] || null;

  if (!location) {
    location = await base44.asServiceRole.entities.LocationReference.create({
      name: 'Gateway House',
      location_type: 'shared',
      scope: 'shared',
      category: 'home',
      canonical_location_key: GATEWAY_HOUSE_KEY,
      owner_email: user.email,
      created_by_role: user.role,
      is_user_created: true,
      'geo-mode': 'app_world',
      description:
        'A shared residence where characters from different households live under one roof. Each apartment holds its own household; everyone here shares the same building, the same front door, and the same neighbours.',
      resident_character_ids: [],
      resident_character_names: [],
      residents: [],
      residential_units: [],
    });
  }

  const configs = await base44.asServiceRole.entities.SharedResidency
    .filter({ canonical_location_key: GATEWAY_HOUSE_KEY }, null, 5);
  let config = configs[0] || null;

  if (!config) {
    config = await base44.asServiceRole.entities.SharedResidency.create({
      location_id: location.id,
      location_name: location.name,
      canonical_location_key: GATEWAY_HOUSE_KEY,
      owner_email: user.email,
    });
  } else if (config.location_id !== location.id || config.location_name !== location.name) {
    config = await base44.asServiceRole.entities.SharedResidency.update(config.id, {
      location_id: location.id,
      location_name: location.name,
    });
  }

  return { location, config };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { location, config } = await loadOrCreate(base44, user);

    let saved = config;
    if (body.action === 'save') {
      const toLimit = (value) => {
        if (value === null || value === undefined || value === '') return 0;
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      };
      saved = await base44.asServiceRole.entities.SharedResidency.update(config.id, {
        max_residents: toLimit(body.max_residents),
        max_units: toLimit(body.max_units),
      });
    }

    return Response.json({
      location: {
        id: location.id,
        name: location.name,
        canonical_location_key: location.canonical_location_key,
        resident_count: (location.resident_character_ids || []).length,
        unit_count: (location.residential_units || []).length,
      },
      config: {
        id: saved.id,
        max_residents: saved.max_residents || 0,
        max_units: saved.max_units || 0,
      },
    });
  } catch (error) {
    console.error('[configureSharedResidency]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});