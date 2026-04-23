import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const allChars = await base44.asServiceRole.entities.Character.filter({}, '-created_date', 500);
    
    const list = allChars.map(c => ({
      id: c.id,
      name: c.name,
      home_location_id: c.home_location_id || c.current_home_location_id || c.resolved_current_location_id || null,
    }));

    console.log(`[CHARS] Total characters: ${list.length}`);
    list.forEach(c => {
      console.log(`[CHARS] "${c.name}" (${c.id}) → home_loc=${c.home_location_id || 'NONE'}`);
    });

    return Response.json({ characters: list });
  } catch (error) {
    console.error('[listAllCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});