import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Verifies how many characters the user-scoped RLS filter returns
 * when filtering by owner_email, and breaks down by character_type.
 * This mirrors exactly what useOwnedCharacters does on the frontend.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Exact query used by useOwnedCharacters hook
    const chars = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      300
    );

    const filtered = chars.filter(c => !c.is_test_character && !c.diagnostic_only);

    const byType = {};
    for (const c of filtered) {
      const t = c.character_type || 'MISSING';
      if (!byType[t]) byType[t] = [];
      byType[t].push({ name: c.name, status: c.status, id: c.id });
    }

    const activeCreated = filtered.filter(
      c => c.character_type === 'active_created_character' && c.status !== 'deleted'
    );

    return Response.json({
      user_email: user.email,
      total_raw: chars.length,
      total_filtered: filtered.length,
      active_created_count: activeCreated.length,
      active_created_names: activeCreated.map(c => c.name),
      by_type: byType,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});