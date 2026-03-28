import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Update Nathan's avatar to null to allow regeneration
    // ID from the database read: 69c7b299fe07fcd80eedfdfc
    const nathanId = '69c7b299fe07fcd80eedfdfc';
    
    await base44.asServiceRole.entities.Character.update(nathanId, {
      avatar_url: null
    });

    return Response.json({
      success: true,
      message: 'Nathan avatar cleared for regeneration',
      nathanId
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});