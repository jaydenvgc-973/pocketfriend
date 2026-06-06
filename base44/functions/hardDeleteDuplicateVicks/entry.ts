import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * hardDeleteDuplicateVicks
 *
 * Permanently deletes three duplicate Vick Servicio records from adobevgc@gmail.com.
 * These records are orphaned and no longer linked to the Recovery Yard.
 *
 * Hard deletion only. Not soft-delete, not archival, not invisibility.
 * Records will be completely removed from the database.
 */

const DUPLICATE_IDS = [
  '6a234ddf57ff381d546ed436',
  '6a234de69b76b4eb689f6410',
  '6a23505f9da5f366f3401a35',
];
const OWNER_EMAIL = 'adobevgc@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const results = {
      deleted: [],
      failed: [],
      notes: [],
    };

    // Attempt hard delete via service-role for each duplicate ID
    for (const dupId of DUPLICATE_IDS) {
      try {
        // Try service-role delete first
        await base44.asServiceRole.entities.Character.delete(dupId);
        results.deleted.push(dupId);
        console.log(`[hardDelete] Hard-deleted duplicate Vick: ${dupId}`);
      } catch (e) {
        const errorMsg = e.message || String(e);
        
        // If service-role is blocked by RLS, note the error
        if (errorMsg.includes('Permission denied') || errorMsg.includes('Forbidden')) {
          results.failed.push({
            id: dupId,
            reason: 'RLS blocks service-role delete for user-owned characters',
            note: `Character belongs to ${OWNER_EMAIL}. Requires user-scoped deletion or admin-escalated path.`,
          });
          console.warn(`[hardDelete] Service-role delete blocked for ${dupId} (RLS): ${errorMsg}`);
        } else if (errorMsg.includes('not found') || errorMsg.includes('404')) {
          // Record already deleted or doesn't exist
          results.deleted.push(dupId);
          console.log(`[hardDelete] Record already gone or 404: ${dupId}`);
        } else {
          results.failed.push({ id: dupId, reason: errorMsg });
          console.error(`[hardDelete] Failed to delete ${dupId}: ${errorMsg}`);
        }
      }
    }

    // If RLS blocks service-role deletes, provide the user-scoped deletion path
    const allBlocked = results.failed.every(f => f.reason.includes('RLS'));
    if (allBlocked && results.deleted.length === 0) {
      results.notes.push(
        'Service-role hard delete is blocked by RLS. User-scoped deletion required.',
        `Account owner (${OWNER_EMAIL}) must call a user-scoped function to hard-delete:`,
        '  - Either login as adobevgc@gmail.com and call a self-delete function with the exact IDs',
        '  - Or admin must invoke deleteCharacter via user context for each ID',
        'These are orphaned records (not linked to Recovery Yard) and safe to delete.'
      );
    }

    const success = results.failed.length === 0 && results.deleted.length === 3;
    return Response.json({
      success,
      ownerEmail: OWNER_EMAIL,
      message: success
        ? `Hard deleted all 3 duplicate Vick records.`
        : results.deleted.length > 0
          ? `Partially deleted: ${results.deleted.length} of 3 deleted, ${results.failed.length} blocked.`
          : `Deletion blocked: all records require user-scoped path.`,
      results,
    });

  } catch (error) {
    console.error('[hardDeleteDuplicateVicks]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});