import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Find Mateo
    const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);
    const mateo = allChars.find(c => c.name === 'Mateo');

    if (!mateo) {
      return Response.json({ error: 'Mateo not found' }, { status: 404 });
    }

    // Check what both accounts see
    const murqartChars = await base44.asServiceRole.entities.Character.filter({ 
      created_by: 'murqart@gmail.com' 
    });
    const murqartOwned = await base44.asServiceRole.entities.Character.filter({ 
      owner_email: 'murqart@gmail.com' 
    });

    const adobevgcChars = await base44.asServiceRole.entities.Character.filter({ 
      created_by: 'adobevgc@gmail.com' 
    });
    const adobevgcOwned = await base44.asServiceRole.entities.Character.filter({ 
      owner_email: 'adobevgc@gmail.com' 
    });

    const mateoInMurqartCreated = murqartChars.some(c => c.id === mateo.id);
    const mateoInMurqartOwned = murqartOwned.some(c => c.id === mateo.id);
    const mateoInAdobevgcCreated = adobevgcChars.some(c => c.id === mateo.id);
    const mateoInAdobevgcOwned = adobevgcOwned.some(c => c.id === mateo.id);

    return Response.json({
      mateoData: {
        id: mateo.id,
        name: mateo.name,
        created_by: mateo.created_by,
        owner_email: mateo.owner_email,
      },
      placement: {
        in_murqart_created_by: mateoInMurqartCreated,
        in_murqart_owner_email: mateoInMurqartOwned,
        in_adobevgc_created_by: mateoInAdobevgcCreated,
        in_adobevgc_owner_email: mateoInAdobevgcOwned,
      },
      verdict: {
        wrongly_visible_to_murqart: mateoInMurqartCreated || mateoInMurqartOwned,
        correctly_visible_to_adobevgc: mateoInAdobevgcCreated || mateoInAdobevgcOwned,
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});