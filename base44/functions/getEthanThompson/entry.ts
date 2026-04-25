import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Search all characters in system for "Ethan Thompson" by name pattern
    const allChars = await base44.asServiceRole.entities.Character.filter({
      name: { $regex: 'ethan', $options: 'i' }
    }, null, 100);

    console.log(`Found ${allChars.length} characters matching "ethan"`);
    
    let ethanThompson = null;
    for (const char of allChars) {
      console.log(`  - ${char.name} (${char.id}) | created_by: ${char.created_by}`);
      if (char.name?.toLowerCase().includes('thompson')) {
        ethanThompson = char;
      }
    }

    if (!ethanThompson) {
      return Response.json({ 
        error: 'Ethan Thompson not found',
        checked_count: allChars.length,
        names_found: allChars.map(c => c.name)
      }, { status: 404 });
    }

    return Response.json({
      id: ethanThompson.id,
      name: ethanThompson.name,
      created_by: ethanThompson.created_by,
      owner_email: ethanThompson.owner_email,
      reference_image_urls_count: (ethanThompson.reference_image_urls || []).length,
      has_home_location: !!ethanThompson.current_home_location_id || !!ethanThompson.home_location_id,
    });

  } catch (error) {
    console.error('[getEthanThompson] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});