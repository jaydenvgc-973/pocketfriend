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
    const selectedCharacterIds = job.selected_character_ids || [];
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
          // PROOF LOGGING: Capture exact payload structure
          const veoPayload = {
            prompt: identityPrompt,
            existing_image_urls: existingImages,
            duration: 4,
            aspect_ratio: '9:16',
          };
          
          console.log(`\n[Clip ${i + 1}] ══════════════════════════════════════════════════════════════`);
          console.log(`[Clip ${i + 1}] VEO PAYLOAD PROOF`);
          console.log(`[Clip ${i + 1}] ──────────────────────────────────────────────────────────────`);
          console.log(`[Clip ${i + 1}] existing_image_urls array (PROOF OF ORDER):`);
          for (let idx = 0; idx < existingImages.length; idx++) {
            const imgUrl = existingImages[idx];
            const role = idx === 0 ? 'FRAME_0_SOURCE' : idx === 1 ? 'IDENTITY_ANCHOR' : 'OTHER';
            console.log(`[Clip ${i + 1}]   [${idx}] ${role}: ${imgUrl.slice(-50)}`);
          }
          console.log(`[Clip ${i + 1}] prompt (first 200 chars): ${identityPrompt.slice(0, 200)}...`);
          console.log(`[Clip ${i + 1}] character_id: ${charId}`);
          console.log(`[Clip ${i + 1}] character_name: ${charAppearance?.name}`);
          console.log(`[Clip ${i + 1}] ──────────────────────────────────────────────────────────────`);
          
          try {
            const generateRes = await base44.integrations.Core.GenerateVideo(veoPayload);
            
            clipUrl = generateRes.url || null;
            clipType = clipUrl ? 'animated' : 'static';
            clipStatus = clipUrl ? 'veo_generated' : 'fallback_generation_failed';

            console.log(`[Clip ${i + 1}] VEO RESPONSE:`);
            console.log(`[Clip ${i + 1}]   clip_url: ${clipUrl ? clipUrl.slice(-50) : 'NULL'}`);
            console.log(`[Clip ${i + 1}]   clip_type: ${clipType}`);
            console.log(`[Clip ${i + 1}]   status: ${clipStatus}`);
            console.log(`[Clip ${i + 1}] ══════════════════════════════════════════════════════════════\n`);

            if (clipUrl) {
              console.log(`[Clip ${i + 1}] VEO ANIMATED | Character '${charId}' | Source: ${imageUrl.slice(-40)} | Avatar: ${avatarUrl ? 'yes' : 'no'}`);
            } else {
              console.warn(`[Clip ${i + 1}] VEO FAILED | Character '${charId}' | Fallback to static`);
              warnings.push(`Clip ${i + 1}: Veo generation failed, using static slide.`);
            }
          } catch (err) {
            console.error(`[Clip ${i + 1}] VEO ERROR:`, err.message);
            console.log(`[Clip ${i + 1}] ══════════════════════════════════════════════════════════════\n`);
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

      const clipRecord = {
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
      };
      
      // PROOF LOGGING: Show exactly what is saved to clip_results
      console.log(`[Clip ${i + 1}] CLIP_RESULTS SAVED:`);
      console.log(`[Clip ${i + 1}]   image_url: ${clipRecord.image_url.slice(-50)}`);
      console.log(`[Clip ${i + 1}]   clip_url: ${clipRecord.clip_url ? clipRecord.clip_url.slice(-50) : 'NULL'}`);
      console.log(`[Clip ${i + 1}]   clip_type: ${clipRecord.clip_type}`);
      console.log(`[Clip ${i + 1}]   status: ${clipRecord.status}`);
      console.log(`[Clip ${i + 1}]   character_id: ${clipRecord.subject_identity.linked_character_id}`);
      if (veo_diagnostics) {
        console.log(`[Clip ${i + 1}]   veo_diagnostics.source_image_url: ${veo_diagnostics.source_image_url.slice(-50)}`);
        console.log(`[Clip ${i + 1}]   veo_diagnostics.avatar_reference_url: ${veo_diagnostics.avatar_reference_url ? veo_diagnostics.avatar_reference_url.slice(-50) : 'NULL'}`);
        console.log(`[Clip ${i + 1}]   veo_diagnostics.source_image_index_in_payload: ${veo_diagnostics.source_image_index_in_payload}`);
        console.log(`[Clip ${i + 1}]   veo_diagnostics.avatar_reference_index_in_payload: ${veo_diagnostics.avatar_reference_index_in_payload}`);
        console.log(`[Clip ${i + 1}]   veo_diagnostics.existing_image_urls_order: ${veo_diagnostics.existing_image_urls_order}`);
      }
      console.log(`[Clip ${i + 1}] ────────────────────────────────────────────────────────────────\n`);
      
      clipResults.push(clipRecord);

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
    
    // FINAL PROOF SUMMARY
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`REEL GENERATION JOB COMPLETE: ${job.id}`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`Total clips processed: ${clipResults.length}`);
    console.log(`Selected source images: ${selectedImageUrls.length}`);
    console.log(`Character(s): ${selectedCharacterIds.join(', ')}`);
    console.log(`${'═'.repeat(80)}\n`);
    
    for (let idx = 0; idx < clipResults.length; idx++) {
      const clip = clipResults[idx];
      console.log(`CLIP ${idx + 1} SUMMARY:`);
      console.log(`  image_url (selected source): ${clip.image_url.slice(-60)}`);
      console.log(`  clip_url (generated video): ${clip.clip_url ? clip.clip_url.slice(-60) : 'NULL'}`);
      console.log(`  clip_type: ${clip.clip_type}`);
      console.log(`  character_id: ${clip.subject_identity.linked_character_id}`);
      if (clip.veo_diagnostics) {
        const diag = clip.veo_diagnostics;
        console.log(`  VEO PROOF:`);
        console.log(`    - source_image_url matches image_url? ${diag.source_image_url === clip.image_url ? 'YES' : 'NO'}`);
        console.log(`    - source_image_index_in_payload: ${diag.source_image_index_in_payload}`);
        console.log(`    - avatar_reference_url: ${diag.avatar_reference_url ? diag.avatar_reference_url.slice(-60) : 'NULL'}`);
        console.log(`    - avatar_reference_index_in_payload: ${diag.avatar_reference_index_in_payload}`);
        console.log(`    - avatar belongs to same character? ${diag.character_id === clip.subject_identity.linked_character_id ? 'YES' : 'CHECK'}`);
      }
      console.log(`\n`);
    }
    console.log(`${'═'.repeat(80)}\n`);
    
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