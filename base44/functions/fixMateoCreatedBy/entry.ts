import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const mateoId = '69e2adcd435862dcccb898a0';
    const targetEmail = 'adobevgc@gmail.com';

    // Fix Mateo's created_by field
    await base44.asServiceRole.entities.Character.update(mateoId, {
      created_by: targetEmail,
    });

    return Response.json({
      success: true,
      message: 'Mateo created_by corrected to adobevgc@gmail.com',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});