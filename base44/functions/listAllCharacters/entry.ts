import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user?.email) return Response.json({ error: 'No user' }, { status: 401 });

    // Get user's active characters
    const activeChars = await base44.asServiceRole.entities.Character.filter({
      status: 'active',
      character_type: 'active_created_character'
    }, null, 50);

    console.log(`\nTotal ACTIVE characters in system: ${activeChars.length}`);
    activeChars.forEach(c => {
      console.log(`- ${c.name} (${c.id}) | owner: ${c.created_by || c.owner_email}`);
    });

    return Response.json({
      total: activeChars.length,
      characters: activeChars.map(c => ({
        name: c.name,
        id: c.id,
        created_by: c.created_by,
        owner_email: c.owner_email,
        has_reference_images: (c.reference_image_urls || []).length > 0,
        reference_count: (c.reference_image_urls || []).length,
      }))
    });

  } catch (error) {
    console.error('[listAllCharacters] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});