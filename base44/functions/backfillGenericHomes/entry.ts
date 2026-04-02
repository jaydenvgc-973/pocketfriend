import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // CRITICAL: This function no longer creates generic homes
    // Auto-creation of generic locations (parks, hospitals, grocery stores, apartments) has been disabled
    // Users must explicitly create all locations via the Locations page
    
    return Response.json({
      success: false,
      message: 'Generic location auto-creation is disabled. Users must explicitly create locations via the Locations page.',
      warning: 'This function is deprecated and no longer generates homes, parks, hospitals, or grocery stores.',
    });
  } catch (error) {
    console.error('[backfillGenericHomes]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});