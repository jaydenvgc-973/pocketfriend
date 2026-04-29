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

    const mapChar = (c) => ({
      id: c.id,
      name: c.name,
      owner_email: c.owner_email,
      character_type: c.character_type,
      status: c.status,
      current_home_location_id: c.current_home_location_id || null,
      occupation_location_id: c.occupation_location_id || null,
      resolved_presence_status: c.resolved_presence_status || null,
    });

    // QUERY 4: Name search — "Melody" (no owner/type filter)
    const melodyByShortName = await base44.asServiceRole.entities.Character.filter({ name: 'Melody' });

    // QUERY 5: Name search — "Melody Jackson Perry" (no owner/type filter)
    const melodyByFullName = await base44.asServiceRole.entities.Character.filter({ name: 'Melody Jackson Perry' });

    const TARGET_EMAIL = 'murqart@gmail.com';

    // QUERY 6A: owner_email + exact name "Melody Jackson Perry"
    const q6a = await base44.asServiceRole.entities.Character.filter({
      owner_email: TARGET_EMAIL,
      name: 'Melody Jackson Perry'
    });

    // QUERY 6B: owner_email + primary_name "Melody Jackson Perry"
    const q6b = await base44.asServiceRole.entities.Character.filter({
      owner_email: TARGET_EMAIL,
      primary_name: 'Melody Jackson Perry'
    });

    // QUERY 6C: owner_email only — with explicit high limit to test pagination cap
    // Base44 .filter() accepts (filter, sort, limit) — try limit 500
    const q6c = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL },
      '-created_date',
      500
    );

    // QUERY 6D: no filter, high limit — see total visible to service role
    const q6d = await base44.asServiceRole.entities.Character.filter(
      {},
      '-created_date',
      500
    );

    const mapChar2 = (c) => ({
      id: c.id,
      name: c.name,
      primary_name: c.primary_name || null,
      owner_email: c.owner_email || null,
      character_type: c.character_type || null,
      status: c.status || null,
    });

    // Type breakdown for high-limit owner query
    const typeBreakdown6c = {};
    for (const c of q6c) {
      const t = c.character_type || 'MISSING_TYPE';
      typeBreakdown6c[t] = (typeBreakdown6c[t] || 0) + 1;
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
      query3_melody_by_id: {
        found: !!melody,
        data: melody,
      },
      query4_name_melody: {
        count: melodyByShortName.length,
        results: melodyByShortName.map(mapChar),
      },
      query5_name_melody_jackson_perry: {
        count: melodyByFullName.length,
        results: melodyByFullName.map(mapChar),
      },
      query6a_owner_email_plus_name: {
        count: q6a.length,
        results: q6a.map(mapChar2),
      },
      query6b_owner_email_plus_primary_name: {
        count: q6b.length,
        results: q6b.map(mapChar2),
      },
      query6c_owner_email_limit500: {
        count: q6c.length,
        type_breakdown: typeBreakdown6c,
        note: 'If count > query2 total, default filter was paginated/capped',
        all_names: q6c.map(c => ({ id: c.id, name: c.name, character_type: c.character_type })),
      },
      query6d_no_filter_limit500: {
        count: q6d.length,
        note: 'Total records visible to service role with limit=500',
      },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});