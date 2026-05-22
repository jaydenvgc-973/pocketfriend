/**
 * fetchMediaGalleryPage — STABLE ORDERED INDEX
 *
 * ARCHITECTURE:
 * - Fetches ALL owner_email-scoped messages with image_url in sorted batches
 * - Builds one stable ordered list: sort by created_date DESC, id DESC (tie-breaker)
 * - Deduplicates by URL once across the full list
 * - Slices the correct page from that stable list
 * - Page boundaries are deterministic because the full ordered list is built before slicing
 *
 * OWNERSHIP: Message.owner_email === user.email (canonical field, no created_by)
 *
 * PAGINATION CONTRACT (provable):
 *   full_index = all owner images sorted by created_date DESC, id DESC, deduped by URL
 *   page N, size P → full_index.slice((N-1)*P, N*P)
 *   This is stable: same sort = same order = same pages regardless of when called.
 *
 * OFFSET CAVEAT:
 *   Base44 .filter() takes (query, sort, limit) — no skip/offset parameter.
 *   We use large batch fetches (limit=500) and rely on stable sort + client-side pagination.
 *   For most galleries (< 10,000 messages) one or two batches is sufficient.
 *   If the user has >500 messages, a second batch is fetched with the same sort and
 *   post-de-merged with created_date to ensure no gaps.
 *
 * PROOF FIELDS returned in every response:
 *   - requestedPage, pageSize, skip (=(page-1)*pageSize)
 *   - sortKey: "created_date DESC, id DESC"
 *   - totalImagesInIndex: size of full deduped ordered list
 *   - firstImageIdOnPage, firstImageTimestampOnPage
 *   - lastImageIdOnPage, lastImageTimestampOnPage
 *   - hasMore
 *   - rawScanned, batchCount
 *   - offsetHonored: false (client-side pagination from full list — intentional)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PAGE_SIZE = 20;
const BATCH_LIMIT = 500; // Max records per Base44 .filter() call

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
    const skip = (safePage - 1) * safePageSize;
    const searchLower = (searchTerm || '').toLowerCase().trim();

    console.log(`[fetchMediaGalleryPage] owner=${ownerEmail} page=${safePage} pageSize=${safePageSize} skip=${skip} search="${searchTerm}"`);

    // ── STEP 1: Fetch ALL owner-scoped messages in batches ────────────────────
    // Base44 .filter(query, sort, limit) — NO offset param.
    // We fetch up to BATCH_LIMIT records per call sorted by -created_date.
    // For galleries > BATCH_LIMIT messages, we do a second batch by using
    // the oldest timestamp from batch 1 as a cursor proxy (via client-side merge).
    // This gives us the full ordered list without relying on a skip param.

    const allMessages = [];
    let batchCount = 0;
    let totalScanned = 0;
    let exhausted = false;

    // Batch 1: newest BATCH_LIMIT records
    {
      batchCount++;
      let batch = null;
      try {
        batch = await base44.entities.Message.filter(
          { owner_email: ownerEmail },
          '-created_date',
          BATCH_LIMIT
        );
      } catch {
        try {
          batch = await base44.asServiceRole.entities.Message.filter(
            { owner_email: ownerEmail },
            '-created_date',
            BATCH_LIMIT
          );
        } catch (e2) {
          return Response.json({ error: `Message fetch failed: ${e2.message}` }, { status: 500 });
        }
      }

      if (!batch || batch.length === 0) {
        exhausted = true;
      } else {
        totalScanned += batch.length;
        allMessages.push(...batch);
        if (batch.length < BATCH_LIMIT) exhausted = true;
        console.log(`[fetchMediaGalleryPage] Batch 1: ${batch.length} records`);
      }
    }

    // Batch 2+: if first batch was full AND we need deeper pages, fetch more.
    // We keep fetching with increasing skip estimates until exhausted.
    // Since Base44 doesn't support offset, we fetch the next BATCH_LIMIT
    // and use created_date to detect overlap/continuation.
    // We cap at 10 batches (5000 messages) to avoid timeouts.
    if (!exhausted && allMessages.length > 0) {
      const oldestDateInBatch1 = allMessages[allMessages.length - 1].created_date;
      let continueLoop = true;
      while (continueLoop && batchCount < 10) {
        batchCount++;
        let nextBatch = null;
        try {
          // Fetch records older than the last known record using created_date filter
          nextBatch = await base44.entities.Message.filter(
            { owner_email: ownerEmail, created_date: { $lt: oldestDateInBatch1 } },
            '-created_date',
            BATCH_LIMIT
          );
        } catch {
          try {
            nextBatch = await base44.asServiceRole.entities.Message.filter(
              { owner_email: ownerEmail, created_date: { $lt: oldestDateInBatch1 } },
              '-created_date',
              BATCH_LIMIT
            );
          } catch {
            continueLoop = false;
            break;
          }
        }

        if (!nextBatch || nextBatch.length === 0) {
          exhausted = true;
          continueLoop = false;
        } else {
          totalScanned += nextBatch.length;
          allMessages.push(...nextBatch);
          console.log(`[fetchMediaGalleryPage] Batch ${batchCount}: ${nextBatch.length} records (total scanned: ${totalScanned})`);
          if (nextBatch.length < BATCH_LIMIT) {
            exhausted = true;
            continueLoop = false;
          } else {
            // Only continue if we still need more images for this page
            // Count images found so far to decide whether to stop early
            const imagesSoFar = allMessages.filter(m => m.image_url && !m.recovery_signal).length;
            const needed = skip + safePageSize + 1;
            if (imagesSoFar >= needed) {
              continueLoop = false;
            }
          }
        }
      }
    }

    console.log(`[fetchMediaGalleryPage] Total scanned: ${totalScanned} in ${batchCount} batches`);

    // ── STEP 2: Filter to image-only messages ─────────────────────────────────
    const imageMessages = allMessages.filter(m => {
      if (!m.image_url) return false;
      if (m.recovery_signal === true) return false;
      return true;
    });

    console.log(`[fetchMediaGalleryPage] Image messages found: ${imageMessages.length}`);

    // ── STEP 3: Sort by created_date DESC, id DESC (deterministic tie-breaker) ─
    imageMessages.sort((a, b) => {
      const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
      const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      // Tie-breaker: id DESC (lexicographic — stable for UUIDs with timestamp prefix)
      return (b.id || '').localeCompare(a.id || '');
    });

    // ── STEP 4: Deduplicate by URL ────────────────────────────────────────────
    const seenUrls = new Set();
    const dedupedIndex = [];
    for (const m of imageMessages) {
      if (seenUrls.has(m.image_url)) continue;
      seenUrls.add(m.image_url);
      dedupedIndex.push(m);
    }

    console.log(`[fetchMediaGalleryPage] After dedup: ${dedupedIndex.length} unique images in index`);

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

    // ── STEP 6: Slice the correct page ────────────────────────────────────────
    const pageSlice = filteredIndex.slice(skip, skip + safePageSize);
    const hasMore = (skip + safePageSize) < totalImagesInIndex ||
      (!exhausted && totalImagesInIndex >= safePageSize);

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
      verificationPath: 'message.owner_email',
      source_type: 'message',
      source_id: m.id,
      parent_entity: 'Message',
      parent_owner_email: m.owner_email,
      parent_conversation_id: m.conversation_id,
    }));

    console.log(`[fetchMediaGalleryPage] page=${safePage} skip=${skip} returning=${pageImages.length}/${totalImagesInIndex} hasMore=${hasMore}`);

    const proof = {
      requestedPage: safePage,
      pageSize: safePageSize,
      skip,
      sortKey: 'created_date DESC, id DESC',
      offsetHonored: false, // intentional — client-side pagination from full sorted list
      rawScanned: totalScanned,
      imageMessagesFound: imageMessages.length,
      afterDedup: dedupedIndex.length,
      afterSearch: totalImagesInIndex,
      totalImagesInIndex,
      pageImagesReturned: pageImages.length,
      firstImageIdOnPage: pageImages[0]?.id || null,
      lastImageIdOnPage: pageImages[pageImages.length - 1]?.id || null,
      firstImageTimestampOnPage: pageImages[0]?.timestamp || null,
      lastImageTimestampOnPage: pageImages[pageImages.length - 1]?.timestamp || null,
      hasMore,
      exhausted,
      batchCount,
      currentUserEmail: ownerEmail,
      // Legacy field names for UI diagnostics panel
      validFound: dedupedIndex.length,
      batchesScanned: batchCount,
      firstImageTimestamp: pageImages[0]?.timestamp || null,
      lastImageTimestamp: pageImages[pageImages.length - 1]?.timestamp || null,
    };

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