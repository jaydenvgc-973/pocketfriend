import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Verify the 6 characters are actually assigned to VGC Towers
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const targetNames = ['Carlos Mendez', 'Demi Rivers', 'Jordan Li', 'Leah Park', 'Mace', 'Mia Chen'];
    
    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    const report = [];

    for (const char of characters) {
      if (targetNames.includes(char.name)) {
        report.push({
          character_name: char.name,
          current_home_location_id: char.current_home_location_id,
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name
        });
      }
    }

    return Response.json({
      status: 'VERIFICATION',
      report
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});