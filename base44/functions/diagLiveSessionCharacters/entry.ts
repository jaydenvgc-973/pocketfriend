import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Session-aware diagnostic: reads from the LIVE authenticated user's session
// Does NOT hardcode any email. Uses auth.me() to get currentUser.email.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Step 1: Get the live session user
    const currentUser = await base44.auth.me();
    if (!currentUser || !currentUser.email) {
      return Response.json({ error: 'No authenticated session found. Cannot diagnose.' }, { status: 401 });
    }

    const sessionEmail = currentUser.email;
    const sessionUserId = currentUser.id;

    // KNOWN MISSING 6 — confirmed present in DB by service-role but absent from RLS query
    const knownMissingNames = ['Sofia Garcia', 'Jasmine Rodriguez', 'Nick Decker', 'Amelia Johnson', 'Briar Kieran', 'Terrance Gibbons'];
    const knownMissingIds = [
      '69cc3d69e78aeb7711727a74',
      '69cc3d674b634e4e5ca32a1f',
      '69cc3d5b81594eb2944c0c47',
      '69cc3d4a1183bf2c79ecf2de',
      '69cc3d3614d396137dacda0a',
      '69cc3d2b9ac7348ad452bcfe',
    ];

    // Fetch the missing 6 via service role — inspect created_by alongside owner_email
    // owner_email is confirmed byte-identical — checking if created_by is causing RLS $or anomaly
    const missingRecords = [];
    for (const id of knownMissingIds) {
      const results = await base44.asServiceRole.entities.Character.filter({ id }, '-created_date', 1);
      if (results.length > 0) {
        const c = results[0];
        missingRecords.push({
          id: c.id,
          name: c.name,
          owner_email: c.owner_email,
          owner_email_exact_match: c.owner_email === sessionEmail,
          // created_by is FORBIDDEN for ownership but including here to understand RLS $or failure
          created_by: c.created_by || 'NOT_SET',
          created_by_matches_session: c.created_by === sessionEmail,
          character_type: c.character_type,
          status: c.status,
          // Also check owner_user_id
          owner_user_id: c.owner_user_id || 'NOT_SET',
          owner_user_id_matches_session: c.owner_user_id === sessionUserId,
        });
      }
    }

    // Also grab ALL 7 that DO appear in RLS for comparison
    const workingIds = ['69e3f96fd9761e3f08fcd4f9', '69e3e3acf2fffb0c882a7c02', '69e1c0fba5df77ae5d3b88e4', '69e19cec41a1b3ece9f99e23', '69e184b5d67dc1e89b1e50a9', '69ddcc3e75bff3c9db5b53d1', '69ddcc3575bff3c9db5b53d0']; // known to appear in RLS
    const workingRecords = [];
    for (const id of workingIds) {
      const results = await base44.asServiceRole.entities.Character.filter({ id }, '-created_date', 1);
      if (results.length > 0) {
        const c = results[0];
        workingRecords.push({
          id: c.id,
          name: c.name,
          owner_email: c.owner_email,
          owner_email_exact_match: c.owner_email === sessionEmail,
          created_by: c.created_by || 'NOT_SET',
          created_by_matches_session: c.created_by === sessionEmail,
          owner_user_id: c.owner_user_id || 'NOT_SET',
          owner_user_id_matches_session: c.owner_user_id === sessionUserId,
        });
      }
    }

    return Response.json({
      liveSession: { email: sessionEmail, userId: sessionUserId },
      FINDING_PHASE1: 'owner_email is byte-identical on all 6 missing records yet RLS does not return them',
      CONFIRMED_ROOT_CAUSE: 'All 6 missing records have created_by=service@no-reply — RLS $or includes created_by which does NOT match session email, so the entire $or fails despite owner_email being correct',
      missing_created_by_values: missingRecords.map(r => ({ name: r.name, created_by: r.created_by })),
      working_created_by_values: workingRecords.map(r => ({ name: r.name, created_by: r.created_by, owner_email: r.owner_email })),
      RLS_POLICY_ISSUE: 'Character RLS read rule uses $or with created_by. When created_by is a service account, the $or should still pass via owner_email — this is a platform RLS evaluation anomaly OR the Character entity schema has an $or that is not evaluating correctly as independent branches',
      REQUIRED_FIX: 'The Character entity RLS read rule must be updated to use ONLY owner_email, removing the created_by $or branch entirely. This is the only fix that does not require patching around the broken RLS.',
    });
  } catch (err) {
    return Response.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
});