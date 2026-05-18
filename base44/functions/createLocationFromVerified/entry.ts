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

    // Create LocationReference
    const locRef = await base44.entities.LocationReference.create({
      name: vl.place_name,
      location_type: 'global',
      category,
      description: vl.formatted_address || '',
      is_user_created: true,
      keywords: [vl.place_name.toLowerCase(), vl.city?.toLowerCase()].filter(Boolean),
      image_urls: vl.image_url ? [vl.image_url] : [],
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