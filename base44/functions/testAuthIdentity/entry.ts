import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    // Test non-service-role write (single field, safe)
    let writeResult = null;
    if (user) {
      // Try writing to a known character we can read
      const chars = await base44.entities.Character.list(null, 10);
      const activeCreated = chars.filter(c => c.character_type === 'active_created_character' && c.status === 'active');
      if (activeCreated.length > 0) {
        const target = activeCreated[0];
        try {
          await base44.entities.Character.update(target.id, {
            last_need_simulated_at: new Date().toISOString(),
          });
          writeResult = { success: true, targetName: target.name, targetId: target.id };
        } catch (e) {
          writeResult = { success: false, error: e.message, status: e.status, targetName: target.name };
        }
      }
    }

    return Response.json({
      authenticated: !!user,
      userEmail: user?.email || null,
      userRole: user?.role || null,
      userId: user?.id || null,
      writeResult,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});