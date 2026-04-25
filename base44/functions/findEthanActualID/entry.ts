import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Search for ANY character with "ethan" in the name
    const allChars = await base44.asServiceRole.entities.Character.filter({}, '-created_date', 500);
    
    const ethanMatches = allChars.filter(c => 
      c.name?.toLowerCase().includes('ethan') || 
      c.display_name?.toLowerCase().includes('ethan') ||
      c.full_name?.toLowerCase().includes('ethan')
    );

    console.log(`\n========== SEARCH RESULTS ==========\n`);
    console.log(`Total characters in system: ${allChars.length}`);
    console.log(`Characters matching "ethan": ${ethanMatches.length}\n`);

    for (const char of ethanMatches) {
      console.log(`Found: ${char.name} (${char.id})`);
      console.log(`  Status: ${char.status}`);
      console.log(`  Owner: ${char.owner_email || char.created_by}`);
      console.log(`  Created: ${char.created_date}`);
      console.log(`  Updated: ${char.updated_date}\n`);
    }

    return Response.json({
      totalCharacters: allChars.length,
      ethanMatches: ethanMatches.map(c => ({
        name: c.name,
        id: c.id,
        status: c.status,
        owner: c.owner_email,
        createdBy: c.created_by,
      }))
    });

  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});