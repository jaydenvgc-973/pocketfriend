import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * cleanStoryEventNarrativeHeaders
 *
 * Strips the "[Story Event: Title — Date at Venue]" header prefix from
 * existing narrative Message records. Narratives should read as natural
 * character inner monologue — not as system-injected metadata blocks.
 *
 * This is a one-time cleanup for messages that were injected with the
 * header before the generateStoryEvent function was fixed to omit it.
 *
 * Safety guarantees:
 *   - Only updates messages where is_narrative=true AND content starts with "[Story Event:"
 *   - Strips the header, preserving the memory_text body
 *   - Never deletes messages — only updates the content field
 *   - Returns a count of fixed messages for audit
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default to dry run for safety

    // ── HEADER STRIPPING LOGIC ──────────────────────────────────────────────
    // The header format is: [Story Event: <title> — <date> at <venue>] <memory_text>
    // We strip the bracketed prefix and any leading whitespace, preserving the rest.
    function stripStoryEventHeader(content) {
      if (!content || typeof content !== 'string') return content;
      const headerPattern = /^\[Story Event:\s+[^\]]+\]\s*/;
      return content.replace(headerPattern, '').trim();
    }

    // Fetch narrative messages in batches
    let allNarrativeMessages = [];
    let skip = 0;
    const batchSize = 100;
    let hasMore = true;

    while (hasMore) {
      const batch = await base44.asServiceRole.entities.Message.filter(
        { is_narrative: true },
        '-created_date',
        batchSize,
        skip
      ).catch(() => []);

      if (!batch || batch.length === 0) {
        hasMore = false;
        break;
      }

      allNarrativeMessages = allNarrativeMessages.concat(batch);
      skip += batch.length;

      if (batch.length < batchSize) {
        hasMore = false;
      }
    }

    if (allNarrativeMessages.length === 0) {
      return Response.json({
        success: true,
        message: 'No narrative messages found',
        total_narrative: 0,
        messages_with_header: 0,
        fixed: 0,
      });
    }

    // Filter to messages that actually have the [Story Event:] header
    const messagesToFix = allNarrativeMessages.filter(m =>
      m.content && typeof m.content === 'string' && m.content.startsWith('[Story Event:')
    );

    if (messagesToFix.length === 0) {
      return Response.json({
        success: true,
        message: 'No messages with [Story Event:] header found',
        total_narrative: allNarrativeMessages.length,
        messages_with_header: 0,
        fixed: 0,
      });
    }

    // Dry run — just report what would be fixed
    if (dryRun) {
      return Response.json({
        success: true,
        dry_run: true,
        total_narrative: allNarrativeMessages.length,
        messages_with_header: messagesToFix.length,
        would_fix: messagesToFix.slice(0, 10).map(m => ({
          id: m.id,
          conversation_id: m.conversation_id,
          character_name: m.character_name,
          old_preview: m.content.substring(0, 80),
          new_preview: stripStoryEventHeader(m.content).substring(0, 80),
        })),
      });
    }

    // ── LIVE RUN — strip headers from each message ────────────────────────────
    let fixed = 0;
    let failed = 0;
    const details = [];

    for (const msg of messagesToFix) {
      try {
        const cleanedContent = stripStoryEventHeader(msg.content);
        if (cleanedContent && cleanedContent !== msg.content) {
          await base44.asServiceRole.entities.Message.update(msg.id, {
            content: cleanedContent,
          });
          fixed++;
          if (details.length < 20) {
            details.push({
              id: msg.id,
              conversation_id: msg.conversation_id,
              character_name: msg.character_name,
              old_preview: msg.content.substring(0, 80),
              new_preview: cleanedContent.substring(0, 80),
            });
          }
        }
      } catch (e) {
        failed++;
      }
    }

    return Response.json({
      success: true,
      total_narrative: allNarrativeMessages.length,
      messages_with_header: messagesToFix.length,
      fixed,
      failed,
      details,
    });
  } catch (error) {
    console.error('[cleanStoryEventNarrativeHeaders]', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});