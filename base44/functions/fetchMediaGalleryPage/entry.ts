/**
 * fetchMediaGalleryPage
 *
 * TRUE image-level pagination for Media Gallery.
 *
 * Problem this solves:
 *   Frontend .list() with skip skips RAW messages, not image records.
 *   If page 1 found 20 images within the first 100 messages, page 2 must
 *   continue scanning from message offset 100+, not from image offset 20.
 *   The frontend cannot know that offset. Only the backend can track it.
 *
 * Algorithm:
 *   1. Accept rawCursor = the raw message offset to start scanning from (0 for page 1).
 *   2. Fetch messages in batches of BATCH_SIZE ordered by -timestamp.
 *   3. Filter each batch for messages with image_url.
 *   4. Collect until PAGE_SIZE images found or no more messages.
 *   5. Return the images + the new rawCursor for the next page.
 *
 * Ownership: scoped by user session (RLS). No created_by. No character filter.
 * All channels included: chat, text, world phone, scene, media grid.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PAGE_SIZE = 20;
const BATCH_SIZE = 100;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rawCursor = 0, searchTerm = '' } = await req.json();
    const searchLower = searchTerm.toLowerCase();

    console.log(`[fetchMediaGalleryPage] user=${user.email} rawCursor=${rawCursor} search="${searchTerm}"`);

    const collected = [];
    const seenUrls = new Set();
    let currentOffset = rawCursor;
    let totalRawScanned = 0;
    let totalExcluded = 0;
    let exhausted = false;

    // Keep scanning batches until we have PAGE_SIZE images or run out of messages
    while (collected.length < PAGE_SIZE) {
      console.log(`[fetchMediaGalleryPage] Fetching batch at offset=${currentOffset}`);

      const batch = await base44.entities.Message.list('-timestamp', BATCH_SIZE, currentOffset);

      if (!batch || batch.length === 0) {
        console.log(`[fetchMediaGalleryPage] No more messages at offset=${currentOffset} — exhausted`);
        exhausted = true;
        break;
      }

      totalRawScanned += batch.length;
      console.log(`[fetchMediaGalleryPage] Batch: ${batch.length} raw messages scanned`);

      for (const m of batch) {
        // Must have image_url
        if (!m.image_url) {
          totalExcluded++;
          continue;
        }

        // Deduplicate by URL
        if (seenUrls.has(m.image_url)) {
          console.log(`[fetchMediaGalleryPage] EXCLUDED duplicate url: ${m.image_url.substring(0, 60)}`);
          totalExcluded++;
          continue;
        }
        seenUrls.add(m.image_url);

        // Apply search filter
        if (searchTerm) {
          const desc = (m.image_description || m.content || '').toLowerCase();
          const name = (m.character_name || '').toLowerCase();
          if (!desc.includes(searchLower) && !name.includes(searchLower)) {
            console.log(`[fetchMediaGalleryPage] EXCLUDED search mismatch: msg=${m.id}`);
            totalExcluded++;
            continue;
          }
        }

        collected.push({
          id: m.id,
          url: m.image_url,
          description: m.image_description || m.content?.slice(0, 100) || 'Image',
          senderType: m.sender_type,
          senderName: m.character_name || 'You',
          characterId: m.character_id,
          conversationId: m.conversation_id,
          timestamp: m.timestamp || m.created_date,
          messageId: m.id,
        });

        if (collected.length >= PAGE_SIZE) break;
      }

      // Advance raw cursor by how many raw messages we scanned in this batch
      currentOffset += batch.length;

      // If batch was smaller than BATCH_SIZE, there are no more messages
      if (batch.length < BATCH_SIZE) {
        console.log(`[fetchMediaGalleryPage] Batch smaller than BATCH_SIZE (${batch.length} < ${BATCH_SIZE}) — exhausted`);
        exhausted = true;
        break;
      }
    }

    const nextRawCursor = exhausted ? null : currentOffset;
    const hasMore = !exhausted && collected.length === PAGE_SIZE;

    console.log(`[fetchMediaGalleryPage] PROOF LOG:`);
    console.log(`  source: Message entity (all channels, user-scoped by RLS)`);
    console.log(`  raw records scanned: ${totalRawScanned}`);
    console.log(`  valid images found: ${collected.length}`);
    console.log(`  excluded records: ${totalExcluded}`);
    console.log(`  returned image count: ${collected.length}`);
    console.log(`  next rawCursor: ${nextRawCursor}`);
    console.log(`  hasMore: ${hasMore}`);
    console.log(`  exhausted: ${exhausted}`);

    return Response.json({
      images: collected,
      nextRawCursor,
      hasMore,
      proof: {
        rawScanned: totalRawScanned,
        validFound: collected.length,
        excluded: totalExcluded,
        nextRawCursor,
        hasMore,
        exhausted,
      }
    });

  } catch (error) {
    console.error('[fetchMediaGalleryPage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});