import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Find Mateo
    const mateos = await base44.asServiceRole.entities.Character.filter({ name: 'Mateo' });
    const mateo = mateos[0];

    if (!mateo) {
      return Response.json({ error: 'Mateo not found' }, { status: 404 });
    }

    // Delete and recreate with correct created_by — only way to fix immutable field
    const charDataToRestore = {
      ...mateo,
      created_by: 'adobevgc@gmail.com',
      owner_email: 'adobevgc@gmail.com',
    };

    // Delete the old one
    await base44.asServiceRole.entities.Character.delete(mateo.id);

    // Recreate with correct ownership
    const recreated = await base44.asServiceRole.entities.Character.create(charDataToRestore);

    return Response.json({
      success: true,
      message: 'Mateo recreated with correct created_by and owner_email',
      oldId: mateo.id,
      newId: recreated.id,
      created_by: recreated.created_by,
      owner_email: recreated.owner_email,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});