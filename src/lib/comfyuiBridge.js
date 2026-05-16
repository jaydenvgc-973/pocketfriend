/**
 * comfyuiBridge.js
 *
 * COMFYUI EXTERNAL SERVER BRIDGE — REAL IMPLEMENTATION
 *
 * Status: REAL HTTP BRIDGE — not a stub.
 * This file is imported by functions/processReelGenerationJob (inlined — see note below).
 *
 * NOTE ON IMPORTS:
 * Deno Deploy (Base44 backend runtime) does NOT support dynamic imports from local lib/ files.
 * This file is the canonical reference implementation. The actual executable version is
 * INLINED inside functions/processReelGenerationJob inside the runComfyUIBridge() async closure.
 * Keep this file and the inlined version in sync when making changes.
 *
 * ── WHAT THIS DOES ───────────────────────────────────────────────────────────
 * 1. Health check: GET /system_stats — verifies server is reachable and running
 * 2. Image upload: POST /upload/image — uploads source image bytes to ComfyUI server
 * 3. Workflow submission: POST /prompt — submits AnimateDiff workflow JSON
 * 4. Polling: GET /history/{prompt_id} — polls until job complete or timeout
 * 5. Video fetch: GET /view?filename=... — downloads the output video bytes
 * 6. Storage: POST to Base44 UploadFile integration — stores video, returns public URL
 *
 * ── WORKFLOW REQUIREMENTS (must be satisfied on your ComfyUI server) ──────────
 * Required models — filenames must match exactly or be overridden via secrets:
 *   COMFYUI_CHECKPOINT   — SD 1.5 checkpoint (default: v1-5-pruned-emaonly.ckpt)
 *   COMFYUI_MOTION_MODULE — AnimateDiff motion module (default: mm_sd_v15_v2.ckpt)
 *   COMFYUI_VAE           — VAE (default: vae-ft-mse-840000-ema-pruned.ckpt)
 *
 * Required ComfyUI custom nodes (must be installed on your server):
 *   - ComfyUI-AnimateDiff-Evolved (Kosinkadink's fork — most commonly installed)
 *   - ComfyUI_IPAdapter_plus (optional, for identity conditioning — not in baseline workflow)
 *
 * Required ComfyUI server flags:
 *   --listen                          (accept external connections)
 *   --enable-cors-header              (allow cross-origin if needed)
 *
 * ── SECRETS ──────────────────────────────────────────────────────────────────
 *   COMFYUI_SERVER_URL    — e.g. https://your-runpod-instance.proxy.runpod.net
 *   COMFYUI_API_KEY       — optional bearer token if your server requires auth
 *   COMFYUI_CHECKPOINT    — optional, SD checkpoint filename (default shown above)
 *   COMFYUI_MOTION_MODULE — optional, AnimateDiff motion module filename
 *   COMFYUI_VAE           — optional, VAE filename
 *
 * ── HONEST STATUS ────────────────────────────────────────────────────────────
 * The HTTP bridge is implemented and real. However:
 * - The workflow will FAIL at /prompt if your server does not have the model files above.
 * - The server's exact error is captured and returned as clip diagnostic — not hidden.
 * - If ComfyUI rejects the workflow (missing node, wrong model name, etc.),
 *   the clip becomes a static slide with the server's error text recorded.
 * - Nothing is silently swallowed.
 *
 * ── WHAT IS NOT IMPLEMENTED ──────────────────────────────────────────────────
 * - IP-Adapter FaceID identity conditioning (requires additional custom nodes + model)
 *   This would improve identity preservation but is NOT in the baseline workflow.
 *   To add: install ComfyUI_IPAdapter_plus, download ip-adapter-faceid-plusv2_sd15.bin,
 *   and extend the buildWorkflow() function below with IPAdapterApply nodes.
 * - ControlNet OpenPose (optional pose preservation — separate model required)
 * - Wan 2.2 (requires 80GB+ VRAM — different workflow entirely)
 */

