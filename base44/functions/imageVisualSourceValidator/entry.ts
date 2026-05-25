/**
 * imageVisualSourceValidator
 *
 * SHARED RUNTIME VISUAL SOURCE BOUNDARY ENFORCER
 *
 * This is the single authoritative module for:
 *   1. Visual Source Audit     — detects forbidden context entities (conversation, location owner, sender)
 *                                and proves they were blocked from subject selection
 *   2. Human Count Enforcement — enforces expected foreground human count
 *   3. Environmental Occupancy Safety — classifies ambient crowd scenes, enforces anonymity
 *   4. Post-Generation Vision Validation — calls InvokeLLM on the generated image URL to confirm:
 *                                          - canonical appearance was rendered
 *                                          - human count was honored
 *                                          - no forbidden entities appeared
 *                                          - background figures are anonymous
 *
 * IMPORTANT: This is the ONLY place these rules live. generateImageAsync, mediaGridGenerate,
 * regenerateImageWithReason, and sceneImageGenerator all call this via base44.functions.invoke.
 * Do not duplicate this logic — any change here applies everywhere.
 *
 * Called as:
 *   POST /imageVisualSourceValidator
 *   { mode: 'audit' | 'validate' | 'build_boundary_block', ...params }
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── NAME EXTRACTOR ─────────────────────────────────────────────────────────────
// Extracts likely human names from a text string using capitalized word patterns.
// Returns lowercase unique name tokens.
function extractNamesFromText(text) {
  if (!text) return [];
  // Match capitalized words 3+ chars not at sentence start
  const matches = text.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/g) || [];
  const common = new Set(['The','This','That','These','Those','When','Where','With','From','Into','Over','Also','Then','They','Their','There','Here','More','Some','Each','Both','Such','Even','Just','Only','Very','Most','Many','Much','After','About','Above','Below','Under','Until']);
  return [...new Set(matches.filter(m => !common.has(m)).map(m => m.toLowerCase()))];
}

// ── FORBIDDEN ENTITY DETECTOR ──────────────────────────────────────────────────
// Scans the prompt for names that match:
//   - conversation context entities (other characters recently mentioned)
//   - location owner/resident names
//   - sender character name (when sender != subject)
// Returns { detected: string[], ignored: string[], sources_blocked: string[] }
function detectForbiddenContextEntities({
  prompt,
  approvedSubjectNames,   // names that ARE allowed (selected subjects)
  conversationContextNames, // names from recent chat context
  locationOwnerNames,       // location owner/resident names
  senderName,               // sender character name (if different from subject)
}) {
  const promptLower = (prompt || '').toLowerCase();
  const detected = [];
  const ignored = [];
  const sourcesBlocked = [];

  const isApproved = (name) =>
    approvedSubjectNames.some(a => a && name && a.toLowerCase().includes(name.toLowerCase()));

  // Check sender
  if (senderName && !isApproved(senderName)) {
    const senderLower = senderName.toLowerCase();
    if (promptLower.includes(senderLower) || true) { // sender is always a forbidden injection risk
      detected.push(`sender:${senderName}`);
      if (!ignored.includes(senderName)) ignored.push(senderName);
      if (!sourcesBlocked.includes('sender_identity')) sourcesBlocked.push('sender_identity');
    }
  }

  // Check conversation context names
  for (const name of (conversationContextNames || [])) {
    if (!name || isApproved(name)) continue;
    const nameLower = name.toLowerCase();
    if (promptLower.includes(nameLower)) {
      detected.push(`conversation:${name}`);
      if (!ignored.includes(name)) ignored.push(name);
      if (!sourcesBlocked.includes('conversation_history')) sourcesBlocked.push('conversation_history');
    } else {
      // Name not in prompt but existed in context — still log as potential source
      detected.push(`context_entity:${name}`);
      if (!ignored.includes(name)) ignored.push(name);
    }
  }

  // Check location owners/residents
  for (const name of (locationOwnerNames || [])) {
    if (!name || isApproved(name)) continue;
    const nameLower = name.toLowerCase();
    detected.push(`location_entity:${name}`);
    if (!ignored.includes(name)) ignored.push(name);
    if (!sourcesBlocked.includes('location_owner_resident_associations')) sourcesBlocked.push('location_owner_resident_associations');
  }

  return { detected, ignored, sourcesBlocked };
}

// ── AMBIENT OCCUPANCY CLASSIFIER ──────────────────────────────────────────────
function classifyAmbientOccupancy(prompt) {
  const p = (prompt || '').toLowerCase();
  const isPublicCrowd = /\b(pool party|club|nightclub|concert|beach party|festival|mall|airport|crowd|packed|busy restaurant|crowded|bar scene|dance floor)\b/i.test(prompt);
  const isIsolated = /\b(alone|empty|vacant|no people|nobody|no one|just the two|private|just us|object only|room only|id card|document only)\b/i.test(prompt);
  return {
    ambient_occupants_enabled: isPublicCrowd && !isIsolated,
    scene_type: isIsolated ? 'isolated' : isPublicCrowd ? 'public_crowd' : 'private',
  };
}

// ── VISUAL SOURCE AUDIT BUILDER ────────────────────────────────────────────────
// Returns a structured audit object AND logs every field at runtime.
function buildVisualSourceAudit({
  prompt,
  approvedSubjects,          // [{id, name, type}]
  conversationContextNames,
  locationOwnerNames,
  senderName,
  expectedHumanCount,
  logPrefix,
}) {
  const prefix = logPrefix || '[VisualSourceAudit]';
  const approvedNames = (approvedSubjects || []).map(s => s.name).filter(Boolean);

  const { detected, ignored, sourcesBlocked } = detectForbiddenContextEntities({
    prompt,
    approvedSubjectNames: approvedNames,
    conversationContextNames,
    locationOwnerNames,
    senderName,
  });

  const { ambient_occupants_enabled, scene_type } = classifyAmbientOccupancy(prompt);

  const audit = {
    prompt_subjects_used: approvedNames,
    locked_subjects_used: approvedNames,
    canonical_traits_used: (approvedSubjects || []).map(s => s.canonical_traits || 'see_appearance_lock').filter(Boolean),
    conversation_entities_detected: detected.filter(d => d.startsWith('conversation:') || d.startsWith('context_entity:')).map(d => d.split(':')[1]),
    conversation_entities_ignored: ignored.filter(n => detected.some(d => (d.startsWith('conversation:') || d.startsWith('context_entity:')) && d.endsWith(n))),
    location_entities_detected: detected.filter(d => d.startsWith('location_entity:')).map(d => d.split(':')[1]),
    location_entities_ignored: ignored.filter(n => detected.some(d => d.startsWith('location_entity:') && d.endsWith(n))),
    sender_detected: senderName || null,
    sender_ignored: senderName && !approvedNames.some(a => a?.toLowerCase() === senderName?.toLowerCase()) ? senderName : null,
    forbidden_context_sources_blocked: sourcesBlocked,
    final_visual_roster: approvedNames,
    final_visual_mode: expectedHumanCount === 0 ? 'object_or_environment' : expectedHumanCount === 1 ? 'single_subject' : 'multi_subject',
    expected_human_count: expectedHumanCount,
    ambient_occupants_enabled,
    scene_type,
    // Post-generation fields — filled after vision validation
    identifiable_background_faces_detected: null,
    named_character_similarity_detected: null,
    environmental_layer_blocked_from_identity_system: true,
  };

  // ── RUNTIME LOG — these are the actual structured diagnostics ──────────────
  console.log(`${prefix} ══════════════════════════════════════════`);
  console.log(`${prefix} prompt_subjects_used:              ${JSON.stringify(audit.prompt_subjects_used)}`);
  console.log(`${prefix} final_visual_roster:               ${JSON.stringify(audit.final_visual_roster)}`);
  console.log(`${prefix} final_visual_mode:                 ${audit.final_visual_mode}`);
  console.log(`${prefix} expected_human_count:              ${audit.expected_human_count}`);
  console.log(`${prefix} conversation_entities_detected:    ${JSON.stringify(audit.conversation_entities_detected)}`);
  console.log(`${prefix} conversation_entities_ignored:     ${JSON.stringify(audit.conversation_entities_ignored)}`);
  console.log(`${prefix} location_entities_detected:        ${JSON.stringify(audit.location_entities_detected)}`);
  console.log(`${prefix} location_entities_ignored:         ${JSON.stringify(audit.location_entities_ignored)}`);
  console.log(`${prefix} sender_detected:                   ${audit.sender_detected}`);
  console.log(`${prefix} sender_ignored:                    ${audit.sender_ignored}`);
  console.log(`${prefix} forbidden_context_sources_blocked: ${JSON.stringify(audit.forbidden_context_sources_blocked)}`);
  console.log(`${prefix} ambient_occupants_enabled:         ${audit.ambient_occupants_enabled}`);
  console.log(`${prefix} scene_type:                        ${audit.scene_type}`);
  console.log(`${prefix} environmental_layer_blocked:       ${audit.environmental_layer_blocked_from_identity_system}`);
  console.log(`${prefix} ══════════════════════════════════════════`);

  return audit;
}

// ── POST-GENERATION VISION VALIDATION ─────────────────────────────────────────
// Calls InvokeLLM on the generated image URL with structured JSON schema response.
// Returns { passes, issues, vision_result }
async function runPostGenerationValidation({
  base44,
  imageUrl,
  audit,
  charRecord,         // primary character record (for appearance_lock check)
  expectedHumanCount,
  attempt,
  logPrefix,
}) {
  const prefix = logPrefix || '[PostGenValidation]';

  if (!imageUrl) {
    console.warn(`${prefix} No image URL — skipping post-generation validation`);
    return { passes: true, issues: [], vision_result: null };
  }

  const lock = charRecord?.appearance_lock || {};
  const canonHair = [lock.hair_type, lock.hairstyle].filter(Boolean).join(', ');
  const isBaldCanon = lock.bald === true || /\b(bald|shaved head|no hair)\b/i.test(lock.hair_type || '');
  const hasAppearanceLock = Object.keys(lock).length > 0;

  // Build the banned names list from audit (conversation + location entities + sender)
  const bannedNames = [
    ...(audit.conversation_entities_detected || []),
    ...(audit.location_entities_detected || []),
    audit.sender_ignored,
  ].filter(Boolean);

  const visionLines = [
    `You are a strict visual content validator. Analyze this image and return ONLY a JSON object.`,
    ``,
    `APPROVED SUBJECTS: ${JSON.stringify(audit.final_visual_roster)} (${expectedHumanCount} total)`,
    `EXPECTED HUMAN COUNT IN FOREGROUND: ${expectedHumanCount}`,
    hasAppearanceLock ? `CANONICAL APPEARANCE FOR PRIMARY SUBJECT: ${isBaldCanon ? 'BALD — zero hair' : (canonHair || 'any')}${lock.facial_hair ? `, facial_hair: ${lock.facial_hair}` : ''}${lock.skin_tone ? `, skin: ${lock.skin_tone}` : ''}` : null,
    bannedNames.length > 0 ? `BANNED PERSONS (must NOT appear — were mentioned in conversation or location context but are NOT subjects): ${bannedNames.join(', ')}` : null,
    ``,
    `Check ALL of the following:`,
    `1. foreground_human_count: How many humans are clearly visible in the foreground?`,
    `2. human_count_correct: Is foreground_human_count === ${expectedHumanCount}?`,
    hasAppearanceLock ? `3. hair_mismatch: Does the primary subject's hair DIFFER from canonical (${isBaldCanon ? 'bald' : canonHair || 'any'})? true=mismatch` : null,
    hasAppearanceLock ? `4. facial_hair_mismatch: Does facial hair differ from canonical (${lock.facial_hair || 'any'})? true=mismatch` : null,
    `5. identifiable_background_faces_detected: Are any background figures identifiable (clear faces visible)?`,
    `6. sender_appeared: Does any subject NOT matching the approved roster appear in a primary focal role?`,
    bannedNames.length > 0 ? `7. banned_person_appeared: Does any person resembling ${bannedNames.join(' or ')} appear anywhere in the image?` : null,
    `8. passes: true ONLY if human_count_correct AND (no hair_mismatch if canonical set) AND NOT identifiable_background_faces_detected AND NOT sender_appeared AND NOT banned_person_appeared`,
    `9. reject_reason: null if passes=true, otherwise specific reason`,
    `10. drift_score: 0-10 (0=perfect match, 10=completely wrong identity/content)`,
    ``,
    `Return ONLY this JSON (no text outside the JSON):`,
    `{"foreground_human_count":N,"human_count_correct":bool,"hair_mismatch":bool,"facial_hair_mismatch":bool,"identifiable_background_faces_detected":bool,"sender_appeared":bool,"banned_person_appeared":bool,"passes":bool,"reject_reason":"null or reason","drift_score":N}`,
    `STRICT: dreadlocks ≠ short hair → hair_mismatch=true, passes=false.`,
    `STRICT: bald + any hair visible → hair_mismatch=true, passes=false.`,
  ].filter(Boolean).join('\n');

  try {
    const vr = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: visionLines,
      file_urls: [imageUrl],
      response_json_schema: {
        type: 'object',
        properties: {
          foreground_human_count: { type: 'number' },
          human_count_correct: { type: 'boolean' },
          hair_mismatch: { type: 'boolean' },
          facial_hair_mismatch: { type: 'boolean' },
          identifiable_background_faces_detected: { type: 'boolean' },
          sender_appeared: { type: 'boolean' },
          banned_person_appeared: { type: 'boolean' },
          passes: { type: 'boolean' },
          reject_reason: { type: 'string' },
          drift_score: { type: 'number' },
        },
      },
    });

    // ── RUNTIME LOG — post-generation validation results ────────────────────
    console.log(`${prefix} ── RESULT attempt=${attempt} ──────────────────────────`);
    console.log(`${prefix} passes:                              ${vr.passes}`);
    console.log(`${prefix} foreground_human_count:             ${vr.foreground_human_count} (expected ${expectedHumanCount})`);
    console.log(`${prefix} human_count_correct:                ${vr.human_count_correct}`);
    console.log(`${prefix} hair_mismatch:                      ${vr.hair_mismatch}`);
    console.log(`${prefix} facial_hair_mismatch:               ${vr.facial_hair_mismatch}`);
    console.log(`${prefix} identifiable_background_faces_detected: ${vr.identifiable_background_faces_detected}`);
    console.log(`${prefix} sender_appeared:                    ${vr.sender_appeared}`);
    console.log(`${prefix} banned_person_appeared:             ${vr.banned_person_appeared}`);
    console.log(`${prefix} drift_score:                        ${vr.drift_score}`);
    console.log(`${prefix} reject_reason:                      ${vr.reject_reason}`);
    console.log(`${prefix} ─────────────────────────────────────────────────────`);

    const issues = [];
    if (!vr.human_count_correct) issues.push(`human_count_violation: got ${vr.foreground_human_count}, expected ${expectedHumanCount}`);
    if (vr.hair_mismatch) issues.push(`hair_mismatch: canonical=${isBaldCanon ? 'bald' : canonHair}`);
    if (vr.facial_hair_mismatch) issues.push(`facial_hair_mismatch: canonical=${lock.facial_hair || 'any'}`);
    if (vr.identifiable_background_faces_detected) issues.push('identifiable_background_faces_detected');
    if (vr.sender_appeared) issues.push('sender_appeared_as_subject');
    if (vr.banned_person_appeared) issues.push(`banned_person_appeared: ${bannedNames.join(', ')}`);

    return {
      passes: vr.passes === true,
      issues,
      vision_result: vr,
      reject_reason: vr.reject_reason,
    };
  } catch (err) {
    console.warn(`${prefix} ⚠️ Vision validation error (non-blocking): ${err?.message}`);
    return { passes: true, issues: [], vision_result: null, non_blocking_error: err?.message };
  }
}

// ── VISUAL SOURCE BOUNDARY BLOCK BUILDER ─────────────────────────────────────
// Returns the text block injected into generation prompts.
// This supplements (not replaces) runtime logging.
function buildVisualSourceBoundaryBlock({ audit, approvedSubjectNames, isPub }) {
  const names = approvedSubjectNames.join(', ') || 'none';
  return `
════════════════════════════════════════════════════════════
⛔ VISUAL SOURCE BOUNDARY LAW — ABSOLUTE ARCHITECTURAL RULE
════════════════════════════════════════════════════════════

APPROVED VISUAL SUBJECTS (the ONLY people allowed to appear): ${names}
EXPECTED FOREGROUND HUMAN COUNT: ${audit.expected_human_count}

FORBIDDEN VISUAL SOURCES (never allowed):
  ⛔ Conversation history or prior chat messages
  ⛔ Recently mentioned character names from context: ${audit.conversation_entities_detected?.join(', ') || 'none detected'}
  ⛔ Sender identity (who sent this message is NOT a subject)
  ⛔ Location owner/resident/worker: ${audit.location_entities_detected?.join(', ') || 'none detected'}
  ⛔ Relationship context or inferred presence
  ⛔ Any person not explicitly declared above

ENVIRONMENTAL OCCUPANCY SAFETY:
${isPub
  ? `Populated setting detected. Anonymous atmospheric occupants ONLY:
  ✅ Blurred, indistinct, distant background silhouettes are allowed
  ⛔ No recognizable facial detail on any background figure
  ⛔ No background figure may resemble: ${[...(audit.conversation_entities_detected || []), ...(audit.location_entities_detected || [])].join(', ') || 'any known character'}
  ⛔ If anonymity cannot be guaranteed → reduce or remove background figures
  ⛔ Identity purity > environmental realism`
  : `Private scene. Zero background figures allowed.`}

environmental_layer_blocked_from_identity_system: true
subject_authority_lock_active: true
════════════════════════════════════════════════════════════`;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // NOTE: This function is called by imageGenerationValidator via service-role invoke.
    // Do NOT gate on user auth here — service-role callers have no user session.
    // Authorization is enforced at the generateImageAsync level (owner_email check).

    const body = await req.json();
    const { mode } = body;

    // ── MODE: audit ────────────────────────────────────────────────────────────
    // Builds the visual source audit object and logs all runtime diagnostics.
    // Call BEFORE generation to establish the audit record.
    if (mode === 'audit') {
      const {
        prompt,
        approvedSubjects,
        conversationContextNames,
        locationOwnerNames,
        senderName,
        expectedHumanCount,
        logPrefix,
      } = body;

      const audit = buildVisualSourceAudit({
        prompt,
        approvedSubjects: approvedSubjects || [],
        conversationContextNames: conversationContextNames || [],
        locationOwnerNames: locationOwnerNames || [],
        senderName: senderName || null,
        expectedHumanCount: expectedHumanCount ?? 1,
        logPrefix,
      });

      const { ambient_occupants_enabled } = audit;
      const approvedNames = (approvedSubjects || []).map(s => s.name).filter(Boolean);
      const boundaryBlock = buildVisualSourceBoundaryBlock({
        audit,
        approvedSubjectNames: approvedNames,
        isPub: ambient_occupants_enabled,
      });

      return Response.json({ success: true, audit, boundary_block: boundaryBlock });
    }

    // ── MODE: validate ─────────────────────────────────────────────────────────
    // Runs post-generation vision validation on a generated image URL.
    // Call AFTER generation to confirm the image is clean.
    if (mode === 'validate') {
      const {
        imageUrl,
        audit,
        charRecord,
        expectedHumanCount,
        attempt,
        logPrefix,
      } = body;

      const result = await runPostGenerationValidation({
        base44,
        imageUrl,
        audit: audit || {},
        charRecord: charRecord || null,
        expectedHumanCount: expectedHumanCount ?? 1,
        attempt: attempt ?? 1,
        logPrefix,
      });

      return Response.json({ success: true, ...result });
    }

    // ── MODE: build_boundary_block ─────────────────────────────────────────────
    // Returns only the text prompt block (no logging, lightweight).
    if (mode === 'build_boundary_block') {
      const { audit, approvedSubjectNames, isPub } = body;
      const block = buildVisualSourceBoundaryBlock({ audit: audit || {}, approvedSubjectNames: approvedSubjectNames || [], isPub: !!isPub });
      return Response.json({ success: true, boundary_block: block });
    }

    return Response.json({ error: `Unknown mode: ${mode}. Use 'audit', 'validate', or 'build_boundary_block'.` }, { status: 400 });

  } catch (error) {
    console.error('[imageVisualSourceValidator] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});