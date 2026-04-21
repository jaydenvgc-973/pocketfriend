import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Find Mateo
    const mateos = await base44.entities.Character.filter({ name: 'Mateo' });
    const mateo = mateos[0];

    if (!mateo) {
      return Response.json({ error: 'Mateo character not found' }, { status: 404 });
    }

    // Look up the adobevgc user to get their ID
    const adobevgcUsers = await base44.entities.User.filter({ email: 'adobevgc@gmail.com' });
    const adobevgcUser = adobevgcUsers[0];

    if (!adobevgcUser) {
      return Response.json({ 
        error: 'adobevgc@gmail.com user not found in system',
        note: 'Cannot set owner_user_id without a valid user account'
      }, { status: 404 });
    }

    // Update with correct ownership
    const updateData = {
      owner_email: 'adobevgc@gmail.com',
      owner_user_id: adobevgcUser.id,
    };

    const updated = await base44.entities.Character.update(mateo.id, updateData);

    return Response.json({
      success: true,
      message: 'Mateo ownership corrected to adobevgc@gmail.com',
      before: {
        created_by: mateo.created_by,
        owner_email: mateo.owner_email,
      },
      after: {
        created_by: updated.created_by,
        owner_email: updated.owner_email,
        owner_user_id: updated.owner_user_id,
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});