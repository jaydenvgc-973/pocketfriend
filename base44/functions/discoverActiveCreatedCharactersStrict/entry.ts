import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Use USER-SCOPED query with owner_email filter (RLS enforces user context)
    const characters = await base44.entities.Character.filter({
      character_type: 'active_created_character',
      owner_email: user.email,
    });

    const filtered = characters.filter(c => 
      c.is_test_character !== true &&
      c.diagnostic_only !== true &&
      c.exclude_from_homepage !== true
    );

    const results = filtered.map(c => ({
      name: c.name,
      id: c.id,
      character_type: c.character_type,
      owner_email: c.owner_email,
    }));

    return Response.json({
      count: results.length,
      characters: results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});