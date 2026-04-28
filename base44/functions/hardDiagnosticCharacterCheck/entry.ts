import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * HARD DIAGNOSTIC: Proves exactly where the query gap is.
 * Tests every possible SDK path for Character records.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1. Auth
    let user = null;
    try { user = await base44.auth.me(); } catch(e) { /* scheduled */ }

    const results = {
      app_id: Deno.env.get('BASE44_APP_ID') || 'NOT_SET',
      authenticated_user: user ? { id: user.id, email: user.email, role: user.role } : null,
      queries: {}
    };

    // 2A. user-scoped list (no filter)
    try {
      const r = await base44.entities.Character.list('-created_date', 500);
      results.queries.user_list_nofilter = { count: r.length, sample: r.slice(0,3).map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })) };
    } catch(e) { results.queries.user_list_nofilter = { error: e.message }; }

    // 2B. user-scoped filter empty object
    try {
      const r = await base44.entities.Character.filter({}, '-created_date', 500);
      results.queries.user_filter_empty = { count: r.length, sample: r.slice(0,3).map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })) };
    } catch(e) { results.queries.user_filter_empty = { error: e.message }; }

    // 2C. user-scoped filter by owner_email
    if (user?.email) {
      try {
        const r = await base44.entities.Character.filter({ owner_email: user.email }, '-created_date', 500);
        results.queries.user_filter_owner_email = { count: r.length, sample: r.slice(0,3).map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })) };
      } catch(e) { results.queries.user_filter_owner_email = { error: e.message }; }
    }

    // 2D. service role list (no filter)
    try {
      const r = await base44.asServiceRole.entities.Character.list('-created_date', 500);
      results.queries.service_list_nofilter = { count: r.length, sample: r.slice(0,3).map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })) };
    } catch(e) { results.queries.service_list_nofilter = { error: e.message }; }

    // 2E. service role filter empty object
    try {
      const r = await base44.asServiceRole.entities.Character.filter({}, '-created_date', 500);
      results.queries.service_filter_empty = { count: r.length, sample: r.slice(0,3).map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })) };
    } catch(e) { results.queries.service_filter_empty = { error: e.message }; }

    // 2F. service role filter murqart@gmail.com
    try {
      const r = await base44.asServiceRole.entities.Character.filter({ owner_email: 'murqart@gmail.com' }, '-created_date', 500);
      results.queries.service_filter_murqart = { count: r.length, sample: r.slice(0,3).map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })) };
    } catch(e) { results.queries.service_filter_murqart = { error: e.message }; }

    // 2G. service role filter adobevgc@gmail.com
    try {
      const r = await base44.asServiceRole.entities.Character.filter({ owner_email: 'adobevgc@gmail.com' }, '-created_date', 500);
      results.queries.service_filter_adobevgc = { count: r.length, sample: r.slice(0,3).map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })) };
    } catch(e) { results.queries.service_filter_adobevgc = { error: e.message }; }

    // 2H. service role filter by status active
    try {
      const r = await base44.asServiceRole.entities.Character.filter({ status: 'active' }, '-created_date', 500);
      results.queries.service_filter_status_active = { count: r.length, sample: r.slice(0,3).map(c => ({ id: c.id, name: c.name, owner_email: c.owner_email })) };
    } catch(e) { results.queries.service_filter_status_active = { error: e.message }; }

    return Response.json(results);

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});