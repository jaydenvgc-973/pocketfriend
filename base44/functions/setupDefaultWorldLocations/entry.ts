import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * setupDefaultWorldLocations — DISABLED
 *
 * Auto-creation of generic locations (parks, hospitals, grocery stores, worship)
 * is PERMANENTLY DISABLED. These locations pollute the user's location list
 * and are never desired.
 *
 * All location creation must happen explicitly through the Locations UI.
 * This function now ONLY deletes any stale generic locations it finds.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Delete ALL generic locations created by the system (any creator)
    const genericTypes = ['park', 'hospital', 'grocery', 'worship'];
    const deleted = [];

    for (const genericType of genericTypes) {
      const typeLocs = await base44.asServiceRole.entities.LocationReference.filter(
        { generic_type: genericType }
      );
      for (const loc of typeLocs) {
        await base44.asServiceRole.entities.LocationReference.delete(loc.id);
        deleted.push(`Deleted: ${loc.name} (${loc.id}) — created by ${loc.created_by}`);
        console.log(`[setupDefaultWorldLocations] DELETED generic location: ${loc.name} (${loc.id})`);
      }
    }

    // Also delete by name pattern for ones without generic_type set
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter(
      { is_default_generic: true }
    );
    for (const loc of allLocs) {
      if (!genericTypes.includes(loc.generic_type)) {
        // It's a generic location without a known type — delete it too unless it's NPC Hub
        if (loc.name !== 'NPC Hub') {
          await base44.asServiceRole.entities.LocationReference.delete(loc.id);
          deleted.push(`Deleted orphan generic: ${loc.name} (${loc.id})`);
        }
      }
    }

    return Response.json({
      success: true,
      deleted: deleted.length,
      details: deleted,
      message: deleted.length > 0
        ? `Cleaned up ${deleted.length} generic location(s). Auto-creation is permanently disabled.`
        : 'No generic locations found. All clean.',
    });
  } catch (error) {
    console.error('[setupDefaultWorldLocations]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});