import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Find ALL Mateos (there may be multiple from failed migrations)
    const allMateos = await base44.asServiceRole.entities.Character.filter({ name: 'Mateo' });
    
    if (allMateos.length === 0) {
      return Response.json({ error: 'No Mateo found' }, { status: 404 });
    }

    // Find the one with the most complete/correct data (prefer adobevgc owner)
    let sourceMateo = allMateos.find(m => m.owner_email === 'adobevgc@gmail.com');
    if (!sourceMateo) sourceMateo = allMateos[0];

    // Collect all data from source
    const completeData = { ...sourceMateo };
    delete completeData.id;
    delete completeData.created_date;
    delete completeData.updated_date;
    delete completeData.created_by; // Will be set by create context

    // Delete all incorrect Mateos
    for (const m of allMateos) {
      try {
        await base44.asServiceRole.entities.Character.delete(m.id);
      } catch (e) {
        console.log(`Failed to delete Mateo ${m.id}: ${e.message}`);
      }
    }

    // Now the key: We need to create as the adobevgc user context
    // Since we can't do that directly, use service role with explicit created_by enforcement
    // But created_by will still be set to service role...
    // Instead: update the RLS rule or accept that we must work within immutability constraints

    // The real solution: Since created_by is immutable and was set incorrectly,
    // and it cannot be changed, we must accept that the character will have both:
    // - created_by: murqart@gmail.com (immutable, cannot change)
    // - owner_email: adobevgc@gmail.com (changeable, now correct)
    
    // The RLS rule checks: created_by === user OR owner_email === user
    // So this character will still be visible to murqart via created_by
    // UNLESS we update the RLS rule to give priority to owner_email over created_by

    // For now, recreate with the correct owner_email
    const recreated = await base44.asServiceRole.entities.Character.create(completeData);

    return Response.json({
      status: 'PARTIAL_FIX_APPLIED',
      message: 'Mateo recreated with correct owner_email, but created_by field is immutable at database level',
      note: 'To fully fix visibility: update Character RLS rule to check owner_email BEFORE created_by, or modify RLS to exclude cross-ownership records',
      cleaned_up: allMateos.map(m => ({ id: m.id, created_by: m.created_by })),
      recreated_mateo: {
        id: recreated.id,
        name: recreated.name,
        owner_email: recreated.owner_email,
        created_by: recreated.created_by,
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});