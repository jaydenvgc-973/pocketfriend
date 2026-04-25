import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, currentMessage, recentMessages = [], topK = 12 } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    console.log(`[retrieveMemoryWithBackfill] Starting fresh deployment`);

    // ── 1. FETCH BACKFILLED NARRATIVES ────────────────────────────────────
    let backfilledNarratives = [];
    try {
      console.log(`[retrieveMemoryWithBackfill] Querying CharacterAutomaticNarrative for char=${characterId}`);
      const allAutoNarratives = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
        { character_id: characterId },
        '-timestamp',
        50
      ).catch((err) => {
        console.error(`[retrieveMemoryWithBackfill] Query catch error: ${err?.message || err}`);
        return [];
      });
      console.log(`[retrieveMemoryWithBackfill] Query returned ${allAutoNarratives.length} records`);
      backfilledNarratives = allAutoNarratives.filter(n => n.triggered_by === 'backfill');
      console.log(`[retrieveMemoryWithBackfill] Filtered to backfilled: ${backfilledNarratives.length}`);
      if (backfilledNarratives.length > 0) {
        console.log(`[retrieveMemoryWithBackfill] First backfill: "${backfilledNarratives[0].narrative_text?.substring(0, 60)}..."`);
      }
    } catch (err) {
      console.error(`[retrieveMemoryWithBackfill] Outer catch - Backfill error: ${err?.message || err}`);
    }

    // Convert to memory format (highest priority)
    const backfillMemories = backfilledNarratives.map(n => ({
      id: n.id,
      title: `[Timeline: ${n.time_of_day || 'Missed Time'}]`,
      description: n.narrative_text,
      emotional_impact: 'Continuity of timeline',
      timestamp: n.timestamp,
      source_context: 'automatic_backfill',
      _score: 10,
    }));

    // ── 2. FETCH ALL EXPLICIT MEMORIES ────────────────────────────────────
    const allMemories = await base44.entities.Memory.filter(
      { character_id: characterId },
      '-timestamp',
      500
    );

    // ── 3. COMBINE ────────────────────────────────────────────────────────
    const combinedWithBackfill = [...backfillMemories, ...allMemories];
    console.log(`[retrieveMemoryWithBackfill] Total combined: ${combinedWithBackfill.length} (${backfillMemories.length} backfill + ${allMemories.length} explicit)`);

    if (combinedWithBackfill.length === 0) {
      return Response.json({ memories: [], total: 0, backfillCount: 0 });
    }

    // Build context string
    const contextText = [
      currentMessage || '',
      ...recentMessages.slice(-6).map(m => m.content || ''),
    ].filter(Boolean).join(' ').toLowerCase();

    // Score each memory
    const scored = combinedWithBackfill.map(mem => {
      const memText = `${mem.title || ''} ${mem.description || ''} ${mem.emotional_impact || ''}`.toLowerCase();
      const words = contextText.split(/\W+/).filter(w => w.length > 3);
      let score = mem._score || 0; // Use preset score if available

      // Keyword overlap
      for (const word of words) {
        if (memText.includes(word)) score += 2;
      }

      // Recency bonus
      const ageDays = mem.timestamp
        ? (Date.now() - new Date(mem.timestamp).getTime()) / (1000 * 60 * 60 * 24)
        : 999;
      if (ageDays < 1) score += 5;
      else if (ageDays < 7) score += 3;
      else if (ageDays < 30) score += 1;

      // High impact words
      const highImpactWords = ['love', 'hurt', 'angry', 'happy', 'sad', 'excited', 'crying', 'kiss', 'fight', 'argument', 'promise', 'secret', 'miss', 'hate', 'family', 'death', 'lost', 'proud', 'scared'];
      for (const hw of highImpactWords) {
        if (memText.includes(hw)) score += 1;
      }

      return { ...mem, _score: score };
    });

    // Sort by score
    scored.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });

    // Get top K
    const result = scored.slice(0, topK).map(m => ({
      id: m.id,
      title: m.title,
      description: m.description,
      emotional_impact: m.emotional_impact,
      timestamp: m.timestamp,
      source_context: m.source_context,
      _score: m._score,
    }));

    console.log(`[retrieveMemoryWithBackfill] Returning ${result.length} (${backfillMemories.filter(m => result.find(r => r.id === m.id)).length} are backfilled)`);

    return Response.json({
      memories: result,
      total: combinedWithBackfill.length,
      retrieved: result.length,
      backfillCount: backfilledNarratives.length,
    });

  } catch (error) {
    console.error('[retrieveMemoryWithBackfill] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});