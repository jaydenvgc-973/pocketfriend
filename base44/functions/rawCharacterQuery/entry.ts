import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    console.log('User email:', user.email);

    // Try all possible filter combinations
    const all = await base44.asServiceRole.entities.Character.filter({});
    
    // Group by type
    const byType = {};
    for (const c of all) {
      if (!byType[c.character_type]) byType[c.character_type] = [];
      byType[c.character_type].push({ id: c.id, name: c.name });
    }

    return Response.json({
      user_email: user.email,
      total_active: all.length,
      by_type: Object.entries(byType).map(([type, chars]) => ({
        type,
        count: chars.length,
        names: chars.map(c => c.name),
      })),
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});