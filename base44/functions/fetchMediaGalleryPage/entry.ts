/**
 * fetchMediaGalleryPage — IMAGE-UNIT PAGINATION v4 (OFFSET-BASED)
 *
 * ROOT CAUSE FIX: Date-cursor pagination ($lt on created_date) does not work
 * in the Base44 SDK. Verified by diagnoseCursorBehavior: compound cursor and
 * simple $lt cursor both return empty after batch 1. Only offset pagination works.
 *
 * CHANGE: Replaced cursor-based scan with offset-based scan.
 * PRESERVED: All dedup logic, metadata fields, generation_context, classification,
 *            ownership scoping, sorting, and proof structure.
 *
 * PAGINATION MODEL:
 *   - Scan ALL messages in batches using offset increment
 *   - Collect unique images (dedup by normalized URL)
 *   - Sort by created_date DESC, id DESC (stable)
 *   - Slice page [imageStart..imageEnd)
 *   - hasMore = collected > imageEnd
 *
 * OWNERSHIP:
 *   - Conversations scoped by created_by (Base44 built-in field)
 *   - Justification: Conversation entity uses created_by for user scoping
 *   - Characters use owner_email (different entity, different field)
 *   - This is the same path the app uses for all conversation queries
 *
 * SCAN FLOOR: 2025-01-01T00:00:00.000Z
 * MAX RUNTIME: 25 seconds
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PAGE_SIZE = 20;
const BATCH_SIZE = 200;
const SCAN_FLOOR = '2025-01-01T00:00:00.000Z';
const MAX_RUNTIME_MS = 25000;

/**
 * Normalize URL for deduplication — strips query strings (signed tokens, CDN params).
 */
function normalizeUrlForDedup(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    const qIdx = url.indexOf('?');
    return qIdx !== -1 ? url.slice(0, qIdx) : url;
  }
}

/**
 * Strip internal metadata from prompts — CANONICAL SANITIZER.
 * Must match the frontend modal's stripInternalMetadata exactly.
 * Used for backend displayPrompt resolution AND for preparing
 * prompts before sending to characters.
 */
