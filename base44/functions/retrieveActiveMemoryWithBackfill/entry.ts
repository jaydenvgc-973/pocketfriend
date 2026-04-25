import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Retrieve active memory INCLUDING backfilled narratives.
 * Called before character response to inject timeline context.
 * Prioritizes recently backfilled events for continuity.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      characterId,
      currentMessage,
      recentMessages = [],
      topK = 14,
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // ── 1. GET EXPLICIT MEMORIES ──────────────────────────────────────────
    const memories = await base44.entities.Memory.filter(
      { character_id: characterId },
      '-timestamp',
      topK
    ).catch(() => []);

    // ── 2. GET RECENT BACKFILLED NARRATIVES ───────────────────────────────
    // Include narratives marked as backfill (triggered_by: 'backfill')
    // These should appear first in memory context for continuity
    const backfilledNarratives = await base44.entities.CharacterAutomaticNarrative.filter(
      { character_id: characterId, triggered_by: 'backfill' },
      '-timestamp',
      5 // Last 5 backfilled events
    ).catch(() => []);

    // Convert backfilled narratives to memory-like format for injection
    const backfillMemories = backfilledNarratives.map(n => ({
      title: `[Timeline] ${n.time_of_day}`,
      description: n.narrative_text,
      memory_type: 'timeline',
      timestamp: n.timestamp,
      source: 'automatic_backfill',
    }));

    // ── 3. GET RECENT AUTOMATIC NARRATIVES (non-backfill) ──────────────────
    // Standard automatic narratives (not backfill) provide context too
    const autoNarratives = await base44.entities.CharacterAutomaticNarrative.filter(
      { character_id: characterId },
      '-timestamp',
      3 // Last 3 non-backfill automatic narratives
    ).catch(() => []);

    const autoMemories = autoNarratives.filter(n => n.triggered_by !== 'backfill').map(n => ({
      title: `[Timeline] ${n.time_of_day}`,
      description: n.narrative_text,
      memory_type: 'timeline',
      timestamp: n.timestamp,
      source: 'automatic_narrative',
    }));

    // ── 4. MERGE AND PRIORITIZE ───────────────────────────────────────────
    // Order: backfilled events first (most recent continuity), then explicit memories, then auto narratives
    const allMemories = [
      ...backfillMemories,
      ...memories.map(m => ({
        title: m.title,
        description: m.description,
        memory_type: m.memory_type,
        timestamp: m.timestamp,
        source: 'explicit_memory',
      })),
      ...autoMemories,
    ];

    // Deduplicate by description to avoid repetition
    const seen = new Set();
    const dedupedMemories = allMemories.filter(m => {
      if (seen.has(m.description)) return false;
      seen.add(m.description);
      return true;
    }).slice(0, topK); // Keep only top K

    console.log(`[retrieveActiveMemoryWithBackfill] ${characterId}: ${dedupedMemories.length} total (${backfillMemories.length} backfill, ${memories.length} explicit, ${autoMemories.length} auto)`);

    return Response.json({
      success: true,
      memories: dedupedMemories,
      total: dedupedMemories.length,
      backfillCount: backfillMemories.length,
      explicitCount: memories.length,
      autoCount: autoMemories.length,
    });

  } catch (error) {
    console.error('[retrieveActiveMemoryWithBackfill] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});