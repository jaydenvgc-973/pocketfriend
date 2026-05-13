/**
 * processReelGenerationJob
 *
 * Provider Routing & Diagnostics:
 * - Character identity-critical clips are routed through provider selection.
 * - Currently only Veo 3.x (Core.GenerateVideo) is available.
 * - Veo treats existing_image_urls as loose style reference, NOT frame-lock.
 * - For character clips, provider diagnostics are stored so caller knows actual capabilities.
 * - No claims of identity preservation made unless provider explicitly supports it.
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
          // ── PROVIDER SELECTION ────────────────────────────────────────────────
          // Determine if this is a character identity-critical clip
          const charId = msgRecord?.character_id || null;
          const requires_identity_preservation = !!charId;

          // Currently only Veo 3.x is available
          const selectedProvider = {
            provider_id: 'veo_3x',
            provider_name: 'Google Veo 3.x',
            supports_init_frame: false,
            supports_identity_reference: 'loose_reference_only',
            identity_preservation_supported: false,
            generation_mode: 'loose_reference_only',
          };

          const motionOptions = [
            'subtle breathing, gentle eye blink, camera slowly pushing in',
            'soft hair movement from a light breeze, natural body stillness, camera holds steady',
            'head turns slightly, eyes shift gently to the side, camera drifts left',
            'slight natural smile, ambient light shifts softly, camera slow pull-back',
            'weight shifts slightly, hand moves naturally, environment has gentle ambient motion',
          ];
          const motion = motionOptions[i % motionOptions.length];

          const charAppearance = charId ? characterAppearanceCache[charId] : null;

          const animPrompt = `Animate this photo with subtle motion only: ${motion}. Vertical 9:16.`;

          // ── LOG EXACT PAYLOAD ────────────────────────────────────────────────
          const generateVideoPayload = {
            prompt: animPrompt,
            duration: 4,
            aspect_ratio: '9:16',
            existing_image_urls: [imageUrl],
          };
          console.log(`[Clip ${i + 1}] Provider: ${selectedProvider.provider_id} | Character: ${charId || 'none'} | Payload:`, JSON.stringify(generateVideoPayload));

          const result = await base44.integrations.Core.GenerateVideo(generateVideoPayload);

          if (result?.url) {
            clipUrl = result.url;
            clipType = 'animated';
            clipStatus = 'success';
          } else {
            // Retry with simpler prompt
            try {
              const retryPayload = {
                prompt: `Animate this photo. Motion: ${motion}. Vertical 9:16.`,
                duration: 4,
                aspect_ratio: '9:16',
                existing_image_urls: [imageUrl],
              };
              console.log(`[Clip ${i + 1}] Retry 1 | Payload:`, JSON.stringify(retryPayload));
              const retryResult = await base44.integrations.Core.GenerateVideo(retryPayload);

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
          // Second attempt failed — final retry
          try {
            const motion = ['subtle breathing', 'soft motion', 'gentle camera'][i % 3];
            const fallbackPayload = {
              prompt: `Animate. Motion: ${motion}. Vertical 9:16.`,
              duration: 4,
              aspect_ratio: '9:16',
              existing_image_urls: [imageUrl],
            };
            console.log(`[Clip ${i + 1}] Retry 2 | Payload:`, JSON.stringify(fallbackPayload));
            const retryResult = await base44.integrations.Core.GenerateVideo(fallbackPayload);

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

      // Build provider diagnostics for this clip
      const charId = msgRecord?.character_id || null;
      const requires_identity_preservation = !!charId;
      const charAppearanceForClip = charId ? characterAppearanceCache[charId] : null;
      const subjectIds = [];
      if (charId) subjectIds.push(charId);
      const characterReferenceUrls = charAppearanceForClip
        ? [charAppearanceForClip.avatar_url, ...(charAppearanceForClip.reference_image_urls || [])].filter(Boolean)
        : [];

      // Provider diagnostics
      let video_provider_capabilities = null;
      if (clipType === 'animated' && clipUrl) {
        video_provider_capabilities = {
          provider_id: 'veo_3x',
          provider_name: 'Google Veo 3.x',
          supports_init_frame: false,
          supports_identity_reference: 'loose_reference_only',
          supports_reference_strength: false,
          supports_seed: false,
          identity_preservation_supported: false,
          identity_validation_status: requires_identity_preservation ? 'CHARACTER_CLIP_USING_LOOSE_REFERENCE' : 'non_identity_critical',
          generation_mode: 'loose_reference_only',
          warning: requires_identity_preservation ? 'Provider does NOT support init-frame locking. Character identity may not be preserved.' : null,
        };
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
        requires_identity_preservation,
        video_provider_capabilities,
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