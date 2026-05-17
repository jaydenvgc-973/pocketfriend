/**
 * verifyGenerationContextParity — Drift detection across all generation paths.
 *
 * Tests each generation pathway's output schema independently and compares
 * required fields to detect when one path has diverged from another.
 *
 * Paths covered:
 *   - generateImageAsync   (chat_image)
 *   - mediaGridGenerate    (media_grid — single-subject and multi-subject)
 *   - regenerateImageWithReason  (regenerate)
 *   - recoverSingleImage   (recovery)
 *
 * Admin-only. Does NOT generate real images — inspects recent message records
 * from each pathway by checking generation_context.context_origin.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const REQUIRED_FIELDS = [
  'generation_context_version',
  'image_type',
  'subject_count',
  'subjects',
  'scene_prompt',
  'original_raw_prompt',
  'resolved_outfit_metadata',
  'user_outfit_text',
  'user_outfit_source',
  'camera_variables',
  'attempts',
  'accepted_attempt_index',
];

const SUBJECT_REQUIRED_FIELDS = [
  'subject_type',
  'subject_id',
  'subject_name',
  'role',
  'reference_image_count',
  'reference_images',
  'subject_fingerprint',
];

const KNOWN_ORIGINS = ['chat_image', 'media_grid', 'regenerate', 'recovery'];

function checkContext(ctx, origin) {
  const result = {
    origin,
    version: ctx?.generation_context_version ?? null,
    missing_fields: [],
    subject_issues: [],
    fingerprint_issues: [],
    outfit_metadata_ok: false,
    duplicate_subject_ids: [],
    duplicate_fingerprints: [],
    role_collisions: [],
    verdict: 'unknown',
  };

  if (!ctx || typeof ctx !== 'object') {
    result.missing_fields = REQUIRED_FIELDS;
    result.verdict = 'no_context';
    return result;
  }

  // Field presence check
  for (const f of REQUIRED_FIELDS) {
    if (!(f in ctx) || ctx[f] === undefined) {
      result.missing_fields.push(f);
    }
  }

  // Subject array validation
  const subjects = ctx.subjects;
  if (Array.isArray(subjects) && subjects.length > 0) {
    const ids = [];
    const fingerprints = [];
    const roles = [];

    for (let i = 0; i < subjects.length; i++) {
      const s = subjects[i];
      const missingSubjectFields = SUBJECT_REQUIRED_FIELDS.filter(f => !(f in s) || s[f] === undefined);
      if (missingSubjectFields.length > 0) {
        result.subject_issues.push({ index: i, missing: missingSubjectFields });
      }

      // Fingerprint format validation: "stable_id:ref_count"
      if (s.subject_fingerprint) {
        const fpParts = s.subject_fingerprint.split(':');
        if (fpParts.length !== 2 || !fpParts[0] || isNaN(Number(fpParts[1]))) {
          result.fingerprint_issues.push({ index: i, fingerprint: s.subject_fingerprint, error: 'malformed — expected stable_id:ref_count' });
        }
        if (fingerprints.includes(s.subject_fingerprint)) {
          result.duplicate_fingerprints.push(s.subject_fingerprint);
        }
        fingerprints.push(s.subject_fingerprint);
      }

      // Duplicate subject IDs
      if (s.subject_id) {
        if (ids.includes(s.subject_id)) {
          result.duplicate_subject_ids.push(s.subject_id);
        }
        ids.push(s.subject_id);
      }

      // Empty reference arrays
      if (Array.isArray(s.reference_images) && s.reference_images.length === 0 && s.reference_image_count > 0) {
        result.subject_issues.push({ index: i, warning: `reference_image_count=${s.reference_image_count} but reference_images is empty` });
      }

      // Role collisions (two "primary" roles in a single-subject image)
      if (ctx.image_type !== 'multi' && ctx.image_type !== 'joint') {
        if (s.role === 'primary') roles.push(i);
      }
    }

    if (roles.length > 1) {
      result.role_collisions = roles;
    }
  }

  // Outfit metadata
  result.outfit_metadata_ok = Array.isArray(ctx.resolved_outfit_metadata);

  // Version check
  if (ctx.generation_context_version !== 2) {
    result.missing_fields.push('generation_context_version_must_be_2');
  }

  // Final verdict
  const hasCriticalIssue =
    result.missing_fields.length > 0 ||
    result.subject_issues.length > 0 ||
    result.fingerprint_issues.length > 0 ||
    result.duplicate_subject_ids.length > 0 ||
    result.duplicate_fingerprints.length > 0 ||
    result.role_collisions.length > 0;

  result.verdict = hasCriticalIssue ? 'ISSUES_FOUND' : 'PASS';
  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Fetch recent image messages (last 200) that have generation_context set
    const recentMessages = await base44.asServiceRole.entities.Message.filter(
      {},
      '-created_date',
      200
    ).catch(() => []);

    const imageMessages = recentMessages.filter(m => m.image_url && m.generation_context);
    console.log(`[verifyGenerationContextParity] Total image messages with context: ${imageMessages.length}`);

    // Bucket by context_origin
    const byOrigin = {};
    for (const origin of KNOWN_ORIGINS) {
      byOrigin[origin] = [];
    }
    byOrigin['unknown_origin'] = [];

    for (const msg of imageMessages) {
      const origin = msg.generation_context?.context_origin || 'unknown_origin';
      const bucket = byOrigin[origin] || (byOrigin[origin] = []);
      bucket.push(msg);
    }

    // Audit each bucket — take the 5 most recent per origin
    const originResults = {};
    const parityIssues = [];

    for (const [origin, msgs] of Object.entries(byOrigin)) {
      if (msgs.length === 0) {
        originResults[origin] = { sample_count: 0, verdict: 'NO_SAMPLES', note: 'No recent messages from this path. Cannot verify.' };
        continue;
      }

      const sample = msgs.slice(0, 5);
      const checks = sample.map(m => checkContext(m.generation_context, origin));
      const passing = checks.filter(c => c.verdict === 'PASS').length;
      const failing = checks.filter(c => c.verdict !== 'PASS').length;

      // Collect missing fields across all checked messages for this origin
      const allMissing = [...new Set(checks.flatMap(c => c.missing_fields))];
      const allSubjectIssues = checks.flatMap(c => c.subject_issues);
      const allFingerprintIssues = checks.flatMap(c => c.fingerprint_issues);

      const originVerdict = failing === 0 ? 'PASS' : passing === 0 ? 'FAIL_ALL' : 'FAIL_PARTIAL';
      originResults[origin] = {
        sample_count: sample.length,
        passing,
        failing,
        verdict: originVerdict,
        missing_fields_seen: allMissing,
        subject_issues: allSubjectIssues.slice(0, 3),
        fingerprint_issues: allFingerprintIssues.slice(0, 3),
        example_message_ids: sample.map(m => m.id),
      };

      if (originVerdict !== 'PASS') {
        parityIssues.push({ origin, missing_fields: allMissing, verdict: originVerdict });
      }
    }

    // Cross-path parity check: compare required field coverage between paths
    const pathsMissingVersionField = Object.entries(originResults)
      .filter(([, r]) => r.missing_fields_seen?.includes('generation_context_version_must_be_2'))
      .map(([origin]) => origin);

    const pathsMissingSubjects = Object.entries(originResults)
      .filter(([, r]) => r.missing_fields_seen?.includes('subjects'))
      .map(([origin]) => origin);

    const pathsMissingOutfitMetadata = Object.entries(originResults)
      .filter(([, r]) => r.missing_fields_seen?.includes('resolved_outfit_metadata'))
      .map(([origin]) => origin);

    const overallVerdict = parityIssues.length === 0 ? 'ALL_PATHS_PASS' : 'DRIFT_DETECTED';

    console.log(`[verifyGenerationContextParity] Verdict: ${overallVerdict} | parity issues: ${parityIssues.length}`);

    return Response.json({
      verdict: overallVerdict,
      parity_issues: parityIssues,
      paths_missing_version_field: pathsMissingVersionField,
      paths_missing_subjects: pathsMissingSubjects,
      paths_missing_outfit_metadata: pathsMissingOutfitMetadata,
      per_origin_results: originResults,
      total_image_messages_scanned: imageMessages.length,
      note: overallVerdict === 'ALL_PATHS_PASS'
        ? 'All sampled generation paths are writing v2-compliant generation_context. No drift detected.'
        : 'Drift detected. Paths listed in parity_issues are missing required fields. Fix the listed paths to restore parity.',
      engineering_rule: 'IDENTITY SOURCE PRIORITY: (1) subjects[] bundle, (2) subject_fingerprint, (3) explicit structured metadata, (4) appearance_lock_snapshot, (5) NEVER prompt text alone.',
    });

  } catch (error) {
    console.error('[verifyGenerationContextParity] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});