import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Compact version - returns ONLY name/id/home fields for the 6 misassigned chars.
 * NO WRITES.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105';
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb';

    const all = await base44.entities.Character.list('-updated_date', 100);

    const pts = all.filter(c =>
      c.current_home_location_id === PERSONAL_HOME_ID ||
      c.home_location_id === PERSONAL_HOME_ID
    );

    // Also check Larry, Linda, Thomas specifically
    const llt = all.filter(c =>
      ['larry', 'linda thompson', 'thomas'].some(n => c.name?.toLowerCase() === n) &&
      c.character_type === 'npc_family_member'
    );

    return Response.json({
      all_pointing_to_personal_home: pts.map(c => ({
        id: c.id,
        name: c.name,
        type: c.character_type,
        home: c.current_home_location_id,
        resolved: c.resolved_current_location_id,
        reason: c.resolved_source_reason,
      })),
      larry_linda_thomas_check: llt.map(c => ({
        id: c.id,
        name: c.name,
        home: c.current_home_location_id,
        resolved: c.resolved_current_location_id,
        reason: c.resolved_source_reason,
      })),
      // What SHOULD be their canonical home? Family Home ID is:
      correct_home_for_family: FAMILY_HOME_ID,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});