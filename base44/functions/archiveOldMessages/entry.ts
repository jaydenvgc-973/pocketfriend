import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // PHASE 1 BASELINE: Do nothing. Messages stay visible.
    // All archiving logic disabled until rewritten correctly.
    
    return Response.json({
      success: true,
      archived: 0,
      message: 'Archiving disabled for stability'
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});