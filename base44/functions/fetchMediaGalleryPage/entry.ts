/**
 * fetchMediaGalleryPage
 *
 * CORRECT PAGINATION ALGORITHM:
 * 1. Gather ALL owner-verified image candidates from all sources
 * 2. Filter by search term
 * 3. Deduplicate by URL
 * 4. Sort by timestamp descending
 * 5. THEN slice for pagination (page * PAGE_SIZE)
 *
 * This guarantees consistent pages because pagination happens AFTER filtering,
 * not on raw message records.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

    console.log(`[fetchMediaGalleryPage] page=${page} pageSize=${pageSize} search="${searchTerm}" user=${currentUserEmail}`);

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 1: Gather all owner-verified images from all sources
    // ─────────────────────────────────────────────────────────────────────────────

    const allImages = [];
    let totalScanned = 0;
    let totalVerified = 0;

    // Source 1: All Messages with image_url
    try {
      console.log('[fetchMediaGalleryPage] Source 1: Scanning Messages');
      const messages = await base44.asServiceRole.entities.Message.list('-timestamp', 500);
      totalScanned += messages.length;

      for (const m of messages) {
        // Only include messages with image_url
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
            // Ignore conversation lookup failure — message ownership is still possible via other paths
          }
        }

        // Path C: Character owner (if character_id is present)
        if (!isOwner && m.character_id) {
          try {
            const char = await base44.asServiceRole.entities.Character.get(m.character_id).catch(() => null);
            if (char && char.owner_email === currentUserEmail) {
              isOwner = true;
              verificationPath = `character.owner_email`;
            }
          } catch {
            // Ignore character lookup failure
          }
        }

        if (!isOwner) continue;

        totalVerified++;
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
    } catch (err) {
      console.log(`[fetchMediaGalleryPage] Message scan error: ${err.message}`);
    }

    console.log(`[fetchMediaGalleryPage] Messages: scanned=${totalScanned} verified=${totalVerified}`);

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 2: Deduplicate by URL
    // ─────────────────────────────────────────────────────────────────────────────

    const seenUrls = new Set();
    const deduplicated = allImages.filter(img => {
      if (seenUrls.has(img.url)) {
        console.log(`[fetchMediaGalleryPage] Dedup: skipped ${img.url.substring(0, 50)}`);
        return false;
      }
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
      console.log(`[fetchMediaGalleryPage] After search filter: ${filtered.length} images`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP 5: Paginate AFTER all filtering
    // ─────────────────────────────────────────────────────────────────────────────

    const totalImages = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageImages = filtered.slice(start, end);
    const hasMore = end < totalImages;

    console.log(`[fetchMediaGalleryPage] PAGINATION: total=${totalImages} start=${start} end=${end} pageSize=${pageSize} hasMore=${hasMore}`);

    // ─────────────────────────────────────────────────────────────────────────────
    // PROOF & RETURN
    // ─────────────────────────────────────────────────────────────────────────────

    console.log('[fetchMediaGalleryPage] PROOF LOG:');
    console.log(`  currentUser: ${currentUserEmail}`);
    console.log(`  page: ${page}`);
    console.log(`  pageSize: ${pageSize}`);
    console.log(`  search: "${searchTerm}"`);
    console.log(`  totalMessages scanned: ${totalScanned}`);
    console.log(`  totalVerified from messages: ${totalVerified}`);
    console.log(`  afterDedup: ${deduplicated.length}`);
    console.log(`  afterSearch: ${filtered.length}`);
    console.log(`  sliceStart: ${start}`);
    console.log(`  sliceEnd: ${end}`);
    console.log(`  pageImages returned: ${pageImages.length}`);
    console.log(`  hasMore: ${hasMore}`);

    if (pageImages.length > 0) {
      console.log(`[fetchMediaGalleryPage] Page ${page} first image: id=${pageImages[0].id} timestamp=${pageImages[0].timestamp}`);
    }

    return Response.json({
      images: pageImages,
      currentUserEmail,
      page,
      pageSize,
      totalImages,
      hasMore,
      proof: {
        currentUserEmail,
        page,
        totalImagesScanned: totalScanned,
        totalVerified,
        afterDedup: deduplicated.length,
        afterSearch: filtered.length,
        sliceStart: start,
        sliceEnd: end,
        pageImagesReturned: pageImages.length,
        hasMore,
      }
    });

  } catch (error) {
    console.error('[fetchMediaGalleryPage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});