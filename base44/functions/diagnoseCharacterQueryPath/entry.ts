/**
 * diagnoseCharacterQueryPath
 * 
 * Compares query methods to find where the mismatch is.
 * Shows exactly which path works and which fails.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    console.log(`[diagnoseCharacterQueryPath] user=${user.email}`);

    const results = {
      auth_user: user.email,
      auth_id: user.id,
      app_id: Deno.env.get('BASE44_APP_ID'),
      paths_tested: []
    };

    // PATH 1: Service-role no filter
    try {
      const p1 = await base44.asServiceRole.entities.Character.filter({}, null, 100).catch(() => []);
      results.paths_tested.push({
        name: 'service-role no-filter',
        count: p1.length,
        success: p1.length > 0,
        sample_owners: p1.slice(0, 3).map(c => ({ name: c.name, owner: c.owner_email }))
      });
    } catch (e) {
      results.paths_tested.push({ name: 'service-role no-filter', error: e.message });
    }

    // PATH 2: Service-role by owner_email
    try {
      const p2 = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email }, null, 100).catch(() => []);
      results.paths_tested.push({
        name: `service-role owner_email=${user.email}`,
        count: p2.length,
        success: p2.length > 0,
        names: p2.map(c => c.name)
      });
    } catch (e) {
      results.paths_tested.push({ name: `service-role owner_email filter`, error: e.message });
    }

    // PATH 3: User-scoped (standard)
    try {
      const p3 = await base44.entities.Character.filter({}, null, 100).catch(() => []);
      results.paths_tested.push({
        name: 'user-scoped no-filter',
        count: p3.length,
        success: p3.length > 0,
        names: p3.map(c => c.name)
      });
    } catch (e) {
      results.paths_tested.push({ name: 'user-scoped no-filter', error: e.message });
    }

    // PATH 4: User-scoped by owner_email (should match self)
    try {
      const p4 = await base44.entities.Character.filter({ owner_email: user.email }, null, 100).catch(() => []);
      results.paths_tested.push({
        name: `user-scoped owner_email=${user.email}`,
        count: p4.length,
        success: p4.length > 0,
        names: p4.map(c => c.name)
      });
    } catch (e) {
      results.paths_tested.push({ name: 'user-scoped owner_email filter', error: e.message });
    }

    return Response.json({ success: true, ...results });
  } catch (error) {
    console.error('[diagnoseCharacterQueryPath]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});