import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Extract ONLY active_created_character from discovery paths
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // PATH 1: Home page dual-merge for active_created_character
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }, "-created_date"),
      base44.entities.Character.filter({ owner_email: user.email }, "-created_date"),
    ]);

    const homeMerged = [];
    const homeSeen = new Set();
    for (const c of [...byCreatedBy, ...byOwnerEmail]) {
      if (homeSeen.has(c.id)) continue;
      homeSeen.add(c.id);
      if (c.is_test_character === true) continue;
      if (c.diagnostic_only === true) continue;
      if (c.exclude_from_homepage === true) continue;
      if (c.character_type !== 'active_created_character') continue;
      homeMerged.push(c);
    }

    // PATH 2: Travel page filter
    const travelQuery = await base44.entities.Character.filter({
      created_by: user.email,
      status: "active",
      character_type: "active_created_character"
    });

    return Response.json({
      user_email: user.email,
      path_1_home_active_created_only: {
        count: homeMerged.length,
        characters: homeMerged.map(c => ({
          id: c.id,
          name: c.name,
          created_by: c.created_by,
          owner_email: c.owner_email,
          status: c.status,
          current_home_location_id: c.current_home_location_id || null,
          resolved_current_location_name: c.resolved_current_location_name || null,
        })),
      },
      path_2_travel_active_created: {
        count: travelQuery.length,
        characters: travelQuery.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
        })),
      },
      discovery_verdict: homeMerged.length === 10 ? "✓ PATH 1 finds all 10" : (travelQuery.length === 10 ? "✓ PATH 2 finds all 10" : `✗ BOTH PATHS FAIL: Path 1=${homeMerged.length}, Path 2=${travelQuery.length}`),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});