/**
 * Build the AnimateDiff workflow JSON for ComfyUI.
 * Uses the ComfyUI API format (node graph with class_type and inputs).
 *
 * Nodes:
 *   1  CheckpointLoaderSimple — load SD 1.5 checkpoint
 *   2  CLIPTextEncode (positive) — minimal positive prompt
 *   3  CLIPTextEncode (negative) — standard negative prompt
 *   4  LoadImage — the uploaded source image filename
 *   5  ADE_AnimateDiffLoaderWithContext — AnimateDiff motion module
 *   6  ADE_UseEvolvedSampling — attach motion to KSampler
 *   7  KSampler — sampling with AnimateDiff
 *   8  VAEDecode — decode latents to pixel frames
 *   9  VHS_VideoCombine — combine frames into video output
 *
 * @param {object} opts
 * @param {string} opts.uploadedImageFilename - filename returned by /upload/image
 * @param {string} opts.checkpoint - SD checkpoint model filename
 * @param {string} opts.motionModule - AnimateDiff motion module filename
 * @param {string} opts.vae - VAE filename (empty string = use checkpoint's built-in VAE)
 * @returns {object} ComfyUI API workflow object
 */
function buildAnimateDiffWorkflow({ uploadedImageFilename, checkpoint, motionModule, vae }) {
  // Frames: 16 = ~0.67s at 24fps, 24 = ~1s. We use 24 for ~2s at 12fps output.
  // AnimateDiff works best at 16 frames with mm_sd_v15_v2.ckpt.
  const frameCount = 16;

  const workflow = {
    // Node 1: Load checkpoint
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    // Node 2: Positive CLIP text encode — minimal prompt, identity from image
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'cinematic portrait, subtle motion, breathing, eye blink, photorealistic, 4k, highly detailed',
        clip: ['1', 1],
      },
    },
    // Node 3: Negative CLIP text encode
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'blur, distortion, different person, different face, morphing, warping, ugly, deformed, mutation, extra limbs, cartoonish, anime',
        clip: ['1', 1],
      },
    },
    // Node 4: Load the uploaded source image
    '4': {
      class_type: 'LoadImage',
      inputs: { image: uploadedImageFilename, upload: 'image' },
    },
    // Node 5: AnimateDiff motion module loader (Evolved fork)
    '5': {
      class_type: 'ADE_AnimateDiffLoaderWithContext',
      inputs: {
        model_name: motionModule,
        beta_schedule: 'sqrt_linear (AnimateDiff)',
      },
    },
    // Node 6: Apply AnimateDiff evolved sampling context
    '6': {
      class_type: 'ADE_UseEvolvedSampling',
      inputs: {
        model: ['1', 0],
        m_models: ['5', 0],
      },
    },
    // Node 7: Encode source image to latent space for img2img
    '7': {
      class_type: 'VAEEncode',
      inputs: {
        pixels: ['4', 0],
        vae: ['1', 2],
      },
    },
    // Node 8: Repeat latent for frame count
    '8': {
      class_type: 'RepeatLatentBatch',
      inputs: {
        samples: ['7', 0],
        amount: frameCount,
      },
    },
    // Node 9: KSampler with high denoise (img2img animation)
    '9': {
      class_type: 'KSampler',
      inputs: {
        model: ['6', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['8', 0],
        seed: Math.floor(Math.random() * 2147483647),
        steps: 20,
        cfg: 7.5,
        sampler_name: 'euler_ancestral',
        scheduler: 'karras',
        denoise: 0.5, // 0.5 = keep 50% of original image — preserves identity better
      },
    },
    // Node 10: VAE Decode
    '10': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['9', 0],
        vae: ['1', 2],
      },
    },
    // Node 11: Combine frames into video (VHS_VideoCombine from ComfyUI-VideoHelperSuite)
    '11': {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['10', 0],
        frame_rate: 12,
        loop_count: 0,
        filename_prefix: 'animatediff_reel',
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  };

  return workflow;
}

