import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// DIAGNOSTIC ONLY — no writes, no auth.me(), no created_by, no automation
// Purpose: verify service-role discovery scope for scheduledLocationEnforcement

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // NO base44.auth.me() — service role only

    // QUERY 1: active_created_character scoped to murqart@gmail.com
    const activeChars = await base44.asServiceRole.entities.Character.filter({
      owner_email: 'murqart@gmail.com',
      character_type: 'active_created_character'
    });

    const activeList = activeChars.map(c => ({
      id: c.id,
      name: c.name,
      owner_email: c.owner_email,
      character_type: c.character_type,
      status: c.status,
    }));

    // QUERY 2: all characters for murqart@gmail.com (no type filter)
    const allChars = await base44.asServiceRole.entities.Character.filter({
      owner_email: 'murqart@gmail.com'
    });

    // Build type breakdown
    const typeBreakdown = {};
    for (const c of allChars) {
      const t = c.character_type || 'MISSING_TYPE';
      typeBreakdown[t] = (typeBreakdown[t] || 0) + 1;
    }

    return Response.json({
      query1_active_created_character: {
        count: activeChars.length,
        characters: activeList,
      },
      query2_all_by_owner_email: {
        total_count: allChars.length,
        type_breakdown: typeBreakdown,
      },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});