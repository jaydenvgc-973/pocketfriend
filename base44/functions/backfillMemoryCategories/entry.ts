import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Exact preset titles and their canonical category.
// Source of truth: matches MEMORY_PRESETS in CreateCharacter.jsx and EditCharacterEmotions.jsx
const PRESET_CATEGORY_MAP = {
  // challenges
  "first heartbreak": "challenges",
  "a betrayal by someone close": "challenges",
  "a moment they lost control": "challenges",
  "a loss they haven't fully processed": "challenges",
  "a time they felt rejected or overlooked": "challenges",
  "a period where everything felt uncertain": "challenges",
  // positive
  "a moment they felt truly loved": "positive",
  "a time they were proud of themselves": "positive",
  "a meaningful friendship they still value": "positive",
  "a time they helped someone and it mattered": "positive",
  "a moment of joy they still remember clearly": "positive",
  "a goal they worked hard to achieve": "positive",
  "a place or experience that made them feel alive": "positive",
  "a time they felt at peace with themselves": "positive",
  // growth
  "they learned from a mistake and changed": "growth",
  "they grew stronger after a difficult time": "growth",
  "they rebuilt something after losing it": "growth",
  "they developed better coping skills": "growth",
  "they became more confident over time": "growth",
  "they are learning to trust again": "growth",
  "they are working on becoming better": "growth",
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Fetch all active characters for this user (owner_email scoped)
    const characters = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      200
    );

    let totalCharsScanned = 0;
    let totalCharsUpdated = 0;
    let totalMemoriesTagged = 0;
    const report = [];

    for (const char of characters) {
      totalCharsScanned++;
      const memories = char.memories;
      if (!Array.isArray(memories) || memories.length === 0) continue;

      let changed = false;
      const updatedMemories = memories.map(mem => {
        // Already has a valid category — leave it untouched
        if (mem.category && ['challenges', 'positive', 'growth'].includes(mem.category)) {
          return mem;
        }
        // Try to match by normalized title
        const normalized = (mem.title || '').trim().toLowerCase();
        const inferredCategory = PRESET_CATEGORY_MAP[normalized];
        if (inferredCategory) {
          changed = true;
          totalMemoriesTagged++;
          return { ...mem, category: inferredCategory };
        }
        // Cannot safely infer — leave uncategorized (no category field = uncategorized in UI)
        return mem;
      });

      if (changed) {
        await base44.asServiceRole.entities.Character.update(char.id, { memories: updatedMemories });
        totalCharsUpdated++;
        report.push({
          id: char.id,
          name: char.name,
          memoriesTagged: updatedMemories.filter(m => m.category).length,
        });
      }
    }

    return Response.json({
      success: true,
      totalCharsScanned,
      totalCharsUpdated,
      totalMemoriesTagged,
      report,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});