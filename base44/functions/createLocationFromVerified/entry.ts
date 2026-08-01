import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Creates a LocationReference from a VerifiedRealLocation record
 * and links them together. Idempotent — if already linked, returns existing.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { verifiedLocationId } = await req.json();
    if (!verifiedLocationId) return Response.json({ error: 'verifiedLocationId required' }, { status: 400 });

    const verified = await base44.entities.VerifiedRealLocation.filter({ id: verifiedLocationId });
    if (!verified.length) return Response.json({ error: 'Verified location not found' }, { status: 404 });

    const vl = verified[0];

    // Idempotent: return existing LocationReference if already linked
    if (vl.linked_location_reference_id) {
      return Response.json({ location_reference_id: vl.linked_location_reference_id, created: false });
    }

    // ── NAME-NORMALIZATION DUPLICATE GUARD ────────────────────────────────────
    // Before creating a new LocationReference, check whether a matching location
    // already exists by normalized name. This prevents blank shell duplicates
    // (e.g. a second "The Velvet Bean - Café" with 0 zones and 0 images).
    //
    // Normalization: trimmed, lowercase, unicode-normalized, punctuation-collapsed.
    const normalizeLocName = (n) =>
      (n || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
        .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const candidateName = normalizeLocName(vl.place_name);
    if (candidateName) {
      const allLocs = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
      const existing = allLocs.find(l => normalizeLocName(l.name) === candidateName);
      if (existing) {
        console.log(`[createLocationFromVerified] Reusing existing location "${existing.name}" (id=${existing.id}) — skipping duplicate create`);
        // Link the VerifiedRealLocation to the canonical existing record
        await base44.entities.VerifiedRealLocation.update(vl.id, {
          linked_location_reference_id: existing.id,
        });
        return Response.json({ location_reference_id: existing.id, created: false, reused: true });
      }
    }

    // Map category
    const categoryMap = {
      food_drink: 'food_drink', gym: 'gym', social: 'social', outdoor: 'outdoor',
      medical: 'medical', grocery: 'grocery', education: 'education',
      business: 'business', religion: 'religion', public: 'public', generic: 'generic',
    };
    const category = categoryMap[vl.app_location_category] || 'generic';

    // ── AUTO-POPULATE ZONES based on category ──────────────────────────────
    // Every real-world location gets 1–3 default zones so the Scene page can
    // render without a black screen. The auto-generated exterior image is
    // assigned to the first zone (Front Entrance).
    const CATEGORY_ZONES: Record<string, Array<{ zone_name: string; zone_description: string }>> = {
      food_drink: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Main Dining Area', zone_description: 'Where people sit to eat' },
        { zone_name: 'Counter / Cashier', zone_description: 'Order and pickup area' },
      ],
      gym: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Workout Floor', zone_description: 'Main exercise area' },
        { zone_name: 'Locker Room', zone_description: 'Changing rooms and restrooms' },
      ],
      social: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Main Floor', zone_description: 'Main social area' },
        { zone_name: 'Bar Area', zone_description: 'Bar and seating' },
      ],
      outdoor: [
        { zone_name: 'Entrance', zone_description: 'Main entrance and approach' },
        { zone_name: 'Main Area', zone_description: 'Primary outdoor space' },
      ],
      medical: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Waiting Area', zone_description: 'Reception and waiting' },
        { zone_name: 'Patient Room', zone_description: 'Examination area' },
      ],
      grocery: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Main Floor', zone_description: 'Shopping area' },
        { zone_name: 'Checkout', zone_description: 'Cashier area' },
      ],
      education: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Main Hallway', zone_description: 'Central corridor' },
        { zone_name: 'Classroom', zone_description: 'Main classroom' },
      ],
      business: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Main Office', zone_description: 'Primary workspace' },
        { zone_name: 'Reception', zone_description: 'Front desk area' },
      ],
      religion: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Main Sanctuary', zone_description: 'Worship area' },
      ],
      public: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Main Area', zone_description: 'Primary public space' },
        { zone_name: 'Bathroom', zone_description: 'Restroom facilities' },
      ],
      generic: [
        { zone_name: 'Front Entrance', zone_description: 'Exterior and entrance' },
        { zone_name: 'Main Area', zone_description: 'Primary space' },
        { zone_name: 'Bathroom', zone_description: 'Restroom facilities' },
      ],
    };

    const zoneTemplates = CATEGORY_ZONES[category] || CATEGORY_ZONES.generic;
    const zones = zoneTemplates.map((z, i) => ({
      zone_name: z.zone_name,
      zone_description: z.zone_description,
      // Assign the auto-generated exterior image to the first zone only
      image_urls: (i === 0 && vl.image_url) ? [vl.image_url] : [],
    }));

    // Create LocationReference with zones + is_real_world flag
    // CRITICAL: owner_email must be set or fetchAllLocationsForUser (Query 1)
    // will filter this location out and the Scene page will show "Location not found".
    const locRef = await base44.entities.LocationReference.create({
      name: vl.place_name,
      location_type: 'global',
      category,
      description: vl.formatted_address || '',
      is_user_created: true,
      is_real_world: true,
      keywords: [vl.place_name.toLowerCase(), vl.city?.toLowerCase()].filter(Boolean),
      image_urls: vl.image_url ? [vl.image_url] : [],
      zones,
      owner_email: user.email,
      owner_user_id: user.id,
      created_by_role: user.role || 'user',
    });

    // Link back
    await base44.entities.VerifiedRealLocation.update(vl.id, {
      linked_location_reference_id: locRef.id,
    });

    return Response.json({ location_reference_id: locRef.id, created: true });
  } catch (error) {
    console.error('createLocationFromVerified error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});