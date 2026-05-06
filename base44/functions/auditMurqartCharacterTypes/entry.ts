import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditMurqartCharacterTypes
 * Returns a clean summary of ALL Character records owned by murqart@gmail.com
 * with just: id, name, character_type, status, owner_email
 * No large data fields — no truncation risk.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Service role — full scope read
    const all = await base44.asServiceRole.entities.Character.filter(
      { owner_email: 'murqart@gmail.com' },
      '-created_date',
      300
    );

    const summary = all.map(c => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      status: c.status,
      owner_email: c.owner_email,
      owner_user_id: c.owner_user_id,
      is_test_character: c.is_test_character,
      diagnostic_only: c.diagnostic_only,
      exclude_from_homepage: c.exclude_from_homepage,
    }));

    const byType = {};
    for (const c of summary) {
      const t = c.character_type || 'MISSING';
      if (!byType[t]) byType[t] = [];
      byType[t].push(c.name);
    }

    return Response.json({
      total: summary.length,
      by_type: byType,
      all: summary,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});