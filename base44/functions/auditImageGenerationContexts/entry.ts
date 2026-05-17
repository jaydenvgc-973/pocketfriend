/**
 * auditImageGenerationContexts — Image metadata health scanner.
 *
 * Scans existing Message records for corrupted or incomplete generation_context.
 * Identifies records that were written before the schema fix (missing subjects,
 * image_type mismatch, stripped nested arrays) so they can be triaged or repaired.
 *
 * This function is READ-ONLY. It does not modify any record.
 *
 * Returns:
 *   - counts of clean vs corrupted records
 *   - examples of each corruption category
 *   - repair candidates (message IDs that need backfill)
 *
 * Admin-only. Non-destructive.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  const { ownerEmail, limit = 200 } = await req.json().catch(() => ({}));

  console.log(`[auditImageGenerationContexts] ▶ owner=${ownerEmail || 'all'} limit=${limit}`);

  // ── Fetch messages with image_urls ──────────────────────────────────────────
  const filter = ownerEmail
    ? { 'generation_context.prompt': { $exists: true } }
    : {};

  // Fetch messages that have an image_url (likely generated images)
  let messages = [];
  try {
    if (ownerEmail) {
      // Filter by conversation ownership — get conversations for this user first
      const convos = await base44.asServiceRole.entities.Conversation.filter(
        { owner_email: ownerEmail }, null, 100
      ).catch(() => []);
      const convoIds = convos.map(c => c.id);
      if (convoIds.length > 0) {
        // Sample up to limit messages from these conversations
        const batchSize = Math.ceil(limit / convoIds.length);
        const batches = await Promise.all(
          convoIds.slice(0, 20).map(cid =>
            base44.asServiceRole.entities.Message.filter(
              { conversation_id: cid }, '-created_date', batchSize
            ).catch(() => [])
          )
        );
        messages = batches.flat().filter(m => m.image_url || m.generation_context);
      }
    } else {
      // Admin broad scan — recent messages with generation_context
      messages = await base44.asServiceRole.entities.Message.list('-created_date', limit)
        .catch(() => []);
      messages = messages.filter(m => m.image_url || m.generation_context);
    }
  } catch (fetchErr) {
    return Response.json({ error: `Fetch failed: ${fetchErr?.message}` }, { status: 500 });
  }

  console.log(`[auditImageGenerationContexts] Scanning ${messages.length} image messages...`);

  // ── Audit categories ──────────────────────────────────────────────────────
  const results = {
    total_scanned: messages.length,
    clean: 0,
    corrupted: 0,
    legacy_single_subject: 0,
    missing_subjects: 0,
    image_type_null: 0,
    image_type_mismatch: 0,
    subject_count_mismatch: 0,
    missing_outfit_metadata: 0,
    stripped_nested_arrays: 0,
    no_generation_context: 0,
    modern_v2: 0,
    examples: {
      corrupted: [],
      legacy: [],
      missing_subjects: [],
      clean_multi: [],
    },
  };

  for (const msg of messages) {
    const ctx = msg.generation_context;

    if (!ctx || typeof ctx !== 'object') {
      results.no_generation_context++;
      results.corrupted++;
      if (results.examples.corrupted.length < 5) {
        results.examples.corrupted.push({
          id: msg.id,
          issue: 'no_generation_context',
          conversation_id: msg.conversation_id,
          has_image_url: !!msg.image_url,
        });
      }
      continue;
    }

    const isModernV2 = ctx.generation_context_version === 2;
    const imageType = ctx.image_type;
    const subjectCount = ctx.subject_count;
    const subjects = ctx.subjects;
    const subjectType = ctx.subject_type;
    const isMulti = imageType === 'multi' || subjectType === 'multi' || subjectCount > 1;

    // Check for legacy-only context (pre-fix: only 8 flat fields)
    const hasModernFields = !!(imageType || subjects || ctx.scene_prompt || ctx.generation_context_version);
    if (!hasModernFields) {
      results.legacy_single_subject++;
      if (results.examples.legacy.length < 5) {
        results.examples.legacy.push({
          id: msg.id,
          fields: Object.keys(ctx),
          character_id: ctx.character_id,
          subject_type: ctx.subject_type,
        });
      }
      continue; // legacy but not necessarily corrupt for single-subject images
    }

    if (isModernV2) results.modern_v2++;

    let issuesFound = [];

    // Check image_type
    if (!imageType) {
      results.image_type_null++;
      issuesFound.push('image_type_null');
    }

    // Check subjects array for multi images
    if (isMulti) {
      if (!Array.isArray(subjects) || subjects.length === 0) {
        results.missing_subjects++;
        issuesFound.push('missing_subjects');
        if (results.examples.missing_subjects.length < 5) {
          results.examples.missing_subjects.push({
            id: msg.id,
            image_type: imageType,
            subject_count: subjectCount,
            subjects_array_length: Array.isArray(subjects) ? subjects.length : 'not_array',
            has_legacy_char_id: !!ctx.character_id,
          });
        }
      } else if (typeof subjectCount === 'number' && subjects.length !== subjectCount) {
        results.subject_count_mismatch++;
        issuesFound.push(`subject_count_mismatch(declared=${subjectCount},actual=${subjects.length})`);
      }

      // Check for missing outfit metadata on multi images
      const outfitMeta = ctx.resolved_outfit_metadata;
      if (!Array.isArray(outfitMeta) || outfitMeta.length === 0) {
        results.missing_outfit_metadata++;
        issuesFound.push('missing_outfit_metadata');
      }

      // Check for user subject without refs
      const userSubject = (subjects || []).find(s => s.subject_type === 'user' || s.subject_id === '__user__');
      if (userSubject && (userSubject.reference_image_count === 0 || !userSubject.reference_images?.length)) {
        issuesFound.push('user_subject_no_refs');
      }
    }

    // Check for stripped nested arrays
    if (ctx.attempts !== undefined && !Array.isArray(ctx.attempts)) {
      results.stripped_nested_arrays++;
      issuesFound.push('attempts_not_array');
    }
    if (ctx.camera_variables !== undefined && ctx.camera_variables !== null && typeof ctx.camera_variables !== 'object') {
      results.stripped_nested_arrays++;
      issuesFound.push('camera_variables_not_object');
    }

    if (issuesFound.length > 0) {
      results.corrupted++;
      if (results.examples.corrupted.length < 10) {
        results.examples.corrupted.push({
          id: msg.id,
          issues: issuesFound,
          image_type: imageType,
          subject_count: subjectCount,
          subjects_length: Array.isArray(subjects) ? subjects.length : null,
          has_legacy_char_id: !!ctx.character_id,
          generation_context_version: ctx.generation_context_version,
        });
      }
    } else {
      results.clean++;
      if (isMulti && results.examples.clean_multi.length < 3) {
        results.examples.clean_multi.push({
          id: msg.id,
          image_type: imageType,
          subject_count: subjectCount,
          subjects: (subjects || []).map(s => ({ type: s.subject_type, id: s.subject_id, name: s.subject_name })),
          has_outfit_metadata: Array.isArray(ctx.resolved_outfit_metadata),
          generation_context_version: ctx.generation_context_version,
        });
      }
    }
  }

  const healthScore = results.total_scanned > 0
    ? Math.round((results.clean / results.total_scanned) * 100)
    : 100;

  const verdict = results.corrupted === 0
    ? `✅ HEALTHY — ${results.clean}/${results.total_scanned} image messages have valid generation_context`
    : results.corrupted <= 5
    ? `⚠️ MINOR ISSUES — ${results.corrupted} corrupted records found (likely pre-schema-fix legacy)`
    : `❌ SIGNIFICANT CORRUPTION — ${results.corrupted}/${results.total_scanned} records have corrupted metadata`;

  console.log(`[auditImageGenerationContexts] ${verdict}`);

  return Response.json({
    verdict,
    health_score_pct: healthScore,
    ...results,
    repair_note: results.corrupted > 0
      ? 'Corrupted records were written before the schema fix. For multi-subject records missing subjects[], regeneration will degrade to single-subject (identity drift). Consider backfilling from chat history if critical scenes need repair.'
      : null,
  });
});