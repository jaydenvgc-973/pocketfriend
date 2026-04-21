import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Find Mateo by name
    const mateos = await base44.entities.Character.filter({ name: 'Mateo' });
    const mateo = mateos[0];

    if (!mateo) {
      return Response.json({ error: 'Mateo character not found' }, { status: 404 });
    }

    // Update Mateo's created_by and owner_email to adobevgc@gmail.com
    const updated = await base44.entities.Character.update(mateo.id, {
      created_by: 'adobevgc@gmail.com',
      owner_email: 'adobevgc@gmail.com',
      owner_user_id: 'adobevgc_user_id', // placeholder if needed
    });

    return Response.json({
      success: true,
      message: 'Mateo ownership corrected',
      character: {
        id: updated.id,
        name: updated.name,
        created_by: updated.created_by,
        owner_email: updated.owner_email,
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});