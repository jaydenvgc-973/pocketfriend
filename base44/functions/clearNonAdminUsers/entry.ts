import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function
    if (!user || user.email !== 'murqart@gmail.com') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch all users
    const allUsers = await base44.asServiceRole.entities.User.list();

    // Delete all except murqart@gmail.com
    const toDelete = (allUsers || []).filter(u => u.email !== 'murqart@gmail.com');
    const deleted = [];

    for (const userToDelete of toDelete) {
      await base44.asServiceRole.entities.User.delete(userToDelete.id);
      deleted.push(userToDelete.email);
    }

    return Response.json({
      success: true,
      deleted_count: deleted.length,
      deleted_emails: deleted,
      message: `Cleared ${deleted.length} non-admin users. murqart@gmail.com preserved.`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});