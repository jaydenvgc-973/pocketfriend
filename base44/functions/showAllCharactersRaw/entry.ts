import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get ALL characters, no filters
    const allChars = await base44.asServiceRole.entities.Character.filter({}, '-created_date', 200);

    console.log(`\n========================================`);
    console.log(`TOTAL CHARACTERS IN SYSTEM: ${allChars.length}`);
    console.log(`========================================\n`);

    const results = [];
    
    for (const char of allChars) {
      const entry = {
        name: char.name,
        id: char.id,
        status: char.status,
        created_by: char.created_by,
        owner_email: char.owner_email,
        reference_images: (char.reference_image_urls || []).length,
        home_location: char.current_home_location_id || char.home_location_id || 'NONE',
      };
      
      console.log(`${char.name} (${char.id})`);
      console.log(`  Status: ${char.status}`);
      console.log(`  Owner: ${char.owner_email || char.created_by}`);
      console.log(`  Ref Images: ${(char.reference_image_urls || []).length}`);
      console.log(`  Home Loc: ${char.current_home_location_id || char.home_location_id || 'NONE'}\n`);
      
      results.push(entry);
    }

    return Response.json({
      total: allChars.length,
      characters: results
    });

  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});