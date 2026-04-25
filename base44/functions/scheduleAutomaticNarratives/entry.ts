import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Scheduled automation: Generate narratives for all active characters every 30 minutes.
 * Runs on a cron schedule and updates each character's timeline.
 * This is the primary heartbeat that keeps characters "alive" even when user is away.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function runs as service role (no user context)
    // It will process ALL active characters in the system

    console.log(`[scheduleAutomaticNarratives] ▶ Starting batch narrative generation`);

    // ── 1. GET ALL ACTIVE CHARACTERS ──────────────────────────────────────────
    // Fetch all characters with status='active' (not deleted, moved away, or merged)
    const allActiveCharacters = await base44.asServiceRole.entities.Character.filter(
      {
        status: 'active',
        character_type: 'active_created_character',
        is_test_character: false,
        diagnostic_only: false,
      },
      null,
      500 // Fetch up to 500 active characters
    ).catch(err => {
      console.error(`[scheduleAutomaticNarratives] Failed to fetch characters: ${err.message}`);
      return [];
    });

    console.log(`[scheduleAutomaticNarratives] Found ${allActiveCharacters.length} active characters to process`);

    // ── 2. PROCESS EACH CHARACTER ─────────────────────────────────────────────
    const results = {
      total: allActiveCharacters.length,
      generated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const character of allActiveCharacters) {
      try {
        // Call generateAutomaticNarrative for each character
        const res = await base44.asServiceRole.functions.invoke('generateAutomaticNarrative', {
          characterId: character.id,
          trigger: 'scheduled',
          forceGenerate: false,
        }).catch(err => ({ error: err.message, skipped: true }));

        if (res?.success) {
          results.generated++;
          console.log(`[scheduleAutomaticNarratives] ✓ Generated narrative for ${character.name} (${res.eventType})`);
        } else if (res?.skipped) {
          results.skipped++;
          console.log(`[scheduleAutomaticNarratives] ⊘ Skipped ${character.name}: ${res.reason || 'unknown'}`);
        } else {
          results.failed++;
          results.errors.push({
            character_id: character.id,
            character_name: character.name,
            error: res?.error || 'Unknown error',
          });
          console.warn(`[scheduleAutomaticNarratives] ✗ Failed for ${character.name}: ${res?.error}`);
        }
      } catch (charErr) {
        results.failed++;
        results.errors.push({
          character_id: character.id,
          character_name: character.name,
          error: charErr.message,
        });
        console.error(`[scheduleAutomaticNarratives] Exception for ${character.name}:`, charErr.message);
      }
    }

    // ── 3. REPORT SUMMARY ─────────────────────────────────────────────────────
    console.log(`[scheduleAutomaticNarratives] ✓ Batch complete: ${results.generated} generated, ${results.skipped} skipped, ${results.failed} failed`);

    return Response.json({
      success: true,
      summary: results,
      message: `Generated narratives for ${results.generated} active characters`,
    });

  } catch (error) {
    console.error('[scheduleAutomaticNarratives] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});