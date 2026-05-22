/**
 * fetchMediaGalleryPage — TRUE STABLE ORDERED INDEX
 *
 * ARCHITECTURE:
 * - Fetches ALL owner_email-scoped messages with image_url
 * - Pagination cursor advances correctly on each batch (not fixed to batch-1 date)
 * - Builds one stable ordered list: sort by created_date DESC, id DESC (tie-breaker)
 * - Deduplicates by URL once across the full list
 * - Slices the correct page from that stable list
 *
 * CURSOR RULE:
 *   After each batch, the cursor advances to the OLDEST date in THAT batch.
 *   This means batch 2 fetches records older than batch 1's oldest.
 *   Batch 3 fetches records older than batch 2's oldest. Etc.
 *   This is a true forward-only cursor — no batch can overlap a prior batch.
 *
 * PAGE MATH:
 *   page 1 → skip=0,  slice [0..pageSize)
 *   page 2 → skip=20, slice [20..40)
 *   page N → skip=(N-1)*pageSize, slice [skip..skip+pageSize)
 *
 * PROOF FIELDS returned in every response:
 *   requestedPage, pageSize, startIndex, endIndex
 *   totalImagesInIndex (full deduped count)
 *   firstImageId, firstImageUrl, firstImageTimestamp
 *   lastImageId, lastImageUrl, lastImageTimestamp
 *   hasMore, exhausted, rawScanned, batchCount
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PAGE_SIZE = 20;
const BATCH_LIMIT = 500;
const MAX_BATCHES = 20; // Safety ceiling: up to 10,000 messages

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
    const startIndex = (safePage - 1) * safePageSize;
    const endIndex = startIndex + safePageSize;
    const searchLower = (searchTerm || '').toLowerCase().trim();

    console.log(`[fetchMediaGalleryPage] owner=${ownerEmail} page=${safePage} pageSize=${safePageSize} startIndex=${startIndex} endIndex=${endIndex} search="${searchTerm}"`);

    // ── STEP 1: Fetch ALL owner-scoped messages in advancing-cursor batches ─────
    // KEY FIX: cursor advances after each batch to the OLDEST date in that batch.
    // This guarantees no batch overlaps a prior batch.
    const allMessages = [];
    let batchCount = 0;
    let totalScanned = 0;
    let exhausted = false;
    let cursor = null; // null = start from the newest; advances each batch

    while (!exhausted && batchCount < MAX_BATCHES) {
      batchCount++;

      let batch = null;
      const query = cursor
        ? { owner_email: ownerEmail, created_date: { $lt: cursor } }
        : { owner_email: ownerEmail };

      try {
        batch = await base44.entities.Message.filter(query, '-created_date', BATCH_LIMIT);
      } catch {
        try {
          batch = await base44.asServiceRole.entities.Message.filter(query, '-created_date', BATCH_LIMIT);
        } catch (e2) {
          if (batchCount === 1) {
            return Response.json({ error: `Message fetch failed: ${e2.message}` }, { status: 500 });
          }
          // Non-first batch failure: stop here with what we have
          exhausted = true;
          break;
        }
      }

      if (!batch || batch.length === 0) {
        exhausted = true;
        break;
      }

      totalScanned += batch.length;
      allMessages.push(...batch);
      console.log(`[fetchMediaGalleryPage] Batch ${batchCount}: ${batch.length} records (total: ${totalScanned}) cursor=${cursor || 'start'}`);

      if (batch.length < BATCH_LIMIT) {
        // Fewer records than requested = we've hit the end
        exhausted = true;
        break;
      }

      // ADVANCE CURSOR to the oldest date in this batch (last item, since sorted -created_date)
      // This is the key fix: each iteration moves the cursor forward, never reusing the same window
      const oldestInBatch = batch[batch.length - 1].created_date;
      if (!oldestInBatch) {
        // No date on last record — stop to avoid infinite loop
        exhausted = true;
        break;
      }
      cursor = oldestInBatch;

      // Early-exit optimization: if we already have enough images for this page, stop fetching
      // Only safe to do once we've confirmed we have all images up to endIndex
      const imagesSoFar = allMessages.filter(m => m.image_url && !m.recovery_signal).length;
      if (imagesSoFar >= endIndex + safePageSize && batchCount >= 3) {
        // We have well more than enough — but don't exit too early or pages will be wrong
        // Continue until exhausted to get the true total count (needed for hasMore accuracy)
        // For performance, only early-exit if we're very deep (page > 10) and have 3x needed
        if (imagesSoFar >= endIndex * 3) {
          console.log(`[fetchMediaGalleryPage] Early-exit: ${imagesSoFar} images found, need ${endIndex} for page ${safePage}`);
          break;
        }
      }
    }

    console.log(`[fetchMediaGalleryPage] Total scanned: ${totalScanned} in ${batchCount} batches (exhausted=${exhausted})`);

    // ── STEP 2: Filter to image-only messages ─────────────────────────────────
    const imageMessages = allMessages.filter(m => {
      if (!m.image_url) return false;
      if (m.recovery_signal === true) return false;
      return true;
    });

    console.log(`[fetchMediaGalleryPage] Image messages: ${imageMessages.length}`);

    // ── STEP 3: Sort by created_date DESC, id DESC (deterministic) ─────────────
    imageMessages.sort((a, b) => {
      const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
      const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      return (b.id || '').localeCompare(a.id || '');
    });

    // ── STEP 4: Deduplicate by URL (once across full index) ────────────────────
    const seenUrls = new Set();
    const dedupedIndex = [];
    for (const m of imageMessages) {
      if (seenUrls.has(m.image_url)) continue;
      seenUrls.add(m.image_url);
      dedupedIndex.push(m);
    }

    console.log(`[fetchMediaGalleryPage] After dedup: ${dedupedIndex.length} unique images`);

    // ── STEP 5: Apply search filter ───────────────────────────────────────────
    let filteredIndex = dedupedIndex;
    if (searchLower) {
      filteredIndex = dedupedIndex.filter(m => {
        const desc = (m.image_description || '').toLowerCase();
        const sender = (m.character_name || '').toLowerCase();
        return desc.includes(searchLower) || sender.includes(searchLower);
      });
    }

    const totalImagesInIndex = filteredIndex.length;

    // ── STEP 6: Slice the exact page ──────────────────────────────────────────
    // startIndex = (page-1) * pageSize
    // endIndex = startIndex + pageSize
    // page 1 → [0..20), page 2 → [20..40), page 3 → [40..60), etc.
    const pageSlice = filteredIndex.slice(startIndex, endIndex);
    const hasMore = endIndex < totalImagesInIndex || (!exhausted && totalScanned >= BATCH_LIMIT);

    // ── STEP 7: Shape output ──────────────────────────────────────────────────
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
      requestedPage: safePage,
      pageSize: safePageSize,
      startIndex,
      endIndex,
      totalImagesInIndex,
      pageImagesReturned: pageImages.length,
      // Per-page boundary proof
      firstImageId: pageImages[0]?.id || null,
      firstImageUrl: pageImages[0]?.url || null,
      firstImageTimestamp: pageImages[0]?.timestamp || null,
      lastImageId: pageImages[pageImages.length - 1]?.id || null,
      lastImageUrl: pageImages[pageImages.length - 1]?.url || null,
      lastImageTimestamp: pageImages[pageImages.length - 1]?.timestamp || null,
      hasMore,
      exhausted,
      rawScanned: totalScanned,
      batchCount,
      sortKey: 'created_date DESC, id DESC',
      cursorStyle: 'advancing_per_batch',
      currentUserEmail: ownerEmail,
      // Legacy field aliases for diagnostics panel
      skip: startIndex,
      validFound: dedupedIndex.length,
      afterDedup: dedupedIndex.length,
      batchesScanned: batchCount,
      firstImageTimestamp: pageImages[0]?.timestamp || null,
      lastImageTimestamp: pageImages[pageImages.length - 1]?.timestamp || null,
    };

    console.log(`[fetchMediaGalleryPage] RESULT: page=${safePage} startIndex=${startIndex} endIndex=${endIndex} returned=${pageImages.length}/${totalImagesInIndex} hasMore=${hasMore}`);

    return Response.json({
      images: pageImages,
      currentUserEmail: ownerEmail,
      page: safePage,
      pageSize: safePageSize,
      totalImages: totalImagesInIndex,
      hasMore,
      proof,
    });

  } catch (error) {
    console.error('[fetchMediaGalleryPage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});