import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const adobevgcEmail = 'adobevgc@gmail.com';
    const leoId = '69e2ac3276e99598733d00f4';
    const mateoId = '69e2adcd435862dcccb898a0';

    // Ensure both Leo and Mateo belong ONLY to adobevgc
    await base44.asServiceRole.entities.Character.update(leoId, {
      created_by: adobevgcEmail,
      owner_email: adobevgcEmail
    });

    await base44.asServiceRole.entities.Character.update(mateoId, {
      created_by: adobevgcEmail,
      owner_email: adobevgcEmail
    });

    // Verify they're now in fictional_relationships for any active character so they appear in "People In Their World"
    const activeChars = await base44.asServiceRole.entities.Character.filter({
      created_by: adobevgcEmail,
      character_type: 'active'
    });

    return Response.json({
      success: true,
      leo: { id: leoId, created_by: adobevgcEmail, owner_email: adobevgcEmail },
      mateo: { id: mateoId, created_by: adobevgcEmail, owner_email: adobevgcEmail },
      active_characters_count: activeChars.length
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});