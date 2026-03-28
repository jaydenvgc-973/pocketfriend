import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const charId = body?.characterId;
    
    if (!charId) return Response.json({ error: 'need id' }, { status: 400 });
    
    const msgs = await base44.entities.Message.filter({ character_id: charId }, '-created_date', 100);
    return Response.json({ success: true, count: msgs?.length || 0 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});