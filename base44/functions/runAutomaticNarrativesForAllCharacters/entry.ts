import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This is a scheduled function — runs independently, no user context needed
    // Uses service role to access all active characters
    
    console.log(`[runAutomaticNarrativesForAllCharacters] ▶ Starting automated narrative generation run`);

    // ── FETCH ALL ACTIVE CREATED CHARACTERS ────────────────────────────────
    // Only active created characters get automatic narratives
    const characters = await base44.asServiceRole.entities.Character.filter({
      status: 'active',
      character_type: 'active_created_character',
    }, '-updated_date', 200);

    console.log(`[runAutomaticNarrativesForAllCharacters] Found ${characters.length} active characters to process`);

    const results = {
      total: characters.length,
      generated: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };

    // ── PROCESS EACH CHARACTER ────────────────────────────────────────────
    for (const character of characters) {
      try {
        const res = await base44.asServiceRole.functions.invoke('generateAutomaticNarrative', {
          characterId: character.id,
          forceGenerate: false,
        });

        if (res?.data?.success) {
          results.generated++;
          results.details.push({
            characterId: character.id,
            characterName: character.name,
            status: 'generated',
            narrativeId: res.data.narrativeId,
          });
        } else if (res?.data?.skipped) {
          results.skipped++;
          results.details.push({
            characterId: character.id,
            characterName: character.name,
            status: 'skipped',
            reason: res.data.reason,
          });
        } else {
          results.errors++;
          results.details.push({
            characterId: character.id,
            characterName: character.name,
            status: 'error',
            error: res?.data?.error || 'Unknown error',
          });
        }
      } catch (err) {
        results.errors++;
        results.details.push({
          characterId: character.id,
          characterName: character.name,
          status: 'error',
          error: err.message,
        });
        console.error(`[runAutomaticNarrativesForAllCharacters] Error for ${character.name}: ${err.message}`);
      }
    }

    console.log(`[runAutomaticNarrativesForAllCharacters] ✓ Complete: ${results.generated} generated, ${results.skipped} skipped, ${results.errors} errors`);

    return Response.json({
      success: true,
      results,
    });

  } catch (error) {
    console.error('[runAutomaticNarrativesForAllCharacters] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});