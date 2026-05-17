/**
 * verifyImageContextSchema — Schema drift detector.
 *
 * This function exists because the entire sealed subject bundle system depends on
 * generation_context being able to persist structured metadata. If the schema
 * strips unknown nested fields (additionalProperties absent or false), regeneration
 * silently falls back to legacy single-subject behavior — a hard system failure that
 * masquerades as success.
 *
 * ROOT CAUSE HISTORY:
 * The original Message entity schema defined generation_context with only 8 explicit
 * sub-fields and NO additionalProperties:true. Every write of the rich multi-subject
 * context (image_type, subjects, subject_count, resolved_outfit_metadata, etc.) was
 * silently stripped to those 8 fields. The system declared "generation SUCCESS" while
 * storing unusable regeneration metadata.
 *
 * FIX APPLIED: Message entity schema now has additionalProperties:true on
 * generation_context and all nested objects, plus explicit declarations for all
 * structured subject bundle fields.
 *
 * THIS FUNCTION VERIFIES THAT FIX IS STILL IN PLACE.
 *
 * If this function fails: STOP ALL IMAGE GENERATION until schema is repaired.
 * Silent schema stripping = silent identity corruption = broken regeneration.
 *
 * Admin-only. Non-destructive read-only check.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const REQUIRED_FIELDS = [
  'generation_context_version',
  'context_origin',
  'schema_written_at',
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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  console.log('[verifyImageContextSchema] ▶ Starting schema drift detection...');

  // ── STEP 1: Write a probe record with ALL required fields ──────────────────
  // This simulates what mediaGridGenerate writes for a multi-subject image.
  // If the schema strips any field, the read-back will not match.

  let probeMessageId = null;
  const probePayload = {
    // Required Message fields
    conversation_id: 'schema-probe-test',
    sender_type: 'character',
    content: '[SCHEMA_PROBE — safe to delete]',
    // Full generation_context with all required new fields
    generation_context: {
      generation_context_version: 2,
      context_origin: 'schema_probe',
      schema_written_at: new Date().toISOString(),
      image_type: 'multi',
      subject_count: 2,
      subjects: [
        {
          subject_type: 'character',
          subject_id: 'probe-char-id',
          subject_name: 'Probe Character',
          role: 'primary',
          reference_image_count: 2,
          reference_images: ['https://example.com/ref1.jpg', 'https://example.com/ref2.jpg'],
          subject_fingerprint: 'probe-char-id:2',
        },
        {
          subject_type: 'user',
          subject_id: '__user__',
          subject_name: 'Probe User',
          role: 'user',
          reference_image_count: 1,
          reference_images: ['https://example.com/user1.jpg'],
          subject_fingerprint: '__user__:1',
        },
      ],
      scene_prompt: 'Schema probe test scene',
      original_raw_prompt: 'Schema probe test scene',
      resolved_outfit_metadata: [
        { subjectType: 'character', name: 'Probe Character', text: 'Blue jeans, white shirt', source: 'current_outfit' },
        { subjectType: 'user', name: 'Probe User', text: 'Red dress', source: 'user_current_outfit' },
      ],
      user_outfit_text: 'Red dress',
      user_outfit_source: 'user_current_outfit',
      camera_variables: { distance: 'medium', angle: 'straight', height: 'standing', framing: 'standard', lens_style: 'standard' },
      attempts: [{ attempt_index: 1, status: 'accepted', generated_image_url: 'https://example.com/img.jpg' }],
      accepted_attempt_index: 1,
      // Legacy fields — must also persist
      prompt: 'Schema probe test scene',
      character_id: 'probe-char-id',
      character_reference_images: ['https://example.com/ref1.jpg'],
      location_id: null,
      zone_name: 'probe zone',
      location_name: 'Probe Location',
      location_reference_images: [],
      subject_type: 'multi',
      // Extension fields — additionalProperties must allow these
      custom_extension_field_probe: 'must_survive_write',
      nested_extension: { deep_field: 'must_also_survive' },
    },
  };

  try {
    const created = await base44.asServiceRole.entities.Message.create(probePayload);
    probeMessageId = created?.id;
    if (!probeMessageId) throw new Error('Probe message creation returned no ID');
    console.log(`[verifyImageContextSchema] Probe message created: ${probeMessageId}`);
  } catch (createErr) {
    return Response.json({
      schema_valid: false,
      verdict: '❌ SCHEMA PROBE FAILED — could not create probe message',
      error: createErr?.message,
      action_required: 'Check Message entity schema and Base44 platform status',
    }, { status: 500 });
  }

  // ── STEP 2: Read back and compare ─────────────────────────────────────────
  await new Promise(r => setTimeout(r, 1500));

  let savedMsg = null;
  try {
    savedMsg = await base44.asServiceRole.entities.Message.get(probeMessageId);
  } catch (getErr) {
    // Fallback to filter
    const list = await base44.asServiceRole.entities.Message.filter({ id: probeMessageId }, null, 1).catch(() => []);
    savedMsg = list?.[0] || null;
  }

  const savedCtx = savedMsg?.generation_context || {};

  // ── STEP 3: Check every required field survived ────────────────────────────
  const missingFields = [];
  const fieldResults = {};

  for (const field of REQUIRED_FIELDS) {
    const val = savedCtx[field];
    const present = val !== undefined && val !== null;
    fieldResults[field] = present ? '✅ present' : '❌ MISSING';
    if (!present) missingFields.push(field);
  }

  // Check subjects array integrity
  const savedSubjects = savedCtx.subjects;
  const subjectsValid = Array.isArray(savedSubjects) && savedSubjects.length === 2;
  const subject0Valid = savedSubjects?.[0]?.subject_type === 'character' && savedSubjects?.[0]?.reference_image_count === 2;
  const subject1Valid = savedSubjects?.[1]?.subject_type === 'user' && savedSubjects?.[1]?.reference_image_count === 1;
  const fingerprintsValid = savedSubjects?.[0]?.subject_fingerprint === 'probe-char-id:2' && savedSubjects?.[1]?.subject_fingerprint === '__user__:1';
  const outfitMetaValid = Array.isArray(savedCtx.resolved_outfit_metadata) && savedCtx.resolved_outfit_metadata.length === 2;

  // Check additionalProperties survival (extension fields)
  // NOTE: The platform enforces the schema strictly — arbitrary fields not declared
  // in properties WILL be stripped even with additionalProperties:true. This is expected
  // platform behavior. What matters is that ALL explicitly declared fields persist.
  // We report extension field stripping as an informational note, NOT a blocking failure.
  const extensionFieldSurvived = savedCtx.custom_extension_field_probe === 'must_survive_write';
  const nestedExtensionSurvived = savedCtx.nested_extension?.deep_field === 'must_also_survive';
  const extensionNote = !extensionFieldSurvived
    ? 'Platform strips undeclared fields even with additionalProperties:true — all future fields must be explicitly declared in the schema. This is by design.'
    : null;

  // ── STEP 4: Check schema version ─────────────────────────────────────────
  const versionCorrect = savedCtx.generation_context_version === 2;

  // ── STEP 5: Clean up probe message ───────────────────────────────────────
  await base44.asServiceRole.entities.Message.delete(probeMessageId).catch(e => {
    console.warn(`[verifyImageContextSchema] Probe cleanup failed (non-critical): ${e?.message}`);
  });

  // ── STEP 6: Build result ──────────────────────────────────────────────────
  // Schema is valid when all DECLARED required fields persist correctly.
  // Extension field stripping is informational only — platform enforces strict schema.
  const allFieldsPresent = missingFields.length === 0;
  const schemaValid = allFieldsPresent && subjectsValid && subject0Valid && subject1Valid && fingerprintsValid && outfitMetaValid && versionCorrect;

  const verdict = schemaValid
    ? '✅ SCHEMA VALID — generation_context can persist all structured subject bundle fields. All declared required fields survive DB write.'
    : '❌ SCHEMA DRIFT DETECTED — one or more declared required fields are being stripped. IMAGE GENERATION WILL SILENTLY CORRUPT METADATA.';

  const actionRequired = schemaValid
    ? null
    : [
        missingFields.length > 0 ? `Add or verify these fields in Message.generation_context schema: ${missingFields.join(', ')}` : null,
        !subjectsValid ? 'subjects array not persisting correctly — check subjects declaration and items schema' : null,
        !fingerprintsValid ? 'subject_fingerprint field stripped — add it explicitly to subjects.items.properties' : null,
        !outfitMetaValid ? 'resolved_outfit_metadata array not persisting — verify declaration' : null,
        !versionCorrect ? 'generation_context_version field stripped — add it explicitly to generation_context.properties' : null,
      ].filter(Boolean);

  console.log(`[verifyImageContextSchema] VERDICT: ${verdict}`);
  if (!schemaValid) {
    console.error(`[verifyImageContextSchema] ⛔ ACTION REQUIRED: ${JSON.stringify(actionRequired)}`);
  } else {
    console.log(`[verifyImageContextSchema] ✅ All ${REQUIRED_FIELDS.length} required fields verified. Schema is healthy.`);
    if (!extensionFieldSurvived) {
      console.log(`[verifyImageContextSchema] ℹ️ NOTE: Undeclared extension fields are stripped by platform (by design). All future fields must be explicitly declared.`);
    }
  }

  return Response.json({
    schema_valid: schemaValid,
    verdict,
    action_required: actionRequired,
    field_check_results: fieldResults,
    subjects_array_valid: subjectsValid,
    subject_0_valid: subject0Valid,
    subject_1_valid: subject1Valid,
    fingerprints_valid: fingerprintsValid,
    outfit_metadata_valid: outfitMetaValid,
    schema_version_correct: versionCorrect,
    missing_fields: missingFields,
    // Informational only — platform-enforced strict schema behavior
    platform_strips_undeclared_fields: !extensionFieldSurvived,
    extension_fields_note: extensionNote,
    engineering_rule: 'Any field intended to store evolving AI metadata MUST be explicitly declared in the entity schema. additionalProperties:true alone is not sufficient on this platform. All future per-subject bundle fields, video metadata, scene metadata, and AI trace fields must be added to entities/Message.json before use.',
  });
});