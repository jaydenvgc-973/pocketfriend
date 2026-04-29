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

    // QUERY 3: Fetch Melody by specific ID
    const melodyId = '69cef8406d65304465075d79';
    const allForMelody = await base44.asServiceRole.entities.Character.filter({ id: melodyId });
    const melodyRaw = allForMelody[0] || null;
    const melody = melodyRaw ? {
      id: melodyRaw.id,
      name: melodyRaw.name,
      owner_email: melodyRaw.owner_email,
      character_type: melodyRaw.character_type,
      status: melodyRaw.status,
      resolved_presence_status: melodyRaw.resolved_presence_status,
      current_home_location_id: melodyRaw.current_home_location_id,
      occupation_location_id: melodyRaw.occupation_location_id,
      work_start_time: melodyRaw.work_start_time,
      work_end_time: melodyRaw.work_end_time,
      work_days: melodyRaw.work_days,
    } : null;

    return Response.json({
      query1_active_created_character: {
        count: activeChars.length,
        characters: activeList,
      },
      query2_all_by_owner_email: {
        total_count: allChars.length,
        type_breakdown: typeBreakdown,
      },
      query3_melody_by_id: {
        found: !!melody,
        data: melody,
      },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});