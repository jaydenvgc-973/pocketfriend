import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * cleanupDuplicateVGCTowers
 *
 * Admin function to audit and remove duplicate VGC Towers from all user accounts.
 * Keeps only ONE VGC Towers per user (the one with template data).
 * Removes all blank/duplicate instances.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch all users
    const allUsers = await base44.asServiceRole.entities.User.list('', 1000);
    
    const results = {
      total_users: allUsers.length,
      users_with_duplicates: [],
      deleted_duplicates: 0,
      errors: [],
    };

    for (const u of allUsers) {
      try {
        // Fetch all VGC Towers for this user (created_by or owner_email, non-shared)
        const [byCreated, byOwner] = await Promise.all([
          base44.asServiceRole.entities.LocationReference.filter({
            created_by: u.email,
            name: 'VGC Towers',
            scope: { $ne: 'shared' }
          }),
          base44.asServiceRole.entities.LocationReference.filter({
            owner_email: u.email,
            name: 'VGC Towers',
            scope: { $ne: 'shared' }
          }),
        ]);

        const seen = new Set();
        const instances = [...byCreated, ...byOwner].filter(l => {
          if (seen.has(l.id)) return false;
          seen.add(l.id);
          return true;
        });

        if (instances.length <= 1) continue;

        // Sort: prioritize instances with image_urls and zones (template data)
        instances.sort((a, b) => {
          const aHasData = (a.image_urls?.length || 0) + (a.zones?.length || 0);
          const bHasData = (b.image_urls?.length || 0) + (b.zones?.length || 0);
          return bHasData - aHasData;
        });

        const [primary, ...duplicates] = instances;

        // Delete all duplicates
        const deletePromises = duplicates.map(dup =>
          base44.asServiceRole.entities.LocationReference.delete(dup.id).catch(err => ({ error: err.message, id: dup.id }))
        );
        const deleteResults = await Promise.all(deletePromises);

        const successfulDeletes = deleteResults.filter(r => !r?.error).length;
        results.deleted_duplicates += successfulDeletes;

        results.users_with_duplicates.push({
          user_email: u.email,
          total_instances: instances.length,
          kept: primary.id,
          deleted: successfulDeletes,
          failed: deleteResults.filter(r => r?.error).length,
        });

        console.log(`[cleanupDuplicateVGCTowers] ${u.email}: kept ${primary.id}, deleted ${successfulDeletes}`);
      } catch (err) {
        results.errors.push({ user_email: u.email, error: err.message });
      }
    }

    return Response.json(results);
  } catch (error) {
    console.error('[cleanupDuplicateVGCTowers]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});