/**
 * fetchMediaGalleryPage — IMAGE-UNIT PAGINATION
 *
 * CORE RULE: Pagination is measured in IMAGES, not messages.
 *
 * The backend scans owner_email messages backward from now to 2025-01-01,
 * collecting image_url records until it has enough UNIQUE IMAGES to satisfy
 * the requested page plus one (for hasMore proof), or until all messages
 * in that date range are exhausted.
 *
 * PAGE MATH (image-based, not message-based):
 *   page 1 → image index [0..20)   → need 21 unique images to prove hasMore
 *   page 2 → image index [20..40)  → need 41 unique images
 *   page N → image index [(N-1)*pageSize .. N*pageSize) → need N*pageSize+1
 *
 * CURSOR: After every message batch, cursor advances to the oldest
 *   created_date in THAT batch. No batch ever overlaps a prior batch.
 *
 * SCAN FLOOR: 2025-01-01T00:00:00.000Z
 *   If all messages back to that date are scanned and still not enough
 *   images, exhaustedAllMessages=true is returned with honest totals.
 *
 * PROOF FIELDS (all returned):
 *   requestedPage, pageSize, imageStartIndex, imageEndIndex
 *   uniqueImagesCollected, messagesScanned, batchCount
 *   exhaustedAllMessages, enoughForRequestedPage
 *   scanStartDate, scanEndDate (2025-01-01)
 *   firstImageId, firstImageUrl, firstImageDate (on page)
 *   lastImageId, lastImageUrl, lastImageDate (on page)
 *   hasMore
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PAGE_SIZE = 20;
const BATCH_SIZE = 200;          // messages per DB fetch (smaller = more precise cursor)
const SCAN_FLOOR = '2025-01-01T00:00:00.000Z';
const MAX_BATCHES = 100;         // safety cap: 100 * 200 = 20,000 messages max per request

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { page = 1, pageSize = PAGE_SIZE, searchTerm = '' } = await req.json();
    const ownerEmail = user.email;
    const safePageSize = Math.max(1, Math.min(50, pageSize));
    const safePage = Math.max(1, page);
    const imageStartIndex = (safePage - 1) * safePageSize;
    const imageEndIndex = imageStartIndex + safePageSize;
    // How many unique images we need to collect to satisfy this page + prove hasMore
    const neededImages = imageEndIndex + 1;
    const searchLower = (searchTerm || '').toLowerCase().trim();

    console.log(`[fetchMediaGalleryPage] owner=${ownerEmail} page=${safePage} pageSize=${safePageSize} imageStart=${imageStartIndex} imageEnd=${imageEndIndex} neededImages=${neededImages} search="${searchTerm}"`);

    // ── SCAN LOOP ──────────────────────────────────────────────────────────────
    // Each iteration fetches the next batch of messages, sorted -created_date.
    // Cursor starts at null (newest first) and advances to the oldest date seen
    // in each batch so the next batch fetches strictly older records.
    // We stop when:
    //   a) we have >= neededImages unique images, OR
    //   b) a batch returns fewer records than BATCH_SIZE (all messages consumed), OR
    //   c) cursor has passed the SCAN_FLOOR (2025-01-01), OR
    //   d) we hit MAX_BATCHES safety cap

    const seenUrls = new Set();   // dedup tracker
    const imageIndex = [];        // ordered image records (created_date DESC)
    let cursor = null;            // null = start from now
    let batchCount = 0;
    let messagesScanned = 0;
    let exhaustedAllMessages = false;
    const scanFloorMs = new Date(SCAN_FLOOR).getTime();

    while (batchCount < MAX_BATCHES) {
      batchCount++;

      // Build query — use cursor only after first batch
      const query = cursor
        ? { owner_email: ownerEmail, created_date: { $lt: cursor } }
        : { owner_email: ownerEmail };

      let batch = null;
      try {
        batch = await base44.entities.Message.filter(query, '-created_date', BATCH_SIZE);
      } catch {
        try {
          batch = await base44.asServiceRole.entities.Message.filter(query, '-created_date', BATCH_SIZE);
        } catch (e2) {
          if (batchCount === 1) {
            return Response.json({ error: `Message fetch failed: ${e2.message}` }, { status: 500 });
          }
          // Non-fatal on later batches — treat as exhausted
          exhaustedAllMessages = true;
          break;
        }
      }

      if (!batch || batch.length === 0) {
        exhaustedAllMessages = true;
        break;
      }

      messagesScanned += batch.length;

      // Extract image records from this batch and add to index
      for (const m of batch) {
        if (!m.image_url) continue;
        if (m.recovery_signal === true) continue;
        if (seenUrls.has(m.image_url)) continue;

        // Apply search filter inline so we only count matching images
        if (searchLower) {
          const desc = (m.image_description || '').toLowerCase();
          const sender = (m.character_name || '').toLowerCase();
          if (!desc.includes(searchLower) && !sender.includes(searchLower)) continue;
        }

        seenUrls.add(m.image_url);
        imageIndex.push(m);
      }

      console.log(`[fetchMediaGalleryPage] Batch ${batchCount}: ${batch.length} msgs scanned, ${imageIndex.length} unique images so far`);

      // ADVANCE CURSOR to oldest created_date in this batch
      const oldestInBatch = batch[batch.length - 1];
      const oldestDate = oldestInBatch?.created_date;

      if (!oldestDate) {
        exhaustedAllMessages = true;
        break;
      }

      // Check if we've passed the scan floor (2025-01-01)
      const oldestMs = new Date(oldestDate).getTime();
      if (oldestMs <= scanFloorMs) {
        exhaustedAllMessages = true;
        break;
      }

      // Batch returned fewer records than requested = no more messages exist
      if (batch.length < BATCH_SIZE) {
        exhaustedAllMessages = true;
        break;
      }

      cursor = oldestDate;

      // EARLY EXIT: we have enough images to satisfy this page + hasMore proof
      if (imageIndex.length >= neededImages) {
        console.log(`[fetchMediaGalleryPage] Early exit: ${imageIndex.length} unique images >= needed ${neededImages}`);
        break;
      }
    }

    // ── SORT (already DESC by scan order, but re-sort for determinism) ────────
    // Messages come back -created_date per batch, and batches are ordered newest→oldest,
    // so imageIndex should already be DESC. Re-sort to guarantee correctness.
    imageIndex.sort((a, b) => {
      const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
      const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      return (b.id || '').localeCompare(a.id || '');
    });

    const uniqueImagesCollected = imageIndex.length;
    const enoughForRequestedPage = uniqueImagesCollected > imageStartIndex;
    const hasMore = uniqueImagesCollected > imageEndIndex || (!exhaustedAllMessages && uniqueImagesCollected >= neededImages - 1);

    // ── SLICE THE REQUESTED PAGE ───────────────────────────────────────────────
    const pageSlice = enoughForRequestedPage
      ? imageIndex.slice(imageStartIndex, imageEndIndex)
      : [];

    // ── SHAPE OUTPUT ───────────────────────────────────────────────────────────
    const pageImages = pageSlice.map(m => ({
      id: m.id,
      url: m.image_url,
      description: m.image_description || '',
      imageDescription: m.image_description || '',
      senderType: m.sender_type || 'user',
      senderName: m.sender_type === 'user' ? 'You' : (m.character_name || 'Character'),
      characterId: m.character_id || null,
      conversationId: m.conversation_id || null,
      timestamp: m.created_date,
      messageId: m.id,
      ownerEmail: m.owner_email,
      source_type: 'message',
      source_id: m.id,
      parent_entity: 'Message',
      parent_owner_email: m.owner_email,
      parent_conversation_id: m.conversation_id,
    }));

    const proof = {
      // Page identity
      requestedPage: safePage,
      pageSize: safePageSize,
      imageStartIndex,
      imageEndIndex,
      // Scan results
      messagesScanned,
      batchCount,
      uniqueImagesCollected,
      exhaustedAllMessages,
      enoughForRequestedPage,
      hasMore,
      scanStartDate: new Date().toISOString(),
      scanEndDate: SCAN_FLOOR,
      // Page boundary proof
      pageImagesReturned: pageImages.length,
      firstImageId: pageImages[0]?.id || null,
      firstImageUrl: pageImages[0]?.url || null,
      firstImageDate: pageImages[0]?.timestamp || null,
      lastImageId: pageImages[pageImages.length - 1]?.id || null,
      lastImageUrl: pageImages[pageImages.length - 1]?.url || null,
      lastImageDate: pageImages[pageImages.length - 1]?.timestamp || null,
      // Alias fields for UI diagnostics panel compatibility
      skip: imageStartIndex,
      totalImagesInIndex: uniqueImagesCollected,
      sortKey: 'created_date DESC, id DESC',
      cursorStyle: 'advancing_per_batch_image_unit',
      rawScanned: messagesScanned,
      validFound: uniqueImagesCollected,
      afterDedup: uniqueImagesCollected,
      batchesScanned: batchCount,
      firstImageTimestamp: pageImages[0]?.timestamp || null,
      lastImageTimestamp: pageImages[pageImages.length - 1]?.timestamp || null,
      currentUserEmail: ownerEmail,
    };

    console.log(`[fetchMediaGalleryPage] RESULT: page=${safePage} images[${imageStartIndex}..${imageEndIndex}] returned=${pageImages.length} uniqueImages=${uniqueImagesCollected} exhausted=${exhaustedAllMessages} enoughForPage=${enoughForRequestedPage} hasMore=${hasMore} batches=${batchCount} msgsScanned=${messagesScanned}`);

    if (!enoughForRequestedPage) {
      console.warn(`[fetchMediaGalleryPage] WARNING: Not enough images for page ${safePage}. Only ${uniqueImagesCollected} unique images found (need >${imageStartIndex}). exhausted=${exhaustedAllMessages}`);
    }

    return Response.json({
      images: pageImages,
      currentUserEmail: ownerEmail,
      page: safePage,
      pageSize: safePageSize,
      totalImages: uniqueImagesCollected,
      hasMore,
      enoughForRequestedPage,
      proof,
    });

  } catch (error) {
    console.error('[fetchMediaGalleryPage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});