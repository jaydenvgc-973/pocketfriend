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

      if (shouldAnimate && imageUrl) {
        try {
          // SOURCE-LOCK: The source image IS the video. existing_image_urls must contain
          // ONLY the source image as the first (and sole) entry. The video model treats
          // the first image as the literal first frame to animate FROM.
          // Avatar/reference goes into the text prompt as a verbal anchor — NOT as a
          // second image, which confuses the model and causes identity replacement.

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

          // SOURCE-FRAME ANIMATION PROTOCOL:
          // Frame 1 = the uploaded image, pixel-exact. No regeneration. No reinterpretation.
          // The model must treat the attached image as the literal starting frame and apply
          // ONLY physics-based motion (breathing, micro-movement) on top of existing pixels.
          // Identity, face, clothing, background = frozen. Only motion vectors applied.
          const animPrompt = [
            `IMAGE-TO-VIDEO: The attached image is frame 1. Do not regenerate it. Do not reinterpret it. Do not replace the person.`,
            `The person photographed in the source image is the ONLY subject. Their face, skin tone, hair, eyes, body shape, clothing, and background must remain pixel-consistent with the source image throughout every frame of the video.`,
            `This is NOT a creative reinterpretation. This is NOT an AI recreation. This is physical animation of the exact photographed person.`,
            `Apply ONLY: ${motion}. These are subtle physics-based motions layered on top of the frozen source frame.`,
            identityAnchor,
            `FORBIDDEN: generating a new person, replacing the face, changing skin tone, changing hair, changing clothing, changing the background, adding new characters, changing the scene. Any deviation from the source image appearance is a failure.`,
            `Output: vertical 9:16, smooth, cinematic, 4 seconds. Memory reel style.`,
          ].filter(Boolean).join(' ');

          // ONLY the source image as existing_image_urls — this is the frame the model animates FROM.
          // Do NOT add avatar as second reference — it confuses model identity and causes actor replacement.
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
            // Retry once with even stronger source-frame emphasis
            try {
              const retryPrompt = [
                `IMAGE-TO-VIDEO RETRY: The attached image is the source frame. Do not replace the person. Do not reinterpret.`,
                `Preserve: face, skin, hair, eyes, body, clothing, background. Apply only micro-motion: ${motion}.`,
                identityAnchor,
                `The output video must show the exact photographed individual — not a similar person, not an AI recreation. Vertical 9:16.`,
              ].filter(Boolean).join(' ');

              const retryResult = await base44.integrations.Core.GenerateVideo({
                prompt: retryPrompt,
                duration: 4,
                aspect_ratio: '9:16',
                existing_image_urls: [imageUrl],
              });

              if (retryResult?.url) {
                clipUrl = retryResult.url;
                clipType = 'animated';
                clipStatus = 'success_retry';
              } else {
                clipType = 'static';
                clipStatus = 'fallback_no_url';
                warnings.push(`Clip ${i + 1}: animation returned no URL after retry — static slide used.`);
              }
            } catch (retryErr) {
              clipType = 'static';
              clipStatus = 'fallback_no_url';
              warnings.push(`Clip ${i + 1}: animation retry also failed — static slide used.`);
            }
          }
        } catch (err) {
          // First attempt failed — retry with maximally minimal prompt to reduce model confusion
          try {
            const charId = msgRecord?.character_id || null;
            const charAppearance = charId ? characterAppearanceCache[charId] : null;
            const identityAnchor = charAppearance?.fingerprint ? `Person: ${charAppearance.fingerprint}.` : '';
            const motion = ['subtle breathing motion and eye blink', 'soft ambient motion', 'gentle camera push-in'][i % 3];

            const fallbackPrompt = [
              `IMAGE-TO-VIDEO FALLBACK: Source image = frame 1. Do not generate a new person. Do not change appearance.`,
              `Apply only physical micro-motion: ${motion}. Preserve: face, skin, hair, body, clothing, background exactly as photographed.`,
              identityAnchor,
              `Vertical 9:16. 4 seconds. The output must show the same individual as in the source photo.`,
            ].filter(Boolean).join(' ');

            const retryResult = await base44.integrations.Core.GenerateVideo({
              prompt: fallbackPrompt,
              duration: 4,
              aspect_ratio: '9:16',
              existing_image_urls: [imageUrl],
            });

            if (retryResult?.url) {
              clipUrl = retryResult.url;
              clipType = 'animated';
              clipStatus = 'success_retry';
            } else {
              clipType = 'static';
              clipStatus = 'fallback_error';
              clipError = err.message;
              warnings.push(`Clip ${i + 1}: animation failed after retry — static slide used (${err.message}).`);
            }
          } catch (_retryErr) {
            clipType = 'static';
            clipStatus = 'fallback_error';
            clipError = err.message;
            warnings.push(`Clip ${i + 1}: animation failed — static slide used (${err.message}).`);
          }
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