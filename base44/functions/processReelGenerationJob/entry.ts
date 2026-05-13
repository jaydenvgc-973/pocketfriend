/**
 * processReelGenerationJob
 *
 * Simple, stable Google Veo 3.x reel generation.
 * 
 * Flow:
 * 1. Fetch ReelGenerationJob
 * 2. Clear stale clip_results
 * 3. For each selected image, call Veo with source image
 * 4. Save clip_results with video URLs
 * 5. Mark job complete
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
    const clipResults = [];

    // Update job to preparing
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'preparing',
      progress_percent: 10,
      updated_at: new Date().toISOString(),
      clip_results: [], // Clear stale results
    });

    // Update to animating
    await base44.entities.ReelGenerationJob.update(job.id, {
      status: 'animating',
      progress_percent: 20,
      updated_at: new Date().toISOString(),
    });

    // Process each selected image through Veo
    for (let i = 0; i < selectedImageUrls.length; i++) {
      // Check for cancellation
      try {
        const freshJobs = await base44.entities.ReelGenerationJob.filter({ owner_email: user.email });
        const freshJob = freshJobs.find(j => j.id === job_id);
        if (freshJob?.status === 'cancelled') {
          return Response.json({ status: 'cancelled', message: 'Job cancelled by user.' });
        }
      } catch (_) {}

      const imageUrl = selectedImageUrls[i];
      const imageId = selectedImageIds[i];

      let clipUrl = null;
      let clipType = 'static';
      let error = null;

      if (!imageUrl) {
        clipType = 'static';
        error = 'No source image URL';
      } else {
        try {
          // Simple Veo call with just the source image
          const generateRes = await base44.integrations.Core.GenerateVideo({
            prompt: 'Create a smooth, cinematic video animation of this scene. Keep the composition, lighting, and all elements exactly as shown in the image. Add subtle motion and depth.',
            existing_image_urls: [imageUrl],
            duration: 4,
            aspect_ratio: '9:16',
          });

          clipUrl = generateRes.url || null;
          clipType = clipUrl ? 'animated' : 'static';

          if (!clipUrl) {
            error = 'Veo returned no URL';
          }
        } catch (err) {
          clipType = 'static';
          error = err?.message || 'Veo generation failed';
          console.error(`[Clip ${i + 1}] Veo error: ${error}`);
        }
      }

      const clipRecord = {
        image_id: imageId,
        image_url: imageUrl,
        clip_url: clipUrl,
        clip_type: clipType,
        status: error ? 'failed' : 'success',
        error: error || null,
      };

      clipResults.push(clipRecord);

      const pct = 20 + Math.round(((i + 1) / selectedImageUrls.length) * 60);
      await base44.entities.ReelGenerationJob.update(job.id, {
        clip_results: clipResults,
        progress_percent: pct,
        updated_at: new Date().toISOString(),
      });
    }

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
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});