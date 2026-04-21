import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all Mateos
    const mateos = await base44.asServiceRole.entities.Character.list('-created_date', 100);
    const mateoList = mateos.filter(c => c.name === 'Mateo');

    if (mateoList.length === 0) {
      return Response.json({ error: 'No Mateo found' }, { status: 404 });
    }

    // Get the one with owner_email = adobevgc (the intended owner)
    const correctMateo = mateoList.find(m => m.owner_email === 'adobevgc@gmail.com');

    if (!correctMateo) {
      return Response.json({ error: 'No Mateo with adobevgc owner found' }, { status: 404 });
    }

    // Try updating created_by using raw field mutation with service role
    // The trick: we update ONLY created_by, preserving everything else
    const updated = await base44.asServiceRole.entities.Character.update(correctMateo.id, {
      created_by: 'adobevgc@gmail.com'
    });

    // Verify it actually changed
    const verified = await base44.asServiceRole.entities.Character.list('-created_date', 1).then(chars => 
      chars.find(c => c.id === correctMateo.id)
    );

    return Response.json({
      success: true,
      message: 'Attempted forced created_by update',
      before: {
        id: correctMateo.id,
        name: correctMateo.name,
        created_by: correctMateo.created_by,
        owner_email: correctMateo.owner_email,
      },
      after: {
        id: updated.id,
        name: updated.name,
        created_by: updated.created_by,
        owner_email: updated.owner_email,
      },
      verified: {
        id: verified?.id,
        created_by: verified?.created_by,
        owner_email: verified?.owner_email,
      }
    });
  } catch (error) {
    return Response.json({ 
      error: error.message,
      errorType: error.constructor.name,
      details: error.toString()
    }, { status: 500 });
  }
});