import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * cleanupDuplicateVickServicio
 *
 * Safe deduplication for Vick Servicio records created during failed idempotency tests.
 *
 * RULES:
 *   1. Identify the canonical Vick = the one referenced by VGC Recovery Yard.owner_character_id
 *      (the only service-role-readable anchor for Character records in this app).
 *   2. Any other Character named "Vick Servicio" with the same owner_email is a duplicate.
 *   3. Duplicates are marked status=soft_deleted + merged_into_character_id=canonicalId.
 *      They are NEVER hard-deleted.
 *   4. The canonical Vick is NEVER touched, removed, or renamed.
 *   5. Supports dry_run=true to preview without writing.
 *   6. Admin-only (role check enforced).
 *
 * USAGE:
 *   { "ownerEmail": "user@example.com", "dry_run": true }    → preview
 *   { "ownerEmail": "user@example.com", "dry_run": false }   → execute
 *   { "dry_run": false }                                      → runs for authenticated user
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    let payload = {};
    try { payload = await req.json(); } catch (_) {}

    const { dry_run = true } = payload;
    const ownerEmail = payload.ownerEmail || user.email;

    if (!ownerEmail) {
      return Response.json({ error: 'ownerEmail required' }, { status: 400 });
    }

    const results = {
      dry_run,
      ownerEmail,
      canonical_vick: null,
      anchor_yard: null,
      duplicates_found: [],
      duplicates_cleaned: [],
      errors: [],
    };

    // ── STEP 1: Find VGC Recovery Yard (the service-role-readable anchor) ────
    const yards = await base44.asServiceRole.entities.LocationReference.filter({
      name: 'VGC Recovery Yard',
      owner_email: ownerEmail,
    }).catch(() => []);

    const yard = yards[0] || null;
    if (!yard) {
      return Response.json({
        success: false,
        error: `No VGC Recovery Yard found for ${ownerEmail}. Run ensureVickServicio first.`,
        results,
      });
    }

    results.anchor_yard = { id: yard.id, name: yard.name, owner_character_id: yard.owner_character_id };

    if (!yard.owner_character_id) {
      return Response.json({
        success: false,
        error: `VGC Recovery Yard exists but has no owner_character_id anchor. Run ensureVickServicio to set it.`,
        results,
      });
    }

    const canonicalVickId = yard.owner_character_id;
    results.canonical_vick = { id: canonicalVickId };

    // ── STEP 2: Find all Vick Servicio characters for this user (user-scoped) ─
    // Character entity RLS is user-scoped. We need user session to read.
    let allVicks = [];
    try {
      const found = await base44.entities.Character.filter(
        { character_type: 'npc_world_service', status: 'active', owner_email: ownerEmail },
        null,
        50
      ).catch(() => []);
      // Also check by name for any that may have wrong type
      const byName = await base44.entities.Character.filter(
        { owner_email: ownerEmail },
        null,
        200
      ).catch(() => []);
      const namedVicks = byName.filter(c =>
        (c.name === 'Vick Servicio' || c.full_name === 'Victor Servicio') &&
        c.status !== 'deleted' &&
        c.status !== 'soft_deleted' &&
        c.status !== 'merged'
      );
      // Union by id
      const seen = new Set();
      for (const c of [...found, ...namedVicks]) {
        if (!seen.has(c.id)) { seen.add(c.id); allVicks.push(c); }
      }
    } catch (e) {
      return Response.json({
        success: false,
        error: `Could not read characters for ${ownerEmail}: ${e.message}`,
        results,
      });
    }

    console.log(`[cleanupDuplicateVickServicio] Found ${allVicks.length} Vick-type records for ${ownerEmail}`);

    // ── STEP 3: Identify duplicates (everything except canonical) ─────────────
    const canonical = allVicks.find(c => c.id === canonicalVickId);
    const duplicates = allVicks.filter(c => c.id !== canonicalVickId);

    if (canonical) {
      results.canonical_vick = { id: canonical.id, name: canonical.name, status: canonical.status };
    }

    if (duplicates.length === 0) {
      return Response.json({
        success: true,
        message: 'No duplicates found. Vick Servicio is clean.',
        results,
      });
    }

    for (const dup of duplicates) {
      results.duplicates_found.push({ id: dup.id, name: dup.name, status: dup.status, created_date: dup.created_date });
    }

    if (dry_run) {
      return Response.json({
        success: true,
        message: `DRY RUN: ${duplicates.length} duplicate(s) found. Re-run with dry_run=false to clean.`,
        results,
      });
    }

    // ── STEP 4: Soft-delete duplicates ────────────────────────────────────────
    for (const dup of duplicates) {
      try {
        await base44.entities.Character.update(dup.id, {
          status: 'soft_deleted',
          merged_into_character_id: canonicalVickId,
          exclude_from_homepage: true,
        });
        results.duplicates_cleaned.push({ id: dup.id, name: dup.name });
        console.log(`[cleanupDuplicateVickServicio] Soft-deleted duplicate Vick id=${dup.id} → canonical=${canonicalVickId}`);
      } catch (e) {
        results.errors.push({ id: dup.id, error: e.message });
        console.error(`[cleanupDuplicateVickServicio] Failed to soft-delete ${dup.id}: ${e.message}`);
      }
    }

    return Response.json({
      success: true,
      message: `Cleaned ${results.duplicates_cleaned.length}/${duplicates.length} duplicate Vick record(s). Canonical Vick preserved: ${canonicalVickId}.`,
      results,
    });

  } catch (error) {
    console.error('[cleanupDuplicateVickServicio]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});