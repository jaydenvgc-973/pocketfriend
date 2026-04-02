import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * migrateGenericLocationTypes
 * 
 * One-time migration to backfill the generic_type field on existing generic locations.
 * Maps locations based on category and is_default_generic flag.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all locations marked as default generic
    const genericLocs = await base44.asServiceRole.entities.LocationReference.filter(
      { is_default_generic: true }
    );

    const typeMapping = {
      outdoor: 'park',
      medical: 'hospital',
      grocery: 'grocery',
      religion: 'worship',
    };

    const updated = [];
    const skipped = [];

    for (const loc of genericLocs) {
      // Skip if already has generic_type
      if (loc.generic_type) {
        skipped.push(`${loc.name} (already has generic_type: ${loc.generic_type})`);
        continue;
      }

      // Map category to generic_type
      const genericType = typeMapping[loc.category];
      if (!genericType) {
        skipped.push(`${loc.name} (unknown category: ${loc.category})`);
        continue;
      }

      // Update the location with generic_type
      await base44.asServiceRole.entities.LocationReference.update(loc.id, {
        generic_type: genericType,
        generic_type_label: genericType,
      });

      updated.push(`${loc.name} → generic_type: ${genericType}`);
    }

    return Response.json({
      success: true,
      updated: updated.length,
      skipped: skipped.length,
      details: {
        updated,
        skipped,
      },
      message: `Migration complete. Updated ${updated.length} location(s).`,
    });
  } catch (error) {
    console.error('[migrateGenericLocationTypes]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});