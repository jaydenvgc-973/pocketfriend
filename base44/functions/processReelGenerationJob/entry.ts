/**
 * processReelGenerationJob
 *
 * Provider Routing & Diagnostics:
 * - Primary animation provider: Google Veo 3.x (via Core.GenerateVideo)
 * - Source image is the primary animation reference (scene, body, outfit)
 * - Avatar/canonical image is secondary identity reference only (face, age, skin tone)
 * - For character clips: Veo routes existing_image_urls = [source_image, avatar_image]
 * - Motion compositor available as optional post-render enhancement
 * - Full diagnostics per clip: source_image_url, avatar_reference_url, prompt, provider_id
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

    // Only process queued/failed jobs
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

    // Fetch full message records for each selected image
    const messageRecords = {};
    for (const msgId of selectedImageIds) {
      try {
        const msgs = await base44.entities.Message.filter({ id: msgId });
        if (msgs[0]) messageRecords[msgId] = msgs[0];
      } catch (_) {}
    }

    // CHARACTER LOOK LOCK: load canonical appearance data per character
    const characterAppearanceCache = {};
    for (const msgId of selectedImageIds) {
      const msg = messageRecords[msgId];
      const charId = msg?.character_id || null;
      if (!charId || characterAppearanceCache[charId]) continue;
      try {
        const chars = await base44.entities.Character.filter({ owner_email: user.email });
        const char = chars.find(c => c.id === charId);
        if (!char) continue;
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

    // ── STEP 2: ANIMATE SELECTED CLIPS ───────────────────────────────────────
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'animating',
      progress_percent: 15,
      updated_at: new Date().toISOString(),
    });

    const animateFlags = job.clip_results?.map(c => c.animate) || selectedImageUrls.map(() => false);
    const captions = job.clip_results?.map(c => c.caption || '') || selectedImageUrls.map(() => '');

    for (let i = 0; i < selectedImageUrls.length; i++) {
      // Cancellation check
      try {
        const freshJobs = await base44.entities.ReelGenerationJob.filter({ owner_email: user.email });
        const freshJob = freshJobs.find(j => j.id === job_id);
        if (freshJob?.status === 'cancelled') {
          return Response.json({ status: 'cancelled', message: 'Job cancelled by user during animation.' });
        }
      } catch (_) {}

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
      let requires_identity_preservation = false;

      if (shouldAnimate && imageUrl) {
        const charId = msgRecord?.character_id || null;
        requires_identity_preservation = !!charId;

        // ANIMATE VIA VEO: Primary animation provider
        // Frame 0 = source image (the selected image comes to life)
        // Avatar = identity stabilizer only (keeps face/likeness consistent during movement)
        if (requires_identity_preservation && imageUrl) {
          const charAppearance = characterAppearanceCache[charId];
          const avatarUrl = charAppearance?.avatar_url || null;
          
          // Build existing_image_urls: [source_image (INDEX 0, FRAME 0), avatar (INDEX 1, IDENTITY FALLBACK)]
          const existingImages = [imageUrl];
          if (avatarUrl && avatarUrl !== imageUrl) {
            existingImages.push(avatarUrl);
          }

          // Motion prompt: animate the SOURCE IMAGE, use AVATAR only to keep identity consistent
          const identityPrompt = avatarUrl
            ? `Animate the person in IMAGE 1 (the starting frame). The video must begin from IMAGE 1 exactly as it appears. As the character moves, use IMAGE 2 only to keep the face, skin tone, hair, facial hair, age, and character identity consistent. Do not change the body type, gender, ethnicity, outfit, scene, pose, lighting, or camera angle from IMAGE 1. Do not create a new person. The result should look like the person in IMAGE 1 came to life.`
            : `Animate the person in IMAGE 1 (the starting frame). The video must begin from IMAGE 1 exactly as it appears. Keep the scene, body, outfit, pose, lighting, and identity exactly as shown. Do not change gender, body type, ethnicity, or outfit. Do not create a new person.`;

          // Call Veo via Core.GenerateVideo
          try {
            const generateRes = await base44.integrations.Core.GenerateVideo({
              prompt: identityPrompt,
              existing_image_urls: existingImages,
              duration: 4,
              aspect_ratio: '9:16',
            });
            
            clipUrl = generateRes.url || null;
            clipType = clipUrl ? 'animated' : 'static';
            clipStatus = clipUrl ? 'veo_generated' : 'fallback_generation_failed';

            if (clipUrl) {
              console.log(`[Clip ${i + 1}] VEO ANIMATED | Character '${charId}' | Source: ${imageUrl.slice(-40)} | Avatar: ${avatarUrl ? 'yes' : 'no'}`);
            } else {
              console.warn(`[Clip ${i + 1}] VEO FAILED | Character '${charId}' | Fallback to static`);
              warnings.push(`Clip ${i + 1}: Veo generation failed, using static slide.`);
            }
          } catch (err) {
            console.error(`[Clip ${i + 1}] VEO ERROR:`, err.message);
            clipType = 'static';
            clipStatus = 'fallback_generation_error';
            warnings.push(`Clip ${i + 1}: Veo error — ${err.message}`);
          }
        } else if (!imageUrl) {
          clipType = 'static';
          clipStatus = 'fallback_no_source';
          warnings.push(`Clip ${i + 1}: no source image — static slide used.`);
        }
      } else if (shouldAnimate && !imageUrl) {
        clipType = 'static';
        clipStatus = 'fallback_no_source';
        warnings.push(`Clip ${i + 1}: no source image available — static slide used.`);
      }

      // Build provider diagnostics
      const charId = msgRecord?.character_id || null;
      const charAppearanceForClip = charId ? characterAppearanceCache[charId] : null;
      const subjectIds = [];
      if (charId) subjectIds.push(charId);
      const characterReferenceUrls = charAppearanceForClip
        ? [charAppearanceForClip.avatar_url, ...(charAppearanceForClip.reference_image_urls || [])].filter(Boolean)
        : [];

      // Build Veo diagnostics for character clips
      const charAppearanceForDiag = charId ? characterAppearanceCache[charId] : null;
      const avatarUrl = charAppearanceForDiag?.avatar_url || null;
      
      let veo_diagnostics = null;
      if (requires_identity_preservation && imageUrl) {
        const existingImages = [imageUrl];
        if (avatarUrl && avatarUrl !== imageUrl) {
          existingImages.push(avatarUrl);
        }
        const identityPrompt = avatarUrl
          ? `Animate the person in IMAGE 1 (the starting frame). The video must begin from IMAGE 1 exactly as it appears. As the character moves, use IMAGE 2 only to keep the face, skin tone, hair, facial hair, age, and character identity consistent. Do not change the body type, gender, ethnicity, outfit, scene, pose, lighting, or camera angle from IMAGE 1. Do not create a new person. The result should look like the person in IMAGE 1 came to life.`
          : `Animate the person in IMAGE 1 (the starting frame). The video must begin from IMAGE 1 exactly as it appears. Keep the scene, body, outfit, pose, lighting, and identity exactly as shown. Do not change gender, body type, ethnicity, or outfit. Do not create a new person.`;
        
        veo_diagnostics = {
          provider_id: 'veo_3x',
          identity_reference_mode: 'frame_0_plus_identity_anchor',
          source_image_url: imageUrl,
          source_image_role: 'frame_0_animation_starting_point',
          source_image_index_in_payload: 0,
          avatar_reference_url: avatarUrl || null,
          avatar_reference_role: avatarUrl ? 'identity_stabilizer_during_movement' : null,
          avatar_reference_index_in_payload: avatarUrl ? 1 : null,
          existing_image_urls: existingImages,
          existing_image_urls_order: `[0]=${imageUrl.slice(-30)} [1]=${avatarUrl ? avatarUrl.slice(-30) : 'none'}`,
          prompt: identityPrompt,
          animation_starts_from: 'source_image_frame_0',
          avatar_does_not_replace_source: true,
          identity_preservation_approach: 'source_image_comes_to_life_with_identity_anchor',
          identity_preservation_supported: 'source_anchored',
          character_id: charId,
          character_name: charAppearanceForDiag?.name || null,
        };
      }
      
      let video_provider_capabilities = null;
      if (clipType === 'animated' && clipUrl) {
        video_provider_capabilities = {
          provider_id: 'veo_3x',
          provider_name: 'Google Veo 3.x',
          supports_init_frame: false,
          identity_preservation_supported: 'best_effort',
          rendering: 'ai_generated',
          identity_reference_mode: 'source_plus_avatar',
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
        veo_diagnostics,
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

      const pct = 15 + Math.round(((i + 1) / selectedImageUrls.length) * 55);
      await base44.entities.ReelGenerationJob.update(job.id, {
        clip_results: clipResults,
        progress_percent: pct,
        updated_at: new Date().toISOString(),
      });
    }

    // ── STEP 3: ASSEMBLING ────────────────────────────────────────────────────
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'assembling',
      progress_percent: 75,
      updated_at: new Date().toISOString(),
    });

    const thumbnailUrl = selectedImageUrls[0] || null;

    // ── STEP 4: VALIDATING ────────────────────────────────────────────────────
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'validating',
      progress_percent: 88,
      updated_at: new Date().toISOString(),
    });

    const validationNotes = [];
    let validationPassed = true;

    if (clipResults.length !== selectedImageUrls.length) {
      validationPassed = false;
      validationNotes.push(`FAIL: Expected ${selectedImageUrls.length} clips, got ${clipResults.length}.`);
    }

    for (const url of selectedImageUrls) {
      const found = clipResults.find(c => c.image_url === url);
      if (!found) {
        validationPassed = false;
        validationNotes.push(`FAIL: Selected image not found in clip results: ${url.slice(-40)}`);
      }
    }

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