function stripInternalMetadata(text) {
  if (!text) return text;
  
  // Remove multiline blocks: [NAME REFERENCE KEY ... [END NAME REFERENCE KEY]
  // This must happen FIRST, before other replacements, to catch multiline content
  let result = text.replace(
    /\[NAME REFERENCE KEY[^\]]*?\][\s\S]*?\[END NAME REFERENCE KEY\]/g,
    ''
  );
  
  result = result
    .replace(/\[REFERENCE KEY[^\]]*?\][\s\S]*?\[END REFERENCE KEY\]/g, '')
    .replace(/\[CHARACTER ID[^\]]*?\]/g, '')
    .replace(/\[IDENTITY LOCK[^\]]*?\]/g, '')
    .replace(/\[PROVIDER INSTRUCTION[^\]]*?\]/g, '')
    .replace(/\(ID:\s*[a-z0-9]+\)/gi, '')
    // Character assignment lines: "Name" = Full Name — description
    .replace(/^\s*"[^"]*"\s*=\s*[^\n]*$/gm, '')
    // Remove "[CHARACTER]", "[USER]", "[JOINT]" markers
    .replace(/^\[CHARACTER\]\s*/im, '')
    .replace(/^\[USER\]\s*/im, '')
    .replace(/^\[JOINT\]\s*/im, '')
    // Remove "Generated character photo. Scene:" prefix
    .replace(/^Generated character photo\.\s*Scene:\s*/im, '')
    // Collapse multiple newlines
    .replace(/\n\n+/g, '\n\n')
    // Trim all lines
    .replace(/^\s+|\s+$/gm, '')
    .trim();
  
  return result;
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
    const neededImages = imageEndIndex + 1; // +1 to prove hasMore
    const searchLower = (searchTerm || '').toLowerCase().trim();

    console.log(`[fetchMediaGalleryPage] v4 owner=${ownerEmail} page=${safePage} pageSize=${safePageSize} imageStart=${imageStartIndex} neededImages=${neededImages}`);

    // ── FETCH CONVERSATIONS ──────────────────────────────────────────────────
    // Scoped by created_by (Conversation entity's legacy Base44 scope field).
    // NOTE: Conversation-only legacy scoping exception — created_by is the user ownership
    // field for Conversations in Base44. This is documented as a legacy exception.
    // owner_email is preferred for Characters and Messages; future Conversation writes
    // should include owner_email but created_by remains the query path for existing records.
    //
    // Paginated fetch to avoid 500-record cap that could miss older conversations.
    let userConversations = [];
    const CONVO_BATCH = 500;
    let convoOffset = 0;
    let convoExhausted = false;

    while (!convoExhausted) {
      let batch = [];
      try {
        batch = await base44.entities.Conversation.filter(
          { created_by: ownerEmail },
          '-created_date',
          CONVO_BATCH,
          convoOffset
        );
      } catch {
        try {
          batch = await base44.asServiceRole.entities.Conversation.filter(
            { created_by: ownerEmail },
            '-created_date',
            CONVO_BATCH,
            convoOffset
          );
        } catch (e) {
          if (convoOffset === 0) {
            return Response.json({ error: `Conversation fetch failed: ${e.message}` }, { status: 500 });
          }
          // Partial failure after first batch — use what we have
          convoExhausted = true;
          break;
        }
      }

      if (!batch || batch.length === 0) {
        convoExhausted = true;
        break;
      }

      userConversations = userConversations.concat(batch);
      convoOffset += CONVO_BATCH;

      if (batch.length < CONVO_BATCH) {
        convoExhausted = true;
        break;
      }

      // Safety cap: max 5000 conversations
      if (userConversations.length >= 5000) {
        console.warn(`[fetchMediaGalleryPage] Conversation cap hit at ${userConversations.length}`);
        break;
      }
    }

    const conversationIds = (userConversations || []).map(c => c.id).filter(Boolean);
    console.log(`[fetchMediaGalleryPage] ${conversationIds.length} conversations (fetched in ${Math.ceil(convoOffset/CONVO_BATCH)} batches)`);

    if (conversationIds.length === 0) {
      const emptyProof = {
        requestedPage: safePage, pageSize: safePageSize, imageStartIndex, imageEndIndex,
        messagesScanned: 0, batchCount: 0, uniqueImagesCollected: 0,
        exhaustedAllMessages: true, enoughForRequestedPage: false, hasMore: false,
        terminationReason: 'no_conversations', runtimeMs: Date.now() - scanStart,
        scanEndDate: SCAN_FLOOR, cursorStyle: 'offset_v4',
        dedupMethod: 'normalized_url_no_querystring',
        pageImagesReturned: 0, skip: imageStartIndex,
        firstImageId: null, lastImageId: null,
        rawScanned: 0, validFound: 0, batchesScanned: 0,
        currentUserEmail: ownerEmail,
      };
      return Response.json({ images: [], currentUserEmail: ownerEmail, page: safePage, pageSize: safePageSize, totalImages: 0, hasMore: false, enoughForRequestedPage: false, proof: emptyProof });
    }

    // ── OFFSET-BASED SCAN LOOP ───────────────────────────────────────────────
    // Uses offset increment instead of cursor — proven to work by diagnoseCursorBehavior.
    const seenNormalizedUrls = new Set();
    const imageIndex = [];
    let offset = 0;
    let batchCount = 0;
    let messagesScanned = 0;
    let exhaustedAllMessages = false;
    let terminationReason = 'in_progress';
    const scanFloorMs = new Date(SCAN_FLOOR).getTime();

    while (true) {
      // Runtime guard
      if (Date.now() - scanStart > MAX_RUNTIME_MS) {
        terminationReason = 'runtime_limit';
        console.warn(`[fetchMediaGalleryPage] Runtime limit at offset=${offset} images=${imageIndex.length}`);
        break;
      }

      // Early exit: have enough images for this page + hasMore proof
      if (imageIndex.length >= neededImages) {
        terminationReason = 'enough_images';
        break;
      }

      batchCount++;
      let batch;
      try {
        batch = await base44.entities.Message.filter(
          { conversation_id: { $in: conversationIds } },
          '-created_date',
          BATCH_SIZE,
          offset
        );
      } catch {
        try {
          batch = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: { $in: conversationIds } },
            '-created_date',
            BATCH_SIZE,
            offset
          );
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

      // ── EXTRACT & DEDUP IMAGES ────────────────────────────────────────────
      for (const m of batch) {
        if (!m.image_url) continue;
        if (m.recovery_signal === true) continue;

        // Check scan floor
        if (m.created_date) {
          const msgMs = new Date(m.created_date).getTime();
          if (msgMs < scanFloorMs) continue; // skip pre-floor messages
        }

        const dedupKey = normalizeUrlForDedup(m.image_url);
        if (seenNormalizedUrls.has(dedupKey)) continue;

        // Apply search filter
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
      
      // Diagnostic: log messages without resolvable displayPrompt
      const emptyPromptCount = imageIndex.filter(m => {
        const gc = m.generation_context || {};
        const hasPrompt = gc?.original_raw_prompt || gc?.scene_prompt || m.image_description || gc?.resolved_description || (gc?.prompt && gc.prompt.length < 2000);
        return !hasPrompt;
      }).length;
      if (emptyPromptCount > 0) {
        console.warn(`[fetchMediaGalleryPage] Batch ${batchCount}: ${emptyPromptCount} images have no resolvable displayPrompt`);
      }

      console.log(`[fetchMediaGalleryPage] Batch ${batchCount} offset=${offset}: ${batch.length} msgs → ${imageIndex.length} unique images`);

      offset += BATCH_SIZE;

      // Check if we hit the end
      if (batch.length < BATCH_SIZE) {
        terminationReason = 'exhausted_messages';
        exhaustedAllMessages = true;
        break;
      }
    }

    if (terminationReason === 'in_progress') terminationReason = 'safety_cap';

    // ── SORT DETERMINISTICALLY: created_date DESC, id DESC ──────────────────
    imageIndex.sort((a, b) => {
      const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
      const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      return (b.id || '').localeCompare(a.id || '');
    });

    const uniqueImagesCollected = imageIndex.length;
    const enoughForRequestedPage = uniqueImagesCollected > imageStartIndex;
    const hasMore = uniqueImagesCollected > imageEndIndex;

    // ── SLICE THE REQUESTED PAGE ─────────────────────────────────────────────
    const pageSlice = enoughForRequestedPage
      ? imageIndex.slice(imageStartIndex, imageEndIndex)
      : [];

    // ── SHAPE OUTPUT ─────────────────────────────────────────────────────────
    const pageImages = pageSlice.map((m) => {
      const gc = m.generation_context || null;

      // Best display prompt — in priority order, with metadata stripping.
      // gc.prompt can be:
      //   - modern: 10,000+ char provider instruction blob (never display)
      //   - legacy: short readable scene description stored before scene_prompt was added
      // Threshold: 2000 chars. Above 2000 chars is almost certainly a provider blob.
      const gcPromptIfReadable = (gc?.prompt && gc.prompt.length < 2000) ? gc.prompt : null;
      
      // Resolve raw prompt first, then strip metadata
      const rawDisplayPrompt =
        gc?.original_raw_prompt ||
        gc?.scene_prompt ||
        m.image_description ||
        gc?.resolved_description ||
        gcPromptIfReadable ||
        null;

      // Strip internal metadata from the resolved prompt
      const displayPrompt = rawDisplayPrompt ? stripInternalMetadata(rawDisplayPrompt) : null;

      // Subject metadata
      const subjects = gc?.subjects || [];
      const subjectIds = subjects.map(s => s.subject_id).filter(Boolean);
      const subjectNames = subjects.map(s => s.subject_name).filter(Boolean);

      // Image classification
      let imageCategory = 'unknown';
      if (gc) {
        imageCategory = (gc.prompt || gc.original_raw_prompt || gc.scene_prompt)
          ? 'ai_generated_with_context'
          : 'ai_generated_missing_context';
      } else if (m.sender_type === 'character') {
        imageCategory = 'character_sent_image';
      } else if (m.sender_type === 'user') {
        imageCategory = 'user_uploaded';
      } else {
        imageCategory = 'legacy_missing_context';
      }

      return {
        id: m.id,
        url: m.image_url,
        description: displayPrompt || null,  // Already cleaned
        imageDescription: m.image_description || '',
        displayPrompt,  // Cleaned, human-readable prompt
        originalPrompt: displayPrompt,  // For backward compat
        generationPrompt: gc?.prompt || null,
        scenePrompt: gc?.scene_prompt || null,
        imageType: gc?.image_type || gc?.subject_type || null,
        subjects,
        subjectIds,
        subjectNames,
        subjectCount: gc?.subject_count || subjects.length || 0,
        locationName: gc?.location_name || gc?.locationName || null,
        locationId: gc?.location_id || null,
        zoneName: gc?.zone_name || gc?.zoneName || null,
        // Provide both raw and cleaned generation_context for send-to-character
        generationContext: gc ? {
          ...gc,
          // Add cleaned versions for send-to-character paths
          _cleaned_original_raw_prompt: gc?.original_raw_prompt ? stripInternalMetadata(gc.original_raw_prompt) : null,
          _cleaned_scene_prompt: gc?.scene_prompt ? stripInternalMetadata(gc.scene_prompt) : null,
          _cleaned_resolved_description: gc?.resolved_description ? stripInternalMetadata(gc.resolved_description) : null,
        } : null,
        imageCategory,
        _diag: {
          hasGenerationContext: !!gc,
          gcPromptLength: gc?.prompt?.length || 0,
          hasScenePrompt: !!gc?.scene_prompt,
          hasOriginalRawPrompt: !!gc?.original_raw_prompt,
          hasImageDescription: !!m.image_description,
          displayPromptLength: displayPrompt?.length || 0,
          imageCategory,
          metadataWasStripped: rawDisplayPrompt !== displayPrompt,
        },
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
      requestedPage: safePage,
      pageSize: safePageSize,
      imageStartIndex,
      imageEndIndex,
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
      cursorStyle: 'offset_v4',
      dedupMethod: 'normalized_url_no_querystring',
      pageImagesReturned: pageImages.length,
      firstImageId: pageImages[0]?.id || null,
      firstImageUrl: pageImages[0]?.url || null,
      firstImageDate: pageImages[0]?.timestamp || null,
      lastImageId: pageImages[pageImages.length - 1]?.id || null,
      lastImageUrl: pageImages[pageImages.length - 1]?.url || null,
      lastImageDate: pageImages[pageImages.length - 1]?.timestamp || null,
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

    console.log(`[fetchMediaGalleryPage] RESULT: page=${safePage} returned=${pageImages.length} uniqueImages=${uniqueImagesCollected} batches=${batchCount} msgsScanned=${messagesScanned} hasMore=${hasMore} runtime=${runtimeMs}ms`);

    if (!enoughForRequestedPage) {
      console.warn(`[fetchMediaGalleryPage] WARNING: Not enough for page ${safePage}. Only ${uniqueImagesCollected} unique images found.`);
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