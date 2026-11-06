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
const BATCH_SIZE = 500; // Larger batches = fewer API calls = less rate limiting
const SCAN_FLOOR = '2023-01-01T00:00:00.000Z'; // Extended back to catch all historical images
const MAX_RUNTIME_MS = 35000;

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

  // Split into lines to safely strip only header/footer blocks, never mid-content
  const lines = text.split('\n');
  const cleaned = [];
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect opening of a metadata block
    if (
      /^\[NAME REFERENCE KEY/i.test(trimmed) ||
      /^\[REFERENCE KEY/i.test(trimmed) ||
      /^\[PROVIDER INSTRUCTION/i.test(trimmed)
    ) {
      inBlock = true;
      continue;
    }
    // Detect closing of a metadata block
    if (
      /^\[END NAME REFERENCE KEY\]/i.test(trimmed) ||
      /^\[END REFERENCE KEY\]/i.test(trimmed)
    ) {
      inBlock = false;
      continue;
    }
    if (inBlock) continue;

    // Strip inline metadata markers from the line (non-destructive to surrounding text)
    let l = line
      .replace(/\[CHARACTER ID[^\]]*\]/gi, '')
      .replace(/\[IDENTITY LOCK[^\]]*\]/gi, '')
      .replace(/\(ID:\s*[a-z0-9]+\)/gi, '');

    // Skip pure assignment lines: "Name" = Full Name — desc
    if (/^\s*"[^"]*"\s*=\s*[^\n]*$/.test(l)) continue;
    // Strip [CHARACTER] / [USER] / [JOINT] as prefix or standalone
    l = l.replace(/^\s*\[(CHARACTER|USER|JOINT)\]\s*/i, '');
    // Strip leading "Generated character photo. Scene:" prefix
    l = l.replace(/^Generated character photo\.\s*Scene:\s*/i, '');

    cleaned.push(l);
  }

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Fetch a batch with retry on 429 rate limit errors.
 */
