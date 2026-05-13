import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DIAGNOSTIC: Full reel generation pipeline trace
 * Shows exactly where the wrong person enters the system
 * Captures ReelGenerationJob, clips, character mappings, and Veo payloads
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { job_id } = body;

    if (!job_id) {
      return Response.json({ error: 'job_id required' }, { status: 400 });
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`DIAGNOSTIC: REEL GENERATION PIPELINE TRACE`);
    console.log(`Job ID: ${job_id}`);
    console.log(`${'═'.repeat(80)}\n`);

    // ── STEP 1: Fetch the ReelGenerationJob record ──────────────────────────────
    const job = await base44.asServiceRole.entities.ReelGenerationJob.filter({
      id: job_id,
    }, '-created_date', 1).catch(() => []);

    if (!job || job.length === 0) {
      return Response.json({ error: `Job ${job_id} not found` }, { status: 404 });
    }

    const jobRecord = job[0];
    console.log(`STEP 1: ReelGenerationJob RECORD`);
    console.log(`  job_id: ${jobRecord.id}`);
    console.log(`  owner_email: ${jobRecord.owner_email}`);
    console.log(`  status: ${jobRecord.status}`);
    console.log(`  created_at: ${jobRecord.created_date}`);
    console.log(`  updated_at: ${jobRecord.updated_at}`);
    console.log(`  completed_at: ${jobRecord.completed_at || 'NOT SET'}`);
    console.log(`  selected_image_ids: [${jobRecord.selected_image_ids?.join(', ') || 'EMPTY'}]`);
    console.log(`  selected_image_urls count: ${jobRecord.selected_image_urls?.length || 0}`);
    console.log(`  selected_character_ids: [${jobRecord.selected_character_ids?.join(', ') || 'EMPTY'}]`);
    console.log(`  clip_results count: ${jobRecord.clip_results?.length || 0}`);
    console.log(`\n`);

    // ── STEP 2: Trace each selected image ───────────────────────────────────────
    console.log(`STEP 2: SELECTED IMAGES AND CHARACTER MAPPINGS`);
    console.log(`${'─'.repeat(80)}\n`);

    const selectedUrls = jobRecord.selected_image_urls || [];
    const selectedCharIds = jobRecord.selected_character_ids || [];

    for (let i = 0; i < selectedUrls.length; i++) {
      const imageUrl = selectedUrls[i];
      const charId = selectedCharIds[i];

      console.log(`IMAGE ${i + 1}:`);
      console.log(`  URL: ${imageUrl.slice(-70)}`);
      console.log(`  selected_character_id: ${charId || 'NULL'}`);

      // Look up the character
      if (charId) {
        const charList = await base44.asServiceRole.entities.Character.filter({
          id: charId,
        }, null, 1).catch(() => []);

        if (charList && charList.length > 0) {
          const char = charList[0];
          console.log(`  character found:`);
          console.log(`    - name: ${char.name}`);
          console.log(`    - avatar_url: ${char.avatar_url ? char.avatar_url.slice(-70) : 'NULL'}`);
          console.log(`    - image_avatar_url: ${char.image_avatar_url ? char.image_avatar_url.slice(-70) : 'NULL'}`);
          console.log(`    - gender: ${char.gender}`);
          console.log(`    - ethnicities: ${char.ethnicities?.join(', ') || 'NOT SET'}`);
          console.log(`    - appearance_age: ${char.appearance_age || 'NOT SET'}`);
        } else {
          console.log(`  ❌ CHARACTER NOT FOUND for id: ${charId}`);
        }
      } else {
        console.log(`  ⚠ NO CHARACTER ID LINKED`);
      }
      console.log(``);
    }

    // ── STEP 3: Trace each clip_result ──────────────────────────────────────────
    console.log(`\nSTEP 3: CLIP RESULTS (WHAT WAS GENERATED)`);
    console.log(`${'─'.repeat(80)}\n`);

    const clipResults = jobRecord.clip_results || [];
    for (let i = 0; i < clipResults.length; i++) {
      const clip = clipResults[i];
      console.log(`CLIP ${i + 1}:`);
      console.log(`  image_url (source): ${clip.image_url ? clip.image_url.slice(-70) : 'NULL'}`);
      console.log(`  clip_url (output): ${clip.clip_url ? clip.clip_url.slice(-70) : 'NULL'}`);
      console.log(`  clip_type: ${clip.clip_type}`);
      console.log(`  status: ${clip.status}`);
      console.log(`  requires_identity_preservation: ${clip.requires_identity_preservation}`);

      // Show veo_diagnostics if present
      if (clip.veo_diagnostics) {
        const diag = clip.veo_diagnostics;
        console.log(`  veo_diagnostics:`);
        console.log(`    - source_image_url: ${diag.source_image_url ? diag.source_image_url.slice(-70) : 'NULL'}`);
        console.log(`    - source_image_role: ${diag.source_image_role}`);
        console.log(`    - source_image_index_in_payload: ${diag.source_image_index_in_payload}`);
        console.log(`    - avatar_reference_url: ${diag.avatar_reference_url ? diag.avatar_reference_url.slice(-70) : 'NULL'}`);
        console.log(`    - avatar_reference_role: ${diag.avatar_reference_role}`);
        console.log(`    - avatar_reference_index_in_payload: ${diag.avatar_reference_index_in_payload}`);
        console.log(`    - character_id: ${diag.character_id}`);
        console.log(`    - character_name: ${diag.character_name}`);
        console.log(`    - existing_image_urls_order: ${diag.existing_image_urls_order}`);
        console.log(`    - prompt (first 150 chars): ${diag.prompt ? diag.prompt.slice(0, 150) + '...' : 'NULL'}`);
      } else {
        console.log(`    ⚠ NO VEO DIAGNOSTICS SAVED`);
      }

      // Check for subject_identity
      if (clip.subject_identity) {
        const subj = clip.subject_identity;
        console.log(`  subject_identity:`);
        console.log(`    - media_id: ${subj.media_id}`);
        console.log(`    - linked_character_id: ${subj.linked_character_id}`);
        console.log(`    - visible_subject_type: ${subj.visible_subject_type}`);
      }

      console.log(``);
    }

    // ── STEP 4: Verify array order ──────────────────────────────────────────────
    console.log(`\nSTEP 4: PAYLOAD PROOF - existing_image_urls ARRAY ORDER`);
    console.log(`${'─'.repeat(80)}\n`);

    for (let i = 0; i < clipResults.length; i++) {
      const clip = clipResults[i];
      if (clip.veo_diagnostics && clip.veo_diagnostics.existing_image_urls) {
        const urls = clip.veo_diagnostics.existing_image_urls;
        console.log(`CLIP ${i + 1}:`);
        console.log(`  existing_image_urls array length: ${urls.length}`);
        for (let idx = 0; idx < urls.length; idx++) {
          const role = idx === 0 ? 'INDEX_0 (FRAME_0_SOURCE)' : idx === 1 ? 'INDEX_1 (IDENTITY_ANCHOR)' : `INDEX_${idx}`;
          console.log(`    [${idx}] ${role}: ${urls[idx].slice(-70)}`);
        }

        // PROOF: Check if index 0 matches the selected image
        if (urls[0] === clip.image_url) {
          console.log(`  ✓ CORRECT: existing_image_urls[0] matches clip.image_url`);
        } else {
          console.log(`  ❌ MISMATCH: existing_image_urls[0] does NOT match clip.image_url`);
          console.log(`     [0] is: ${urls[0].slice(-50)}`);
          console.log(`     image_url is: ${clip.image_url.slice(-50)}`);
        }

        console.log(``);
      } else {
        console.log(`CLIP ${i + 1}: ⚠ No veo_diagnostics.existing_image_urls found\n`);
      }
    }

    // ── STEP 5: Check for stale clip_url reuse ──────────────────────────────────
    console.log(`\nSTEP 5: STALE CLIP_URL DETECTION`);
    console.log(`${'─'.repeat(80)}\n`);

    const nonNullClips = clipResults.filter(c => c.clip_url);
    console.log(`Total clips with clip_url: ${nonNullClips.length}`);

    const uniqueUrls = new Set(nonNullClips.map(c => c.clip_url));
    console.log(`Unique clip_url values: ${uniqueUrls.size}`);

    if (nonNullClips.length > 0) {
      console.log(`\nFirst clip_url (sample): ${nonNullClips[0].clip_url.slice(-70)}`);
      console.log(`Clip URL contains 'veo' or 'video': ${nonNullClips[0].clip_url.includes('veo') || nonNullClips[0].clip_url.includes('video') ? 'YES' : 'NO'}`);
    }

    console.log(`\n`);

    // ── FINAL SUMMARY ────────────────────────────────────────────────────────────
    console.log(`${'═'.repeat(80)}`);
    console.log(`DIAGNOSTIC SUMMARY`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`\nChecklist:`);
    console.log(`  ☐ ReelGenerationJob exists: ${jobRecord ? '✓' : '✗'}`);
    console.log(`  ☐ Selected images count: ${selectedUrls.length}`);
    console.log(`  ☐ Selected characters linked: ${selectedCharIds.filter(c => c).length}`);
    console.log(`  ☐ Clips generated: ${clipResults.length}`);
    console.log(`  ☐ Clips with veo_diagnostics: ${clipResults.filter(c => c.veo_diagnostics).length}`);
    console.log(`  ☐ Payload array index 0 = source image: ${clipResults.every(c => !c.veo_diagnostics || !c.veo_diagnostics.existing_image_urls || c.veo_diagnostics.existing_image_urls[0] === c.image_url) ? '✓' : '✗'}`);
    console.log(`\n${'═'.repeat(80)}\n`);

    return Response.json({
      job_id: jobRecord.id,
      owner_email: jobRecord.owner_email,
      status: jobRecord.status,
      selected_images_count: selectedUrls.length,
      selected_characters_count: selectedCharIds.length,
      clips_generated: clipResults.length,
      clips_with_diagnostics: clipResults.filter(c => c.veo_diagnostics).length,
      diagnostic_message: 'See console logs for full trace',
    });
  } catch (error) {
    console.error('[diagnosticReelGenerationPipeline] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});