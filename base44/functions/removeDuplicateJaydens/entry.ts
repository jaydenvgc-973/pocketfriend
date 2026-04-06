import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Removes all duplicate Jaydens, keeping only the default (user) character
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get ALL characters named Jayden for this user
    const jaydens = await base44.asServiceRole.entities.Character.filter({
      name: 'Jayden',
      created_by: user.email
    });

    // Find the default one (the real user)
    const defaultJayden = jaydens.find(j => j.is_default === true);
    
    if (!defaultJayden) {
      return Response.json({ 
        error: 'No default Jayden found',
        totalFound: jaydens.length
      }, { status: 400 });
    }

    // Delete all duplicates
    const duplicates = jaydens.filter(j => j.id !== defaultJayden.id);
    
    for (const dup of duplicates) {
      await base44.asServiceRole.entities.Character.delete(dup.id);
    }

    return Response.json({
      success: true,
      message: `Deleted ${duplicates.length} duplicate Jaydens`,
      keptDefault: defaultJayden.id,
      deletedIds: duplicates.map(d => d.id)
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});