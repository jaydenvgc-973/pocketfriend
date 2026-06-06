import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * cleanupAdobevgcDuplicateVicks
 *
 * One-time surgical cleanup for adobevgc@gmail.com.
 * Uses direct ID-based updates only — no list() lookup that could miss records.
 *
 * Operations:
 * 1. Soft-delete 3 duplicate Vick records by ID.
 * 2. Remove duplicate IDs from Recovery Yard resident_character_ids + worker_character_ids.
 * 3. Verify canonical Vick and yard are intact.
 */

const CANONICAL_VICK_ID = '6a2467b9a07bd221ece6abe2';
const DUPLICATE_IDS = [
  // Old deleted/stale IDs that should never be re-activated
  '6a2350666c880e0049e4236c',
  '6a234ddf57ff381d546ed436',
  '6a234de69b76b4eb689f6410',
  '6a23505f9da5f366f3401a35',
  '6a2462532d4beb65aa7a3024',
];
const YARD_ID = '6a2467b9ddf176aa4ec640c6';
const OWNER_EMAIL = 'adobevgc@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const results = {
      duplicates_soft_deleted: [],
      duplicates_failed: [],
      yard_updated: false,
      yard_error: null,
      canonical_verified: false,
      yard_verified: null,
    };

    // ── STEP 1: Soft-delete each duplicate by direct ID ───────────────────────
    for (const dupId of DUPLICATE_IDS) {
      try {
        await base44.asServiceRole.entities.Character.update(dupId, {
          status: 'soft_deleted',
          merged_into_character_id: CANONICAL_VICK_ID,
          exclude_from_homepage: true,
          exclude_from_roster: true,
        });
        results.duplicates_soft_deleted.push(dupId);
        console.log(`[cleanup] Soft-deleted duplicate Vick: ${dupId}`);
      } catch (e) {
        results.duplicates_failed.push({ id: dupId, error: e.message });
        console.error(`[cleanup] Failed to soft-delete ${dupId}: ${e.message}`);
      }
    }

    // ── STEP 2: Update Recovery Yard — remove duplicates from arrays ──────────
    try {
      const yard = await base44.asServiceRole.entities.LocationReference.filter(
        { id: YARD_ID }, null, 1
      ).then(r => r[0]).catch(() => null);

      if (!yard) {
        results.yard_error = 'Yard not found by ID';
      } else {
        const cleanWorkers = (yard.worker_character_ids || []).filter(
          id => !DUPLICATE_IDS.includes(id)
        );
        const cleanResidents = (yard.resident_character_ids || []).filter(
          id => !DUPLICATE_IDS.includes(id)
        );
        const cleanResidentNames = (yard.resident_character_names || []).filter(
          name => name !== 'Vick Servicio' // will re-add canonical below if missing
        );
        // Ensure canonical is present
        if (!cleanWorkers.includes(CANONICAL_VICK_ID)) cleanWorkers.push(CANONICAL_VICK_ID);
        if (!cleanResidents.includes(CANONICAL_VICK_ID)) cleanResidents.push(CANONICAL_VICK_ID);
        if (!cleanResidentNames.includes('Vick Servicio')) cleanResidentNames.push('Vick Servicio');

        // Rebuild job titles with only canonical
        const cleanJobTitles = { [CANONICAL_VICK_ID]: 'Recovery Yard Operator' };

        await base44.asServiceRole.entities.LocationReference.update(YARD_ID, {
          worker_character_ids: cleanWorkers,
          resident_character_ids: cleanResidents,
          resident_character_names: cleanResidentNames,
          worker_job_titles: cleanJobTitles,
          owner_character_id: CANONICAL_VICK_ID,
          owner_character_name: 'Vick Servicio',
        });
        results.yard_updated = true;
        console.log(`[cleanup] Yard updated: workers=${JSON.stringify(cleanWorkers)}, residents=${JSON.stringify(cleanResidents)}`);
      }
    } catch (e) {
      results.yard_error = e.message;
      console.error(`[cleanup] Yard update failed: ${e.message}`);
    }

    // ── STEP 3: Verify canonical Vick still intact ────────────────────────────
    try {
      const canon = await base44.asServiceRole.entities.Character.filter(
        { character_type: 'npc_world_service' }, null, 50
      ).then(list => list.find(c => c.id === CANONICAL_VICK_ID)).catch(() => null);

      results.canonical_verified = !!(canon && canon.status === 'active');
      console.log(`[cleanup] Canonical Vick verified: ${results.canonical_verified}, status=${canon?.status}`);
    } catch (e) {
      console.warn(`[cleanup] Canonical verify failed (non-fatal): ${e.message}`);
    }

    // ── STEP 4: Verify yard state ─────────────────────────────────────────────
    try {
      const yardCheck = await base44.asServiceRole.entities.LocationReference.filter(
        { id: YARD_ID }, null, 1
      ).then(r => r[0]).catch(() => null);

      if (yardCheck) {
        results.yard_verified = {
          owner_character_id: yardCheck.owner_character_id,
          worker_character_ids: yardCheck.worker_character_ids,
          resident_character_ids: yardCheck.resident_character_ids,
          duplicates_still_present: DUPLICATE_IDS.filter(id =>
            (yardCheck.worker_character_ids || []).includes(id) ||
            (yardCheck.resident_character_ids || []).includes(id)
          ),
        };
      }
    } catch (e) {
      console.warn(`[cleanup] Yard verify failed (non-fatal): ${e.message}`);
    }

    const success = results.duplicates_failed.length === 0 && results.yard_updated;
    return Response.json({
      success,
      ownerEmail: OWNER_EMAIL,
      message: success
        ? `Cleanup complete: ${results.duplicates_soft_deleted.length} duplicates removed, yard cleaned.`
        : `Partial cleanup: ${results.duplicates_soft_deleted.length} soft-deleted, ${results.duplicates_failed.length} failed.`,
      results,
    });

  } catch (error) {
    console.error('[cleanupAdobevgcDuplicateVicks]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});