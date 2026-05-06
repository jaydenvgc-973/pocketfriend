import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * findMissingCharactersByStatus
 *
 * Single-query approach to avoid rate limits:
 * - We already know the 20 SDK-visible IDs from auditMurqartCharacterTypes.
 * - We fetch via RLS token (user-scoped) to discover ALL records this user can see.
 * - Any record visible via RLS but NOT in the known-SDK-visible set = missing owner_email in data.
 * - Returns exact ID+name whitelist only. No writes. No broad queries. No $ne.
 */

const TARGET_EMAIL = 'murqart@gmail.com';

// Known SDK-visible IDs from auditMurqartCharacterTypes result
const ALREADY_SDK_VISIBLE = new Set([
  '69cc3d69e78aeb7711727a74', // Sofia Garcia
  '69cc3d674b634e4e5ca32a1f', // Jasmine Rodriguez
  '69cc3d667526402fb206bbab', // Kiara
  '69cc3d657e1c2e8eea6ea4fd', // Daniela
  '69cc3d64be1a3b1342e98eea', // Udelka
  // remaining 15 from the audit (family + npc + Test Character)
  // We'll match by checking if owner_email exists in the data returned by RLS
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.email !== TARGET_EMAIL) {
      return Response.json({ error: `Locked to ${TARGET_EMAIL}` }, { status: 403 });
    }

    // Single RLS-scoped read — all records this user can access
    const rlsVisible = await base44.entities.Character.list('-created_date', 500);

    // Records missing owner_email in their data field = invisible to SDK owner_email filter
    const needsRepair = rlsVisible.filter(c => !c.owner_email);

    const repairWhitelist = needsRepair.map(c => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      status: c.status,
      has_owner_user_id: !!c.owner_user_id,
      owner_user_id: c.owner_user_id || null,
    }));

    const alreadyCorrect = rlsVisible.filter(c => c.owner_email === TARGET_EMAIL);

    return Response.json({
      rls_total: rlsVisible.length,
      already_have_owner_email: alreadyCorrect.length,
      needs_repair_count: repairWhitelist.length,
      repair_whitelist: repairWhitelist,
      summary: repairWhitelist.length === 0
        ? 'All RLS-visible records already have owner_email in data.'
        : `${repairWhitelist.length} record(s) need owner_email written to data. Exact IDs listed in repair_whitelist.`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});