async function fetchBatchWithRetry(base44, conversationIds, sortField, batchSize, offset, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await base44.entities.Message.filter(
        { conversation_id: { $in: conversationIds } },
        sortField,
        batchSize,
        offset
      );
    } catch (e) {
      const is429 = e?.message?.includes('429') || e?.message?.includes('Rate limit');
      if (is429 && attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
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

    const {
      page = 1,
      pageSize = PAGE_SIZE,
      searchTerm = '',
      folderKey = null,
      mode = 'images',
    } = await req.json();
    const ownerEmail = user.email;
    const safePageSize = Math.max(1, Math.min(50, pageSize));
    const safePage = Math.max(1, page);
    const imageStartIndex = (safePage - 1) * safePageSize;
    const imageEndIndex = imageStartIndex + safePageSize;
    const isFolderMode = mode === 'folders';
    // Folder mode indexes every folder, so it never early-exits.
    const neededImages = isFolderMode ? Number.MAX_SAFE_INTEGER : imageEndIndex + 1; // +1 to prove hasMore
    const searchLower = (searchTerm || '').toLowerCase().trim();
    const requestedFolderKey = typeof folderKey === 'string' && folderKey ? folderKey : null;

    console.log(`[fetchMediaGalleryPage] v5 owner=${ownerEmail} mode=${mode} folder=${requestedFolderKey || 'ALL'} page=${safePage} pageSize=${safePageSize} imageStart=${imageStartIndex}`);

    // ── FETCH CONVERSATIONS ──────────────────────────────────────────────────
    // Scoped by created_by OR owner_email so both user-created conversations
    // (created_by = user email) and service-role-created story_event conversations
    // (created_by = service email, owner_email = user email) are discovered.
    //
    // Paginated fetch to avoid 500-record cap that could miss older conversations.
    let userConversations = [];
    const CONVO_BATCH = 500;
    let convoOffset = 0;
    let convoExhausted = false;
    const convoQuery = { $or: [{ created_by: ownerEmail }, { owner_email: ownerEmail }] };

    while (!convoExhausted) {
      let batch = [];
      try {
        batch = await base44.entities.Conversation.filter(
          convoQuery,
          '-created_date',
          CONVO_BATCH,
          convoOffset
        );
      } catch {
        try {
          batch = await base44.asServiceRole.entities.Conversation.filter(
            convoQuery,
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

    // ── FOLDER CONTEXT ───────────────────────────────────────────────────────
    // A folder is resolved from the EXISTING generation context of each image:
    //   Story Event  → the conversation is a Story Event conversation, or the
    //                  generation context says story_event
    //   Character    → the image lives in that character's own chat/text
    //                  conversation (exactly one character in the conversation)
    //   Miscellaneous→ anything that cannot be reliably attributed
    // Appearance or names inside a description are never used to assign a folder.
    const conversationMetaById = {};
    for (const c of userConversations || []) {
      conversationMetaById[c.id] = {
        character_ids: Array.isArray(c.character_ids) ? c.character_ids.filter(Boolean) : [],
        title: c.title || '',
      };
    }

    const candidateCharacterIds = [...new Set(
      Object.values(conversationMetaById)
        .filter((c) => c.character_ids.length === 1 && !c.title.startsWith('story_event::'))
        .map((c) => c.character_ids[0])
    )];

    const characterNameById = {};
    for (let i = 0; i < candidateCharacterIds.length; i += 40) {
      const chunk = candidateCharacterIds.slice(i, i + 40);
      // $or of exact ids — the id field does not accept $in queries.
      const chars = await base44.entities.Character
        .filter({ $or: chunk.map((id) => ({ id })) }, null, 40)
        .catch(() => []);
      for (const ch of chars || []) {
        const nm = ch.display_name || ch.name || null;
        if (nm) characterNameById[ch.id] = nm;
      }
    }

    // Readable fallback name for a folder whose character record is unavailable
    // (e.g. a character deleted before the folder was organized).
    function nameFromConversationTitle(title) {
      if (!title || title.startsWith('story_event::')) return null;
      const base = title.replace(/^(direct|phone|text|chat)\s+with\s+/i, '').split('::')[0].trim();
      if (!base) return null;
      if (/^[0-9a-f-]{16,}$/i.test(base.replace(/\s/g, ''))) return null;
      return base;
    }

    const storyEventTitleById = {};
    const storyEvents = await base44.entities.StoryEvent.filter({ owner_email: ownerEmail }, '-event_date', 500).catch(() => []);
    for (const ev of storyEvents || []) {
      if (ev?.id) storyEventTitleById[ev.id] = ev.title || null;
    }

    function resolveFolderForMessage(m) {
      const gc = m.generation_context || {};
      const conv = conversationMetaById[m.conversation_id] || { character_ids: [], title: '' };
      const origin = typeof gc.context_origin === 'string' ? gc.context_origin : '';
      const titleIsStoryEvent = conv.title.startsWith('story_event::');
      if (origin.startsWith('story_event') || titleIsStoryEvent) {
        const storyEventId = titleIsStoryEvent
          ? conv.title.slice('story_event::'.length).split('::')[0]
          : (gc.story_event_id || null);
        return { key: 'story_events', kind: 'story_events', name: 'Story Events', characterId: null, storyEventId };
      }
      if (conv.character_ids.length === 1) {
        const characterId = conv.character_ids[0];
        return {
          key: `character:${characterId}`,
          kind: 'character',
          name: characterNameById[characterId] || nameFromConversationTitle(conv.title),
          characterId,
          storyEventId: null,
        };
      }
      return { key: 'miscellaneous', kind: 'miscellaneous', name: 'Miscellaneous', characterId: null, storyEventId: null };
    }

    function buildSearchHaystack(m, folder) {
      const gc = m.generation_context || {};
      const subjects = Array.isArray(gc.subjects) ? gc.subjects : [];
      const dateStr = m.created_date ? String(m.created_date).slice(0, 10) : '';
      return [
        m.image_description,
        gc.scene_prompt,
        gc.original_raw_prompt,
        gc.resolved_description,
        (gc.prompt && gc.prompt.length < 2000) ? gc.prompt : null,
        m.character_name,
        gc.location_name,
        gc.zone_name,
        folder.kind === 'story_events' ? 'story events' : null,
        folder.kind === 'miscellaneous' ? 'miscellaneous' : null,
        folder.characterId ? (characterNameById[folder.characterId] || '') : null,
        folder.storyEventId ? (storyEventTitleById[folder.storyEventId] || '') : null,
        ...subjects.map((s) => s?.subject_name).filter(Boolean),
        dateStr,
      ].filter(Boolean).join(' ').toLowerCase();
    }

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
    const folderStats = {};
    const imageFolderById = {};
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
        batch = await fetchBatchWithRetry(base44, conversationIds, '-created_date', BATCH_SIZE, offset);
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

        const folder = resolveFolderForMessage(m);

        // ── FOLDER AGGREGATION (all folders, independent of the requested folder) ──
        const agg = folderStats[folder.key] || (folderStats[folder.key] = {
          key: folder.key,
          kind: folder.kind,
          characterId: folder.characterId,
          name: folder.name,
          count: 0,
          coverImageUrl: null,
          lastImageAt: null,
        });
        if (!agg.name && folder.name) agg.name = folder.name;
        if (!agg.coverImageUrl) {
          agg.coverImageUrl = m.image_url;
          agg.lastImageAt = m.created_date || null;
        }
        agg.count++;

        // Apply folder filter
        if (requestedFolderKey && folder.key !== requestedFolderKey) continue;

        // Apply search filter — matches names, descriptions, prompts, Story Event
        // titles, location, subjects and dates.
        if (searchLower && !buildSearchHaystack(m, folder).includes(searchLower)) continue;

        seenNormalizedUrls.add(dedupKey);
        imageFolderById[m.id] = folder;
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

    // ── FOLDER MODE: return the organized folder view ─────────────────────────
    if (isFolderMode) {
      let storedFolders = [];
      try {
        storedFolders = (await base44.entities.MediaGalleryFolder.filter({ owner_email: ownerEmail }, null, 500)) || [];
      } catch {
        storedFolders = [];
      }
      const storedByKey = {};
      for (const f of storedFolders) storedByKey[f.folder_key] = f;

      // Story Events and Miscellaneous always exist as destinations.
      const allKeys = new Set(['story_events', 'miscellaneous', ...Object.keys(folderStats)]);

      const folders = [...allKeys].map((key) => {
        const agg = folderStats[key] || null;
        const stored = storedByKey[key] || null;
        const kind = agg?.kind || stored?.folder_kind ||
          (key === 'story_events' ? 'story_events' : key === 'miscellaneous' ? 'miscellaneous' : 'character');
        const characterId = agg?.characterId || stored?.character_id ||
          (key.startsWith('character:') ? key.slice('character:'.length) : null);
        // Live character name first, then the name captured when the folder was
        // organized (kept after the character is deleted).
        const name = (characterId ? characterNameById[characterId] : null)
          || stored?.folder_name
          || agg?.name
          || (kind === 'story_events' ? 'Story Events'
            : kind === 'miscellaneous' ? 'Miscellaneous'
            : characterId ? `Character ${characterId.slice(-4)}` : 'Folder');

        return {
          key,
          kind,
          name,
          characterId,
          imageCount: agg?.count || 0,
          coverImageUrl: agg?.coverImageUrl || stored?.cover_image_url || null,
          lastImageAt: agg?.lastImageAt || stored?.last_image_at || null,
          canDelete: kind === 'character',
        };
      });

      folders.sort((a, b) => {
        const rank = (f) => (f.kind === 'character' ? 0 : f.kind === 'story_events' ? 1 : 2);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return (a.name || '').localeCompare(b.name || '');
      });

      const toCreate = folders
        .filter((f) => !storedByKey[f.key] && (f.imageCount > 0 || f.kind !== 'character'))
        .map((f) => ({
          owner_email: ownerEmail,
          folder_key: f.key,
          folder_name: f.name,
          folder_kind: f.kind,
          character_id: f.characterId || null,
          cover_image_url: f.coverImageUrl || null,
          last_image_at: f.lastImageAt || null,
        }));
      if (toCreate.length > 0) {
        await base44.entities.MediaGalleryFolder.bulkCreate(toCreate).catch(() => {});
      }

      return Response.json({
        mode: 'folders',
        folders,
        totalImages: imageIndex.length,
        currentUserEmail: ownerEmail,
        proof: {
          messagesScanned,
          terminationReason,
          runtimeMs: Date.now() - scanStart,
          uniqueImagesCollected: imageIndex.length,
        },
      });
    }

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
      const folderInfo = imageFolderById[m.id] || resolveFolderForMessage(m);

      // Best display prompt — in priority order, with metadata stripping.
      // gc.prompt can be a large provider blob OR a short legacy scene description.
      // We use original_raw_prompt and scene_prompt first (most reliable).
      // gc.prompt is used as last resort — stripped of metadata regardless of length.
      const gcPromptIfUsable = gc?.prompt || null;

      // Resolve raw prompt first, then strip metadata
      const rawDisplayPrompt =
        gc?.original_raw_prompt ||
        gc?.scene_prompt ||
        m.image_description ||
        gc?.resolved_description ||
        gcPromptIfUsable ||
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
        folderKey: folderInfo.key,
        folderKind: folderInfo.kind,
        folderName: folderInfo.kind === 'story_events' ? 'Story Events'
          : folderInfo.kind === 'miscellaneous' ? 'Miscellaneous'
          : (folderInfo.characterId ? (characterNameById[folderInfo.characterId] || null) : null),
        storyEventId: folderInfo.storyEventId || null,
        storyEventTitle: folderInfo.storyEventId ? (storyEventTitleById[folderInfo.storyEventId] || null) : null,
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