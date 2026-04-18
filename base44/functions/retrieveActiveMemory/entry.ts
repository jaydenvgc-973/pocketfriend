import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Smart memory retrieval: fetches ALL memories for a character and returns
// the most contextually relevant ones for the current conversation turn.
// This ensures stored/archived memories are NEVER silently dropped — they
// remain active long-term memory the character can think with.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, currentMessage, recentMessages = [], topK = 12 } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    // Fetch ALL memories for this character (up to 500 — full long-term store)
    const allMemories = await base44.entities.Memory.filter(
      { character_id: characterId },
      '-timestamp',
      500
    );

    if (allMemories.length === 0) {
      return Response.json({ memories: [], total: 0 });
    }

    // Build context string from current message + recent messages
    const contextText = [
      currentMessage || '',
      ...recentMessages.slice(-6).map(m => m.content || ''),
    ].filter(Boolean).join(' ').toLowerCase();

    // Score each memory by keyword overlap with current context
    // This ensures relevant memories from ANY point in history surface — not just recent
    const scored = allMemories.map(mem => {
      const memText = `${mem.title || ''} ${mem.description || ''} ${mem.emotional_impact || ''}`.toLowerCase();
      const words = contextText.split(/\W+/).filter(w => w.length > 3);
      let score = 0;

      // Keyword overlap scoring
      for (const word of words) {
        if (memText.includes(word)) score += 2;
      }

      // Recency bonus (more recent = slightly higher base score)
      const ageDays = mem.timestamp
        ? (Date.now() - new Date(mem.timestamp).getTime()) / (1000 * 60 * 60 * 24)
        : 999;
      if (ageDays < 1) score += 5;
      else if (ageDays < 7) score += 3;
      else if (ageDays < 30) score += 1;

      // Boost emotionally significant memories
      const highImpactWords = ['love', 'hurt', 'angry', 'happy', 'sad', 'excited', 'crying', 'kiss', 'fight', 'argument', 'promise', 'secret', 'miss', 'hate', 'family', 'death', 'lost', 'proud', 'scared', 'afraid'];
      for (const hw of highImpactWords) {
        if (memText.includes(hw)) score += 1;
      }

      // Boost relationship/family memories when those topics come up
      if (/family|mom|dad|kids|daughter|son|brother|sister|parent|child/i.test(contextText)) {
        if (/family|mom|dad|kids|daughter|son|brother|sister|parent|child/i.test(memText)) score += 4;
      }
      if (/relationship|romantic|love|dating|together|couple/i.test(contextText)) {
        if (/relationship|romantic|love|dating|together|couple/i.test(memText)) score += 4;
      }
      if (/remember|recall|told|said|talked|mentioned|asked|promised/i.test(contextText)) {
        // User is asking about past — boost ALL memories slightly
        score += 2;
      }

      return { ...mem, _score: score };
    });

    // Sort by score desc, then recency for ties
    scored.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });

    // Always include: top scored + always include the most recent 3 regardless of score
    const topScored = scored.slice(0, topK - 3);
    const mostRecent = allMemories.slice(0, 3);
    const combined = [...topScored];
    for (const mem of mostRecent) {
      if (!combined.find(m => m.id === mem.id)) combined.push(mem);
    }

    const result = combined.slice(0, topK).map(m => ({
      id: m.id,
      title: m.title,
      description: m.description,
      emotional_impact: m.emotional_impact,
      timestamp: m.timestamp,
      source_context: m.source_context,
      _score: m._score,
    }));

    return Response.json({
      memories: result,
      total: allMemories.length,
      retrieved: result.length,
    });

  } catch (error) {
    console.error('retrieveActiveMemory error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});