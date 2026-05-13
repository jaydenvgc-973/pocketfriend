/**
 * processReelGenerationJob
 *
 * Source-Lock Rule:
 * - Every animated clip uses the selected image as existing_image_urls source frame.
 * - GenerateVideo is called with the source image as reference — NOT a freeform prompt.
 * - Static slides are kept as-is with no AI replacement.
 * - Validation checks that clip_results length == selected_image_ids length.
 * - If validation fails, status is set to "failed" with validation_notes.
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

    // Only process queued or failed jobs
    if (job.status === 'complete') {
      return Response.json({ status: 'complete', job });
    }

    const selectedImageIds = job.selected_image_ids || [];
    const selectedImageUrls = job.selected_image_urls || [];
    const clipResults = [];
    const warnings = [];

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

      if (shouldAnimate && imageUrl) {
        try {
          // SOURCE-LOCK: existing_image_urls = [imageUrl] locks the source frame.
          // Prompt only describes minimal motion — no character invention.
          const motionOptions = [
            'subtle breathing motion and gentle eye blink, camera slowly pushing in',
            'soft hair movement from a light breeze, natural body stillness',
            'head turns slightly, eyes look gently to the side, camera drifts left',
            'slight smile appears, natural ambient light shift, camera slow pull-back',
            'hand moves slightly, weight shift, natural environment ambient motion',
          ];
          const motion = motionOptions[i % motionOptions.length];

          // Build identity-preserving prompt
          const identityContext = originalPrompt
            ? `Continuation of this exact scene: ${originalPrompt.slice(0, 200)}.`
            : 'Preserve exact character identity, face, outfit, setting, and lighting from the source image.';

          const animPrompt = `${identityContext} Add only this subtle motion: ${motion}. Do NOT change the character, their face, body, clothing, hair color, skin tone, or setting. Do NOT introduce new people or locations. Keep the scene identical to the source image. Vertical 9:16 format. Smooth, cinematic motion. No cuts. Memory reel style.`;

          const result = await base44.integrations.Core.GenerateVideo({
            prompt: animPrompt,
            duration: 4,
            aspect_ratio: '9:16',
            existing_image_urls: [imageUrl],
          });

          if (result?.url) {
            clipUrl = result.url;
            clipType = 'animated';
            clipStatus = 'success';
          } else {
            clipType = 'static';
            clipStatus = 'fallback_no_url';
            warnings.push(`Clip ${i + 1}: animation returned no URL — using static slide.`);
          }
        } catch (err) {
          clipType = 'static';
          clipStatus = 'fallback_error';
          clipError = err.message;
          warnings.push(`Clip ${i + 1} (${imageUrl.slice(-20)}): animation failed — ${err.message} — using static slide.`);
        }
      }

      clipResults.push({
        image_id: imageId,
        image_url: imageUrl,
        clip_url: clipUrl,
        clip_type: clipType,
        status: clipStatus,
        error: clipError,
        caption,
        animate: shouldAnimate,
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