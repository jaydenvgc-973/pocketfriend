/**
 * Find Ethan character in database
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Search for Ethan by name
    const ethanChars = await base44.asServiceRole.entities.Character.filter({
      name: { $regex: 'ethan', $options: 'i' }
    }, null, 20);

    console.log(`Found ${ethanChars.length} characters with "ethan" in name`);
    ethanChars.forEach(c => {
      console.log(`- ${c.name} (${c.id}) | created_by: ${c.created_by}`);
    });

    // Also search by name containing Thompson
    const thompsonChars = await base44.asServiceRole.entities.Character.filter({
      name: { $regex: 'thompson', $options: 'i' }
    }, null, 20);

    console.log(`\nFound ${thompsonChars.length} characters with "thompson" in name`);
    thompsonChars.forEach(c => {
      console.log(`- ${c.name} (${c.id}) | created_by: ${c.created_by}`);
    });

    return Response.json({
      ethan_results: ethanChars.map(c => ({ name: c.name, id: c.id, created_by: c.created_by })),
      thompson_results: thompsonChars.map(c => ({ name: c.name, id: c.id, created_by: c.created_by })),
    });

  } catch (error) {
    console.error('[findEthanCharacter] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});