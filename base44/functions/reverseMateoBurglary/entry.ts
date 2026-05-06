import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CRITICAL FIX: Transfer Mateo back to adobevgc@gmail.com
 * Mateo was incorrectly transferred - it belongs to adobevgc, not murqart.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Mateo by name and current ownership
    const mateos = await base44.asServiceRole.entities.Character.filter(
      { owner_email: 'murqart@gmail.com', name: 'Mateo' },
      'created_date',
      10
    );

    if (mateos.length === 0) {
      return Response.json({ error: 'Mateo not found on murqart account' }, { status: 404 });
    }

    const mateo = mateos[0];

    // Transfer Mateo back to adobevgc@gmail.com
    await base44.asServiceRole.entities.Character.update(mateo.id, {
      owner_email: 'adobevgc@gmail.com',
    });

    console.log(`[reverseMateoBurglary] Mateo (${mateo.id}) transferred back to adobevgc@gmail.com`);

    return Response.json({
      success: true,
      mateo_id: mateo.id,
      mateo_name: mateo.name,
      restored_to: 'adobevgc@gmail.com',
    });
  } catch (error) {
    console.error('[reverseMateoBurglary]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});