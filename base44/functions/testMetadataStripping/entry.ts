/**
 * testMetadataStripping — v2
 *
 * CORRECTED test that applies the SAME regex as the MediaGallery modal.
 * Scans real messages for ALL leak types including character assignment lines.
 *
 * Tests ALL patterns:
 *   - [NAME REFERENCE KEY ...]
 *   - [END NAME REFERENCE KEY]
 *   - [CHARACTER ID ...]
 *   - (ID: hex) references
 *   - "Name" = Full Name ... assignment lines (was NOT checked in v1 — false negatives)
 *   - [IDENTITY LOCK ...]
 *   - [PROVIDER INSTRUCTION ...]
 *
 * Reports:
 *   - all leaky messages found (up to 10)
 *   - total count of each leak type
 *   - cleaned vs raw comparison per sample
 *   - whether cleaning is truly sufficient
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

    // ALL leak patterns — INCLUDING the assignment line that v1 missed
    const LEAK_PATTERNS = [
      { name: 'NAME_REFERENCE_KEY_block',    pattern: /\[NAME REFERENCE KEY[^\]]*?\]/i },
      { name: 'END_NAME_REFERENCE_KEY',      pattern: /\[END NAME REFERENCE KEY\]/i },
      { name: 'REFERENCE_KEY_block',         pattern: /\[REFERENCE KEY[^\]]*?\]/i },
      { name: 'CHARACTER_ID_block',          pattern: /\[CHARACTER ID[^\]]*?\]/i },
      { name: 'IDENTITY_LOCK_block',         pattern: /\[IDENTITY LOCK[^\]]*?\]/i },
      { name: 'PROVIDER_INSTRUCTION_block',  pattern: /\[PROVIDER INSTRUCTION[^\]]*?\]/i },
      { name: 'hex_ID_reference',            pattern: /\(ID:\s*[a-z0-9]{10,}\)/i },
      // THE CRITICAL ONE v1 MISSED:
      { name: 'character_assignment_line',   pattern: /^\s*"[^"]*"\s*=\s*.+\u2014.+$/m },
    ];

    // The canonical stripInternalMetadata — MUST MATCH the MediaGallery modal exactly
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
        // Character assignment lines: "Name" = Full Name — description
        .replace(/^\s*"[^"]*"\s*=\s*[^\n]*$/gm, '')
        .replace(/\n\n+/g, '\n\n')
        .replace(/^\s+|\s+$/gm, '')
        .trim();
    };

    // Get conversations
    const conversations = await base44.asServiceRole.entities.Conversation.filter(
      { created_by: ownerEmail },
      '-created_date',
      500
    );
    const conversationIds = conversations.map(c => c.id).filter(Boolean);
    console.log(`[testMetadataStripping] v2 — scanning ${conversationIds.length} conversations`);

    const leakCountsByPattern = {};
    LEAK_PATTERNS.forEach(lp => { leakCountsByPattern[lp.name] = 0; });
    
    let totalImagesScanned = 0;
    let totalImagesWithAnyLeak = 0;
    let totalImagesStillLeakyAfterCleaning = 0;
    const leakySamples = [];

    const batchSize = 200;
    let offset = 0;
    let done = false;

    while (!done && offset < 10000) {
      const messages = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: { $in: conversationIds } },
        '-created_date',
        batchSize,
        offset
      );

      if (!messages || messages.length === 0) { done = true; break; }

      for (const m of messages) {
        if (!m.image_url) continue;
        if (m.recovery_signal === true) continue;

        totalImagesScanned++;
        const gc = m.generation_context || {};
        const rawPrompt = gc.original_raw_prompt || gc.scene_prompt || m.image_description || '';
        if (!rawPrompt) continue;

        // Check each pattern
        const leaksFound = [];
        LEAK_PATTERNS.forEach(lp => {
          if (lp.pattern.test(rawPrompt)) {
            leakCountsByPattern[lp.name]++;
            leaksFound.push(lp.name);
          }
        });

        if (leaksFound.length > 0) {
          totalImagesWithAnyLeak++;
          const cleaned = stripInternalMetadata(rawPrompt);
          const stillLeaky = LEAK_PATTERNS.some(lp => lp.pattern.test(cleaned));
          if (stillLeaky) totalImagesStillLeakyAfterCleaning++;

          if (leakySamples.length < 5) {
            const remainingLeaks = LEAK_PATTERNS.filter(lp => lp.pattern.test(cleaned)).map(lp => lp.name);
            leakySamples.push({
              message_id: m.id,
              leaks_in_raw: leaksFound,
              raw_sample: rawPrompt.substring(0, 300),
              cleaned_sample: cleaned.substring(0, 300),
              still_leaky_after_cleaning: stillLeaky,
              remaining_leaks: remainingLeaks,
            });
          }
        }
      }

      offset += batchSize;
      if (messages.length < batchSize) done = true;
    }

    const cleaningIsComplete = totalImagesStillLeakyAfterCleaning === 0;

    return Response.json({
      scan_date: new Date().toISOString(),
      total_images_scanned: totalImagesScanned,
      total_images_with_any_leak: totalImagesWithAnyLeak,
      total_images_still_leaky_after_cleaning: totalImagesStillLeakyAfterCleaning,
      leak_rate_percent: totalImagesScanned > 0 
        ? ((totalImagesWithAnyLeak / totalImagesScanned) * 100).toFixed(1) 
        : 0,
      cleaning_verdict: cleaningIsComplete 
        ? 'CLEANING_COMPLETE — no leaks survive the stripping function' 
        : `CLEANING_INCOMPLETE — ${totalImagesStillLeakyAfterCleaning} images still leak after stripping`,
      leak_counts_by_pattern: leakCountsByPattern,
      leaky_samples: leakySamples,
      note_on_v1_failure: 'v1 did NOT check character_assignment_line pattern ("Name" = Full Name — desc), causing false negatives. v2 tests all patterns including this one.',
    });

  } catch (error) {
    console.error('[testMetadataStripping] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});