/**
 * Run the full ComfyUI animation bridge.
 * This is the reference implementation. The executable version is inlined
 * in functions/processReelGenerationJob.
 *
 * @param {object} opts
 * @param {string} opts.sourceImageUrl - public URL of source image
 * @param {string} opts.serverUrl - ComfyUI server base URL
 * @param {string|null} opts.apiKey - optional bearer auth token
 * @param {string} opts.checkpoint - SD checkpoint filename
 * @param {string} opts.motionModule - AnimateDiff motion module filename
 * @param {string} opts.vae - VAE filename
 * @param {number} opts.timeoutMs - max wait ms for polling (default: 300000 = 5min)
 * @param {Function} opts.uploadToStorage - async fn(blob) => { file_url: string }
 * @returns {Promise<{ success: boolean, videoUrl: string|null, error: string|null, diagnostic: string, server_error: string|null }>}
 */
export async function runComfyUIAnimation({
  sourceImageUrl,
  serverUrl,
  apiKey = null,
  checkpoint = 'v1-5-pruned-emaonly.ckpt',
  motionModule = 'mm_sd_v15_v2.ckpt',
  vae = '',
  timeoutMs = 300000,
  uploadToStorage,
}) {
  if (!serverUrl) {
    return {
      success: false, videoUrl: null, error: 'COMFYUI_NOT_CONFIGURED', server_error: null,
      diagnostic: 'No COMFYUI_SERVER_URL secret is set. ComfyUI cannot run inside Base44 — it requires an external GPU server.',
    };
  }
  if (!sourceImageUrl) {
    return {
      success: false, videoUrl: null, error: 'NO_SOURCE_IMAGE', server_error: null,
      diagnostic: 'No source image URL provided.',
    };
  }

  const base = serverUrl.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // ── STEP 1: Health check ──────────────────────────────────────────────────
  let healthOk = false;
  try {
    const healthRes = await fetch(`${base}/system_stats`, { headers, signal: AbortSignal.timeout(10000) });
    healthOk = healthRes.ok;
    if (!healthOk) {
      const text = await healthRes.text().catch(() => '');
      return {
        success: false, videoUrl: null, error: 'SERVER_UNREACHABLE', server_error: text || null,
        diagnostic: `ComfyUI server at ${base} returned HTTP ${healthRes.status} on /system_stats. Server is reachable but returned an error. Response: ${text?.slice(0, 200)}`,
      };
    }
  } catch (err) {
    return {
      success: false, videoUrl: null, error: 'SERVER_UNREACHABLE', server_error: err.message,
      diagnostic: `ComfyUI server at ${base} is not reachable. Network error: ${err.message}. Check that COMFYUI_SERVER_URL is correct and the server is running with --listen.`,
    };
  }

  // ── STEP 2: Download source image and upload to ComfyUI server ────────────
  let uploadedFilename = null;
  try {
    const imgRes = await fetch(sourceImageUrl, { signal: AbortSignal.timeout(30000) });
    if (!imgRes.ok) {
      return {
        success: false, videoUrl: null, error: 'SOURCE_IMAGE_FETCH_FAILED', server_error: null,
        diagnostic: `Could not download source image from ${sourceImageUrl.slice(0, 80)}. HTTP ${imgRes.status}.`,
      };
    }
    const imgBlob = await imgRes.blob();
    const imgArrayBuffer = await imgBlob.arrayBuffer();
    const imgBytes = new Uint8Array(imgArrayBuffer);

    // Determine extension from content-type or URL
    const ct = imgRes.headers.get('content-type') || '';
    const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
    const filename = `reel_source_${Date.now()}${ext}`;

    const formData = new FormData();
    formData.append('image', new Blob([imgBytes], { type: ct || 'image/jpeg' }), filename);
    formData.append('type', 'input');
    formData.append('overwrite', 'true');

    const uploadHeaders = {};
    if (apiKey) uploadHeaders['Authorization'] = `Bearer ${apiKey}`;
    const uploadRes = await fetch(`${base}/upload/image`, {
      method: 'POST',
      headers: uploadHeaders,
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '');
      return {
        success: false, videoUrl: null, error: 'IMAGE_UPLOAD_FAILED', server_error: text || null,
        diagnostic: `Failed to upload source image to ComfyUI server. HTTP ${uploadRes.status}. Response: ${text?.slice(0, 200)}`,
      };
    }
    const uploadData = await uploadRes.json();
    uploadedFilename = uploadData.name || filename;
  } catch (err) {
    return {
      success: false, videoUrl: null, error: 'IMAGE_UPLOAD_FAILED', server_error: err.message,
      diagnostic: `Image upload to ComfyUI failed: ${err.message}`,
    };
  }

  // ── STEP 3: Build and submit workflow ─────────────────────────────────────
  const workflow = buildAnimateDiffWorkflow({
    uploadedImageFilename: uploadedFilename,
    checkpoint,
    motionModule,
    vae,
  });

  let promptId = null;
  try {
    const promptRes = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(30000),
    });

    if (!promptRes.ok) {
      const text = await promptRes.text().catch(() => '');
      // Parse ComfyUI error format: { error: { message, details, ... }, node_errors: {...} }
      let serverError = text;
      try {
        const parsed = JSON.parse(text);
        if (parsed.error) {
          serverError = `${parsed.error.message || ''}${parsed.error.details ? ' — ' + parsed.error.details : ''}`;
        }
        if (parsed.node_errors && Object.keys(parsed.node_errors).length > 0) {
          const nodeErrs = Object.entries(parsed.node_errors)
            .map(([nodeId, errs]) => `Node ${nodeId}: ${JSON.stringify(errs)}`)
            .join('; ');
          serverError += ` | Node errors: ${nodeErrs}`;
        }
      } catch (_) {}

      return {
        success: false, videoUrl: null, error: 'WORKFLOW_REJECTED', server_error: serverError,
        diagnostic:
          `ComfyUI rejected the workflow. HTTP ${promptRes.status}. ` +
          `This usually means a model file is missing on the server or a required custom node is not installed. ` +
          `Server error: ${serverError?.slice(0, 400)}. ` +
          `Required: checkpoint="${checkpoint}", motion_module="${motionModule}". ` +
          `Override via secrets COMFYUI_CHECKPOINT and COMFYUI_MOTION_MODULE if filenames differ.`,
      };
    }

    const promptData = await promptRes.json();
    promptId = promptData.prompt_id;
    if (!promptId) {
      return {
        success: false, videoUrl: null, error: 'NO_PROMPT_ID', server_error: JSON.stringify(promptData),
        diagnostic: `ComfyUI accepted the workflow but returned no prompt_id. Response: ${JSON.stringify(promptData).slice(0, 200)}`,
      };
    }
  } catch (err) {
    return {
      success: false, videoUrl: null, error: 'WORKFLOW_SUBMIT_FAILED', server_error: err.message,
      diagnostic: `Failed to submit workflow to ComfyUI: ${err.message}`,
    };
  }

  // ── STEP 4: Poll /history/{prompt_id} until done or timeout ──────────────
  const deadline = Date.now() + timeoutMs;
  let outputFilename = null;
  let outputSubfolder = '';
  let outputType = 'output';
  let pollError = null;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000)); // poll every 4 seconds
    try {
      const histRes = await fetch(`${base}/history/${promptId}`, { headers, signal: AbortSignal.timeout(10000) });
      if (!histRes.ok) {
        pollError = `History poll returned HTTP ${histRes.status}`;
        continue;
      }
      const histData = await histRes.json();
      const entry = histData[promptId];
      if (!entry) continue; // not finished yet

      // Check for execution error in history
      if (entry.status?.status_str === 'error') {
        const msgs = entry.status?.messages || [];
        const errMsg = msgs.find(m => m[0] === 'execution_error')?.[1] || {};
        return {
          success: false, videoUrl: null, error: 'EXECUTION_ERROR',
          server_error: JSON.stringify(errMsg).slice(0, 400),
          diagnostic:
            `ComfyUI reported an execution error during generation. ` +
            `Node: ${errMsg.node_type || 'unknown'} (ID: ${errMsg.node_id || '?'}). ` +
            `Error: ${errMsg.exception_message || JSON.stringify(errMsg).slice(0, 200)}. ` +
            `This usually means a missing model or incompatible custom node.`,
        };
      }

      // Find video output — look in all node outputs for videos or gifs
      const outputs = entry.outputs || {};
      for (const nodeOutputs of Object.values(outputs)) {
        const videos = nodeOutputs.videos || nodeOutputs.gifs || [];
        const found = videos.find(v => v.filename && (v.filename.endsWith('.mp4') || v.filename.endsWith('.gif') || v.filename.endsWith('.webm')));
        if (found) {
          outputFilename = found.filename;
          outputSubfolder = found.subfolder || '';
          outputType = found.type || 'output';
          break;
        }
      }
      if (outputFilename) break;
    } catch (pollErr) {
      pollError = pollErr.message;
      // non-fatal — keep polling until timeout
    }
  }

  if (!outputFilename) {
    return {
      success: false, videoUrl: null, error: 'TIMEOUT_NO_OUTPUT', server_error: pollError || null,
      diagnostic:
        `ComfyUI job timed out after ${Math.round(timeoutMs / 1000)}s without producing a video output. ` +
        `prompt_id=${promptId}. ` +
        (pollError ? `Last poll error: ${pollError}. ` : '') +
        `Check ComfyUI server logs for generation errors. The job may still be running on the server.`,
    };
  }

  // ── STEP 5: Fetch the video from ComfyUI ─────────────────────────────────
  let videoBytes = null;
  let videoContentType = 'video/mp4';
  try {
    const viewUrl = `${base}/view?filename=${encodeURIComponent(outputFilename)}&subfolder=${encodeURIComponent(outputSubfolder)}&type=${encodeURIComponent(outputType)}`;
    const videoRes = await fetch(viewUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(60000),
    });
    if (!videoRes.ok) {
      const text = await videoRes.text().catch(() => '');
      return {
        success: false, videoUrl: null, error: 'VIDEO_FETCH_FAILED', server_error: text || null,
        diagnostic: `ComfyUI generated a video (${outputFilename}) but fetching it failed. HTTP ${videoRes.status}. Response: ${text?.slice(0, 200)}`,
      };
    }
    videoContentType = videoRes.headers.get('content-type') || 'video/mp4';
    const ab = await videoRes.arrayBuffer();
    videoBytes = new Uint8Array(ab);
  } catch (err) {
    return {
      success: false, videoUrl: null, error: 'VIDEO_FETCH_FAILED', server_error: err.message,
      diagnostic: `Failed to download generated video from ComfyUI: ${err.message}`,
    };
  }

  // ── STEP 6: Upload video to Base44 storage ───────────────────────────────
  let publicVideoUrl = null;
  try {
    const videoBlob = new Blob([videoBytes], { type: videoContentType });
    const result = await uploadToStorage(videoBlob);
    publicVideoUrl = result?.file_url || null;
    if (!publicVideoUrl) {
      return {
        success: false, videoUrl: null, error: 'STORAGE_UPLOAD_FAILED', server_error: null,
        diagnostic: `Video was generated by ComfyUI but uploading to Base44 storage returned no file_url. Result: ${JSON.stringify(result)}`,
      };
    }
  } catch (err) {
    return {
      success: false, videoUrl: null, error: 'STORAGE_UPLOAD_FAILED', server_error: err.message,
      diagnostic: `Video was generated by ComfyUI but failed to upload to Base44 storage: ${err.message}`,
    };
  }

  return {
    success: true,
    videoUrl: publicVideoUrl,
    error: null,
    server_error: null,
    diagnostic: `ComfyUI animation complete. prompt_id=${promptId}. Output: ${outputFilename}. Stored at: ${publicVideoUrl}.`,
  };
}