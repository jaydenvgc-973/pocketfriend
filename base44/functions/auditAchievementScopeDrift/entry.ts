/**
 * auditAchievementScopeDrift
 *
 * Drift protection diagnostic. Call this whenever lib/achievements.js is modified
 * or when deploying either checkAchievements or retroactiveAchievementScan.
 *
 * Accepts a payload containing the scope map extracted from lib/achievements.js
 * and compares it against the inline ACHIEVEMENT_SCOPES used in both backend functions.
 *
 * USAGE (from frontend or test harness):
 *   import { ACHIEVEMENTS } from '@/lib/achievements';
 *   const frontendScopes = Object.fromEntries(
 *     Object.values(ACHIEVEMENTS).map(a => [a.id, a.scope])
 *   );
 *   await base44.functions.invoke('auditAchievementScopeDrift', { frontendScopes });
 *
 * Returns:
 *   { status: 'clean' | 'drift_detected', drifted: [...], missing_in_backend: [...], extra_in_backend: [...] }
 *
 * Clean = backend inline maps exactly mirror lib/achievements.js scope fields.
 * Drift = at least one id has a different scope value, is missing from backend, or is extra in backend.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── BACKEND INLINE SCOPE MAP ─────────────────────────────────────────────────
// SOURCE OF TRUTH: lib/achievements.js — scope field on each ACHIEVEMENTS entry.
// This map lists ONLY the ids whose scope is "global". All others default to "character".
// To update: change lib/achievements.js first, then update this map to match exactly.
// Run auditAchievementScopeDrift after every change to verify no drift.
//
// Current global achievements per lib/achievements.js (as of 2026-05-13):
//   first_impression, consistent, seen_it_all, still_here, they_came_back,
//   left_on_read, group_hangout, new_place, productive_day, showed_up_anyway, rent_paid
// All other achievement ids in ACHIEVEMENTS have scope: "character".
const BACKEND_ACHIEVEMENT_SCOPES = {
  first_impression: 'global',
  consistent: 'global',
  seen_it_all: 'global',
  still_here: 'global',
  they_came_back: 'global',
  left_on_read: 'global',
  group_hangout: 'global',
  new_place: 'global',
  productive_day: 'global',
  showed_up_anyway: 'global',
  rent_paid: 'global',
};

// All achievement ids that exist in lib/achievements.js ACHIEVEMENTS object.
// Must match Object.keys(ACHIEVEMENTS) exactly. Update when adding/removing achievements.
const ALL_KNOWN_ACHIEVEMENT_IDS = [
  'first_impression', 'consistent', 'they_opened_up', 'inner_circle', 'ride_along',
  'the_push', 'voice_of_reason', 'bad_influence', 'clutch_timing', 'missed_moment',
  'that_meant_something', 'hit_deep', 'tension', 'shifted_perspective',
  'seen_it_all', 'progress_witness', 'big_moment', 'you_were_there',
  'messy', 'he_said_she_said', 'in_the_middle', 'stirred_the_pot',
  'trust_built', 'reconnected', 'favorite_contact', 'tension_resolved',
  'productive_day', 'healthy_choice', 'showed_up_anyway',
  'rent_paid', 'financial_clutch', 'impulse_avoided',
  'night_out', 'group_hangout', 'new_place',
  'let_them_in', 'hard_truth', 'apologized', 'stayed_calm',
  'watched_them_grow', 'relapse',
  'first_responder', 'bedside_manner', 'the_call_nobody_wanted',
  'still_here', 'they_came_back', 'left_on_read',
];

function getBackendScope(id) {
  return BACKEND_ACHIEVEMENT_SCOPES[id] ?? 'character';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const frontendScopes = body.frontendScopes || null;

    const drifted = [];
    const missingInBackend = [];
    const extraInBackend = [];
    const frontendOnlyIds = [];

    // ── Compare backend inline map against ALL_KNOWN_ACHIEVEMENT_IDS
    // Every known id must resolve to the correct scope in the backend map.
    for (const id of ALL_KNOWN_ACHIEVEMENT_IDS) {
      const backendScope = getBackendScope(id);
      // We can only verify "global" explicitly — "character" is the default.
      // So: if BACKEND_ACHIEVEMENT_SCOPES has this id, it claims "global".
      // If not, backend claims "character" (default).
      const backendClaims = BACKEND_ACHIEVEMENT_SCOPES.hasOwnProperty(id) ? 'global' : 'character';

      if (frontendScopes) {
        const frontendScope = frontendScopes[id];
        if (frontendScope === undefined) {
          missingInBackend.push({ id, note: 'present in ALL_KNOWN_ACHIEVEMENT_IDS but not in frontendScopes payload' });
        } else if (frontendScope !== backendClaims) {
          drifted.push({
            id,
            frontend_scope: frontendScope,
            backend_scope: backendClaims,
            fix: frontendScope === 'global'
              ? `Add '${id}: "global"' to BACKEND_ACHIEVEMENT_SCOPES in checkAchievements and retroactiveAchievementScan`
              : `Remove '${id}' from BACKEND_ACHIEVEMENT_SCOPES in checkAchievements and retroactiveAchievementScan`,
          });
        }
      }
    }

    // ── Check for ids in frontend payload that are NOT in ALL_KNOWN_ACHIEVEMENT_IDS
    if (frontendScopes) {
      for (const id of Object.keys(frontendScopes)) {
        if (!ALL_KNOWN_ACHIEVEMENT_IDS.includes(id)) {
          frontendOnlyIds.push({
            id,
            frontend_scope: frontendScopes[id],
            fix: `Add '${id}' to ALL_KNOWN_ACHIEVEMENT_IDS in auditAchievementScopeDrift, and to BACKEND_ACHIEVEMENT_SCOPES in checkAchievements + retroactiveAchievementScan if scope is "global"`,
          });
        }
      }
    }

    // ── Check for ids in BACKEND_ACHIEVEMENT_SCOPES that are NOT in ALL_KNOWN_ACHIEVEMENT_IDS
    for (const id of Object.keys(BACKEND_ACHIEVEMENT_SCOPES)) {
      if (!ALL_KNOWN_ACHIEVEMENT_IDS.includes(id)) {
        extraInBackend.push({
          id,
          note: 'In BACKEND_ACHIEVEMENT_SCOPES but not in ALL_KNOWN_ACHIEVEMENT_IDS — may be stale or mistyped',
        });
      }
    }

    const hasDrift = drifted.length > 0 || frontendOnlyIds.length > 0 || extraInBackend.length > 0;
    const status = hasDrift ? 'drift_detected' : (frontendScopes ? 'clean' : 'no_frontend_payload_provided');

    // ── Also return current UserAchievement state as proof data
    const allRecords = await base44.entities.UserAchievement.filter({ owner_email: user.email }, '-created_date', 500);

    // Build dedup groups
    const groups = new Map();
    for (const r of allRecords) {
      const scope = getBackendScope(r.achievement_id);
      const key = scope === 'global'
        ? `global::${user.email}::${r.achievement_id}`
        : `char::${user.email}::${r.achievement_id}::${r.character_id || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    const duplicateGroups = [...groups.values()].filter(g => g.length > 1);

    // Sample: one global canonical, one character canonical
    const globalSample = allRecords.find(r => getBackendScope(r.achievement_id) === 'global');
    const charSample = allRecords.find(r => getBackendScope(r.achievement_id) === 'character' && r.character_id);

    return Response.json({
      status,
      drift_summary: {
        drifted_scope_values: drifted,
        new_ids_not_in_backend_list: frontendOnlyIds,
        stale_ids_in_backend_not_in_list: extraInBackend,
      },
      proof_data: {
        total_achievement_records: allRecords.length,
        unique_scoped_keys: groups.size,
        duplicate_groups_remaining: duplicateGroups.length,
        duplicate_group_details: duplicateGroups.map(g => ({
          key: [...groups.entries()].find(([, v]) => v === g)?.[0],
          count: g.length,
          ids: g.map(r => r.id),
        })),
        global_sample: globalSample ? {
          id: globalSample.id,
          achievement_id: globalSample.achievement_id,
          scope: 'global',
          owner_email: globalSample.owner_email,
          unlocked_at: globalSample.unlocked_at,
          character_id: globalSample.character_id,
        } : null,
        character_sample: charSample ? {
          id: charSample.id,
          achievement_id: charSample.achievement_id,
          scope: 'character',
          owner_email: charSample.owner_email,
          character_id: charSample.character_id,
          character_name: charSample.character_name,
          unlocked_at: charSample.unlocked_at,
        } : null,
      },
      instructions: frontendScopes
        ? (hasDrift ? 'Fix the drifted entries listed above, then re-run this audit.' : 'Scope maps are clean. Backend mirrors lib/achievements.js exactly.')
        : 'Pass frontendScopes payload to enable full drift comparison. See function header for usage.',
    });
  } catch (error) {
    console.error('[auditAchievementScopeDrift] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});