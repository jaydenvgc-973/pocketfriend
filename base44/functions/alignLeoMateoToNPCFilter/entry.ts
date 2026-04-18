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

    // Align both characters to match NPCContactPanel filter requirements
    await base44.asServiceRole.entities.Character.update(leoId, {
      owner_email: targetEmail,
      protected_active: false
    });

    await base44.asServiceRole.entities.Character.update(mateoId, {
      owner_email: targetEmail,
      protected_active: false
    });

    return Response.json({
      success: true,
      message: 'Leo and Mateo aligned to NPC filter requirements',
      updated: [
        { id: leoId, name: 'Leo', owner_email: targetEmail, protected_active: false },
        { id: mateoId, name: 'Mateo', owner_email: targetEmail, protected_active: false }
      ]
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});