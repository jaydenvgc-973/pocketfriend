import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const mateoId = '69e2adcd435862dcccb898a0';

    // Remove owner_email from Mateo so he only belongs to murqart
    await base44.asServiceRole.entities.Character.update(mateoId, {
      owner_email: 'murqart@gmail.com'
    });

    return Response.json({
      success: true,
      message: 'Mateo owner_email corrected to murqart@gmail.com only'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});