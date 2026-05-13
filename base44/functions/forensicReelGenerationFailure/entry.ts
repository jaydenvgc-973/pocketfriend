import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FORENSIC: Complete reel generation failure diagnosis
 * Pulls the actual latest ReelGenerationJob and proves every data point in the pipeline
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { job_id } = body;

    console.log(`\n${'═'.repeat(90)}`);
    console.log(`FORENSIC: REEL GENERATION FAILURE DIAGNOSIS`);
    console.log(`User: ${user.email}`);
    console.log(`${'═'.repeat(90)}\n`);

    // ── STEP 1: Fetch the actual ReelGenerationJob ───────────────────────────────
    let job = null;
    
    if (job_id) {
      const jobs = await base44.entities.ReelGenerationJob.filter({ owner_email: user.email });
      job = jobs.find(j => j.id === job_id);
    } else {
      // Auto-fetch latest failed/completed job
      const jobs = await base44.entities.ReelGenerationJob.filter(
        { owner_email: user.email },
        '-updated_at',
        1
      );
      job = jobs[0];
    }

    if (!job) {
      return Response.json({ error: 'No ReelGenerationJob found' }, { status: 404 });
    }

    console.log(`QUESTION 1: Was selected_image_urls[0] the correct source image?`);
    console.log(`${'─'.repeat(90)}`);
    console.log(`Job ID: ${job.id}`);
    console.log(`Job status: ${job.status}`);
    console.log(`selected_image_urls count: ${(job.selected_image_urls || []).length}`);
    if (job.selected_image_urls && job.selected_image_urls.length > 0) {
      console.log(`selected_image_urls[0]: ${job.selected_image_urls[0].slice(-70)}`);
      console.log(`selected_image_urls[0] exists in job record: YES`);
    } else {
      console.log(`selected_image_urls[0]: MISSING OR EMPTY`);
    }
    console.log(``);

    // ── QUESTION 2: Was that URL passed to existing_image_urls[0]? ────────────────
    console.log(`QUESTION 2: Was selected_image_urls[0] passed to existing_image_urls[0]?`);
    console.log(`${'─'.repeat(90)}`);
    const clipResults = job.clip_results || [];
    let existingImagesMatch = true;
    for (let i = 0; i < clipResults.length; i++) {
      const clip = clipResults[i];
      if (clip.veo_diagnostics && clip.veo_diagnostics.existing_image_urls) {
        const urls = clip.veo_diagnostics.existing_image_urls;
        console.log(`Clip ${i + 1}:`);
        console.log(`  clip.image_url: ${clip.image_url ? clip.image_url.slice(-60) : 'NULL'}`);
        console.log(`  existing_image_urls[0]: ${urls[0] ? urls[0].slice(-60) : 'NULL'}`);
        const matches = clip.image_url === urls[0];
        console.log(`  MATCH? ${matches ? 'YES ✓' : 'NO ✗'}`);
        if (!matches) existingImagesMatch = false;
      } else {
        console.log(`Clip ${i + 1}: No veo_diagnostics.existing_image_urls`);
        existingImagesMatch = false;
      }
    }
    console.log(``);

    // ── QUESTION 3: Was selected_character_ids present on job record? ───────────────
    console.log(`QUESTION 3: Was selected_character_ids present on job record?`);
    console.log(`${'─'.repeat(90)}`);
    const selectedCharIds = job.selected_character_ids || [];
    console.log(`selected_character_ids exists? ${job.selected_character_ids ? 'YES' : 'NO'}`);
    console.log(`selected_character_ids count: ${selectedCharIds.length}`);
    if (selectedCharIds.length > 0) {
      for (let i = 0; i < selectedCharIds.length; i++) {
        console.log(`  [${i}]: ${selectedCharIds[i]}`);
      }
    } else {
      console.log(`  EMPTY OR MISSING - CHARACTER IDS NOT STORED ON JOB`);
    }
    console.log(``);

    // ── QUESTION 4: Did messageRecords[imageId].character_id exist? ─────────────────
    console.log(`QUESTION 4: Did messageRecords exist with character_id?`);
    console.log(`${'─'.repeat(90)}`);
    const selectedImageIds = job.selected_image_ids || [];
    const messageCheckResults = [];
    for (let i = 0; i < selectedImageIds.length; i++) {
      const msgId = selectedImageIds[i];
      try {
        const msgs = await base44.entities.Message.filter({ id: msgId });
        if (msgs && msgs.length > 0) {
          const msg = msgs[0];
          console.log(`Message ${i + 1} (${msgId}):`);
          console.log(`  character_id: ${msg.character_id || 'NULL'}`);
          console.log(`  character_name: ${msg.character_name || 'NULL'}`);
          messageCheckResults.push({
            msgId,
            character_id: msg.character_id,
            character_name: msg.character_name,
            found: true,
          });
        } else {
          console.log(`Message ${i + 1} (${msgId}): NOT FOUND`);
          messageCheckResults.push({ msgId, found: false });
        }
      } catch (err) {
        console.log(`Message ${i + 1} (${msgId}): ERROR - ${err.message}`);
        messageCheckResults.push({ msgId, found: false, error: err.message });
      }
    }
    console.log(``);

    // ── QUESTION 5: Did character lookup return the correct character? ─────────────
    console.log(`QUESTION 5: Did character lookup return the correct character?`);
    console.log(`${'─'.repeat(90)}`);
    const charLookupResults = [];
    for (const msgResult of messageCheckResults) {
      if (msgResult.character_id) {
        try {
          const chars = await base44.entities.Character.filter({ owner_email: user.email });
          const char = chars.find(c => c.id === msgResult.character_id);
          if (char) {
            console.log(`Character ${msgResult.character_id}:`);
            console.log(`  name: ${char.name}`);
            console.log(`  gender: ${char.gender || 'NOT SET'}`);
            console.log(`  age/appearance_age: ${char.appearance_age || char.age || 'NOT SET'}`);
            console.log(`  ethnicities: ${char.ethnicities?.join(', ') || 'NOT SET'}`);
            console.log(`  appearance_lock: ${char.appearance_lock ? 'YES' : 'NO'}`);
            charLookupResults.push({
              charId: msgResult.character_id,
              found: true,
              name: char.name,
              gender: char.gender,
            });
          } else {
            console.log(`Character ${msgResult.character_id}: NOT FOUND in user's characters`);
            charLookupResults.push({ charId: msgResult.character_id, found: false });
          }
        } catch (err) {
          console.log(`Character ${msgResult.character_id}: ERROR - ${err.message}`);
          charLookupResults.push({ charId: msgResult.character_id, found: false, error: err.message });
        }
      }
    }
    console.log(``);

    // ── QUESTION 6 & 7: Was avatar_url found and passed as [1]? ──────────────────
    console.log(`QUESTION 6 & 7: Was avatar_url found and passed as existing_image_urls[1]?`);
    console.log(`${'─'.repeat(90)}`);
    for (let i = 0; i < clipResults.length; i++) {
      const clip = clipResults[i];
      console.log(`Clip ${i + 1}:`);
      if (clip.veo_diagnostics) {
        const diag = clip.veo_diagnostics;
        console.log(`  avatar_reference_url: ${diag.avatar_reference_url ? diag.avatar_reference_url.slice(-60) : 'NULL'}`);
        console.log(`  avatar_reference_index_in_payload: ${diag.avatar_reference_index_in_payload}`);
        if (diag.existing_image_urls && diag.existing_image_urls.length > 1) {
          console.log(`  existing_image_urls[1]: ${diag.existing_image_urls[1].slice(-60)}`);
          console.log(`  [1] matches avatar_reference_url? ${diag.existing_image_urls[1] === diag.avatar_reference_url ? 'YES' : 'NO'}`);
        } else if (diag.existing_image_urls && diag.existing_image_urls.length === 1) {
          console.log(`  existing_image_urls.length: 1 (NO AVATAR PASSED)`);
        }
      } else {
        console.log(`  veo_diagnostics: MISSING`);
      }
    }
    console.log(``);

    // ── QUESTION 8: Was clip_url new or stale/cached? ────────────────────────────
    console.log(`QUESTION 8: Was clip_url new or stale/cached?`);
    console.log(`${'─'.repeat(90)}`);
    for (let i = 0; i < clipResults.length; i++) {
      const clip = clipResults[i];
      console.log(`Clip ${i + 1}:`);
      console.log(`  clip_url: ${clip.clip_url ? clip.clip_url.slice(-70) : 'NULL'}`);
      console.log(`  clip_type: ${clip.clip_type}`);
      console.log(`  status: ${clip.status}`);
      if (clip.clip_url) {
        const isVeoUrl = clip.clip_url.includes('veo') || clip.clip_url.includes('video') || clip.clip_url.includes('replicate');
        console.log(`  URL contains veo/video provider markers? ${isVeoUrl ? 'YES' : 'NO'}`);
        console.log(`  URL pattern suggests fresh generation? ${isVeoUrl ? 'LIKELY' : 'UNCLEAR'}`);
      }
    }
    console.log(``);

    // ── QUESTION 9: Did ReelPlayer render clip.image_url or clip.clip_url? ────────
    console.log(`QUESTION 9: What did ReelPlayer render?`);
    console.log(`${'─'.repeat(90)}`);
    console.log(`ReelPlayer behavior:`);
    console.log(`  - For animated clips: shows clip.image_url briefly (200ms), then plays clip.clip_url`);
    console.log(`  - For static clips: renders clip.image_url with CSS animation`);
    for (let i = 0; i < clipResults.length; i++) {
      const clip = clipResults[i];
      console.log(`Clip ${i + 1}:`);
      console.log(`  clip_type: ${clip.clip_type}`);
      if (clip.clip_type === 'animated' && clip.clip_url) {
        console.log(`  → Renders: 200ms of clip.image_url, then plays clip.clip_url`);
      } else {
        console.log(`  → Renders: clip.image_url with CSS motion (3.2s)`);
      }
    }
    console.log(``);

    // ── QUESTION 10: Was deployed function using latest changes? ──────────────────
    console.log(`QUESTION 10: Was deployed function using latest changes?`);
    console.log(`${'─'.repeat(90)}`);
    console.log(`Check log output from processReelGenerationJob execution:`);
    console.log(`  - If console logs show veo_diagnostics.source_image_index_in_payload: 0`);
    console.log(`  - And existing_image_urls[0] matches selected source image`);
    console.log(`  - Then: Function deployed with changes`);
    console.log(`  - If no such logs: Function may be outdated or not executing`);
    console.log(`\nNote: Check browser console and server logs for [Clip N] messages\n`);

    // ── FINAL SUMMARY ────────────────────────────────────────────────────────────
    console.log(`${'═'.repeat(90)}`);
    console.log(`FORENSIC SUMMARY`);
    console.log(`${'═'.repeat(90)}`);
    console.log(`\nCheck results:`);
    console.log(`  1. selected_image_urls[0] present: ${job.selected_image_urls?.length > 0 ? 'YES' : 'NO'}`);
    console.log(`  2. existing_image_urls[0] matches source: ${existingImagesMatch ? 'YES' : 'NO'}`);
    console.log(`  3. selected_character_ids present: ${selectedCharIds.length > 0 ? 'YES' : 'NO'}`);
    console.log(`  4. Message character_id found: ${messageCheckResults.filter(m => m.found && m.character_id).length}/${messageCheckResults.length}`);
    console.log(`  5. Character lookup succeeded: ${charLookupResults.filter(c => c.found).length}/${charLookupResults.length}`);
    console.log(`  6. Avatar references found: ${clipResults.filter(c => c.veo_diagnostics?.avatar_reference_url).length}/${clipResults.length}`);
    console.log(`  7. Avatar passed as [1]: ${clipResults.filter(c => c.veo_diagnostics?.existing_image_urls?.[1]).length}/${clipResults.length}`);
    console.log(`  8. clip_url appears fresh: ${clipResults.filter(c => c.clip_url && (c.clip_url.includes('veo') || c.clip_url.includes('video'))).length}/${clipResults.length}`);
    console.log(`\n${'═'.repeat(90)}\n`);

    return Response.json({
      job_id: job.id,
      job_status: job.status,
      diagnostics: {
        selected_image_urls_present: job.selected_image_urls?.length > 0,
        selected_character_ids_present: selectedCharIds.length > 0,
        existing_images_match_source: existingImagesMatch,
        message_character_ids_found: messageCheckResults.filter(m => m.found && m.character_id).length,
        character_lookups_succeeded: charLookupResults.filter(c => c.found).length,
        avatar_references_found: clipResults.filter(c => c.veo_diagnostics?.avatar_reference_url).length,
        avatars_passed_as_index_1: clipResults.filter(c => c.veo_diagnostics?.existing_image_urls?.[1]).length,
        clip_results_count: clipResults.length,
      },
    });
  } catch (error) {
    console.error('[forensicReelGenerationFailure] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});