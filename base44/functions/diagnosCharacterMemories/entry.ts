import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch all characters owned by current user
  const chars = await base44.entities.Character.filter({ owner_email: user.email }, '-created_date', 50);

  // Only return characters that have at least some data to show, plus always include Ethan
  const results = chars.map(c => {
    const memories = c.memories || [];
    return {
      id: c.id,
      name: c.name,
      memories_count: memories.length,
      first_5: memories.slice(0, 5).map(m => ({
        title: m.title || null,
        description: m.description ? m.description.substring(0, 60) : null,
        category: m.category || null,
        emotional_impact: m.emotional_impact ? m.emotional_impact.substring(0, 40) : null,
        lesson_learned: m.lesson_learned ? m.lesson_learned.substring(0, 40) : null,
      })),
    };
  });

  // Sort: characters WITH memories first
  results.sort((a, b) => b.memories_count - a.memories_count);

  return Response.json({
    total_characters: chars.length,
    with_memories: results.filter(r => r.memories_count > 0).length,
    without_memories: results.filter(r => r.memories_count === 0).length,
    // Only return top 6 (those with memories, or first 6 if none have any)
    results: results.slice(0, 6),
  });
});