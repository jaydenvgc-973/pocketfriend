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

      // HARD REQUIREMENT: Character MUST have avatar for animation
      if (!char.avatar_url) {
        console.warn(`[CHARACTER LOAD] Character '${char.name}' (${charId}) missing avatar_url. Cannot use for identity-preserved animation.`);
        // Still cache the character, but mark avatar as missing so Veo calls fail validation
      }

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
        has_avatar: !!char.avatar_url, // EXPLICIT FLAG: true = safe for animation, false = FAIL
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
    
    // Declare here so per-clip hard gates can write into them during the animation loop
    const validationNotes = [];
    let validationPassed = true;

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
      let veo_diagnostics = null;

      // Resolve character identity now — used by both the Veo gate and the diagnostics
      const charId = msgRecord?.character_id || null;
      const charAppearance = charId ? characterAppearanceCache[charId] : null;
      const avatarUrl = charAppearance?.avatar_url || null;

      if (shouldAnimate && !imageUrl) {
        clipType = 'static';
        clipStatus = 'failed_no_source_image';
        clipError = `Clip ${i + 1}: source image URL missing — cannot animate.`;
        warnings.push(`Clip ${i + 1}: no source image — static slide used.`);

      } else if (shouldAnimate && imageUrl) {
        requires_identity_preservation = !!charId;

        // ── PRE-ANIMATION HARD GATES ─────────────────────────────────────────
        // These block Veo from being called with insufficient data.
        // Veo called without an avatar will generate a random wrong person.

        if (requires_identity_preservation && !charId) {
          clipType = 'static';
          clipStatus = 'failed_missing_character_id';
          clipError = `Clip ${i + 1}: character_id missing from message. Cannot preserve identity.`;
          warnings.push(`Clip ${i + 1}: Character mapping missing — cannot animate. Static slide used.`);
          console.error(`[Clip ${i + 1}] HARD FAIL: character_id missing. Veo BLOCKED.`);

        } else if (requires_identity_preservation && !avatarUrl) {
          // HARD BLOCK: Veo without avatar = guaranteed wrong person / wrong gender output
          clipType = 'static';
          clipStatus = 'failed_missing_avatar';
          clipError = `Character '${charAppearance?.name || charId}' has no avatar_url. Veo call blocked — cannot preserve identity without avatar reference. Add an avatar to this character's profile.`;
          warnings.push(`Clip ${i + 1}: Character '${charAppearance?.name || charId}' needs an avatar photo. Static slide used until avatar is added.`);
          console.error(`[Clip ${i + 1}] HARD FAIL: avatar_url missing for '${charAppearance?.name || charId}'. Veo BLOCKED.`);

        } else {
          // ── ALL GATES PASSED — build payload and call Veo ─────────────────
          const existingImages = [imageUrl]; // INDEX 0 = FRAME 0 SOURCE (MANDATORY)
          if (avatarUrl && avatarUrl !== imageUrl) {
            existingImages.push(avatarUrl);  // INDEX 1 = IDENTITY ANCHOR (character face/likeness)
          }

          const identityPrompt = avatarUrl
            ? `Animate the person in IMAGE 1 (the starting frame). The video must begin from IMAGE 1 exactly as it appears. As the character moves, use IMAGE 2 only to keep the face, skin tone, hair, facial hair, age, and character identity consistent. Do not change the body type, gender, ethnicity, outfit, scene, pose, lighting, or camera angle from IMAGE 1. Do not create a new person. The result must look like the person in IMAGE 1 came to life.`
            : `Animate the person in IMAGE 1 (the starting frame). The video must begin from IMAGE 1 exactly as it appears. Keep the scene, body, outfit, pose, lighting, and identity exactly as shown. Do not change gender, body type, ethnicity, or outfit. Do not create a new person.`;

          console.log(`\n[Clip ${i + 1}] ══════════════════════════════════════════════════`);
          console.log(`[Clip ${i + 1}] GATES PASSED — CALLING VEO`);
          console.log(`[Clip ${i + 1}] character: ${charAppearance?.name || charId}`);
          console.log(`[Clip ${i + 1}] [0] FRAME_0_SOURCE: ${imageUrl.slice(-60)}`);
          console.log(`[Clip ${i + 1}] [1] IDENTITY_ANCHOR: ${avatarUrl ? avatarUrl.slice(-60) : 'NONE'}`);
          console.log(`[Clip ${i + 1}] ══════════════════════════════════════════════════\n`);

          try {
            const generateRes = await base44.integrations.Core.GenerateVideo({
              prompt: identityPrompt,
              existing_image_urls: existingImages,
              duration: 4,
              aspect_ratio: '9:16',
            });

            clipUrl = generateRes.url || null;
            clipType = clipUrl ? 'animated' : 'static';
            clipStatus = clipUrl ? 'veo_generated' : 'veo_returned_no_url';

            // Save the exact payload as diagnostics proof
            veo_diagnostics = {
              provider_id: 'veo_3x',
              source_image_url: imageUrl,
              source_image_index_in_payload: 0,
              avatar_reference_url: avatarUrl || null,
              avatar_reference_index_in_payload: avatarUrl ? 1 : null,
              existing_image_urls: existingImages,
              existing_image_urls_order: `[0]=${imageUrl.slice(-30)} [1]=${avatarUrl ? avatarUrl.slice(-30) : 'none'}`,
              prompt: identityPrompt,
              character_id: charId,
              character_name: charAppearance?.name || null,
            };

            console.log(`[Clip ${i + 1}] VEO RESULT: ${clipUrl ? 'SUCCESS' : 'NO URL'}`);
            if (!clipUrl) {
              warnings.push(`Clip ${i + 1}: Veo returned no URL. Static slide used.`);
            }
          } catch (err) {
            console.error(`[Clip ${i + 1}] VEO ERROR:`, err.message);
            clipType = 'static';
            clipStatus = 'veo_error';
            clipError = err.message;
            warnings.push(`Clip ${i + 1}: Veo error — ${err.message}`);
          }
        }
      }

      // Build subject identity for clip record
      const subjectIds = charId ? [charId] : [];
      const characterReferenceUrls = charAppearance
        ? [charAppearance.avatar_url, ...(charAppearance.reference_image_urls || [])].filter(Boolean)
        : [];
      
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
        veo_diagnostics,
        subject_identity: {
          media_id: imageId,
          source_image_url: imageUrl,
          linked_character_id: charId || null,
          visible_subject_type: charId ? 'character' : 'unknown',
          visible_subject_ids: subjectIds,
          original_prompt: originalPrompt || null,
          character_reference_urls: characterReferenceUrls,
          character_fingerprint: charAppearance?.fingerprint || null,
          identity_confidence: charAppearance?.fingerprint ? 'high' : (imageUrl ? 'source_only' : 'low'),
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

    // validationNotes may already contain FAIL entries from per-clip hard gates
    // Do not reset — accumulate from clip loop
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
      
      // IDENTITY VALIDATION: If animated clip for a character, MUST have all three: source, character ID, avatar
      if (clip.requires_identity_preservation && clip.clip_type === 'animated') {
        if (!clip.veo_diagnostics || !clip.veo_diagnostics.source_image_url) {
          validationPassed = false;
          validationNotes.push(`FAIL: Character clip missing source_image_url in diagnostics.`);
        }
        if (!clip.veo_diagnostics || !clip.veo_diagnostics.character_id) {
          validationPassed = false;
          validationNotes.push(`FAIL: Character clip missing character_id in diagnostics.`);
        }
        if (!clip.veo_diagnostics || !clip.veo_diagnostics.avatar_reference_url) {
          validationPassed = false;
          validationNotes.push(`FAIL: Character clip missing avatar_reference_url in diagnostics.`);
        }
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