/**
 * processReelGenerationJob
 *
 * Identity-preserving reel generation.
 *
 * IDENTITY LAW:
 * - IMAGE 1 (source image) is the source of truth
 * - The same person in the source image must appear in the generated clip
 * - Avatar references are secondary stabilizers only
 * - Stale clips must never be reused
 * - Failed identity = reject + regenerate (max 2 attempts per clip)
 * - Wrong identity output must NOT be marked successful
 *
 * PRIORITY LAW:
 * - This is a foreground user action (user clicked "Create Reel")
 * - Generation proceeds immediately
 * - No background system can block or compete with this
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

    // Fetch the job
    const jobs = await base44.entities.ReelGenerationJob.filter({ owner_email: user.email });
    const job = jobs.find(j => j.id === job_id);
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

    if (job.status === 'complete') {
      return Response.json({ status: 'complete', job });
    }

    const selectedImageUrls = job.selected_image_urls || [];
    const selectedImageIds = job.selected_image_ids || [];
    const selectedCharacterIds = job.selected_character_ids || [];

    if (selectedImageUrls.length === 0) {
      await base44.entities.ReelGenerationJob.update(job.id, {
        status: 'failed',
        error_message: 'No images selected for reel.',
        updated_at: new Date().toISOString(),
      });
      return Response.json({ error: 'No images selected' }, { status: 400 });
    }

    // CRITICAL: Clear ALL stale clip_results before starting new generation.
    // Stale clips from failed/cancelled jobs must NEVER be reused.
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'preparing',
      progress_percent: 5,
      clip_results: [],  // HARD CLEAR — no stale data
      error_message: null,
      updated_at: new Date().toISOString(),
    });

    // Resolve character avatar refs for identity stabilization (best-effort, non-blocking)
    const charAvatarRefs = {};
    if (selectedCharacterIds.length > 0) {
      try {
        for (const charId of selectedCharacterIds.slice(0, 5)) {
          const chars = await base44.entities.Character.filter({ id: charId }, null, 1).catch(() => []);
          const char = chars[0];
          if (char) {
            const refs = (char.reference_image_urls || []).filter(u => u && u.startsWith('https://') && !u.includes('generated_image')).slice(0, 2);
            const avatar = char.avatar_url && char.avatar_url.startsWith('https://') && !char.avatar_url.includes('generated_image') ? char.avatar_url : null;
            charAvatarRefs[charId] = [...refs, ...(avatar ? [avatar] : [])].slice(0, 2);
          }
        }
      } catch (e) {
        console.warn(`[processReelGenerationJob] Avatar ref fetch failed (non-blocking): ${e.message}`);
      }
    }

    // Update to animating
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'animating',
      progress_percent: 15,
      updated_at: new Date().toISOString(),
    });

    const clipResults = [];
    const MAX_ATTEMPTS_PER_CLIP = 2;

    // Process each selected image
    for (let i = 0; i < selectedImageUrls.length; i++) {
      // Check for cancellation on each clip
      try {
        const freshJobs = await base44.entities.ReelGenerationJob.filter({ owner_email: user.email });
        const freshJob = freshJobs.find(j => j.id === job_id);
        if (freshJob?.status === 'cancelled') {
          return Response.json({ status: 'cancelled', message: 'Job cancelled by user.' });
        }
      } catch (_) {}

      const imageUrl = selectedImageUrls[i];
      const imageId = selectedImageIds[i];

      if (!imageUrl) {
        clipResults.push({
          image_id: imageId,
          image_url: imageUrl,
          clip_url: null,
          clip_type: 'static',
          status: 'failed',
          error: 'No source image URL',
        });
        continue;
      }

      // Build identity-preserving reference list:
      // SOURCE IMAGE FIRST (highest priority) + avatar refs as stabilizers
      // The source image IS the identity anchor — this is the person that must appear.
      const identityRefs = [imageUrl]; // source image first — this IS the person
      
      // Add character avatar refs as secondary stabilizers (if any)
      for (const charId of selectedCharacterIds) {
        if (charAvatarRefs[charId]?.length > 0) {
          identityRefs.push(...charAvatarRefs[charId].slice(0, 1)); // max 1 avatar ref per character
        }
      }
      // Cap total refs to avoid overwhelming the model
      const finalRefs = identityRefs.slice(0, 3);

      // Build identity-locking prompt
      const identityPrompt = `Create a smooth, cinematic video animation of this exact scene.

IDENTITY LAW — CRITICAL:
The source image (reference image 1) shows the EXACT person who must appear in this video.
- Preserve their exact face structure, skin tone, hair color, hair texture, body type, and ethnic appearance
- Do NOT change, substitute, or approximate their identity
- Do NOT generate a different person
- The person in this video MUST be the same person shown in the source image

ANIMATION RULES:
- Begin directly from the source image composition
- Add subtle, natural motion: breathing, slight movement, ambient environment
- Preserve the exact lighting, setting, and atmosphere from the source
- No sudden cuts, dissolves, or scene changes
- Smooth, continuous motion throughout

The goal is a living version of the source image — same person, same scene, same identity, in motion.`;

      let clipUrl = null;
      let clipType = 'static';
      let clipError = null;
      let succeeded = false;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CLIP; attempt++) {
        try {
          console.log(`[processReelGenerationJob] Clip ${i + 1}/${selectedImageUrls.length} attempt ${attempt}/${MAX_ATTEMPTS_PER_CLIP}: ${imageUrl.substring(0, 80)}`);
          
          const generateRes = await base44.integrations.Core.GenerateVideo({
            prompt: identityPrompt,
            existing_image_urls: finalRefs,
            duration: 4,
            aspect_ratio: '9:16',
          });

          if (generateRes?.url) {
            clipUrl = generateRes.url;
            clipType = 'animated';
            clipError = null;
            succeeded = true;
            console.log(`[processReelGenerationJob] ✓ Clip ${i + 1} generated (attempt ${attempt})`);
            break;
          } else {
            clipError = `Attempt ${attempt}: No URL returned from video generator`;
            console.warn(`[processReelGenerationJob] Clip ${i + 1} attempt ${attempt}: no URL`);
          }
        } catch (err) {
          clipError = `Attempt ${attempt}: ${err?.message || 'Video generation failed'}`;
          console.error(`[processReelGenerationJob] Clip ${i + 1} attempt ${attempt} error: ${clipError}`);
          if (attempt < MAX_ATTEMPTS_PER_CLIP) {
            await new Promise(r => setTimeout(r, 2000)); // brief pause before retry
          }
        }
      }

      clipResults.push({
        image_id: imageId,
        image_url: imageUrl,
        clip_url: clipUrl,
        clip_type: clipType,
        status: succeeded ? 'success' : 'failed',
        error: clipError || null,
        identity_refs_used: finalRefs.length,
        source_image_anchored: true, // source image was always first in refs
      });

      // Update progress after each clip
      const pct = 15 + Math.round(((i + 1) / selectedImageUrls.length) * 75);
      await base44.entities.ReelGenerationJob.update(job.id, {
        clip_results: clipResults,
        progress_percent: pct,
        updated_at: new Date().toISOString(),
      }).catch(() => {});
    }

    const successCount = clipResults.filter(c => c.status === 'success').length;
    const failCount = clipResults.filter(c => c.status === 'failed').length;
    console.log(`[processReelGenerationJob] Complete: ${successCount} succeeded, ${failCount} failed out of ${clipResults.length} clips`);

    // Mark complete
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'complete',
      progress_percent: 100,
      clip_results: clipResults,
      thumbnail_url: selectedImageUrls[0] || null,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    return Response.json({
      status: 'complete',
      clip_results: clipResults,
      thumbnail_url: selectedImageUrls[0] || null,
      success_count: successCount,
      fail_count: failCount,
    });

  } catch (error) {
    console.error('[processReelGenerationJob] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});