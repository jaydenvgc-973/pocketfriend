import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105';
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb';
    const TARGET_IDS = [
      '69cc3d44b25d3fd3a0fd6452', // Stephanie
      '69cc3d42d6ca008ac66f34fd', // Sarah
      '69cc3d5da03ec2209200dff4', // Marisol
      '69cc3d612394d529d2754ccb', // Vanessa
      '69cc3d43cc9d37cbf0c6888d', // Larry
    ];

    const fmt = (c) => ({
      id: c.id,
      name: c.name,
      current_home_location_id: c.current_home_location_id,
      resolved_current_location_id: c.resolved_current_location_id,
      resolved_current_location_name: c.resolved_current_location_name,
      resolved_source_reason: c.resolved_source_reason,
      still_at_personal_home: c.resolved_current_location_id === PERSONAL_HOME_ID || c.current_home_location_id === PERSONAL_HOME_ID,
    });

    const results = [];
    for (const id of TARGET_IDS) {
      const arr = await base44.entities.Character.filter({ id });
      if (arr[0]) results.push(fmt(arr[0]));
    }

    return Response.json({
      verification_timestamp: new Date().toISOString(),
      characters: results,
      any_still_at_personal_home: results.some(r => r.still_at_personal_home),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});