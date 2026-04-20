import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ensureAllUsersHaveVGCTowers
 *
 * Admin function that ensures EVERY user in the system has their own private VGC Towers.
 * - Audits all users
 * - Creates missing VGC Towers locations
 * - Returns completion status
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
    
    const missingUsers = [];
    
    // Identify users without VGC Towers
    for (const u of allUsers) {
      const userVGC = await base44.asServiceRole.entities.LocationReference.filter({
        created_by: u.email,
        name: 'VGC Towers',
        scope: { $ne: 'shared' }
      }).then(r => r[0] || null);

      const ownerVGC = await base44.asServiceRole.entities.LocationReference.filter({
        owner_email: u.email,
        name: 'VGC Towers',
        scope: { $ne: 'shared' }
      }).then(r => r[0] || null);

      if (!userVGC && !ownerVGC) {
        missingUsers.push(u.email);
      }
    }

    // Create VGC Towers for each missing user using service role
    const created = [];
    const errors = [];

    for (const userEmail of missingUsers) {
      try {
        const sharedVGC = await base44.asServiceRole.entities.LocationReference.filter({
          scope: 'shared',
          name: 'VGC Towers'
        }).then(r => r[0] || null);

        const newVGC = await base44.asServiceRole.entities.LocationReference.create({
          name: 'VGC Towers',
          category: 'home',
          scope: 'account_global',
          location_type: 'global',
          owner_email: userEmail,
          created_by_role: 'user',
          is_user_created: true,
          description: 'Residential complex where NPCs live',
          bedroom_count: 20,
          image_urls: sharedVGC?.image_urls || [],
          zones: sharedVGC?.zones || [],
          resident_character_ids: [],
          resident_character_names: [],
        });

        created.push({ user_email: userEmail, vgc_id: newVGC.id });
        console.log(`[ensureAllUsersHaveVGCTowers] Created VGC Towers for ${userEmail}: ${newVGC.id}`);
      } catch (err) {
        errors.push({ user_email: userEmail, error: err.message });
        console.error(`[ensureAllUsersHaveVGCTowers] Failed for ${userEmail}:`, err.message);
      }
    }

    return Response.json({
      total_users: allUsers.length,
      previously_missing: missingUsers.length,
      successfully_created: created.length,
      failed: errors.length,
      created_users: created,
      error_details: errors,
    });
  } catch (error) {
    console.error('[ensureAllUsersHaveVGCTowers]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});