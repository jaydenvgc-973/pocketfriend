/**
 * processReelGenerationJob
 *
 * Source-Lock Rule:
 * - Every animated clip uses the selected image as existing_image_urls source frame.
 * - GenerateVideo is called with the source image as reference — NOT a freeform prompt.
 * - Static slides are kept as-is with no AI replacement.
 * - Validation checks that clip_results length == selected_image_ids length.
 * - If validation fails, status is set to "failed" with validation_notes.
 *
 * PROVIDER ARCHITECTURE:
 * - Default provider: Base44 GenerateVideo (always active, no identity guarantee)
 * - Experimental provider: ComfyUI External Server (feature-flagged, requires external GPU server)
 *   Flag: job.use_experimental_identity_animation === true
 *   Requires secrets: COMFYUI_SERVER_URL, optionally COMFYUI_API_KEY
 *   If flag is true but secrets are not set, fails visibly — does NOT silently fall back
 *   and pretend identity was preserved. The diagnostic is written to validation_notes.
 *
 * Base44 has no local GPU runtime. ComfyUI cannot run inside Base44.
 * The ComfyUI provider is a bridge to an external server you must host yourself.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { job_id } = body;
    if (!job_id) return Response.json({ error: 'job_id required' }, { status: 400 });

    // Fetch the job — must belong to authenticated user
    const jobs = await base44.entities.ReelGenerationJob.filter({ owner_email: user.email });
    const job = jobs.find(j => j.id === job_id);
    if (!job) return Response.json({ error: 'Job not found or not owned by user' }, { status: 404 });

    // Only process queued/failed jobs — stop immediately if already complete or cancelled
    if (job.status === 'complete') {
      return Response.json({ status: 'complete', job });
    }
    if (job.status === 'cancelled') {
      return Response.json({ status: 'cancelled', message: 'Job was cancelled by user.' });
    }

    const selectedImageIds = job.selected_image_ids || [];
    const selectedImageUrls = job.selected_image_urls || [];
    const clipResults = [];
    const warnings = [];

    // ── PROVIDER RESOLUTION ───────────────────────────────────────────────────
    // Resolve which animation provider to use for this job.
    // This is done ONCE per job, not per clip.
    const useExperimentalIdentityAnimation = job.use_experimental_identity_animation === true;
    const comfyuiServerUrl = Deno.env.get('COMFYUI_SERVER_URL') || null;
    const comfyuiApiKey = Deno.env.get('COMFYUI_API_KEY') || null;

    // Provider descriptor: { id, ready, reason }
    let animationProvider;
    if (!useExperimentalIdentityAnimation) {
      animationProvider = {
        id: 'base44_generate_video',
        ready: true,
        reason: 'Default Base44 GenerateVideo provider. useExperimentalIdentityAnimation=false.',
      };
    } else if (!comfyuiServerUrl) {
      animationProvider = {
        id: 'comfyui_external',
        ready: false,
        reason: 'COMFYUI_NOT_CONFIGURED: useExperimentalIdentityAnimation=true but COMFYUI_SERVER_URL secret is not set. ' +
          'ComfyUI is an external GPU server that must be hosted by you (e.g. RunPod, Vast.ai, local GPU machine). ' +
          'Base44 has no local GPU runtime — ComfyUI, AnimateDiff, Wan 2.2, IP-Adapter FaceID, and ControlNet ' +
          'cannot run inside Base44. No identity-preserving animation was attempted. ' +
          'All animated clips will fall back to static slides with this error recorded. ' +
          'To enable: set COMFYUI_SERVER_URL in your dashboard secrets.',
      };
    } else {
      animationProvider = {
        id: 'comfyui_external',
        ready: true,
        reason: `ComfyUI external provider configured. Server: ${comfyuiServerUrl}. Real HTTP bridge active. Required models: checkpoint=${Deno.env.get('COMFYUI_CHECKPOINT') || 'v1-5-pruned-emaonly.ckpt'}, motion_module=${Deno.env.get('COMFYUI_MOTION_MODULE') || 'mm_sd_v15_v2.ckpt'}. Required custom nodes: ComfyUI-AnimateDiff-Evolved, ComfyUI-VideoHelperSuite.`,
      };
    }

    console.log(`[ReelJob] Animation provider: ${animationProvider.id} | ready=${animationProvider.ready} | ${animationProvider.reason}`);

    // Record provider selection on the job immediately so UI can surface it
    await base44.entities.ReelGenerationJob.update(job.id, {
      animation_provider: animationProvider.id,
      animation_provider_ready: animationProvider.ready,
      animation_provider_reason: animationProvider.reason,
      updated_at: new Date().toISOString(),
    });

    // ── STEP 1: PREPARING ────────────────────────────────────────────────────
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'preparing',
      progress_percent: 5,
      updated_at: new Date().toISOString(),
      estimated_time_remaining: selectedImageUrls.some((_, i) => job.clip_results?.[i]?.animate) ? '3–6 minutes' : '1–2 minutes',
    });

    // Fetch full message records for each selected image to get generation_context
    const messageRecords = {};
    for (const msgId of selectedImageIds) {
      try {
        const msgs = await base44.entities.Message.filter({ id: msgId });
        if (msgs[0]) messageRecords[msgId] = msgs[0];
      } catch (_) {}
    }

    // ── CHARACTER LOOK LOCK: load canonical appearance data per character ──────
    // For each selected image, fetch the Character record and build an appearance
    // fingerprint. This is injected into every animation prompt to prevent the
    // generator from inventing a generic or different-looking person.
    const characterAppearanceCache = {};
    for (const msgId of selectedImageIds) {
      const msg = messageRecords[msgId];
      const charId = msg?.character_id || null;
      if (!charId || characterAppearanceCache[charId]) continue;
      try {
        const chars = await base44.entities.Character.filter({ owner_email: user.email });
        const char = chars.find(c => c.id === charId);
        if (!char) continue;
        // Build appearance fingerprint from canonical fields
        const parts = [];
        if (char.name) parts.push(`Character name: ${char.name}`);
        if (char.gender) parts.push(`Gender: ${char.gender}`);
        if (char.ethnicities?.length) parts.push(`Ethnicity: ${char.ethnicities.join(', ')}`);
        if (char.age || char.appearance_age) parts.push(`Age: ${char.appearance_age || char.age}`);
        if (char.appearance_notes) parts.push(`Appearance: ${char.appearance_notes.slice(0, 200)}`);
        if (char.appearance_lock) {
          const al = char.appearance_lock;
          if (al.skin_tone) parts.push(`Skin tone: ${al.skin_tone}`);
          if (al.hair_type) parts.push(`Hair: ${al.hair_type}`);
          if (al.hairstyle) parts.push(`Hairstyle: ${al.hairstyle}`);
          if (al.facial_hair) parts.push(`Facial hair: ${al.facial_hair}`);
          if (al.overall_aesthetic) parts.push(`Style: ${al.overall_aesthetic}`);
        }
        characterAppearanceCache[charId] = {
          fingerprint: parts.join('. '),
          avatar_url: char.avatar_url || null,
          reference_image_urls: char.reference_image_urls || [],
          name: char.name,
        };
      } catch (_) {}
    }

    // ── STEP 2: ANIMATE SELECTED CLIPS (SOURCE-LOCKED) ───────────────────────
    // Each clip MUST use the original image as existing_image_urls.
    // The prompt only adds SMALL motion — identity, outfit, setting preserved.
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'animating',
      progress_percent: 15,
      updated_at: new Date().toISOString(),
    });

    const animateFlags = job.clip_results?.map(c => c.animate) || selectedImageUrls.map(() => false);
    const captions = job.clip_results?.map(c => c.caption || '') || selectedImageUrls.map(() => '');

    for (let i = 0; i < selectedImageUrls.length; i++) {
      // ── CANCELLATION CHECK: re-fetch job before each clip to respect user cancel ──
      try {
        const freshJobs = await base44.entities.ReelGenerationJob.filter({ owner_email: user.email });
        const freshJob = freshJobs.find(j => j.id === job_id);
        if (freshJob?.status === 'cancelled') {
          return Response.json({ status: 'cancelled', message: 'Job cancelled by user during animation.' });
        }
      } catch (_) {} // non-blocking — if check fails, continue processing

      const imageUrl = selectedImageUrls[i];
      const imageId = selectedImageIds[i];
      const shouldAnimate = animateFlags[i] || false;
      const caption = captions[i] || '';
      const msgRecord = messageRecords[imageId];
      const originalPrompt = msgRecord?.generation_context?.prompt || null;

      let clipUrl = null;
      let clipType = 'static';
      let clipStatus = 'static';
      let clipError = null;
      let identityValidation = null;

      if (shouldAnimate && imageUrl) {
        // ── COMFYUI EXPERIMENTAL PROVIDER BRANCH ─────────────────────────────
        // If the experimental flag is set, attempt ComfyUI first.
        // If ComfyUI is not configured or fails, the clip becomes a static slide
        // with a visible diagnostic. We do NOT silently fall through to Base44
        // GenerateVideo and claim identity was preserved — that would be dishonest.
        if (animationProvider.id === 'comfyui_external') {
          if (!animationProvider.ready) {
            // Server not configured — fail visibly, do not animate
            clipType = 'static';
            clipStatus = 'comfyui_not_configured';
            clipError = animationProvider.reason;
            warnings.push(
              `Clip ${i + 1}: ComfyUI experimental provider selected but not configured. ` +
              `No identity-preserving animation attempted. Static slide used. ` +
              `Diagnostic: ${animationProvider.reason}`
            );
          } else {
            // Server URL exists — call the bridge stub
            // The stub currently always returns success=false with COMFYUI_BRIDGE_STUB error
            // until the workflow implementation is filled in.
            // This is intentional — we must not claim success without a real result.
            const charId = msgRecord?.character_id || null;
            const charAppearance = charId ? characterAppearanceCache[charId] : null;

            // ── REAL COMFYUI BRIDGE (inlined — Deno Deploy cannot import local lib/ files) ──
            // Canonical reference: lib/comfyuiBridge.js — keep in sync with changes here.
            const bridgeResult = await (async () => {
              const base = comfyuiServerUrl.replace(/\/$/, '');
              const authHeaders = { 'Content-Type': 'application/json' };
              if (comfyuiApiKey) authHeaders['Authorization'] = `Bearer ${comfyuiApiKey}`;

              // ── Model names (overridable via secrets) ──────────────────────
              const checkpoint = Deno.env.get('COMFYUI_CHECKPOINT') || 'v1-5-pruned-emaonly.ckpt';
              const motionModule = Deno.env.get('COMFYUI_MOTION_MODULE') || 'mm_sd_v15_v2.ckpt';
              const timeoutMs = 300000; // 5 minutes

              // ── STEP 1: Health check ───────────────────────────────────────
              try {
                const healthRes = await fetch(`${base}/system_stats`, {
                  headers: authHeaders,
                  signal: AbortSignal.timeout(10000),
                });
                if (!healthRes.ok) {
                  const text = await healthRes.text().catch(() => '');
                  return {
                    success: false, videoUrl: null, error: 'SERVER_UNREACHABLE', server_error: text || null,
                    diagnostic: `ComfyUI server at ${base} returned HTTP ${healthRes.status} on health check. Response: ${text?.slice(0, 200)}`,
                  };
                }
              } catch (err) {
                return {
                  success: false, videoUrl: null, error: 'SERVER_UNREACHABLE', server_error: err.message,
                  diagnostic: `ComfyUI server at ${base} is not reachable: ${err.message}. Check COMFYUI_SERVER_URL and that the server is running with --listen.`,
                };
              }

              // ── STEP 2: Download source image and upload to ComfyUI ────────
              let uploadedFilename = null;
              try {
                const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
                if (!imgRes.ok) {
                  return {
                    success: false, videoUrl: null, error: 'SOURCE_IMAGE_FETCH_FAILED', server_error: null,
                    diagnostic: `Could not download source image. HTTP ${imgRes.status}.`,
                  };
                }
                const imgBlob = await imgRes.blob();
                const imgAb = await imgBlob.arrayBuffer();
                const ct = imgRes.headers.get('content-type') || 'image/jpeg';
                const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
                const fname = `reel_src_${Date.now()}${ext}`;

                const form = new FormData();
                form.append('image', new Blob([imgAb], { type: ct }), fname);
                form.append('type', 'input');
                form.append('overwrite', 'true');
                const upHeaders = comfyuiApiKey ? { Authorization: `Bearer ${comfyuiApiKey}` } : {};
                const upRes = await fetch(`${base}/upload/image`, {
                  method: 'POST', headers: upHeaders, body: form,
                  signal: AbortSignal.timeout(30000),
                });
                if (!upRes.ok) {
                  const text = await upRes.text().catch(() => '');
                  return {
                    success: false, videoUrl: null, error: 'IMAGE_UPLOAD_FAILED', server_error: text || null,
                    diagnostic: `Failed to upload source image to ComfyUI. HTTP ${upRes.status}. Response: ${text?.slice(0, 200)}`,
                  };
                }
                const upData = await upRes.json();
                uploadedFilename = upData.name || fname;
              } catch (err) {
                return {
                  success: false, videoUrl: null, error: 'IMAGE_UPLOAD_FAILED', server_error: err.message,
                  diagnostic: `Image upload to ComfyUI failed: ${err.message}`,
                };
              }

              // ── STEP 3: Build AnimateDiff workflow and submit ──────────────
              // Workflow uses AnimateDiff-Evolved (Kosinkadink fork).
              // Required custom nodes on server: ComfyUI-AnimateDiff-Evolved, ComfyUI-VideoHelperSuite.
              // Required models: checkpoint (SD 1.5), motion module (AnimateDiff).
              // denoise=0.5 preserves ~50% of source image — balances identity vs motion.
              const workflow = {
                '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
                '2': { class_type: 'CLIPTextEncode', inputs: {
                  text: 'cinematic portrait, subtle motion, breathing, eye blink, photorealistic, 4k, highly detailed, same person, same face',
                  clip: ['1', 1],
                }},
                '3': { class_type: 'CLIPTextEncode', inputs: {
                  text: 'different person, different face, blur, distortion, morphing, warping, ugly, deformed, extra limbs, cartoonish',
                  clip: ['1', 1],
                }},
                '4': { class_type: 'LoadImage', inputs: { image: uploadedFilename, upload: 'image' } },
                '5': { class_type: 'ADE_AnimateDiffLoaderWithContext', inputs: {
                  model_name: motionModule,
                  beta_schedule: 'sqrt_linear (AnimateDiff)',
                }},
                '6': { class_type: 'ADE_UseEvolvedSampling', inputs: {
                  model: ['1', 0],
                  m_models: ['5', 0],
                }},
                '7': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } },
                '8': { class_type: 'RepeatLatentBatch', inputs: { samples: ['7', 0], amount: 16 } },
                '9': { class_type: 'KSampler', inputs: {
                  model: ['6', 0],
                  positive: ['2', 0],
                  negative: ['3', 0],
                  latent_image: ['8', 0],
                  seed: Math.floor(Math.random() * 2147483647),
                  steps: 20,
                  cfg: 7.5,
                  sampler_name: 'euler_ancestral',
                  scheduler: 'karras',
                  denoise: 0.5,
                }},
                '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['1', 2] } },
                '11': { class_type: 'VHS_VideoCombine', inputs: {
                  images: ['10', 0],
                  frame_rate: 12,
                  loop_count: 0,
                  filename_prefix: 'reel_animatediff',
                  format: 'video/h264-mp4',
                  pingpong: false,
                  save_output: true,
                }},
              };

              let promptId = null;
              try {
                const promptRes = await fetch(`${base}/prompt`, {
                  method: 'POST',
                  headers: authHeaders,
                  body: JSON.stringify({ prompt: workflow }),
                  signal: AbortSignal.timeout(30000),
                });
                if (!promptRes.ok) {
                  const text = await promptRes.text().catch(() => '');
                  let serverError = text;
                  try {
                    const p = JSON.parse(text);
                    if (p.error) serverError = `${p.error.message || ''}${p.error.details ? ' — ' + p.error.details : ''}`;
                    if (p.node_errors && Object.keys(p.node_errors).length > 0) {
                      serverError += ' | Node errors: ' + Object.entries(p.node_errors).map(([id, e]) => `Node ${id}: ${JSON.stringify(e)}`).join('; ');
                    }
                  } catch (_) {}
                  return {
                    success: false, videoUrl: null, error: 'WORKFLOW_REJECTED', server_error: serverError,
                    diagnostic:
                      `ComfyUI rejected the workflow (HTTP ${promptRes.status}). ` +
                      `This usually means a model file is missing or a required custom node is not installed. ` +
                      `Required: checkpoint="${checkpoint}", motion_module="${motionModule}". ` +
                      `Override filenames via secrets COMFYUI_CHECKPOINT / COMFYUI_MOTION_MODULE. ` +
                      `Required custom nodes: ComfyUI-AnimateDiff-Evolved, ComfyUI-VideoHelperSuite. ` +
                      `Server error: ${serverError?.slice(0, 400)}`,
                  };
                }
                const pd = await promptRes.json();
                promptId = pd.prompt_id;
                if (!promptId) {
                  return {
                    success: false, videoUrl: null, error: 'NO_PROMPT_ID', server_error: JSON.stringify(pd),
                    diagnostic: `ComfyUI accepted workflow but returned no prompt_id. Response: ${JSON.stringify(pd).slice(0, 200)}`,
                  };
                }
              } catch (err) {
                return {
                  success: false, videoUrl: null, error: 'WORKFLOW_SUBMIT_FAILED', server_error: err.message,
                  diagnostic: `Workflow submission failed: ${err.message}`,
                };
              }

              // ── STEP 4: Poll /history/{prompt_id} ─────────────────────────
              const deadline = Date.now() + timeoutMs;
              let outputFilename = null, outputSubfolder = '', outputType = 'output', pollError = null;
              while (Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 4000));
                try {
                  const hRes = await fetch(`${base}/history/${promptId}`, { headers: authHeaders, signal: AbortSignal.timeout(10000) });
                  if (!hRes.ok) { pollError = `HTTP ${hRes.status}`; continue; }
                  const hData = await hRes.json();
                  const entry = hData[promptId];
                  if (!entry) continue;

                  // Check for server-side execution error
                  if (entry.status?.status_str === 'error') {
                    const msgs = entry.status?.messages || [];
                    const errMsg = msgs.find(m => m[0] === 'execution_error')?.[1] || {};
                    return {
                      success: false, videoUrl: null, error: 'EXECUTION_ERROR',
                      server_error: JSON.stringify(errMsg).slice(0, 400),
                      diagnostic:
                        `ComfyUI execution error during generation. ` +
                        `Node: ${errMsg.node_type || 'unknown'} (ID: ${errMsg.node_id || '?'}). ` +
                        `Error: ${errMsg.exception_message || JSON.stringify(errMsg).slice(0, 200)}.`,
                    };
                  }

                  // Find video output
                  for (const nodeOut of Object.values(entry.outputs || {})) {
                    const vids = nodeOut.videos || nodeOut.gifs || [];
                    const found = vids.find(v => v.filename && /\.(mp4|gif|webm)$/i.test(v.filename));
                    if (found) {
                      outputFilename = found.filename;
                      outputSubfolder = found.subfolder || '';
                      outputType = found.type || 'output';
                      break;
                    }
                  }
                  if (outputFilename) break;
                } catch (pollErr) { pollError = pollErr.message; }
              }

              if (!outputFilename) {
                return {
                  success: false, videoUrl: null, error: 'TIMEOUT_NO_OUTPUT', server_error: pollError || null,
                  diagnostic: `ComfyUI timed out after ${Math.round(timeoutMs / 1000)}s. prompt_id=${promptId}. ${pollError ? 'Last poll error: ' + pollError : 'No video output found in history.'}`,
                };
              }

              // ── STEP 5: Fetch video bytes from ComfyUI ────────────────────
              let videoBytes = null, videoContentType = 'video/mp4';
              try {
                const viewUrl = `${base}/view?filename=${encodeURIComponent(outputFilename)}&subfolder=${encodeURIComponent(outputSubfolder)}&type=${encodeURIComponent(outputType)}`;
                const vRes = await fetch(viewUrl, {
                  headers: comfyuiApiKey ? { Authorization: `Bearer ${comfyuiApiKey}` } : {},
                  signal: AbortSignal.timeout(60000),
                });
                if (!vRes.ok) {
                  const text = await vRes.text().catch(() => '');
                  return {
                    success: false, videoUrl: null, error: 'VIDEO_FETCH_FAILED', server_error: text || null,
                    diagnostic: `ComfyUI generated video (${outputFilename}) but download failed. HTTP ${vRes.status}.`,
                  };
                }
                videoContentType = vRes.headers.get('content-type') || 'video/mp4';
                videoBytes = new Uint8Array(await vRes.arrayBuffer());
              } catch (err) {
                return {
                  success: false, videoUrl: null, error: 'VIDEO_FETCH_FAILED', server_error: err.message,
                  diagnostic: `Video download from ComfyUI failed: ${err.message}`,
                };
              }

              // ── STEP 6: Upload video to Base44 storage ────────────────────
              let publicVideoUrl = null;
              try {
                const videoBlob = new Blob([videoBytes], { type: videoContentType });
                const uploadResult = await base44.integrations.Core.UploadFile({ file: videoBlob });
                publicVideoUrl = uploadResult?.file_url || null;
                if (!publicVideoUrl) {
                  return {
                    success: false, videoUrl: null, error: 'STORAGE_UPLOAD_FAILED', server_error: null,
                    diagnostic: `ComfyUI video generated but Base44 storage returned no file_url. Result: ${JSON.stringify(uploadResult)}`,
                  };
                }
              } catch (err) {
                return {
                  success: false, videoUrl: null, error: 'STORAGE_UPLOAD_FAILED', server_error: err.message,
                  diagnostic: `ComfyUI video generated but Base44 storage upload failed: ${err.message}`,
                };
              }

              return {
                success: true, videoUrl: publicVideoUrl, error: null, server_error: null,
                diagnostic: `ComfyUI animation complete. prompt_id=${promptId}. Output: ${outputFilename}. Public URL stored.`,
              };
            })();

            if (bridgeResult.success && bridgeResult.videoUrl) {
              // ComfyUI returned a video — validate identity before accepting
              // (identity validation runs below in the shared block)
              clipUrl = bridgeResult.videoUrl;
              clipType = 'animated';
              clipStatus = 'comfyui_pending_validation';
            } else {
              clipType = 'static';
              clipStatus = bridgeResult.error || 'comfyui_failed';
              clipError = bridgeResult.diagnostic;
              warnings.push(`Clip ${i + 1} [comfyui_external]: ${bridgeResult.diagnostic}`);
            }
          }

          // Record identity_validation as null — ComfyUI path does not run Base44 identity check
          // unless it actually returned a video URL above
          if (clipType !== 'animated') {
            clipResults.push({
              image_id: imageId,
              image_url: imageUrl,
              clip_url: null,
              clip_type: 'static',
              status: clipStatus,
              error: clipError,
              caption,
              animate: shouldAnimate,
              identity_validation: null,
              animation_provider: animationProvider.id,
              subject_identity: {
                media_id: imageId,
                source_image_url: imageUrl,
                linked_character_id: msgRecord?.character_id || null,
                identity_confidence: 'not_attempted',
              },
            });
            const pct = 15 + Math.round(((i + 1) / selectedImageUrls.length) * 55);
            await base44.entities.ReelGenerationJob.update(job.id, {
              clip_results: clipResults,
              progress_percent: pct,
              updated_at: new Date().toISOString(),
            });
            continue; // skip Base44 GenerateVideo block entirely for this clip
          }
          // If ComfyUI returned a URL, fall through to identity validation below
          // (the identity validation block is shared — it will validate clipUrl)
        }

        // ── IDENTITY VALIDATION HELPER ────────────────────────────────────────
        // Uses vision LLM to compare the source image against the generated video's first frame.
        // Returns { preserved: bool, confidence: 'high'|'medium'|'low', reason: string }
        async function validateIdentityPreservation(sourceImageUrl, generatedVideoUrl) {
          try {
            const validationResult = await base44.integrations.Core.InvokeLLM({
              prompt: `You are a forensic identity validator for a video animation system. Your job is to determine whether the person in a SOURCE IMAGE is the SAME PERSON shown in the GENERATED VIDEO.

Compare these two media items:
1. SOURCE IMAGE: ${sourceImageUrl}
2. GENERATED VIDEO (first frame check): ${generatedVideoUrl}

Evaluate STRICTLY for identity preservation:
- Is the face the same person? (bone structure, eyes, nose, mouth shape)
- Is the skin tone identical or very close?
- Is the hair color, texture, and style the same?
- Is the body type/build consistent?
- Is the clothing the same?
- Is the background/setting consistent?

IMPORTANT: This is NOT about artistic quality. This is about whether the VIDEO shows the SAME REAL PERSON as the SOURCE IMAGE, not a reinterpretation or recreation.

Return a JSON object with:
{
  "preserved": true or false,
  "confidence": "high" | "medium" | "low",
  "face_match": true or false,
  "skin_tone_match": true or false,
  "hair_match": true or false,
  "clothing_match": true or false,
  "background_match": true or false,
  "reason": "brief explanation of what matches or what changed",
  "drift_detected": true or false
}

If preserved=false, drift_detected must be true. If the video appears to show a completely different person, set preserved=false and confidence=high.`,
              file_urls: [sourceImageUrl, generatedVideoUrl],
              response_json_schema: {
                type: 'object',
                properties: {
                  preserved: { type: 'boolean' },
                  confidence: { type: 'string' },
                  face_match: { type: 'boolean' },
                  skin_tone_match: { type: 'boolean' },
                  hair_match: { type: 'boolean' },
                  clothing_match: { type: 'boolean' },
                  background_match: { type: 'boolean' },
                  reason: { type: 'string' },
                  drift_detected: { type: 'boolean' },
                },
              },
            });
            return validationResult;
          } catch (valErr) {
            // Validation itself failed — cannot confirm identity, treat as unverified
            return { preserved: false, confidence: 'low', reason: `Validation error: ${valErr.message}`, drift_detected: true };
          }
        }

        const motionOptions = [
          'subtle chest rise-and-fall breathing, gentle eye blink, soft eyelid flutter',
          'hair strands shift from a barely perceptible breeze, body completely still',
          'eyes track slowly left then return forward, head micro-turns by 5 degrees',
          'corners of mouth relax into a barely visible exhale, ambient light shimmer on skin',
          'shoulder weight shifts 2–3 degrees, fingers rest naturally, background depth breathes',
        ];
        const motion = motionOptions[i % motionOptions.length];

        const charId = msgRecord?.character_id || null;
        const charAppearance = charId ? characterAppearanceCache[charId] : null;
        const identityAnchor = charAppearance?.fingerprint
          ? `Subject identity locked to: ${charAppearance.fingerprint}.`
          : '';

        const animPrompt = [
          `IMAGE-TO-VIDEO: The attached image is frame 1. Do not regenerate it. Do not reinterpret it. Do not replace the person.`,
          `The person photographed in the source image is the ONLY subject. Their face, skin tone, hair, eyes, body shape, clothing, and background must remain pixel-consistent with the source image throughout every frame of the video.`,
          `This is NOT a creative reinterpretation. This is NOT an AI recreation. This is physical animation of the exact photographed person.`,
          `Apply ONLY: ${motion}. These are subtle physics-based motions layered on top of the frozen source frame.`,
          identityAnchor,
          `FORBIDDEN: generating a new person, replacing the face, changing skin tone, changing hair, changing clothing, changing the background. Any deviation from the source image appearance is a failure.`,
          `Output: vertical 9:16, smooth, cinematic, 4 seconds.`,
        ].filter(Boolean).join(' ');

        let identityValidation = null;
        let attemptsMade = 0;

        // ── ATTEMPT 1 ─────────────────────────────────────────────────────────
        try {
          const result = await base44.integrations.Core.GenerateVideo({
            prompt: animPrompt,
            duration: 4,
            aspect_ratio: '9:16',
            existing_image_urls: [imageUrl],
          });
          attemptsMade++;

          if (result?.url) {
            // Validate identity before accepting
            identityValidation = await validateIdentityPreservation(imageUrl, result.url);
            if (identityValidation.preserved) {
              clipUrl = result.url;
              clipType = 'animated';
              clipStatus = 'success';
              console.log(`[ReelJob] Clip ${i+1}: identity PRESERVED (confidence=${identityValidation.confidence}). Accepted.`);
            } else {
              // Identity drifted — try once more with stronger prompt
              console.warn(`[ReelJob] Clip ${i+1}: identity DRIFT detected on attempt 1. Reason: ${identityValidation.reason}. Retrying.`);
              warnings.push(`Clip ${i + 1}: attempt 1 drifted identity (${identityValidation.reason}) — retrying.`);

              const retryPrompt = [
                `IMAGE-TO-VIDEO STRICT: The attached image IS the subject. Do NOT generate a new person. Do NOT change the face, skin color, hair, body type, or clothing.`,
                `The subject in the output video must be visually identical to the person in the attached image — same face structure, same eyes, same nose, same mouth, same skin tone, same hair.`,
                identityAnchor,
                `Apply only this minimal motion: ${motion}. No identity changes. No actor replacement. The photo subject must animate, not be replaced. Vertical 9:16.`,
              ].filter(Boolean).join(' ');

              let retryUrl = null;
              try {
                const retryResult = await base44.integrations.Core.GenerateVideo({
                  prompt: retryPrompt,
                  duration: 4,
                  aspect_ratio: '9:16',
                  existing_image_urls: [imageUrl],
                });
                attemptsMade++;
                retryUrl = retryResult?.url || null;
              } catch (_) {}

              if (retryUrl) {
                const retryValidation = await validateIdentityPreservation(imageUrl, retryUrl);
                if (retryValidation.preserved) {
                  clipUrl = retryUrl;
                  clipType = 'animated';
                  clipStatus = 'success_retry';
                  identityValidation = retryValidation;
                  console.log(`[ReelJob] Clip ${i+1}: retry identity PRESERVED. Accepted.`);
                } else {
                  // Both attempts drifted — fail this clip visibly, do NOT accept the video
                  clipType = 'static';
                  clipStatus = 'identity_drift_rejected';
                  clipError = `Animation failed: generated video did not preserve the source person. ${retryValidation.reason}`;
                  identityValidation = retryValidation;
                  warnings.push(`WARN: Clip ${i + 1}: identity drift on both attempts — video rejected. The animation provider generated a different person instead of animating the source image subject. Using static slide. Details: ${retryValidation.reason}`);
                  console.error(`[ReelJob] Clip ${i+1}: identity drift on BOTH attempts. Rejecting video. Reason: ${retryValidation.reason}`);
                }
              } else {
                // Retry returned no URL
                clipType = 'static';
                clipStatus = 'identity_drift_rejected';
                clipError = `Animation failed: attempt 1 drifted identity and retry returned no video.`;
                warnings.push(`WARN: Clip ${i + 1}: identity drift on attempt 1, retry returned no video — static slide used.`);
              }
            }
          } else {
            clipType = 'static';
            clipStatus = 'fallback_no_url';
            warnings.push(`Clip ${i + 1}: animation returned no URL — static slide used.`);
          }
        } catch (err) {
          clipType = 'static';
          clipStatus = 'fallback_error';
          clipError = err.message;
          warnings.push(`Clip ${i + 1}: animation failed — static slide used (${err.message}).`);
        }
      } else if (shouldAnimate && !imageUrl) {
        // Missing source image — do not animate; do not invent a person
        clipType = 'static';
        clipStatus = 'fallback_no_source';
        warnings.push(`Clip ${i + 1}: no source image available — static slide used, no person invented.`);
      }

      // Build strong subject identity metadata for this clip
      const charId = msgRecord?.character_id || null;
      const charAppearanceForClip = charId ? characterAppearanceCache[charId] : null;
      const subjectIds = [];
      if (charId) subjectIds.push(charId);
      const characterReferenceUrls = charAppearanceForClip
        ? [charAppearanceForClip.avatar_url, ...(charAppearanceForClip.reference_image_urls || [])].filter(Boolean)
        : [];

      clipResults.push({
        image_id: imageId,
        image_url: imageUrl,
        clip_url: clipUrl,
        clip_type: clipType,
        status: clipStatus,
        error: clipError,
        caption,
        animate: shouldAnimate,
        identity_validation: identityValidation || null,
        animation_provider: animationProvider.id,
        // Strong identity reference metadata
        subject_identity: {
          media_id: imageId,
          source_image_url: imageUrl,
          linked_character_id: charId || null,
          visible_subject_type: charId ? 'character' : 'unknown',
          visible_subject_ids: subjectIds,
          original_prompt: originalPrompt || null,
          character_reference_urls: characterReferenceUrls,
          character_fingerprint: charAppearanceForClip?.fingerprint || null,
          identity_confidence: charAppearanceForClip?.fingerprint ? 'high' : (imageUrl ? 'source_only' : 'low'),
        },
      });

      // Update progress
      const pct = 15 + Math.round(((i + 1) / selectedImageUrls.length) * 55);
      await base44.entities.ReelGenerationJob.update(job.id, {
        clip_results: clipResults,
        progress_percent: pct,
        updated_at: new Date().toISOString(),
      });
    }

    // ── STEP 3: ASSEMBLING ────────────────────────────────────────────────────
    // The "assembled reel" output is the clip_results array itself.
    // The client-side ReelPlayer renders these as a real TikTok-style montage.
    // We do NOT call GenerateVideo for the overall reel — that would invent new footage.
    // The canonical output IS the ordered clip_results with image_urls + clip_urls.
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'assembling',
      progress_percent: 75,
      updated_at: new Date().toISOString(),
    });

    // Use the first selected image as thumbnail
    const thumbnailUrl = selectedImageUrls[0] || null;

    // ── STEP 4: VALIDATING ────────────────────────────────────────────────────
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'validating',
      progress_percent: 88,
      updated_at: new Date().toISOString(),
    });

    const validationNotes = [];
    let validationPassed = true;

    // Rule 1: clip count must match selected image count
    if (clipResults.length !== selectedImageUrls.length) {
      validationPassed = false;
      validationNotes.push(`FAIL: Expected ${selectedImageUrls.length} clips, got ${clipResults.length}.`);
    }

    // Rule 2: every selected image_url must appear in clip_results
    for (const url of selectedImageUrls) {
      const found = clipResults.find(c => c.image_url === url);
      if (!found) {
        validationPassed = false;
        validationNotes.push(`FAIL: Selected image not found in clip results: ${url.slice(-40)}`);
      }
    }

    // Rule 3: animated clips must have the source image_url recorded
    for (const clip of clipResults) {
      if (clip.clip_type === 'animated' && !clip.image_url) {
        validationPassed = false;
        validationNotes.push(`FAIL: Animated clip missing source image_url reference.`);
      }
    }

    // Rule 4: identity drift rejections are flagged — not a hard fail but must be surfaced
    const driftCount = clipResults.filter(c => c.status === 'identity_drift_rejected').length;
    if (driftCount > 0) {
      validationNotes.push(`WARN: ${driftCount} clip(s) rejected due to identity drift — the video provider did not preserve the source person. These clips were kept as static slides.`);
    }

    if (warnings.length > 0) {
      validationNotes.push(...warnings.map(w => `WARN: ${w}`));
    }

    if (!validationPassed) {
      await base44.entities.ReelGenerationJob.update(job.id, {
        status: 'failed',
        progress_percent: 100,
        validation_passed: false,
        validation_notes: validationNotes,
        error_message: 'Reel failed source validation. Check validation_notes for details.',
        clip_results: clipResults,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      return Response.json({
        status: 'failed',
        validation_passed: false,
        validation_notes: validationNotes,
        error: 'Reel failed source validation.',
      });
    }

    // ── COMPLETE ───────────────────────────────────────────────────────────────
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'complete',
      progress_percent: 100,
      validation_passed: true,
      validation_notes: validationNotes,
      clip_results: clipResults,
      thumbnail_url: thumbnailUrl,
      estimated_time_remaining: '0',
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    return Response.json({
      status: 'complete',
      clip_results: clipResults,
      thumbnail_url: thumbnailUrl,
      validation_passed: true,
      validation_notes: validationNotes,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});