import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get the broken Mateo record (it may have been recreated with wrong created_by)
    const mateos = await base44.asServiceRole.entities.Character.filter({ name: 'Mateo' });
    
    if (mateos.length === 0) {
      return Response.json({ error: 'No Mateo found' }, { status: 404 });
    }

    // If multiple Mateos exist due to recreation, delete the service-role ones and keep the original
    if (mateos.length > 1) {
      const origMateo = mateos.find(m => m.owner_email === 'adobevgc@gmail.com' && m.created_by === 'murqart@gmail.com');
      const wrongOnes = mateos.filter(m => m.id !== origMateo?.id);
      
      for (const wrong of wrongOnes) {
        await base44.asServiceRole.entities.Character.delete(wrong.id);
      }
    }

    const mateo = mateos.find(m => m.name === 'Mateo');
    if (!mateo) {
      return Response.json({ error: 'Mateo still not found after cleanup' }, { status: 404 });
    }

    // Store all Mateo's data
    const mateoData = JSON.stringify(mateo);

    // Backup current state
    const backup = {
      id: mateo.id,
      name: mateo.name,
      created_by: mateo.created_by,
      owner_email: mateo.owner_email,
    };

    // Delete the character
    await base44.asServiceRole.entities.Character.delete(mateo.id);

    // Reconstruct without the created_by override, letting the auth context set it
    const restored = await base44.entities.Character.create({
      ...mateo,
      id: undefined, // let DB generate new ID
      created_at: undefined,
      updated_at: undefined,
    });

    return Response.json({
      success: true,
      message: 'Mateo restoration completed',
      backup,
      restored: {
        id: restored.id,
        name: restored.name,
        created_by: restored.created_by,
        owner_email: restored.owner_email,
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});