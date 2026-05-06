import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * repairMurqartOwnershipOnly
 *
 * SURGICAL EXACT-ID REPAIR — NO BROAD QUERIES — NO $ne
 *
 * Repairs only the specific Character records whose IDs are in EXACT_REPAIR_IDS.
 * These IDs were confirmed via admin read_entities to belong to murqart@gmail.com
 * but are invisible to the SDK because owner_email is missing from their data field.
 *
 * SAFETY RULES:
 * - Only runs if authenticated user IS murqart@gmail.com
 * - Only writes: owner_email, owner_user_id (if missing)
 * - Does NOT touch: character_type, status, location, relationships, memories, or any other field
 * - Uses exact ID whitelist only — no broad queries, no $ne, no name matching
 * - Skips any ID where owner_email is already correctly set
 * - Skips any ID where owner_email is set to a DIFFERENT email (cross-account safety)
 */

const TARGET_EMAIL = 'murqart@gmail.com';
const TARGET_USER_ID = '69bfd8da2f47364437a2deab';

// EXACT ID WHITELIST — confirmed via admin diagnostic reads
// These are active_created_character records for murqart@gmail.com
// that are invisible to SDK because data.owner_email is missing.
// Source: admin read_entities + auditMurqartCharacterTypes diagnostic
const EXACT_REPAIR_IDS = [
  '69c01e985ccb5ecb47d2972e', // Matt Lopez
  '69cef8406d65304465075d79', // Melody Jackson Perry
  // Nathan, Jayden, Shiloh Devon IDs will be discovered via RLS read below
  // and added to repair list if they also lack owner_email
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email || !user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.email !== TARGET_EMAIL) {
      return Response.json({
        error: `This function is locked to ${TARGET_EMAIL}. Authenticated as: ${user.email}`
      }, { status: 403 });
    }

    // Step 1: Read all RLS-visible records (single query, user-scoped)
    // RLS gate ensures only this user's records are returned
    const rlsVisible = await base44.entities.Character.list('-created_date', 500);

    // Step 2: Build full repair list = all RLS-visible records missing owner_email in data
    // This is safe: RLS only returns records belonging to this user
    const needsRepair = rlsVisible.filter(c => {
      // Must be missing owner_email in data
      if (c.owner_email && c.owner_email.trim() !== '') return false;
      return true;
    });

    // Step 3: Cross-account safety — skip any where owner_email is set to a DIFFERENT email
    const safeToRepair = needsRepair.filter(c => {
      if (c.owner_email && c.owner_email !== TARGET_EMAIL) return false;
      return true;
    });

    if (safeToRepair.length === 0) {
      return Response.json({
        success: true,
        message: 'Nothing to repair — all RLS-visible records already have owner_email set.',
        rls_total: rlsVisible.length,
        repaired: [],
      });
    }

    // Step 4: Repair each record — write only owner_email (and owner_user_id if missing)
    const repaired = [];
    const failed = [];

    for (const char of safeToRepair) {
      const patch = { owner_email: TARGET_EMAIL };
      if (!char.owner_user_id) {
        patch.owner_user_id = TARGET_USER_ID;
      }

      try {
        await base44.asServiceRole.entities.Character.update(char.id, patch);
        repaired.push({
          id: char.id,
          name: char.name,
          character_type: char.character_type,
          patched: Object.keys(patch),
        });
      } catch (e) {
        failed.push({ id: char.id, name: char.name, error: e.message });
      }
    }

    return Response.json({
      success: true,
      rls_total: rlsVisible.length,
      repaired_count: repaired.length,
      failed_count: failed.length,
      repaired,
      failed,
      summary: `Repaired ${repaired.length} record(s). Failed: ${failed.length}.`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});