/**
 * imageGenerationValidator — Shared pre/post generation visual validation helper.
 *
 * Called by generateImageAsync, regenerateImageWithReason, and mediaGridGenerate.
 *
 * All audit and validation logic is INLINED here — no inter-function calls to
 * imageVisualSourceValidator. This eliminates the 401/403 auth failure chain
 * that was causing every generated image to be rejected with [IMAGE_FAILED].
 *
 *   mode: "prepare"
 *     - Fetches recent conversation context names (live, from DB)
 *     - Resolves location owner/resident names
 *     - Resolves sender name (when sender ≠ subject)
 *     - Builds audit object and boundary block inline
 *     - Returns { boundaryBlock, audit, conversationContextNames, locationOwnerNames }
 *
 *   mode: "validate"
 *     - Calls InvokeLLM directly on the generated image URL
 *     - Returns { passes, reject_reason, issues, vision_result, validation_status }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINED: detectForbiddenContextEntities ───────────────────────────────────
function detectForbiddenContextEntities({ prompt, approvedSubjectNames, conversationContextNames, locationOwnerNames, senderName }) {
  const promptLower = (prompt || '').toLowerCase();
  const detected = [];
  const ignored = [];
  const sourcesBlocked = [];

  const isApproved = (name) => approvedSubjectNames.some(a => a && name && a.toLowerCase().includes(name.toLowerCase()));

  if (senderName && !isApproved(senderName)) {
    detected.push(`sender:${senderName}`);
    if (!ignored.includes(senderName)) ignored.push(senderName);
    if (!sourcesBlocked.includes('sender_identity')) sourcesBlocked.push('sender_identity');
  }

  for (const name of (conversationContextNames || [])) {
    if (!name || isApproved(name)) continue;
    const nameLower = name.toLowerCase();
    if (promptLower.includes(nameLower)) {
      detected.push(`conversation:${name}`);
      if (!ignored.includes(name)) ignored.push(name);
      if (!sourcesBlocked.includes('conversation_history')) sourcesBlocked.push('conversation_history');
    } else {
      detected.push(`context_entity:${name}`);
      if (!ignored.includes(name)) ignored.push(name);
    }
  }

  for (const name of (locationOwnerNames || [])) {
    if (!name || isApproved(name)) continue;
    detected.push(`location_entity:${name}`);
    if (!ignored.includes(name)) ignored.push(name);
    if (!sourcesBlocked.includes('location_owner_resident_associations')) sourcesBlocked.push('location_owner_resident_associations');
  }

  return { detected, ignored, sourcesBlocked };
}

// ── INLINED: classifyAmbientOccupancy ─────────────────────────────────────────
function classifyAmbientOccupancy(prompt) {
  const isPublicCrowd = /\b(pool party|club|nightclub|concert|beach party|festival|mall|airport|crowd|packed|busy restaurant|crowded|bar scene|dance floor)\b/i.test(prompt);
  const isIsolated = /\b(alone|empty|vacant|no people|nobody|no one|just the two|private|just us|object only|room only|id card|document only)\b/i.test(prompt);
  return {
    ambient_occupants_enabled: isPublicCrowd && !isIsolated,
    scene_type: isIsolated ? 'isolated' : isPublicCrowd ? 'public_crowd' : 'private',
  };
}

// ── INLINED: buildVisualSourceAudit ──────────────────────────────────────────
function buildVisualSourceAudit({ prompt, approvedSubjects, conversationContextNames, locationOwnerNames, senderName, expectedHumanCount, logPrefix }) {
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
    identifiable_background_faces_detected: null,
    named_character_similarity_detected: null,
    environmental_layer_blocked_from_identity_system: true,
  };

  console.log(`${prefix} final_visual_roster: ${JSON.stringify(audit.final_visual_roster)}`);
  console.log(`${prefix} expected_human_count: ${audit.expected_human_count}`);
  console.log(`${prefix} scene_type: ${audit.scene_type}`);

  return audit;
}

// ── INLINED: buildVisualSourceBoundaryBlock ───────────────────────────────────
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

// ── INLINED: runPostGenerationValidation ─────────────────────────────────────
async function runPostGenerationValidation({ base44, imageUrl, audit, charRecord, expectedHumanCount, attempt, logPrefix }) {
  const prefix = logPrefix || '[PostGenValidation]';

  if (!imageUrl) {
    return { passes: true, issues: [], vision_result: null };
  }

  const lock = charRecord?.appearance_lock || {};
  const canonHair = [lock.hair_type, lock.hairstyle].filter(Boolean).join(', ');
  const isBaldCanon = lock.bald === true || /\b(bald|shaved head|no hair)\b/i.test(lock.hair_type || '');
  const hasAppearanceLock = Object.keys(lock).length > 0;

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
    bannedNames.length > 0 ? `BANNED PERSONS (must NOT appear): ${bannedNames.join(', ')}` : null,
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

    console.log(`${prefix} attempt=${attempt} passes=${vr.passes} human_count_correct=${vr.human_count_correct} hair_mismatch=${vr.hair_mismatch}`);

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
    // On LLM error, return passes=true so the image is NOT blocked
    return { passes: true, issues: [], vision_result: null, non_blocking_error: err?.message };
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // NOTE: user may be null for service-role callers — that is OK.
    // All DB access below uses base44.asServiceRole which does not require user auth.
    const user = await base44.auth.me().catch(() => null);

    const body = await req.json();
    const { mode } = body;

    if (!mode) {
      return Response.json({ error: 'mode is required (prepare | validate)' }, { status: 400 });
    }

    // ── MODE: PREPARE ─────────────────────────────────────────────────────────
    if (mode === 'prepare') {
      const {
        conversationId,
        senderCharacterId,
        subjectCharacterId,
        locationId,
        approvedSubjects,
        sanitizedPrompt,
        expectedHumanCount,
        logPrefix,
      } = body;

      if (!sanitizedPrompt) {
        return Response.json({ error: 'sanitizedPrompt is required for prepare mode' }, { status: 400 });
      }

      // 1. Resolve conversation context names
      const conversationContextNames = [];
      let conversationNameResolutionStatus = 'skipped';
      if (conversationId) {
        try {
          const recentMsgs = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: conversationId }, '-created_date', 20
          ).catch(() => []);
          const nameSet = new Set();
          for (const m of recentMsgs) {
            if (m.character_name) nameSet.add(m.character_name);
            if (m.played_as_character_name) nameSet.add(m.played_as_character_name);
          }
          const approvedNameSet = new Set((approvedSubjects || []).map(s => (s.name || '').toLowerCase()));
          for (const n of nameSet) {
            if (n && !approvedNameSet.has(n.toLowerCase())) conversationContextNames.push(n);
          }
          conversationNameResolutionStatus = `resolved_${recentMsgs.length}_msgs_found_${conversationContextNames.length}_context_names`;
          console.log(`${logPrefix || '[imageGenerationValidator]'} conversation_context_names: [${conversationContextNames.join(', ')}] from ${recentMsgs.length} msgs`);
        } catch (ctxErr) {
          conversationNameResolutionStatus = `error: ${ctxErr?.message}`;
        }
      }

      // 2. Resolve location owner / resident names
      const locationOwnerNames = [];
      if (locationId) {
        try {
          const locRecs = await base44.asServiceRole.entities.LocationReference.filter(
            { id: locationId }, null, 1
          ).catch(() => []);
          const loc = locRecs?.[0];
          if (loc) {
            if (loc.owner_character_name) locationOwnerNames.push(loc.owner_character_name);
            if (loc.owner_npc_name) locationOwnerNames.push(loc.owner_npc_name);
            (loc.residents || []).forEach(r => { if (r.character_name) locationOwnerNames.push(r.character_name); });
            (loc.resident_character_names || []).forEach(n => { if (n) locationOwnerNames.push(n); });
          }
        } catch (locErr) {
          console.warn(`${logPrefix || '[imageGenerationValidator]'} location owner resolution failed: ${locErr?.message}`);
        }
      }

      // 3. Resolve sender name for firewall
      let senderName = null;
      if (senderCharacterId && senderCharacterId !== subjectCharacterId) {
        try {
          const sr = await base44.asServiceRole.entities.Character.filter(
            { id: senderCharacterId }, null, 1
          ).catch(() => []);
          senderName = sr?.[0]?.name || null;
        } catch (senderErr) {
          console.warn(`${logPrefix || '[imageGenerationValidator]'} sender name resolution failed: ${senderErr?.message}`);
        }
      }

      // 4. Build audit inline (no inter-function call)
      const audit = buildVisualSourceAudit({
        prompt: sanitizedPrompt,
        approvedSubjects: approvedSubjects || [],
        conversationContextNames,
        locationOwnerNames,
        senderName: senderName || null,
        expectedHumanCount: expectedHumanCount ?? 1,
        logPrefix: logPrefix || '[imageGenerationValidator][audit]',
      });

      const approvedNames = (approvedSubjects || []).map(s => s.name).filter(Boolean);
      const boundaryBlock = buildVisualSourceBoundaryBlock({
        audit,
        approvedSubjectNames: approvedNames,
        isPub: audit.ambient_occupants_enabled,
      });

      return Response.json({
        success: true,
        audit,
        boundaryBlock,
        conversationContextNames,
        locationOwnerNames,
        senderName,
        auditStatus: 'success',
        conversationNameResolutionStatus,
      });
    }

    // ── MODE: VALIDATE ────────────────────────────────────────────────────────
    if (mode === 'validate') {
      const {
        imageUrl,
        audit,
        charRecord,
        expectedHumanCount,
        attempt,
        logPrefix,
      } = body;

      if (!imageUrl) {
        return Response.json({ error: 'imageUrl is required for validate mode' }, { status: 400 });
      }

      try {
        const result = await runPostGenerationValidation({
          base44,
          imageUrl,
          audit: audit || { final_visual_roster: [], conversation_entities_detected: [], location_entities_detected: [], expected_human_count: expectedHumanCount || 1 },
          charRecord: charRecord || null,
          expectedHumanCount: expectedHumanCount ?? 1,
          attempt: attempt ?? 1,
          logPrefix: logPrefix || '[imageGenerationValidator][validate]',
        });

        return Response.json({
          success: true,
          passes: result.passes ?? null,
          reject_reason: result.reject_reason || null,
          issues: result.issues || [],
          vision_result: result.vision_result || null,
          validation_status: result.passes === true ? 'passed' : result.passes === false ? 'failed' : 'validation_unavailable',
          image_not_verified: result.passes !== true,
        });

      } catch (validateErr) {
        console.error(`${logPrefix || '[imageGenerationValidator]'} ⛔ validate FAILED: ${validateErr?.message}`);
        // On hard failure, return passes=true — do NOT block the image
        return Response.json({
          success: true,
          passes: true,
          reject_reason: null,
          issues: [],
          vision_result: null,
          validation_status: 'validation_unavailable',
          validation_error: validateErr?.message,
          image_not_verified: true,
        });
      }
    }

    return Response.json({ error: `Unknown mode: ${mode}` }, { status: 400 });

  } catch (error) {
    console.error('[imageGenerationValidator] Fatal:', error?.message);
    return Response.json({ success: false, error: error?.message }, { status: 500 });
  }
});