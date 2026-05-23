/**
 * testMetadataStripping
 *
 * Fetch an image with metadata leak and show:
 * 1. Raw display prompt (from backend)
 * 2. After stripInternalMetadata function
 * 3. Whether cleaning is sufficient
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;

    // Get conversations
    const conversations = await base44.asServiceRole.entities.Conversation.filter(
      { created_by: ownerEmail },
      '-created_date',
      500
    );
    const conversationIds = conversations.map(c => c.id).filter(Boolean);

    // Find a message with metadata leak
    let leakyMessage = null;
    const batchSize = 200;
    for (let offset = 0; offset < 3000; offset += batchSize) {
      const messages = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: { $in: conversationIds } },
        '-created_date',
        batchSize,
        offset
      );

      if (!messages || messages.length === 0) break;

      leakyMessage = messages.find(m => 
        m.image_url && (
          (m.generation_context?.original_raw_prompt || '').includes('[NAME REFERENCE KEY') ||
          (m.generation_context?.scene_prompt || '').includes('[CHARACTER ID') ||
          /(ID:\s*[a-z0-9]+)/i.test(m.generation_context?.original_raw_prompt || '')
        )
      );

      if (leakyMessage) break;
    }

    if (!leakyMessage) {
      return Response.json({ error: 'No image with metadata leak found in first 3000 messages' }, { status: 400 });
    }

    const rawPrompt = leakyMessage.generation_context?.original_raw_prompt || leakyMessage.generation_context?.scene_prompt || '';

    // Apply the stripInternalMetadata function logic
    const stripInternalMetadata = (text) => {
      if (!text) return text;
      return text
        .replace(/\[NAME REFERENCE KEY[^\]]*?\]/g, '')
        .replace(/\[END NAME REFERENCE KEY\]/g, '')
        .replace(/\[REFERENCE KEY[^\]]*?\]/g, '')
        .replace(/\[END REFERENCE KEY\]/g, '')
        .replace(/\[CHARACTER ID[^\]]*?\]/g, '')
        .replace(/\[IDENTITY LOCK[^\]]*?\]/g, '')
        .replace(/\[PROVIDER INSTRUCTION[^\]]*?\]/g, '')
        .replace(/\(ID:\s*[a-z0-9]+\)/gi, '')
        .replace(/\n\n+/g, '\n\n')
        .trim();
    };

    const cleanedPrompt = stripInternalMetadata(rawPrompt);

    // Check if cleaning was sufficient
    const metadataPatterns = [
      /\[NAME REFERENCE KEY/i,
      /\[REFERENCE KEY/i,
      /\[CHARACTER ID/i,
      /\[IDENTITY LOCK/i,
      /\[PROVIDER INSTRUCTION/i,
      /\(ID:\s*[a-z0-9]+\)/i,
    ];

    const stillLeaky = metadataPatterns.some(p => p.test(cleanedPrompt));

    return Response.json({
      message_id: leakyMessage.id,
      raw_prompt_length: rawPrompt.length,
      raw_prompt_sample: rawPrompt.substring(0, 500),
      
      cleaned_prompt_length: cleanedPrompt.length,
      cleaned_prompt_sample: cleanedPrompt.substring(0, 500),
      
      cleaning_result: {
        bytes_removed: rawPrompt.length - cleanedPrompt.length,
        still_contains_metadata: stillLeaky,
        patterns_found_in_raw: metadataPatterns.map(p => ({ pattern: p.source, found: p.test(rawPrompt) })),
        patterns_found_in_cleaned: metadataPatterns.map(p => ({ pattern: p.source, found: p.test(cleanedPrompt) })),
      },

      recommendation: stillLeaky ? 'CLEANING INSUFFICIENT — needs enhancement' : 'CLEANING WORKS',
    });

  } catch (error) {
    console.error('[testMetadataStripping] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});