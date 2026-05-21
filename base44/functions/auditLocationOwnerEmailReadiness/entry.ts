/**
 * auditLocationOwnerEmailReadiness
 *
 * READ-ONLY audit. Does NOT modify any records.
 *
 * Checks every LocationReference accessible to the authenticated user and reports:
 * - owner_email presence/absence per record
 * - created_by vs owner_email alignment
 * - scope classification (shared, system, user-owned, character-specific, jail, home, etc.)
 * - records that would become inaccessible if RLS switched from created_by → owner_email
 *
 * Purpose: prove safety of RLS change before committing it.
 * owner_email is the sole ownership source of truth — never created_by.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userEmail = user.email;

    // ── Load ALL records via service role (complete picture, no RLS filtering) ──
    let allLocations = [];
    let page = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.LocationReference.list(
        '-created_date', 200, page * 200
      ).catch(() => []);
      if (!batch || batch.length === 0) break;
      allLocations = allLocations.concat(batch);
      if (batch.length < 200) break;
      page++;
    }

    const total = allLocations.length;

    // ── Classify every record ──────────────────────────────────────────────────
    const missingOwnerEmail       = [];  // owner_email is null/blank
    const ownerEmailMismatch      = [];  // owner_email exists but != userEmail (and not shared/system)
    const ownerEmailMatchUser     = [];  // owner_email matches userEmail
    const sharedOrSystem          = [];  // scope=shared, is_system_managed, or is_generic_shared
    const characterSpecific       = [];  // location_type=character_specific OR assigned_character_id set
    const jailPrisonLocations     = [];  // is_confinement_facility OR category=jail_prison
    const homeResidenceLocations  = [];  // category=home, shelter, hotel
    const rabbitHoleLocations     = [];  // is_rabbit_hole
    const adminCreated            = [];  // created_by_role=admin
    const createdByMatchesEmail   = [];  // created_by field (legacy) matches userEmail
    const createdByMissingEmail   = [];  // created_by exists, owner_email missing

    // Records that would LOSE access if RLS switches from created_by → owner_email
    // = records where created_by === userEmail but owner_email is blank/null/different
    const wouldLoseAccess = [];

    for (const loc of allLocations) {
      const hasOwnerEmail = loc.owner_email && loc.owner_email.trim() !== '';
      const ownerEmailValue = hasOwnerEmail ? loc.owner_email.trim() : null;
      const createdBy = loc.created_by || null; // legacy field — for audit comparison only

      const isShared = loc.scope === 'shared' || loc.is_generic_shared === true ||
                       loc.is_system_managed === true || loc.location_type === 'global';
      const isCharSpecific = loc.location_type === 'character_specific' || !!loc.assigned_character_id;
      const isJail = loc.is_confinement_facility === true || loc.category === 'jail_prison';
      const isHome = ['home', 'shelter', 'hotel'].includes(loc.category);
      const isRabbitHole = loc.is_rabbit_hole === true;
      const isAdminCreated = loc.created_by_role === 'admin';

      const row = {
        id: loc.id,
        name: loc.name,
        category: loc.category,
        scope: loc.scope,
        location_type: loc.location_type,
        owner_email: ownerEmailValue,
        created_by: createdBy,
        created_by_role: loc.created_by_role,
        is_system_managed: loc.is_system_managed,
        is_generic_shared: loc.is_generic_shared,
        is_confinement_facility: loc.is_confinement_facility,
        is_rabbit_hole: loc.is_rabbit_hole,
        assigned_character_id: loc.assigned_character_id || null,
      };

      if (!hasOwnerEmail) {
        missingOwnerEmail.push(row);
        // Would this record lose access under owner_email RLS?
        if (createdBy === userEmail) {
          wouldLoseAccess.push({ ...row, reason: 'created_by matches user but owner_email is blank' });
        }
        if (isShared) {
          // Shared/system records don't need owner_email for RLS (scope=shared catches them)
        }
      } else {
        if (ownerEmailValue === userEmail) {
          ownerEmailMatchUser.push(row);
        } else if (!isShared) {
          ownerEmailMismatch.push(row);
        }
      }

      if (isShared) sharedOrSystem.push(row);
      if (isCharSpecific) characterSpecific.push(row);
      if (isJail) jailPrisonLocations.push(row);
      if (isHome) homeResidenceLocations.push(row);
      if (isRabbitHole) rabbitHoleLocations.push(row);
      if (isAdminCreated) adminCreated.push(row);

      if (createdBy === userEmail) createdByMatchesEmail.push(row);
      if (!hasOwnerEmail && createdBy) createdByMissingEmail.push(row);
    }

    // ── RLS safety verdict ────────────────────────────────────────────────────
    const safe = wouldLoseAccess.length === 0;
    const verdict = safe
      ? 'SAFE — all user-owned records have owner_email populated. RLS change is safe.'
      : `NOT SAFE — ${wouldLoseAccess.length} record(s) would lose access. Backfill owner_email first.`;

    // ── Compact summaries (avoid huge response) ───────────────────────────────
    const compactRow = r => ({ id: r.id, name: r.name, category: r.category, owner_email: r.owner_email, created_by: r.created_by, scope: r.scope });

    return Response.json({
      audit_result: verdict,
      rls_change_safe: safe,
      user_email: userEmail,
      timestamp: new Date().toISOString(),

      totals: {
        all_records_in_db: total,
        owner_email_matches_user: ownerEmailMatchUser.length,
        owner_email_missing: missingOwnerEmail.length,
        owner_email_mismatch_non_shared: ownerEmailMismatch.length,
        would_lose_access_under_new_rls: wouldLoseAccess.length,
        shared_or_system: sharedOrSystem.length,
        character_specific: characterSpecific.length,
        jail_prison: jailPrisonLocations.length,
        homes_residences: homeResidenceLocations.length,
        rabbit_hole: rabbitHoleLocations.length,
        admin_created: adminCreated.length,
        created_by_matches_user: createdByMatchesEmail.length,
        created_by_exists_owner_email_missing: createdByMissingEmail.length,
      },

      // Full lists for problematic records
      missing_owner_email: missingOwnerEmail.map(compactRow),
      would_lose_access: wouldLoseAccess.map(r => ({
        ...compactRow(r),
        reason: r.reason,
      })),
      owner_email_mismatch: ownerEmailMismatch.map(compactRow),

      // Summaries for safe categories
      shared_or_system_names: sharedOrSystem.map(r => r.name),
      jail_prison_names: jailPrisonLocations.map(r => ({ name: r.name, owner_email: r.owner_email, is_confinement: r.is_confinement_facility })),
      home_residence_names: homeResidenceLocations.map(r => ({ name: r.name, owner_email: r.owner_email, category: r.category })),
      rabbit_hole_names: rabbitHoleLocations.map(r => ({ name: r.name, owner_email: r.owner_email })),
      character_specific_summary: characterSpecific.map(r => ({ name: r.name, owner_email: r.owner_email, assigned_to: r.assigned_character_id })),
    });

  } catch (error) {
    console.error('[auditLocationOwnerEmailReadiness]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});