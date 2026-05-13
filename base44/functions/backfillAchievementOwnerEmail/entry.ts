/**
 * backfillAchievementOwnerEmail
 *
 * Two-phase operation:
 *
 * Phase 1 — Owner backfill:
 *   Find UserAchievement records missing owner_email where ownership can be PROVEN.
 *   Proof sources (in priority order):
 *     1. RLS-scoped list() returns only the authenticated user's records — this is the primary proof.
 *        The platform enforces owner_email RLS, so any record returned by base44.entities.UserAchievement.list()
 *        already belongs to the authenticated user.
 *     2. created_by field on the record matches user.email (used as a one-time migration clue only).
 *   Records where neither condition is satisfied are skipped and reported.
 *
 * Phase 2 — Duplicate cleanup:
 *   After owner_email is proven, group records by the correct dedup key:
 *     global:    owner_email + achievement_id
 *     character: owner_email + achievement_id + character_id
 *   Within each group keep one canonical record:
 *     - earliest unlocked_at
 *     - is_seen = true if any duplicate was seen
 *     - character_name = first non-empty value
 *   Delete duplicates only after canonical is confirmed updated.
 *
 * Safe to run multiple times — idempotent.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Inline scope map — mirrors lib/achievements.js scope fields exactly.
// No local imports allowed in Deno. Keep in sync with lib/achievements.js.
const ACHIEVEMENT_SCOPES = {
  first_impression: 'global', consistent: 'global', seen_it_all: 'global',
  still_here: 'global', they_came_back: 'global', left_on_read: 'global',
  group_hangout: 'global', new_place: 'global', productive_day: 'global',
  showed_up_anyway: 'global', rent_paid: 'global',
};

function getAchievementScope(id) {
  return ACHIEVEMENT_SCOPES[id] ?? 'character';
}

function buildDedupKey(ownerEmail, achievementId, characterId) {
  if (getAchievementScope(achievementId) === 'global') {
    return `global::${ownerEmail}::${achievementId}`;
  }
  return `char::${ownerEmail}::${achievementId}::${characterId || ''}`;
}

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1200;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── PHASE 1: Ownership backfill ──────────────────────────────────────────
    //
    // RLS proof: base44.entities.UserAchievement.list() is scoped to the authenticated user.
    // Only this user's records are returned. Any record in this list belongs to user.email.
    // Records returned by this call are safe to assign owner_email = user.email.
    const allRecords = await base44.entities.UserAchievement.list('-created_date', 1000);

    const alreadyHasOwner = allRecords.filter(r => r.owner_email);
    const missingOwner = allRecords.filter(r => !r.owner_email);

    // For records missing owner_email, prove ownership:
    //   - RLS-returned records belong to user (primary proof)
    //   - If created_by matches user.email, that is additional confirmation
    //   - If created_by is present but does NOT match user.email, skip and report
    const toBackfill = [];
    const skippedOwnershipMismatch = [];

    for (const r of missingOwner) {
      const createdBy = r.created_by; // platform email field
      if (!createdBy || createdBy === user.email) {
        // RLS proof alone is sufficient; created_by match is a bonus confirmation
        toBackfill.push(r);
      } else {
        // created_by disagrees — skip and report. Do not overwrite with wrong owner.
        skippedOwnershipMismatch.push({ id: r.id, achievement_id: r.achievement_id, created_by: createdBy });
      }
    }

    let patched = 0;
    let rateLimited = 0;
    const patchErrors = [];

    for (let i = 0; i < toBackfill.length; i += BATCH_SIZE) {
      const batch = toBackfill.slice(i, i + BATCH_SIZE);
      for (const record of batch) {
        try {
          await base44.asServiceRole.entities.UserAchievement.update(record.id, { owner_email: user.email });
          patched++;
        } catch (err) {
          if (err.message?.includes('429') || err.message?.toLowerCase().includes('rate')) {
            rateLimited++;
          } else {
            patchErrors.push({ id: record.id, achievement_id: record.achievement_id, error: err.message });
          }
        }
      }
      if (i + BATCH_SIZE < toBackfill.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    // ── PHASE 2: Duplicate cleanup ────────────────────────────────────────────
    //
    // Re-fetch after patching so we have fresh owner_email values.
    const freshRecords = await base44.entities.UserAchievement.filter({ owner_email: user.email }, '-created_date', 1000);

    // Group by dedup key
    const groups = new Map(); // dedupKey -> Array of records
    for (const r of freshRecords) {
      const key = buildDedupKey(r.owner_email, r.achievement_id, r.character_id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    let duplicatesRemoved = 0;
    let canonicalsUpdated = 0;
    const dedupErrors = [];

    for (const [key, group] of groups.entries()) {
      if (group.length <= 1) continue; // no duplicates

      // Sort: earliest unlocked_at first
      group.sort((a, b) => new Date(a.unlocked_at || a.created_date) - new Date(b.unlocked_at || b.created_date));

      const canonical = group[0];
      const duplicates = group.slice(1);

      // Merge is_seen and character_name across all duplicates into canonical
      const mergedIsSeen = group.some(r => r.is_seen === true);
      const mergedCharName = group.map(r => r.character_name).find(n => n) || canonical.character_name || '';
      const earliestUnlockedAt = canonical.unlocked_at || canonical.created_date;

      // Update canonical with merged values if needed
      const needsUpdate =
        mergedIsSeen !== canonical.is_seen ||
        mergedCharName !== (canonical.character_name || '') ||
        earliestUnlockedAt !== canonical.unlocked_at;

      if (needsUpdate) {
        try {
          await base44.asServiceRole.entities.UserAchievement.update(canonical.id, {
            is_seen: mergedIsSeen,
            character_name: mergedCharName,
            unlocked_at: earliestUnlockedAt,
          });
          canonicalsUpdated++;
        } catch (err) {
          dedupErrors.push({ id: canonical.id, error: err.message });
          continue; // don't delete duplicates if canonical update failed
        }
        await new Promise(r => setTimeout(r, 300));
      }

      // Delete duplicates
      for (const dup of duplicates) {
        try {
          await base44.asServiceRole.entities.UserAchievement.delete(dup.id);
          duplicatesRemoved++;
        } catch (err) {
          dedupErrors.push({ id: dup.id, error: err.message });
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const remainingMissing = toBackfill.length - patched;

    console.log(`[backfillAchievementOwnerEmail] user=${user.email} total=${allRecords.length} missing=${missingOwner.length} patched=${patched} skipped_mismatch=${skippedOwnershipMismatch.length} rate_limited=${rateLimited} duplicates_removed=${duplicatesRemoved}`);

    return Response.json({
      status: remainingMissing > 0 ? 'partial_run_again' : 'complete',
      user_email: user.email,
      phase1_backfill: {
        total_scanned: allRecords.length,
        already_had_owner_email: alreadyHasOwner.length,
        missing_owner_email: missingOwner.length,
        proven_and_patched: patched,
        skipped_ownership_mismatch: skippedOwnershipMismatch.length,
        rate_limited: rateLimited,
        remaining: remainingMissing,
        errors: patchErrors.slice(0, 10),
        skipped_details: skippedOwnershipMismatch.slice(0, 10),
      },
      phase2_dedup: {
        groups_with_duplicates: [...groups.values()].filter(g => g.length > 1).length,
        canonicals_updated: canonicalsUpdated,
        duplicates_removed: duplicatesRemoved,
        errors: dedupErrors.slice(0, 10),
      },
      note: remainingMissing > 0 ? 'Run again to continue patching' : 'All records have owner_email. Dedup complete.',
    });
  } catch (error) {
    console.error('[backfillAchievementOwnerEmail] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});