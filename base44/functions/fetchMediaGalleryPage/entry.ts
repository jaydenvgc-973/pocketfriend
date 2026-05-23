/**
 * fetchMediaGalleryPage — IMAGE-UNIT PAGINATION v3
 *
 * CORE RULE: Pagination is measured in IMAGES, not messages.
 *
 * FIXES IN v3:
 *   - Compound cursor (date + id) prevents timestamp-collision skips/duplicates
 *   - URL normalization for dedup (strips querystrings/signed tokens)
 *   - Simpler, honest hasMore: uniqueImagesCollected > imageEndIndex only
 *   - Runtime-based termination in addition to batch cap
 *   - Richer termination_reason in proof for debugging
 *
 * PAGE MATH (image-based, not message-based):
 *   page 1 → image index [0..20)   → need 21 unique images to prove hasMore
 *   page N → image index [(N-1)*pageSize .. N*pageSize)
 *
 * CURSOR: compound (date + id) — deterministic even on timestamp collisions
 * SCAN FLOOR: 2025-01-01T00:00:00.000Z
 * DEDUP KEY: normalized URL (path only, no querystring) with message ID as fallback
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PAGE_SIZE = 20;
const BATCH_SIZE = 200;
const SCAN_FLOOR = '2025-01-01T00:00:00.000Z';
const MAX_BATCHES = 100;           // safety cap: 100 × 200 = 20,000 messages
const MAX_RUNTIME_MS = 25000;      // 25s hard runtime cap — stop before Deno timeout

/**
 * Normalize an image URL for deduplication purposes.
 * Strips query parameters (signed tokens, CDN params, expiry signatures)
 * so the same underlying image is never counted twice.
 */
function normalizeUrlForDedup(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    // Keep only origin + pathname — strip all querystring and fragments
    return u.origin + u.pathname;
  } catch {
    // If URL is malformed, strip from ? onward
    const qIdx = url.indexOf('?');
    return qIdx !== -1 ? url.slice(0, qIdx) : url;
  }
}

