import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'adobevgc@gmail.com';
    const leoId = '69e2ac3276e99598733d00f4';
    const mateoId = '69e2adcd435862dcccb898a0';

    // Update both characters to belong to adobevgc@gmail.com
    await base44.asServiceRole.entities.Character.update(leoId, {
      created_by: targetEmail,
      owner_email: targetEmail
    });

    await base44.asServiceRole.entities.Character.update(mateoId, {
      created_by: targetEmail,
      owner_email: targetEmail
    });

    return Response.json({
      success: true,
      message: 'Leo and Mateo ownership corrected to adobevgc@gmail.com'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});