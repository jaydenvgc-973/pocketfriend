/**
 * fetchMediaGalleryPage
 *
 * CORRECT PAGINATION WITH BATCHED FETCHING:
 * 1. Fetch raw messages in batches (not one capped list)
 * 2. Collect owner-verified images until we have ENOUGH for the requested page
 * 3. Stop only when: (a) we have enough, OR (b) no more records exist
 * 4. Then dedupe, sort, paginate
 *
 * This fixes the issue where page 15 fails because only 500 raw messages were scanned.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BATCH_SIZE = 200;
const PAGE_SIZE = 20;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { page = 1, pageSize = PAGE_SIZE, searchTerm = '' } = await req.json();
    const currentUserEmail = user.email;
    const searchLower = searchTerm.toLowerCase();
    const requiredImageCount = page * pageSize; // Need this many verified images to slice page

    console.log(`[fetchMediaGalleryPage] page=${page} pageSize=${pageSize} requiredImageCount=${requiredImageCount} search="${searchTerm}"`);

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 1: Batched fetching — collect until we have enough verified images
    // ─────────────────────────────────────────────────────────────────────────────

    const allImages = [];
    let rawOffset = 0;
    let totalRawScanned = 0;
    let batchNumber = 0;
    let exhausted = false;

    while (allImages.length < requiredImageCount && !exhausted) {
      batchNumber++;
      console.log(`[fetchMediaGalleryPage] Batch ${batchNumber}: fetching ${BATCH_SIZE} messages starting at offset ${rawOffset}`);

      try {
        // Fetch batch of raw messages (ascending order, so we scan from oldest first — then reverse to newest)
        const batch = await base44.asServiceRole.entities.Message.list('timestamp', BATCH_SIZE, rawOffset);

        if (!batch || batch.length === 0) {
          console.log(`[fetchMediaGalleryPage] Batch ${batchNumber}: empty result — exhausted`);
          exhausted = true;
          break;
        }

        totalRawScanned += batch.length;
        console.log(`[fetchMediaGalleryPage] Batch ${batchNumber}: got ${batch.length} raw records`);

        // Process each message for ownership and images
        for (const m of batch) {
          // Only process messages with image_url
          if (!m.image_url) continue;

          // CRITICAL: Verify ownership through parent source
          let isOwner = false;
          let verificationPath = null;

          // Path A: Message.owner_email
          if (m.owner_email === currentUserEmail) {
            isOwner = true;
            verificationPath = `message.owner_email`;
          }

          // Path B: Conversation owner
          if (!isOwner && m.conversation_id) {
            try {
              const conv = await base44.asServiceRole.entities.Conversation.get(m.conversation_id).catch(() => null);
              if (conv && (conv.owner_email === currentUserEmail || conv.created_by === currentUserEmail)) {
                isOwner = true;
                verificationPath = `conversation.owner_email`;
              }
            } catch {
              // Ignore lookup failure
            }
          }

          // Path C: Character owner
          if (!isOwner && m.character_id) {
            try {
              const char = await base44.asServiceRole.entities.Character.get(m.character_id).catch(() => null);
              if (char && char.owner_email === currentUserEmail) {
                isOwner = true;
                verificationPath = `character.owner_email`;
              }
            } catch {
              // Ignore lookup failure
            }
          }

          if (!isOwner) continue;

          allImages.push({
            id: m.id,
            url: m.image_url,
            description: m.image_description || m.content?.slice(0, 100) || 'Image',
            senderType: m.sender_type,
            senderName: m.character_name || 'You',
            characterId: m.character_id,
            conversationId: m.conversation_id,
            timestamp: m.timestamp || m.created_date,
            messageId: m.id,
            ownerEmail: m.owner_email,
            verificationPath,
            source_type: 'message',
            source_id: m.id,
            parent_entity: 'Message',
            parent_owner_email: m.owner_email,
            parent_conversation_id: m.conversation_id,
          });
        }

        console.log(`[fetchMediaGalleryPage] Batch ${batchNumber}: collected ${allImages.length} verified images so far`);

        // Stop if batch was smaller than BATCH_SIZE (no more records exist)
        if (batch.length < BATCH_SIZE) {
          console.log(`[fetchMediaGalleryPage] Batch ${batchNumber}: returned ${batch.length} < ${BATCH_SIZE} — exhausted`);
          exhausted = true;
          break;
        }

        rawOffset += BATCH_SIZE;
      } catch (batchErr) {
        console.log(`[fetchMediaGalleryPage] Batch ${batchNumber} error: ${batchErr.message}`);
        exhausted = true;
        break;
      }
    }

    console.log(`[fetchMediaGalleryPage] Batching complete: scanned=${totalRawScanned} verified=${allImages.length} batches=${batchNumber}`);

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: Deduplicate by URL
    // ─────────────────────────────────────────────────────────────────────────────

    const seenUrls = new Set();
    const deduplicated = allImages.filter(img => {
      if (seenUrls.has(img.url)) return false;
      seenUrls.add(img.url);
      return true;
    });

    console.log(`[fetchMediaGalleryPage] After dedup: ${deduplicated.length} images`);

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 3: Sort by timestamp descending (newest first)
    // ─────────────────────────────────────────────────────────────────────────────

    deduplicated.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 4: Apply search filter
    // ─────────────────────────────────────────────────────────────────────────────

    let filtered = deduplicated;
    if (searchTerm) {
      filtered = deduplicated.filter(img => {
        const desc = (img.description || '').toLowerCase();
        const sender = (img.senderName || '').toLowerCase();
        return desc.includes(searchLower) || sender.includes(searchLower);
      });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 5: Paginate AFTER all filtering
    // ─────────────────────────────────────────────────────────────────────────────

    const totalImages = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageImages = filtered.slice(start, end);
    const hasMore = end < totalImages;

    console.log(`[fetchMediaGalleryPage] PAGINATION: total=${totalImages} start=${start} end=${end} hasMore=${hasMore}`);

    if (pageImages.length > 0) {
      console.log(`[fetchMediaGalleryPage] Page ${page} first image: id=${pageImages[0].id} timestamp=${pageImages[0].timestamp}`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // PROOF & RETURN
    // ─────────────────────────────────────────────────────────────────────────────

    return Response.json({
      images: pageImages,
      currentUserEmail,
      page,
      pageSize,
      totalImages,
      hasMore,
      proof: {
        requestedPage: page,
        pageSize,
        requiredImageCount,
        rawRecordsScanned: totalRawScanned,
        verifiedImagesCollected: allImages.length,
        afterDedup: deduplicated.length,
        afterSearch: filtered.length,
        sliceStart: start,
        sliceEnd: end,
        pageImagesReturned: pageImages.length,
        firstImageIdOnPage: pageImages.length > 0 ? pageImages[0].id : null,
        hasMore,
        exhausted,
        batchesScanned: batchNumber,
      }
    });

  } catch (error) {
    console.error('[fetchMediaGalleryPage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});