/**
 * verifyGenerationContextParity — Drift detection across all generation paths.
 *
 * TWO MODES:
 *
 * 1. passive (default):
 *    Inspects recent message records bucketed by context_origin.
 *    Tells you what old/existing records look like.
 *    Honest limitation: NO_SAMPLES = cannot prove anything for that path.
 *
 * 2. active_runtime_probe:
 *    Creates real scratch messages, runs each generation pathway via HTTP fetch
 *    (same auth mechanism as the frontend), reads back the saved generation_context,
 *    then deletes all scratch messages and restores any injected test refs.
 *    This is the ONLY mode that can prove the current code path works when no
 *    real user images have been generated since the last deployment.
 *
 *    Required params for active mode:
 *      - characterId: a real character the admin owns (with reference images or avatar)
 *      - conversationId: an existing conversation to attach scratch messages to
 *
 * Admin-only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── SCHEMA REQUIREMENTS ────────────────────────────────────────────────────────

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

const APP_ID = Deno.env.get('BASE44_APP_ID');
const FUNCTIONS_BASE_URL = `https://base44.app/api/apps/${APP_ID}/functions`;

// ── URL UTILITIES ──────────────────────────────────────────────────────────────

function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

function cdnFilter(urls) {
  return (urls || []).map(toPublicCDN).filter(isAccessible);
}

// ── CONTEXT CHECKER (shared by both modes) ─────────────────────────────────────

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

  for (const f of REQUIRED_FIELDS) {
    if (!(f in ctx) || ctx[f] === undefined) {
      result.missing_fields.push(f);
    }
  }

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

      if (s.subject_id) {
        if (ids.includes(s.subject_id)) result.duplicate_subject_ids.push(s.subject_id);
        ids.push(s.subject_id);
      }

      if (Array.isArray(s.reference_images) && s.reference_images.length === 0 && s.reference_image_count > 0) {
        result.subject_issues.push({ index: i, warning: `reference_image_count=${s.reference_image_count} but reference_images is empty` });
      }

      if (ctx.image_type !== 'multi' && ctx.image_type !== 'joint') {
        if (s.role === 'primary') roles.push(i);
      }
    }

    if (roles.length > 1) result.role_collisions = roles;
  }

  result.outfit_metadata_ok = Array.isArray(ctx.resolved_outfit_metadata);

  if (ctx.generation_context_version !== 2) {
    result.missing_fields.push('generation_context_version_must_be_2');
  }

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

// ── PASSIVE AUDIT ──────────────────────────────────────────────────────────────

async function runPassiveAudit(base44) {
  const recentMessages = await base44.asServiceRole.entities.Message.filter(
    {}, '-created_date', 200
  ).catch(() => []);

  const imageMessages = recentMessages.filter(m => m.image_url && m.generation_context);
  console.log(`[verifyGenerationContextParity:passive] Image messages with context: ${imageMessages.length}`);

  const byOrigin = {};
  for (const origin of KNOWN_ORIGINS) byOrigin[origin] = [];
  byOrigin['unknown_origin'] = [];

  for (const msg of imageMessages) {
    const origin = msg.generation_context?.context_origin || 'unknown_origin';
    const bucket = byOrigin[origin] || (byOrigin[origin] = []);
    bucket.push(msg);
  }

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

  return {
    mode: 'passive',
    verdict: overallVerdict,
    parity_issues: parityIssues,
    paths_missing_version_field: pathsMissingVersionField,
    paths_missing_subjects: pathsMissingSubjects,
    paths_missing_outfit_metadata: pathsMissingOutfitMetadata,
    per_origin_results: originResults,
    total_image_messages_scanned: imageMessages.length,
    honest_limitation: 'Passive mode only describes existing records. NO_SAMPLES means no proof for that path. Use mode=active_runtime_probe to prove current code paths.',
    note: overallVerdict === 'ALL_PATHS_PASS'
      ? 'All sampled generation paths are writing v2-compliant generation_context. No drift detected.'
      : 'Drift detected. Paths listed in parity_issues are missing required fields.',
    engineering_rule: 'IDENTITY SOURCE PRIORITY: (1) subjects[] bundle, (2) subject_fingerprint, (3) explicit structured metadata, (4) appearance_lock_snapshot, (5) NEVER prompt text alone.',
  };
}

// ── ACTIVE RUNTIME PROBE ───────────────────────────────────────────────────────

// Reads back a message with retry to account for DB propagation delay.
async function readMessageWithRetry(base44, messageId, maxAttempts = 3, delayMs = 3000) {
  for (let i = 1; i <= maxAttempts; i++) {
    await new Promise(r => setTimeout(r, delayMs));
    try {
      const msg = await base44.asServiceRole.entities.Message.get(messageId);
      if (msg?.generation_context || msg?.image_url) return msg;
    } catch (_) {}
    // fallback
    const list = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    if (list?.[0]?.generation_context || list?.[0]?.image_url) return list[0];
    console.log(`[probe] Attempt ${i}/${maxAttempts}: message not ready yet, retrying...`);
  }
  return null;
}

// Summarise a generation_context for probe reporting (safe subset — no truncation of critical data).
function summariseContext(ctx) {
  if (!ctx) return null;
  return {
    context_origin: ctx.context_origin ?? null,
    generation_context_version: ctx.generation_context_version ?? null,
    image_type: ctx.image_type ?? null,
    subject_count: ctx.subject_count ?? null,
    subjects: (ctx.subjects || []).map(s => ({
      type: s.subject_type,
      id: s.subject_id,
      name: s.subject_name,
      role: s.role,
      ref_count: s.reference_image_count,
      fingerprint: s.subject_fingerprint ?? null,
    })),
    resolved_outfit_metadata_count: Array.isArray(ctx.resolved_outfit_metadata) ? ctx.resolved_outfit_metadata.length : null,
    has_scene_prompt: !!ctx.scene_prompt,
    has_original_raw_prompt: !!ctx.original_raw_prompt,
    has_camera_variables: ctx.camera_variables !== undefined,
    has_attempts: Array.isArray(ctx.attempts),
    accepted_attempt_index: ctx.accepted_attempt_index ?? null,
    schema_written_at: ctx.schema_written_at ?? null,
  };
}

async function runActiveProbe(base44, authHeader, characterId, conversationId, requestingUser) {
  console.log(`[probe] ▶ Active runtime probe | char=${characterId} | convo=${conversationId} | user=${requestingUser}`);

  // ── Resolve character ────────────────────────────────────────────────────
  let charRecord = null;
  const charListUser = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
  charRecord = charListUser?.[0] || null;
  if (!charRecord) {
    const charListSR = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    charRecord = charListSR?.[0] || null;
  }
  if (!charRecord) return { error: `Character ${characterId} not found` };

  // ── Resolve character ref images ─────────────────────────────────────────
  const rawCharRefs = cdnFilter(charRecord.reference_image_urls || []).filter(u => !u.includes('generated_image'));
  let charRefs = rawCharRefs.slice(0, 2);
  if (charRefs.length === 0 && charRecord.avatar_url) {
    const av = toPublicCDN(charRecord.avatar_url);
    if (isAccessible(av) && !av.includes('generated_image')) charRefs = [av];
  }
  if (charRefs.length === 0) {
    return { error: `Character "${charRecord.name}" has no usable reference images — cannot run probe without identity anchor.` };
  }

  // ── Resolve / inject user refs ───────────────────────────────────────────
  const TEST_USER_REF = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/320px-Camponotus_flavomarginatus_ant.jpg';
  const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: requestingUser }, null, 1).catch(() => []);
  const sett = settingsList?.[0] || null;
  const settingsId = sett?.id || null;
  const originalReferenceImageUrls = sett?.reference_image_urls || [];
  const dbUserRefs = cdnFilter([...(sett?.reference_image_urls || []), ...(sett?.generated_avatar_urls || [])]);

  let injectedTestRef = false;
  let effectiveUserRefs = dbUserRefs.slice(0, 3);
  if (effectiveUserRefs.length === 0 && settingsId) {
    await base44.asServiceRole.entities.UserSettings.update(settingsId, {
      reference_image_urls: [...originalReferenceImageUrls, TEST_USER_REF],
    });
    injectedTestRef = true;
    effectiveUserRefs = [TEST_USER_REF];
    console.log(`[probe] Injected temporary test user ref`);
  }

  // ── Scratch message IDs to clean up ──────────────────────────────────────
  const scratchIds = [];

  const probeResults = {
    chat_image_probe_passed: false,
    media_grid_probe_passed: false,
    regenerate_probe_passed: false,
    recovery_probe_passed: null, // only attempted if chat_image succeeds
    chat_image: null,
    media_grid: null,
    regenerate: null,
    recovery: null,
  };

  // ── PROBE 1: generateImageAsync (chat_image) ─────────────────────────────
  console.log(`[probe] ── PROBE 1: generateImageAsync (chat_image) ──`);
  let chatImageMessageId = null;
  try {
    const msg1 = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: characterId,
      character_name: charRecord.name,
      content: '[PARITY_PROBE_chat_image — safe to delete]',
      timestamp: new Date().toISOString(),
    });
    chatImageMessageId = msg1?.id;
    if (chatImageMessageId) scratchIds.push(chatImageMessageId);

    const p1Payload = {
      messageId: chatImageMessageId,
      prompt: `${charRecord.name} standing in the park`,
      subjectType: 'character',
      characterId,
      characterName: charRecord.name,
      characterReferenceImages: charRefs,
      ownerEmail: requestingUser,
    };

    const p1Fetch = await fetch(`${FUNCTIONS_BASE_URL}/generateImageAsync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(p1Payload),
    });

    const p1Json = await p1Fetch.json().catch(() => ({}));
    console.log(`[probe] generateImageAsync status=${p1Fetch.status} success=${p1Json?.success}`);

    if (p1Fetch.ok && p1Json?.success) {
      await new Promise(r => setTimeout(r, 4000));
      const savedMsg1 = await readMessageWithRetry(base44, chatImageMessageId);
      const ctx1 = savedMsg1?.generation_context || null;
      const check1 = checkContext(ctx1, 'chat_image');
      probeResults.chat_image = {
        http_status: p1Fetch.status,
        function_success: true,
        persistence_verified: !!ctx1,
        context_origin: ctx1?.context_origin ?? null,
        generation_context_version: ctx1?.generation_context_version ?? null,
        subject_count: ctx1?.subject_count ?? null,
        subject_fingerprint_status: (ctx1?.subjects || []).map(s => s.subject_fingerprint || 'MISSING'),
        resolved_outfit_metadata_ok: Array.isArray(ctx1?.resolved_outfit_metadata),
        schema_check: check1,
        summary: summariseContext(ctx1),
      };
      probeResults.chat_image_probe_passed = check1.verdict === 'PASS';
    } else {
      probeResults.chat_image = { http_status: p1Fetch.status, function_success: false, error: p1Json?.error || 'no success flag', persistence_verified: false };
    }
  } catch (err) {
    probeResults.chat_image = { function_success: false, error: err?.message, persistence_verified: false };
    console.error(`[probe] Probe 1 threw: ${err?.message}`);
  }

  // ── PROBE 2: mediaGridGenerate (media_grid) ──────────────────────────────
  console.log(`[probe] ── PROBE 2: mediaGridGenerate (media_grid) ──`);
  let mediaGridMessageId = null;
  try {
    const msg2 = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: characterId,
      character_name: charRecord.name,
      content: '[PARITY_PROBE_media_grid — safe to delete]',
      timestamp: new Date().toISOString(),
    });
    mediaGridMessageId = msg2?.id;
    if (mediaGridMessageId) scratchIds.push(mediaGridMessageId);

    const p2Payload = {
      messageId: mediaGridMessageId,
      prompt: `[user] and [character] ${charRecord.name} at the park`,
      subjectType: 'multi',
      locationId: null,
      locationName: null,
      zoneName: null,
      zoneImageUrls: [],
      multiPersonSelection: {
        selectedCharacters: [{
          role: 'primary',
          id: charRecord.id,
          displayName: charRecord.name,
          firstName: charRecord.name.split(' ')[0],
          referenceImages: charRefs,
        }],
        includeUser: true,
        userReferenceImages: effectiveUserRefs,
        userWorldName: sett?.fictional_world_name || null,
      },
    };

    const p2Fetch = await fetch(`${FUNCTIONS_BASE_URL}/mediaGridGenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(p2Payload),
    });

    const p2Json = await p2Fetch.json().catch(() => ({}));
    console.log(`[probe] mediaGridGenerate status=${p2Fetch.status} success=${p2Json?.success}`);

    if (p2Fetch.ok && p2Json?.success) {
      await new Promise(r => setTimeout(r, 4000));
      const savedMsg2 = await readMessageWithRetry(base44, mediaGridMessageId);
      const ctx2 = savedMsg2?.generation_context || null;
      const check2 = checkContext(ctx2, 'media_grid');
      probeResults.media_grid = {
        http_status: p2Fetch.status,
        function_success: true,
        persistence_verified: !!ctx2,
        context_origin: ctx2?.context_origin ?? null,
        generation_context_version: ctx2?.generation_context_version ?? null,
        subject_count: ctx2?.subject_count ?? null,
        subjects_present: Array.isArray(ctx2?.subjects) && ctx2.subjects.length > 0,
        subject_fingerprint_status: (ctx2?.subjects || []).map(s => s.subject_fingerprint || 'MISSING'),
        resolved_outfit_metadata_ok: Array.isArray(ctx2?.resolved_outfit_metadata),
        schema_check: check2,
        summary: summariseContext(ctx2),
      };
      probeResults.media_grid_probe_passed = check2.verdict === 'PASS';
    } else {
      probeResults.media_grid = { http_status: p2Fetch.status, function_success: false, error: p2Json?.error || 'no success flag', persistence_verified: false };
    }
  } catch (err) {
    probeResults.media_grid = { function_success: false, error: err?.message, persistence_verified: false };
    console.error(`[probe] Probe 2 threw: ${err?.message}`);
  }

  // ── PROBE 3: regenerateImageWithReason ───────────────────────────────────
  // Can only run if one of the above probes produced a real image.
  console.log(`[probe] ── PROBE 3: regenerateImageWithReason ──`);
  const regenSourceId = chatImageMessageId || mediaGridMessageId;
  const regenSourceOk = probeResults.chat_image?.function_success || probeResults.media_grid?.function_success;

  if (regenSourceOk && regenSourceId) {
    try {
      const p3Fetch = await fetch(`${FUNCTIONS_BASE_URL}/regenerateImageWithReason`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ messageId: regenSourceId, reason: 'flawed' }),
      });

      const p3Json = await p3Fetch.json().catch(() => ({}));
      console.log(`[probe] regenerateImageWithReason status=${p3Fetch.status} success=${p3Json?.success}`);

      if (p3Fetch.ok && p3Json?.success) {
        // Read back the source message to inspect updated context
        await new Promise(r => setTimeout(r, 3000));
        const savedMsg3 = await readMessageWithRetry(base44, regenSourceId, 2, 2000);
        const ctx3 = savedMsg3?.generation_context || null;
        const check3 = checkContext(ctx3, 'regenerate');
        probeResults.regenerate = {
          http_status: p3Fetch.status,
          function_success: true,
          final_generation_allowed: p3Json?.final_generation_allowed ?? null,
          selected_subject_roles: p3Json?.selected_subject_roles ?? null,
          user_ref_count: p3Json?.user_ref_count ?? null,
          character_ref_count: p3Json?.character_ref_count ?? null,
          persistence_verified: !!ctx3,
          context_origin: ctx3?.context_origin ?? null,
          generation_context_version: ctx3?.generation_context_version ?? null,
          subject_count: ctx3?.subject_count ?? null,
          subject_fingerprint_status: (ctx3?.subjects || []).map(s => s.subject_fingerprint || 'MISSING'),
          resolved_outfit_metadata_ok: Array.isArray(ctx3?.resolved_outfit_metadata),
          schema_check: check3,
          summary: summariseContext(ctx3),
        };
        probeResults.regenerate_probe_passed = check3.verdict === 'PASS' && p3Json?.final_generation_allowed === true;
      } else {
        probeResults.regenerate = { http_status: p3Fetch.status, function_success: false, error: p3Json?.error || 'no success flag', persistence_verified: false };
      }
    } catch (err) {
      probeResults.regenerate = { function_success: false, error: err?.message, persistence_verified: false };
      console.error(`[probe] Probe 3 threw: ${err?.message}`);
    }
  } else {
    probeResults.regenerate = { skipped: true, reason: 'No upstream probe produced a usable image to regenerate from.' };
  }

  // ── PROBE 4: recoverSingleImage (recovery) ───────────────────────────────
  // Only runs if chat_image produced a real image and context.
  console.log(`[probe] ── PROBE 4: recoverSingleImage (recovery) ──`);
  const recoverySourceId = chatImageMessageId;
  const recoverySourceOk = probeResults.chat_image?.function_success;

  if (recoverySourceOk && recoverySourceId) {
    try {
      const p4Fetch = await fetch(`${FUNCTIONS_BASE_URL}/recoverSingleImage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ messageId: recoverySourceId }),
      });

      const p4Json = await p4Fetch.json().catch(() => ({}));
      console.log(`[probe] recoverSingleImage status=${p4Fetch.status} success=${p4Json?.success}`);

      if (p4Fetch.ok && p4Json?.success) {
        await new Promise(r => setTimeout(r, 3000));
        const savedMsg4 = await readMessageWithRetry(base44, recoverySourceId, 2, 2000);
        const ctx4 = savedMsg4?.generation_context || null;
        const check4 = checkContext(ctx4, 'recovery');
        probeResults.recovery = {
          http_status: p4Fetch.status,
          function_success: true,
          persistence_verified: !!ctx4,
          context_origin: ctx4?.context_origin ?? null,
          generation_context_version: ctx4?.generation_context_version ?? null,
          subject_count: ctx4?.subject_count ?? null,
          subject_fingerprint_status: (ctx4?.subjects || []).map(s => s.subject_fingerprint || 'MISSING'),
          resolved_outfit_metadata_ok: Array.isArray(ctx4?.resolved_outfit_metadata),
          schema_check: check4,
          summary: summariseContext(ctx4),
        };
        probeResults.recovery_probe_passed = check4.verdict === 'PASS';
      } else {
        probeResults.recovery = { http_status: p4Fetch.status, function_success: false, error: p4Json?.error || 'no success flag', persistence_verified: false };
        probeResults.recovery_probe_passed = false;
      }
    } catch (err) {
      probeResults.recovery = { function_success: false, error: err?.message, persistence_verified: false };
      probeResults.recovery_probe_passed = false;
      console.error(`[probe] Probe 4 threw: ${err?.message}`);
    }
  } else {
    probeResults.recovery = { skipped: true, reason: 'chat_image probe did not produce an image, cannot test recovery path.' };
  }

  // ── CLEANUP ───────────────────────────────────────────────────────────────
  console.log(`[probe] Cleaning up ${scratchIds.length} scratch messages...`);
  await Promise.all(
    scratchIds.map(id => base44.asServiceRole.entities.Message.delete(id).catch(e => {
      console.warn(`[probe] Delete ${id} failed (non-critical): ${e?.message}`);
    }))
  );

  if (injectedTestRef && settingsId) {
    await base44.asServiceRole.entities.UserSettings.update(settingsId, {
      reference_image_urls: originalReferenceImageUrls,
    }).catch(e => console.warn(`[probe] Ref cleanup failed: ${e?.message}`));
    console.log(`[probe] Temporary user ref cleaned up`);
  }

  // ── FINAL VERDICT ─────────────────────────────────────────────────────────
  const activePassCount = [
    probeResults.chat_image_probe_passed,
    probeResults.media_grid_probe_passed,
    probeResults.regenerate_probe_passed,
    probeResults.recovery_probe_passed,
  ].filter(v => v === true).length;

  const activeFailCount = [
    probeResults.chat_image_probe_passed,
    probeResults.media_grid_probe_passed,
    probeResults.regenerate_probe_passed,
    probeResults.recovery_probe_passed,
  ].filter(v => v === false).length;

  const activeVerdict = activeFailCount === 0 && activePassCount >= 2
    ? 'ALL_PROBED_PATHS_PASS'
    : activeFailCount > 0
    ? 'PROBE_FAILURES_DETECTED'
    : 'INSUFFICIENT_PROBES';

  return {
    mode: 'active_runtime_probe',
    verdict: activeVerdict,
    pass_count: activePassCount,
    fail_count: activeFailCount,
    ...probeResults,
    scratch_messages_deleted: scratchIds.length,
    test_ref_cleaned_up: injectedTestRef,
    character_used: charRecord.name,
    character_id: characterId,
    probe_standard: 'Active runtime probes call real HTTP endpoints with a forwarded auth token — the same mechanism the frontend uses. This proves the current deployed code path works, not just that the schema is valid.',
  };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'passive';

    if (mode === 'active_runtime_probe') {
      const { characterId, conversationId } = body;
      if (!characterId || !conversationId) {
        return Response.json({
          error: 'active_runtime_probe requires: characterId, conversationId',
          usage: 'verifyGenerationContextParity({ mode: "active_runtime_probe", characterId: "<id>", conversationId: "<id>" })',
        }, { status: 400 });
      }

      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
      if (!authHeader) {
        return Response.json({ error: 'No auth token found — cannot forward to generation functions' }, { status: 401 });
      }

      const result = await runActiveProbe(base44, authHeader, characterId, conversationId, user.email);
      return Response.json(result);
    }

    // Default: passive mode
    const result = await runPassiveAudit(base44);
    return Response.json(result);

  } catch (error) {
    console.error('[verifyGenerationContextParity] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});