import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Truncate text to 3-5 sentences
function truncateToSentences(text, minSentences = 3, maxSentences = 5) {
  if (!text) return text;
  
  // Split by sentence-ending punctuation
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length === 0) return text;
  
  // Take up to maxSentences sentences
  const truncated = sentences.slice(0, maxSentences).join('').trim();
  
  // Ensure we have at least minSentences or return what we have
  const sentenceCount = (truncated.match(/[.!?]/g) || []).length;
  return sentenceCount >= minSentences ? truncated : text;
}

// Remove excessive em-dashes and AI-like punctuation patterns
function cleanPunctuation(text) {
  if (!text) return text;
  
  // Replace em-dashes used as dramatic pauses with periods or commas
  text = text.replace(/\s*—\s*/g, '. ');
  
  // Clean up multiple spaces
  text = text.replace(/\s+/g, ' ');
  
  // Remove trailing spaces before punctuation
  text = text.replace(/\s+([.!?])/g, '$1');
  
  return text.trim();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all characters for this user
    const characters = await base44.entities.Character.filter({
      owner_email: user.email
    });

    const updated = [];
    const skipped = [];

    for (const char of characters) {
      // Skip if profile_summary already exists
      if (char.profile_summary) {
        skipped.push(char.id);
        continue;
      }

      // Derive profile_summary from available fields
      let summary = null;
      
      if (char.personality_summary) {
        summary = char.personality_summary;
      } else if (char.current_situation) {
        summary = char.current_situation;
      } else if (char.background_story) {
        summary = char.background_story;
      } else if (char.backstory) {
        summary = char.backstory;
      } else {
        // Fallback: create a basic summary from name and basic info
        const age = char.age ? ` ${char.age} years old` : '';
        const location = char.city ? ` from ${char.city}` : '';
        summary = `${char.name}${age}${location}.`;
      }

      // Clean punctuation and truncate to 3-5 sentences
      summary = cleanPunctuation(summary);
      summary = truncateToSentences(summary, 3, 5);

      // Update character with the derived summary
      await base44.entities.Character.update(char.id, {
        profile_summary: summary
      });

      updated.push({
        id: char.id,
        name: char.name,
        source: char.personality_summary
          ? 'personality_summary'
          : char.current_situation
          ? 'current_situation'
          : char.background_story
          ? 'background_story'
          : char.backstory
          ? 'backstory'
          : 'generated'
      });
    }

    return Response.json({
      success: true,
      updated: updated.length,
      skipped: skipped.length,
      details: {
        updated,
        skipped_count: skipped.length
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});