Deno.serve(async (req) => {
  const scanStart = Date.now();
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
    // Need imageEndIndex + 1 images to prove hasMore
    const neededImages = imageEndIndex + 1;
    const searchLower = (searchTerm || '').toLowerCase().trim();

    console.log(`[fetchMediaGalleryPage] v3 owner=${ownerEmail} page=${safePage} pageSize=${safePageSize} imageStart=${imageStartIndex} imageEnd=${imageEndIndex} neededImages=${neededImages} search="${searchTerm}"`);

    // ── SCAN LOOP ──────────────────────────────────────────────────────────────
    // Compound cursor: (cursorDate, cursorId) — advances past oldest record in each batch.
    // This prevents both overlaps and skips when multiple messages share the same timestamp.
    const seenNormalizedUrls = new Set();  // normalized URL → dedup key
    const imageIndex = [];                  // collected image records (newest→oldest)
    let cursorDate = null;                  // null = start from now
    let cursorId = null;                    // companion ID for tie-breaking
    let batchCount = 0;
    let messagesScanned = 0;
    let exhaustedAllMessages = false;
    let terminationReason = 'in_progress';
    const scanFloorMs = new Date(SCAN_FLOOR).getTime();

    while (batchCount < MAX_BATCHES) {
      // Runtime guard: stop before Deno's execution timeout
      if (Date.now() - scanStart > MAX_RUNTIME_MS) {
        terminationReason = 'runtime_limit';
        console.warn(`[fetchMediaGalleryPage] Runtime limit reached (${MAX_RUNTIME_MS}ms) at batch ${batchCount}`);
        break;
      }

      batchCount++;

      // ── COMPOUND CURSOR QUERY ──────────────────────────────────────────────
      // On the first batch, fetch the newest messages (no cursor constraint).
      // On subsequent batches, use $or to correctly handle timestamp ties:
      //   - records strictly older than cursorDate, OR
      //   - records with the same cursorDate but an id that sorts before cursorId (lexically)
      // This guarantees no gaps and no duplicates even when multiple messages share a timestamp.
      let query;
      if (!cursorDate) {
        query = { owner_email: ownerEmail };
      } else {
        query = {
          owner_email: ownerEmail,
          $or: [
            { created_date: { $lt: cursorDate } },
            // Same date, earlier ID (lexicographic — works with UUIDs and MongoDB ObjectIDs)
            { created_date: cursorDate, id: { $lt: cursorId || '' } },
          ],
        };
      }

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
          terminationReason = 'db_error';
          exhaustedAllMessages = true;
          break;
        }
      }

      if (!batch || batch.length === 0) {
        terminationReason = 'exhausted_messages';
        exhaustedAllMessages = true;
        break;
      }

      messagesScanned += batch.length;

      // ── EXTRACT & DEDUP IMAGES ─────────────────────────────────────────────
      for (const m of batch) {
        if (!m.image_url) continue;
        if (m.recovery_signal === true) continue;

        // Use normalized URL for dedup (strips signed tokens, CDN params, etc.)
        const dedupKey = normalizeUrlForDedup(m.image_url);
        if (seenNormalizedUrls.has(dedupKey)) continue;

        // Apply search filter — search all available description fields
        if (searchLower) {
          const gc = m.generation_context || {};
          const desc = [
            m.image_description,
            gc.scene_prompt,
            gc.original_raw_prompt,
            (gc.prompt && gc.prompt.length < 400) ? gc.prompt : null,
            gc.resolved_description,
          ].filter(Boolean).join(' ').toLowerCase();
          const sender = (m.character_name || '').toLowerCase();
          if (!desc.includes(searchLower) && !sender.includes(searchLower)) continue;
        }

        seenNormalizedUrls.add(dedupKey);
        imageIndex.push(m);
      }

      console.log(`[fetchMediaGalleryPage] Batch ${batchCount}: ${batch.length} msgs → ${imageIndex.length} unique images`);

      // ── ADVANCE COMPOUND CURSOR ────────────────────────────────────────────
      const oldestInBatch = batch[batch.length - 1];
      const oldestDate = oldestInBatch?.created_date;
      const oldestId = oldestInBatch?.id;

      if (!oldestDate) {
        terminationReason = 'exhausted_messages';
        exhaustedAllMessages = true;
        break;
      }

      // Check scan floor
      const oldestMs = new Date(oldestDate).getTime();
      if (oldestMs <= scanFloorMs) {
        terminationReason = 'scan_floor_reached';
        exhaustedAllMessages = true;
        break;
      }

      // Fewer records than batch size = no more messages
      if (batch.length < BATCH_SIZE) {
        terminationReason = 'exhausted_messages';
        exhaustedAllMessages = true;
        break;
      }

      cursorDate = oldestDate;
      cursorId = oldestId || null;

      // EARLY EXIT: collected enough images for this page + hasMore proof
      if (imageIndex.length >= neededImages) {
        terminationReason = 'enough_images';
        console.log(`[fetchMediaGalleryPage] Early exit at batch ${batchCount}: ${imageIndex.length} images >= needed ${neededImages}`);
        break;
      }
    }

    if (terminationReason === 'in_progress') terminationReason = 'safety_cap';

    // ── SORT deterministically: created_date DESC, id DESC ────────────────────
    imageIndex.sort((a, b) => {
      const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
      const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      return (b.id || '').localeCompare(a.id || '');
    });

    const uniqueImagesCollected = imageIndex.length;
    const enoughForRequestedPage = uniqueImagesCollected > imageStartIndex;

    // SIMPLE, HONEST hasMore: we actually collected more images than this page needs
    // No fuzzy "probably more" — only confirm hasMore when we have proof
    const hasMore = uniqueImagesCollected > imageEndIndex;

    // ── SLICE THE REQUESTED PAGE ───────────────────────────────────────────────
    const pageSlice = enoughForRequestedPage
      ? imageIndex.slice(imageStartIndex, imageEndIndex)
      : [];

    // ── SHAPE OUTPUT ───────────────────────────────────────────────────────────
    // CRITICAL: generation_context carries the original prompt, subjects, character IDs,
    // location, and outfit metadata. It MUST be passed through so:
    //   1. The gallery detail view can display the original prompt/caption.
    //   2. Send-to-character writes this context onto the recipient message so the
    //      receiving character's LLM knows who/what is in the image.
    const pageImages = pageSlice.map(m => {
      const gc = m.generation_context || null;

      // Extract the most descriptive prompt available, in priority order:
      //   1. generation_context.original_raw_prompt (the user's original typed request)
      //   2. generation_context.scene_prompt (sanitized scene description — human-readable)
      //   3. image_description on the message (written by generateImageAsync as clean sanitizedPrompt)
      //   4. generation_context.resolved_description
      //   5. generation_context.prompt ONLY if short (< 400 chars) — the full prompt blob is 10,000+ chars
      //
      // CRITICAL: gc.prompt is the full 10,000-character provider instruction string.
      // It must NEVER be used as the display description — it's unreadable and not the scene.
      // gc.scene_prompt and m.image_description are the clean human-readable values.
      const gcPromptIfShort = (gc?.prompt && gc.prompt.length < 400) ? gc.prompt : null;
      const originalPrompt =
        gc?.original_raw_prompt ||
        gc?.scene_prompt ||
        m.image_description ||
        gc?.resolved_description ||
        gcPromptIfShort ||
        null;

      // Resolved display description — what the gallery modal shows under PROMPT / CONTEXT.
      // Same priority chain as originalPrompt.
      const resolvedDescription = originalPrompt;

      // Extract subject metadata (people/characters shown in the image)
      const subjects = gc?.subjects || [];
      const subjectIds = subjects.map(s => s.subject_id).filter(Boolean);
      const subjectNames = subjects.map(s => s.subject_name).filter(Boolean);

      return {
        id: m.id,
        url: m.image_url,
        description: resolvedDescription || '',
        imageDescription: m.image_description || '',
        // ── RESTORED PROMPT/CONTEXT FIELDS ──
        originalPrompt,
        generationPrompt: gc?.prompt || null,
        scenePrompt: gc?.scene_prompt || null,
        imageType: gc?.image_type || gc?.subject_type || null,
        // Subject identity metadata — who is in the image
        subjects,
        subjectIds,
        subjectNames,
        subjectCount: gc?.subject_count || subjects.length || 0,
        locationName: gc?.location_name || gc?.locationName || null,
        locationId: gc?.location_id || null,
        zoneName: gc?.zone_name || gc?.zoneName || null,
        // Full generation_context — passed through for send-to-character
        generationContext: gc,
        // ── SENDER / SOURCE ──
        senderType: m.sender_type || 'user',
        senderName: m.sender_type === 'user' ? 'You' : (m.character_name || 'Character'),
        senderCharacterId: m.character_id || null,
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
      };
    });

    const runtimeMs = Date.now() - scanStart;
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
      terminationReason,
      runtimeMs,
      scanStartDate: new Date().toISOString(),
      scanEndDate: SCAN_FLOOR,
      // Compound cursor info
      cursorStyle: 'compound_date_id_v3',
      dedupMethod: 'normalized_url_no_querystring',
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