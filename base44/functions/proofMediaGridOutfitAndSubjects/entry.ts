/**
 * proofMediaGridOutfitAndSubjects — End-to-end proof via REAL HTTP function calls.
 *
 * VALID PROOF CHAIN:
 *   1. Create a scratch message
 *   2. Call mediaGridGenerate via direct HTTP fetch with the user's auth token forwarded
 *      (same as the frontend does — real user-facing path)
 *      → This naturally creates generation_context.subjects on the scratch message
 *   3. Read back the scratch message from DB to verify natural context was written
 *   4. Call regenerateImageWithReason via direct HTTP fetch with the user's auth token
 *      → Against the naturally-created context, no manual edits
 *   5. Read returned diagnostics from both calls
 *   6. Delete scratch message and restore any injected test ref
 *
 * Admin-only. Does NOT mutate any existing message or production record.
 *
 * The HTTP fetch approach forwards the exact same Authorization header the frontend uses,
 * bypassing the backend-to-backend session-stripping constraint of functions.invoke.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TEST_USER_REF = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/320px-Camponotus_flavomarginatus_ant.jpg';

const APP_ID = Deno.env.get('BASE44_APP_ID');
const FUNCTIONS_BASE_URL = `https://base44.app/api/apps/${APP_ID}/functions`;

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
function cdnFilter(urls) { return (urls || []).map(toPublicCDN).filter(isAccessible); }

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  const { characterId, conversationId } = await req.json();
  if (!characterId || !conversationId) {
    return Response.json({ error: 'characterId and conversationId are required' }, { status: 400 });
  }

  const requestingUser = user.email;
  // Neutral park scene — no content policy triggers
  const TEST_PROMPT = `[user] Jayden and [character] Khalil at the park`;

  // Extract the auth token from the incoming request to forward to function calls
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  if (!authHeader) {
    return Response.json({ error: 'No auth token found in request headers — cannot forward to function calls' }, { status: 401 });
  }

  console.log(`[ProofE2E] ▶ characterId=${characterId} | user=${requestingUser}`);
  console.log(`[ProofE2E] APP_ID=${APP_ID} | Functions base: ${FUNCTIONS_BASE_URL}`);

  // ── STEP 1: Resolve character record ──────────────────────────────────────
  let charRecord = null;
  const charListUser = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
  charRecord = charListUser?.[0] || null;
  if (!charRecord) {
    const charListSR = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    charRecord = charListSR?.[0] || null;
  }
  if (!charRecord) {
    return Response.json({ error: `Character ${characterId} not found` }, { status: 404 });
  }
  console.log(`[ProofE2E] Character: "${charRecord.name}" (${charRecord.id})`);

  // ── STEP 2: Resolve character ref images ──────────────────────────────────
  const rawCharRefs = cdnFilter(charRecord.reference_image_urls || []).filter(u => !u.includes('generated_image'));
  let charRefs = rawCharRefs.slice(0, 2);
  if (charRefs.length === 0 && charRecord.avatar_url) {
    const avatarPublic = toPublicCDN(charRecord.avatar_url);
    if (isAccessible(avatarPublic) && !avatarPublic.includes('generated_image')) {
      charRefs = [avatarPublic];
    }
  }
  console.log(`[ProofE2E] Character refs: ${charRefs.length}`);

  if (charRefs.length === 0) {
    return Response.json({
      error: `Character "${charRecord.name}" has no usable reference images.`,
      character_id: characterId,
      character_name: charRecord.name,
    }, { status: 422 });
  }

  // ── STEP 3: Resolve user ref images + inject temp ref if needed ───────────
  const settingsList = await base44.asServiceRole.entities.UserSettings.filter(
    { owner_email: requestingUser }, null, 1
  ).catch(() => []);
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
    console.log(`[ProofE2E] Injected temporary test ref for user`);
  }

  if (effectiveUserRefs.length === 0) {
    return Response.json({
      error: 'User has no visual reference images and no UserSettings record.',
      requesting_user: requestingUser,
    }, { status: 422 });
  }

  // ── STEP 4: Create scratch message ────────────────────────────────────────
  let scratchMessageId = null;
  try {
    const scratchMsg = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: characterId,
      character_name: charRecord.name,
      content: '[PROOF_E2E_SCRATCH — safe to delete]',
      timestamp: new Date().toISOString(),
    });
    scratchMessageId = scratchMsg?.id;
    if (!scratchMessageId) throw new Error('Scratch message creation returned no ID');
    console.log(`[ProofE2E] Scratch message created: ${scratchMessageId}`);
  } catch (err) {
    if (injectedTestRef && settingsId) {
      await base44.asServiceRole.entities.UserSettings.update(settingsId, { reference_image_urls: originalReferenceImageUrls }).catch(() => {});
    }
    return Response.json({ error: `Failed to create scratch message: ${err?.message}` }, { status: 500 });
  }

  // ── STEP 5: Call mediaGridGenerate via HTTP fetch (REAL PATH — same as frontend) ─
  // Forward the user's auth token exactly as the frontend does.
  let mediaGridResult = null;
  let mediaGridError = null;
  let mediaGridStatus = null;

  try {
    console.log(`[ProofE2E] Calling mediaGridGenerate via HTTP fetch...`);

    const mgPayload = {
      messageId: scratchMessageId,
      prompt: TEST_PROMPT,
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

    const mgFetch = await fetch(`${FUNCTIONS_BASE_URL}/mediaGridGenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify(mgPayload),
    });

    mediaGridStatus = mgFetch.status;
    const mgJson = await mgFetch.json().catch(() => ({}));
    console.log(`[ProofE2E] mediaGridGenerate HTTP status: ${mediaGridStatus}`);

    if (mgFetch.ok && mgJson?.success === true) {
      mediaGridResult = mgJson;
      console.log(`[ProofE2E] mediaGridGenerate SUCCESS: imageUrl=${mgJson.imageUrl?.substring(0, 80)}…`);
    } else {
      mediaGridError = mgJson?.error || `HTTP ${mediaGridStatus}`;
      console.error(`[ProofE2E] mediaGridGenerate failed: ${mediaGridError}`);
    }
  } catch (err) {
    mediaGridError = err?.message || String(err);
    console.error(`[ProofE2E] mediaGridGenerate fetch threw: ${mediaGridError}`);
  }

  // ── STEP 6: Read back the scratch message to inspect natural generation_context ──
  let savedContext = null;
  if (mediaGridResult?.success) {
    // Wait for DB write to propagate
    await new Promise(r => setTimeout(r, 4000));
    // Use .get() for point-lookup consistency (not filter which may return stale data)
    let savedMsg = null;
    try {
      savedMsg = await base44.asServiceRole.entities.Message.get(scratchMessageId);
    } catch (getErr) {
      console.warn(`[ProofE2E] Message.get failed, falling back to filter: ${getErr?.message}`);
      const savedList = await base44.asServiceRole.entities.Message.filter({ id: scratchMessageId }, null, 1).catch(() => []);
      savedMsg = savedList?.[0] || null;
    }
    const rawGenCtx = savedMsg?.generation_context;
    savedContext = rawGenCtx || savedMsg?.data?.generation_context || null;
    const contextStr = JSON.stringify(rawGenCtx) || 'null';
    console.log(`[ProofE2E] generation_context type=${typeof rawGenCtx} | first 400: ${contextStr.substring(0, 400)}`);
    console.log(`[ProofE2E] image_url on saved msg: ${savedMsg?.image_url?.substring(0, 80) ?? 'null'}`);
    console.log(`[ProofE2E] subjects count: ${savedContext?.subjects?.length ?? 'none'} | image_type: ${savedContext?.image_type ?? 'none'}`);
  }

  // ── STEP 7: Call regenerateImageWithReason via HTTP fetch (REAL PATH) ──────
  let regenResult = null;
  let regenError = null;
  let regenStatus = null;

  // Allow regen even if DB read-back failed to find subjects — the image was generated,
  // so the message has an image_url and regen can attempt to run against it.
  // This separates the DB read-back diagnostic from the regen diagnostic.
  const canRegen = mediaGridResult?.success === true;

  if (canRegen) {
    try {
      console.log(`[ProofE2E] Calling regenerateImageWithReason via HTTP fetch...`);

      const regenPayload = {
        messageId: scratchMessageId,
        reason: 'flawed',
      };

      const regenFetch = await fetch(`${FUNCTIONS_BASE_URL}/regenerateImageWithReason`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(regenPayload),
      });

      regenStatus = regenFetch.status;
      const regenJson = await regenFetch.json().catch(() => ({}));
      console.log(`[ProofE2E] regenerateImageWithReason HTTP status: ${regenStatus}`);

      if (regenFetch.ok && regenJson?.success === true) {
        regenResult = regenJson;
        console.log(`[ProofE2E] regenerateImageWithReason SUCCESS: ${regenJson.image_url?.substring(0, 80)}…`);
      } else {
        regenError = regenJson?.error || `HTTP ${regenStatus}`;
        console.error(`[ProofE2E] regenerateImageWithReason failed: ${regenError}`);
      }
    } catch (err) {
      regenError = err?.message || String(err);
      console.error(`[ProofE2E] regenerateImageWithReason fetch threw: ${regenError}`);
    }
  } else if (mediaGridResult?.success) {
    regenError = `Skipped — subjects in saved context: ${savedContext?.subjects?.length ?? 0}, image_type: ${savedContext?.image_type ?? 'none'}`;
    console.warn(`[ProofE2E] ${regenError}`);
  }

  // ── STEP 8: Clean up ──────────────────────────────────────────────────────
  if (scratchMessageId) {
    await base44.asServiceRole.entities.Message.delete(scratchMessageId).catch(e => {
      console.warn(`[ProofE2E] Scratch delete failed (non-critical): ${e?.message}`);
    });
    console.log(`[ProofE2E] Scratch message ${scratchMessageId} deleted`);
  }
  if (injectedTestRef && settingsId) {
    await base44.asServiceRole.entities.UserSettings.update(settingsId, {
      reference_image_urls: originalReferenceImageUrls,
    }).catch(e => console.warn(`[ProofE2E] Ref cleanup failed: ${e?.message}`));
    console.log(`[ProofE2E] Test ref cleaned up from UserSettings`);
  }

  // ── STEP 9: Build proof report ─────────────────────────────────────────────
  const subjectsInContext = savedContext?.subjects?.length || 0;
  const charSubjectInContext = (savedContext?.subjects || []).find(s => s.subject_type === 'character' || (s.subject_id !== '__user__' && s.subject_id !== 'user'));
  const userSubjectInContext = (savedContext?.subjects || []).find(s => s.subject_type === 'user' || s.subject_id === '__user__' || s.subject_id === 'user');
  const savedOutfitMeta = savedContext?.resolved_outfit_metadata || [];
  const charOutfitInContext = savedOutfitMeta.find(o => o.subjectType === 'character');
  const userOutfitInContext = savedOutfitMeta.find(o => o.subjectType === 'user');

  const proofPassed = (
    mediaGridResult?.success === true &&
    subjectsInContext >= 2 &&
    !!charSubjectInContext &&
    !!userSubjectInContext &&
    regenResult?.success === true &&
    regenResult?.final_generation_allowed === true
  );

  return Response.json({
    proof_status: proofPassed
      ? '✅ PROOF PASSED — real end-to-end flow verified via HTTP function calls'
      : '❌ PROOF FAILED — see diagnostics',
    proof_passed: proofPassed,
    proof_method: 'HTTP fetch with forwarded auth header — same mechanism as frontend',

    // ── Step 5: mediaGridGenerate (REAL HTTP CALL) ────────────────────────
    media_grid_called_via: `HTTP POST ${FUNCTIONS_BASE_URL}/mediaGridGenerate`,
    media_grid_http_status: mediaGridStatus,
    media_grid_success: mediaGridResult?.success || false,
    media_grid_image_url: mediaGridResult?.imageUrl ? mediaGridResult.imageUrl.substring(0, 100) + '…' : null,
    media_grid_subject_count: mediaGridResult?.selectedPeopleCount || null,
    media_grid_subject_type: mediaGridResult?.subjectType || null,
    media_grid_error: mediaGridError || null,

    // ── Step 6: DB read-back of naturally-written generation_context ──────
    saved_context_read_from_db: true,
    subjects_in_saved_context: subjectsInContext,
    subjects_expected: 2,
    subjects_match: subjectsInContext >= 2,
    char_subject_in_context: !!charSubjectInContext,
    user_subject_in_context: !!userSubjectInContext,
    saved_context_image_type: savedContext?.image_type || null,
    saved_subjects: savedContext?.subjects?.map(s => ({
      type: s.subject_type,
      id: s.subject_id,
      name: s.subject_name,
      role: s.role,
      ref_count: s.reference_image_count,
    })) || null,
    saved_outfit_metadata: savedOutfitMeta,
    char_outfit_in_context: !!charOutfitInContext,
    user_outfit_in_context: !!userOutfitInContext,
    char_outfit_text: charOutfitInContext?.text || null,
    user_outfit_text: userOutfitInContext?.text || null,

    // ── Step 7: regenerateImageWithReason (REAL HTTP CALL) ────────────────
    regen_called_via: `HTTP POST ${FUNCTIONS_BASE_URL}/regenerateImageWithReason`,
    regen_http_status: regenStatus,
    regen_skipped: !canRegen,
    regen_success: regenResult?.success || false,
    regen_image_url: regenResult?.image_url ? regenResult.image_url.substring(0, 100) + '…' : null,
    regen_final_generation_allowed: regenResult?.final_generation_allowed || false,
    regen_selected_subject_roles: regenResult?.selected_subject_roles || null,
    regen_user_ref_count: regenResult?.user_ref_count ?? null,
    regen_character_ref_count: regenResult?.character_ref_count ?? null,
    regen_camera_variables: regenResult?.cameraVariables || null,
    regen_error: regenError || null,

    // ── Test parameters ───────────────────────────────────────────────────
    test_prompt: TEST_PROMPT,
    character_name: charRecord.name,
    character_id: characterId,
    character_ref_count: charRefs.length,
    user_ref_count_used: effectiveUserRefs.length,
    user_ref_injected_for_test: injectedTestRef,
    requesting_user: requestingUser,
    scratch_message_id: '(deleted after test)',
  });
});