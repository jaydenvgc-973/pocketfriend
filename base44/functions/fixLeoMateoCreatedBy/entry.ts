import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const leoId = '69e2ac3276e99598733d00f4';
    const mateoId = '69e2adcd435862dcccb898a0';
    const targetEmail = 'adobevgc@gmail.com';

    // Update both characters to have created_by = adobevgc@gmail.com
    const leo = await base44.asServiceRole.entities.Character.filter({ id: leoId });
    const mateo = await base44.asServiceRole.entities.Character.filter({ id: mateoId });

    if (leo[0]) {
      await base44.asServiceRole.entities.Character.update(leoId, {
        created_by: targetEmail
      });
    }

    if (mateo[0]) {
      await base44.asServiceRole.entities.Character.update(mateoId, {
        created_by: targetEmail
      });
    }

    return Response.json({
      success: true,
      updated: {
        leo: leo[0] ? `Updated Leo to created_by: ${targetEmail}` : 'Leo not found',
        mateo: mateo[0] ? `Updated Mateo to created_by: ${targetEmail}` : 'Mateo not found'
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});