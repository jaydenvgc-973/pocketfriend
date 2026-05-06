import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditOwnerEmailFieldPosition
 *
 * For each character where admin-level root shows owner_email = murqart@gmail.com
 * but SDK filter misses them, check:
 * - Does owner_email exist inside data object? (SDK-visible)
 * - Does owner_email exist only at root? (admin-only visible)
 *
 * Tests both query paths and reports the discrepancy.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // These are the IDs we know are murqart's chars that are missing from SDK queries
    // Matt Lopez, Melody, Jayden, Nathan, etc.
    const suspectIds = [
      '69c01e985ccb5ecb47d2972e', // Matt Lopez
      '69cef8406d65304465075d79', // Melody Jackson Perry
    ];

    // Also get all chars via service role with broader filter to find the missing ones
    // The admin tool reads root-level owner_email, SDK reads data.owner_email
    // We need to find ALL murqart chars that are missing from the SDK query

    // Step 1: What SDK returns for murqart
    const sdkResult = await base44.asServiceRole.entities.Character.filter(
      { owner_email: 'murqart@gmail.com' },
      '-created_date',
      300
    );
    const sdkIds = new Set(sdkResult.map(c => c.id));
    const sdkNames = sdkResult.map(c => c.name);

    // Step 2: Check specific known-missing characters
    const results = [];
    for (const id of suspectIds) {
      // Direct ID lookup via service role
      const chars = await base44.asServiceRole.entities.Character.filter({ id }, '-created_date', 1);
      if (chars.length === 0) {
        results.push({ id, found: false, note: 'Not found even by ID via service role' });
        continue;
      }
      const c = chars[0];
      results.push({
        id: c.id,
        name: c.name,
        character_type: c.character_type,
        status: c.status,
        owner_email_in_data: c.owner_email || null,
        owner_user_id_in_data: c.owner_user_id || null,
        in_sdk_query_result: sdkIds.has(c.id),
      });
    }

    return Response.json({
      sdk_query_total: sdkResult.length,
      sdk_names: sdkNames,
      suspect_checks: results,
      conclusion: results.map(r => {
        if (!r.found) return `${r.id}: NOT FOUND`;
        if (r.in_sdk_query_result) return `${r.name}: ✅ visible in SDK query (owner_email in data: ${r.owner_email_in_data})`;
        return `${r.name}: ❌ MISSING from SDK query — owner_email in data field: ${r.owner_email_in_data}`;
      }),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});