import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { X, Send, Trash2, Search, ArrowLeft, RefreshCw } from 'lucide-react';
import { lfcRead, lfcWrite, lfcDelete } from '@/lib/localFirstCache';

function galleryPageCacheKey(ownerEmail, page, search, pageSize = 20) {
  const s = (search || '').trim().toLowerCase();
  const owner = (ownerEmail || 'anon').replace(/[^a-z0-9]/gi, '_');
  return `mediaGallery:v2:${owner}:page:${page}:ps:${pageSize}:search:${s}`;
}

const GALLERY_STALE_MS = 5 * 60 * 1000;

export default function MediaGallery() {
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [pageImages, setPageImages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initSettled, setInitSettled] = useState(false);
  const [lastProof, setLastProof] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState('');

  // Cross-page dedup: tracks ALL image IDs seen across every page loaded this session.
  // Prevents duplicate images from appearing when backend re-scans overlap page boundaries.
  const seenImageIdsRef = useRef(new Set());

  const activeRequestRef = useRef(0);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  const fetchPage = useCallback(async (page, search, opts = {}) => {
    if (!user?.email) return;
    const { forceRefresh = false } = opts;

    const cacheKey = galleryPageCacheKey(user.email, page, search);
    const requestId = ++activeRequestRef.current;

    // ── STEP 1: Serve cache immediately (local-first) ─────────────────────────
    const cached = lfcRead(user.email, cacheKey);
    const cacheAge = cached?.loaded_at ? Date.now() - cached.loaded_at : Infinity;
    const isCacheStale = cacheAge > GALLERY_STALE_MS;

    if (cached?.data?.images?.length > 0 && !forceRefresh) {
      console.log(`[MediaGallery] Cache HIT page=${page} age=${Math.round(cacheAge/1000)}s stale=${isCacheStale}`);
      setPageImages(cached.data.images);
      setHasMore(cached.data.hasMore === true);
      setLastProof(cached.data.proof || null);
      setIsLoading(false);
      setInitSettled(true);
      if (!isCacheStale) return;
      setIsRefreshing(true);
    } else {
      console.log(`[MediaGallery] Cache MISS page=${page} — cold load`);
      setIsLoading(true);
    }

    // ── STEP 2: Fetch from backend ─────────────────────────────────────────────
    try {
      const res = await base44.functions.invoke('fetchMediaGalleryPage', {
        page,
        pageSize: 20,
        searchTerm: search,
      });

      if (requestId !== activeRequestRef.current) {
        console.log(`[MediaGallery] Stale response for page=${page} — discarded`);
        return;
      }

      const data = res?.data;
      if (!data) throw new Error('No data returned');

      let freshImages = data.images || [];

      // ── CLIENT-SIDE CROSS-PAGE DEDUP ──────────────────────────────────────────
      // The backend rescans from scratch per page request. If the image set shifted
      // between requests (new messages), the backend may return images that were
      // already shown on a previous page. Filter those out using the session-scoped
      // seen-IDs set so the user never sees the same image twice across pages.
      // Note: do NOT add to seenImageIdsRef here for the current page — only for
      // previously loaded pages. We reset the set when navigating to a new page.
      const dedupedImages = freshImages.filter(img => !seenImageIdsRef.current.has(img.id));
      if (dedupedImages.length < freshImages.length) {
        console.warn(`[MediaGallery] Client dedup removed ${freshImages.length - dedupedImages.length} duplicate(s) on page=${page}`);
      }
      // Track these IDs as seen for future pages
      dedupedImages.forEach(img => seenImageIdsRef.current.add(img.id));

      if (dedupedImages.length > 0) {
        lfcWrite(user.email, cacheKey, {
          images: dedupedImages,
          hasMore: data.hasMore === true,
          proof: data.proof,
        });
      }

      if (dedupedImages.length > 0) {
        setPageImages(dedupedImages);
      }
      setHasMore(data.hasMore === true);
      setLastProof(data.proof || null);

    } catch (e) {
      // Never clear pageImages on error — preserve last-known-good state
      console.error('[MediaGallery] fetchPage error:', e.message);
    } finally {
      if (requestId === activeRequestRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        setInitSettled(true);
      }
    }
  }, [user?.email]); // eslint-disable-line

  useEffect(() => {
    if (user?.email) {
      fetchPage(currentPage, searchTerm);
    }
  }, [user?.email, currentPage, searchTerm, fetchPage]);

  // Reset initSettled and seenIds tracking when page/search changes
  useEffect(() => {
    setInitSettled(false);
    // When navigating to a different page, clear the seen-IDs so the new page
    // can show all its images. We track seen IDs only within a page's fetch cycle.
    seenImageIdsRef.current = new Set();
  }, [currentPage, searchTerm]);

  const handleNext = () => setCurrentPage(p => p + 1);
  const handlePrev = () => { if (currentPage > 1) setCurrentPage(p => p - 1); };

  const handlePageJump = () => {
    const page = parseInt(pageJumpValue, 10);
    if (!page || page < 1) return;
    setCurrentPage(page);
    setPageJumpValue('');
  };

  const handleSearchChange = (val) => {
    setSearchTerm(val);
    setCurrentPage(1);
    setHasMore(true);
  };

  const handleManualRefresh = () => {
    seenImageIdsRef.current = new Set();
    fetchPage(currentPage, searchTerm, { forceRefresh: true });
  };

  const handleDeleteImage = async (image) => {
    if (!user?.email) { alert('User not authenticated'); return; }
    try {
      const res = await base44.functions.invoke('deleteMediaGalleryImage', {
        messageId: image.messageId,
        parentEntity: image.parent_entity,
      });
      if (res?.data?.success) {
        setSelectedImage(null);
        const cacheKey = galleryPageCacheKey(user.email, currentPage, searchTerm);
        lfcDelete(user.email, cacheKey);
        seenImageIdsRef.current = new Set();
        fetchPage(currentPage, searchTerm, { forceRefresh: true });
      } else {
        alert(`Delete denied: ${res?.data?.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('[MediaGallery] Delete failed:', e);
      alert(`Delete failed: ${e.message}`);
    }
  };

  const showSpinner = isLoading && pageImages.length === 0 && !initSettled;
  const showEmpty = initSettled && !isLoading && pageImages.length === 0;
  const showGrid = pageImages.length > 0;

  return (
    <div className="min-h-screen bg-background p-6" style={{ paddingTop: 'max(1.5rem, calc(1.5rem + env(safe-area-inset-top)))' }}>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Media Gallery</h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                Page {currentPage}{hasMore ? '+' : ''} • {pageImages.length} images
                {isRefreshing && <RefreshCw className="w-3 h-3 animate-spin opacity-50" />}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualRefresh}
              disabled={isLoading || isRefreshing}
              className="p-2 rounded-lg bg-secondary/40 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              title="Refresh gallery"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="text-xs px-2 py-1 rounded-lg bg-secondary/40 text-muted-foreground hover:text-foreground"
            >
              {showDiagnostics ? 'Hide' : 'Show'} diagnostics
            </button>
          </div>
        </div>

        {showDiagnostics && lastProof && (
          <div className="mb-6 p-4 rounded-lg bg-secondary/20 border border-border text-xs font-mono text-muted-foreground space-y-1">
            <div><strong>Gallery Diagnostics v3 — Page {currentPage}</strong></div>
            <div>owner: {user?.email || 'unknown'}</div>
            <div>initSettled: {initSettled ? 'YES' : 'no'} | isLoading: {isLoading ? 'yes' : 'NO'} | isRefreshing: {isRefreshing ? 'yes' : 'NO'}</div>
            <div>imageStart: {lastProof.imageStartIndex ?? lastProof.skip ?? 'n/a'} | imageEnd: {lastProof.imageEndIndex ?? 'n/a'} | pageSize: {lastProof.pageSize}</div>
            <div>uniqueImages: {lastProof.uniqueImagesCollected ?? lastProof.validFound ?? 'n/a'} | returned: {lastProof.pageImagesReturned}</div>
            <div>msgsScanned: {lastProof.messagesScanned ?? lastProof.rawScanned ?? 'n/a'} | batches: {lastProof.batchCount ?? lastProof.batchesScanned}</div>
            <div>exhausted: {lastProof.exhaustedAllMessages ? 'YES' : 'no'} | enoughForPage: {lastProof.enoughForRequestedPage !== false ? 'YES' : 'NO ⚠️'}</div>
            <div>terminated: <strong>{lastProof.terminationReason || 'n/a'}</strong> | runtime: {lastProof.runtimeMs != null ? `${lastProof.runtimeMs}ms` : 'n/a'}</div>
            <div>dedup: {lastProof.dedupMethod || 'n/a'} | cursor: {lastProof.cursorStyle || 'n/a'}</div>
            <div>scanFloor: {lastProof.scanEndDate || '2025-01-01'}</div>
            <div>firstId: {lastProof.firstImageId || 'n/a'} | firstDate: {lastProof.firstImageDate || lastProof.firstImageTimestamp || 'n/a'}</div>
            <div>lastId: {lastProof.lastImageId || 'n/a'} | lastDate: {lastProof.lastImageDate || lastProof.lastImageTimestamp || 'n/a'}</div>
            <div>hasMore: {lastProof.hasMore ? 'yes' : 'no'}</div>
          </div>
        )}

        <div className="mb-6 flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or description..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder-muted-foreground"
          />
        </div>

        {showSpinner ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full" />
          </div>
        ) : showEmpty ? (
          <div className="text-center py-12 text-muted-foreground">
            {lastProof && lastProof.enoughForRequestedPage === false
              ? `Page ${currentPage} is beyond the gallery. Only ${lastProof.uniqueImagesCollected ?? 0} unique images found.`
              : searchTerm ? 'No images match your search.' : 'No media found. Images you send and receive will appear here.'}
          </div>
        ) : !showGrid ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
              {pageImages.map((item) => (
                <div
                  key={item.id}
                  className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer border border-border hover:border-primary/50 transition-all"
                  onClick={() => setSelectedImage(item)}
                >
                  <img
                    src={item.url}
                    alt={item.description || 'Gallery image'}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => {
                      e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23333%22 width=%22200%22 height=%22200%22/%3E%3C/svg%3E';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Send className="w-5 h-5 text-white" />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-4 mb-8 flex-wrap">
              <button
                onClick={handlePrev}
                disabled={currentPage === 1 || isLoading}
                className="px-4 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Page:</span>
                <input
                  type="number"
                  min="1"
                  value={pageJumpValue}
                  placeholder={String(currentPage)}
                  onChange={(e) => setPageJumpValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePageJump(); }}
                  className="w-16 px-2 py-1 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:border-primary"
                />
                {pageJumpValue && (
                  <button
                    onClick={handlePageJump}
                    className="px-2 py-1 rounded-lg bg-primary text-primary-foreground text-xs font-medium"
                  >
                    Go
                  </button>
                )}
              </div>

              <span className="text-sm text-muted-foreground">Page {currentPage}{hasMore ? '+' : ''}</span>

              <button
                onClick={handleNext}
                disabled={!hasMore || isLoading || (lastProof && lastProof.enoughForRequestedPage === false)}
                className="px-4 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
              {lastProof && lastProof.terminationReason === 'runtime_limit' && (
                <div className="w-full text-center text-xs text-amber-400/80 mt-1">
                  ⚠ Scan hit time limit — some older images may not be indexed yet. Try refreshing.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selectedImage && (
        <ImageDetailModal
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
          onSend={() => setShowSendModal(true)}
          onDelete={() => handleDeleteImage(selectedImage)}
        />
      )}

      {showSendModal && selectedImage && (
        <SendImageModal
          image={selectedImage}
          onClose={() => setShowSendModal(false)}
          onSent={() => { setShowSendModal(false); setSelectedImage(null); }}
        />
      )}
    </div>
  );
}

function ImageDetailModal({ image, onClose, onSend, onDelete }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="relative flex-shrink-0">
          <img
            src={image.url}
            alt={image.description}
            className="w-full max-h-64 object-contain"
          />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-2 bg-black/50 rounded-lg hover:bg-black/70"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">From</p>
            <p className="text-sm text-foreground">{image.senderName}</p>
          </div>
          {image.imageDescription && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Caption</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{image.imageDescription}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border p-4 bg-card flex gap-2">
          <button
            onClick={onSend}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center justify-center gap-2 text-sm font-medium"
          >
            <Send className="w-4 h-4" /> Send to Character
          </button>
          <button
            onClick={onDelete}
            className="px-4 py-2 bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SendImageModal({ image, onClose, onSent }) {
  const [characters, setCharacters] = useState([]);
  const [senderMode, setSenderMode] = useState('user');
  const [selectedSenderCharacterId, setSelectedSenderCharacterId] = useState(null);
  const [selectedRecipientCharacterIds, setSelectedRecipientCharacterIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sendLog, setSendLog] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!user?.email) return;
      try {
        const chars = await base44.entities.Character.filter(
          { owner_email: user.email, status: 'active' },
          'name',
          200
        );
        setCharacters(chars);
      } catch (e) {
        console.error('[SendImageModal] Failed to load characters:', e);
      }
    };
    load();
  }, [user?.email]);

  const groupedCharacters = useMemo(() => {
    const groups = { active_created: [], npc_regular: [], npc_family: [], npc_fictitious: [], other: [] };
    characters.forEach(char => {
      const type = char.character_type || 'other';
      const displayName = char.display_name || char.name;
      if (type === 'active_created_character') groups.active_created.push({ ...char, displayName });
      else if (type === 'npc_regular') groups.npc_regular.push({ ...char, displayName });
      else if (type === 'npc_family_member') groups.npc_family.push({ ...char, displayName });
      else if (type === 'npc_fictitious') groups.npc_fictitious.push({ ...char, displayName });
      else groups.other.push({ ...char, displayName });
    });
    Object.keys(groups).forEach(key => groups[key].sort((a, b) => a.displayName.localeCompare(b.displayName)));
    return groups;
  }, [characters]);

  /**
   * resolveConversationId — finds the correct existing conversation for a user↔character chat.
   *
   * ROOT CAUSE FIX: The previous implementation used `owner_email` to query Conversation,
   * but the Conversation entity uses `created_by` for RLS — not `owner_email`.
   * This caused the filter to return 0 results, fall through to `create()`,
   * and write the image message to a brand-new ghost conversation that Chat never rendered.
   *
   * Fix: Use `created_by` as the primary query field (matches actual RLS).
   * Also check `parent_conversation_id` from the image itself — this is the authoritative
   * conversation ID for user-mode sends since the image came FROM that conversation.
   */
  const resolveConversationId = async (charId, charName) => {
    // PRIORITY 1: Use the source conversation from the gallery image itself.
    // This is the most reliable path — the image's parent_conversation_id is
    // already the correct conversation for this character.
    if (image.parent_conversation_id) {
      console.log(`[SendImageModal] RESOLVE: Using parent_conversation_id from image → ${image.parent_conversation_id} | charId=${charId}`);
      return image.parent_conversation_id;
    }

    // PRIORITY 2: Search by created_by (actual RLS field) + client-side filter for charId
    console.log(`[SendImageModal] RESOLVE: No parent_conversation_id on image — searching by created_by | charId=${charId} | user=${user.email}`);
    let convos = [];
    try {
      convos = await base44.entities.Conversation.filter(
        { created_by: user.email },
        '-last_message_date',
        200
      );
      console.log(`[SendImageModal] RESOLVE: found ${convos.length} convos by created_by`);
    } catch (e) {
      console.error('[SendImageModal] RESOLVE: Conversation query failed:', e.message);
    }

    // Client-side filter: find direct (non-world-phone) conversation for this character
    const direct = convos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      const hasChar = ids.includes(charId);
      const isWorldPhone = !!c.shared_conversation_key || c.channel === 'world_phone' || c.type === 'bilateral';
      return hasChar && !isWorldPhone;
    });

    if (direct.length > 0) {
      const sorted = [...direct].sort((a, b) => {
        const da = a.last_message_date ? new Date(a.last_message_date).getTime() : 0;
        const db = b.last_message_date ? new Date(b.last_message_date).getTime() : 0;
        return db - da;
      });
      console.log(`[SendImageModal] RESOLVE: Found direct convo=${sorted[0].id} for charId=${charId}`);
      return sorted[0].id;
    }

    // PRIORITY 3: Create a new conversation (last resort — only if truly none exists)
    console.warn(`[SendImageModal] RESOLVE: No existing direct convo for charId=${charId} — creating new`);
    const newConvo = await base44.entities.Conversation.create({
      title: `chat with ${charName}`,
      type: 'chat',
      character_ids: [charId],
      owner_email: user.email,
    });
    console.log(`[SendImageModal] RESOLVE: Created new convo=${newConvo.id} for charId=${charId}`);
    return newConvo.id;
  };

  const handleSend = async () => {
    setError(null);
    setSendLog(null);
    setLoading(true);
    const log = [];
    try {
      if (senderMode === 'user') {
        if (selectedRecipientCharacterIds.size === 0) {
          setError('Please select at least one character');
          setLoading(false);
          return;
        }

        for (const charId of selectedRecipientCharacterIds) {
          const char = characters.find(c => c.id === charId);
          if (!char) {
            log.push(`WARN: charId=${charId} not found in character list`);
            continue;
          }

          log.push(`Resolving conversation for charId=${charId} name=${char.name}`);
          const convoId = await resolveConversationId(charId, char.name || char.display_name);
          log.push(`Resolved convoId=${convoId}`);

          // DIAGNOSTIC: Verify conversation exists before writing
          log.push(`Writing image message: url=${image.url?.substring(0, 60)}... convo=${convoId}`);

          const msg = await base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: 'user',
            character_id: charId,
            character_name: char.name || char.display_name,
            content: '',
            image_url: image.url,
            image_description: image.imageDescription || '',
            timestamp: new Date().toISOString(),
            owner_email: user.email,
            typed_by_user: true,
          });

          if (!msg?.id) {
            throw new Error(`Message.create returned no ID for convo=${convoId}`);
          }
          log.push(`Message created: id=${msg.id} convo=${convoId} image_url_set=${!!msg.image_url}`);

          // DIAGNOSTIC: Read back the message to confirm persistence
          try {
            const readback = await base44.entities.Message.filter({ id: msg.id }, '-created_date', 1);
            const confirmed = readback?.length > 0 && readback[0].image_url === image.url;
            log.push(`Readback: found=${readback?.length > 0} image_url_match=${confirmed}`);
            if (!confirmed) {
              console.error('[SendImageModal] PERSISTENCE FAILURE: message written but readback failed or image_url missing', readback);
            }
          } catch (rbErr) {
            log.push(`Readback failed: ${rbErr.message}`);
          }

          await base44.entities.Conversation.update(convoId, {
            last_message_preview: '📷 Photo',
            last_message_date: new Date().toISOString(),
          }).catch(() => {});

          log.push(`Conversation preview updated for convo=${convoId}`);
        }

        console.log('[SendImageModal] SEND LOG:', log.join('\n'));
        setSendLog(log);

      } else {
        // Character → character via World Phone
        if (!selectedSenderCharacterId) { setError('Please select a sender character'); setLoading(false); return; }
        if (selectedRecipientCharacterIds.size === 0) { setError('Please select at least one recipient character'); setLoading(false); return; }
        if (selectedRecipientCharacterIds.has(selectedSenderCharacterId)) { setError('Cannot send to the same character you are sending as'); setLoading(false); return; }

        for (const receiverId of selectedRecipientCharacterIds) {
          log.push(`World Phone send: sender=${selectedSenderCharacterId} receiver=${receiverId}`);
          const res = await base44.functions.invoke('sendWorldPhoneMessage', {
            sender_character_id: selectedSenderCharacterId,
            recipient_identifier: receiverId,
            requested_message: '',
            image_url: image.url,
            image_description: image.imageDescription || '',
            message_type: 'image',
            source: 'media_gallery_send',
            owner_email: user.email,
          });

          if (!res?.data?.success) {
            throw new Error(res?.data?.error || 'World Phone send failed');
          }
          log.push(`World Phone success: msg_id=${res.data.message_id}`);
        }
        console.log('[SendImageModal] SEND LOG:', log.join('\n'));
      }

      onSent();
    } catch (e) {
      console.error('[SendImageModal] Send failed:', e, '\nLog:', log.join('\n'));
      setError(`Send failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const CharacterGroupUser = ({ title, chars, selected, onToggle }) => {
    if (chars.length === 0) return null;
    return (
      <>
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase bg-secondary/30 border-t border-border">{title}</div>
        {chars.map((char) => (
          <label key={char.id} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 cursor-pointer border-b border-border/50 last:border-b-0">
            <input type="checkbox" checked={selected.has(char.id)} onChange={() => onToggle(char.id)} className="w-4 h-4" />
            <span className="text-sm text-foreground">{char.displayName}</span>
          </label>
        ))}
      </>
    );
  };

  const CharacterGroupCharacter = ({ title, chars, selected, senderCharacterId, onToggle }) => {
    if (chars.length === 0) return null;
    return (
      <>
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase bg-secondary/30 border-t border-border">{title}</div>
        {chars.map((char) => {
          const isSender = char.id === senderCharacterId;
          return (
            <label key={char.id} className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/50 last:border-b-0 ${isSender ? 'bg-secondary/20 opacity-50 cursor-not-allowed' : 'hover:bg-secondary/50'}`}>
              <input type="checkbox" checked={selected.has(char.id)} onChange={() => onToggle(char.id)} disabled={isSender} className="w-4 h-4 disabled:opacity-50" />
              <span className={`text-sm ${isSender ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{char.displayName}{isSender && ' (sender)'}</span>
            </label>
          );
        })}
      </>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card rounded-lg max-w-md w-full p-6 flex flex-col max-h-[90vh]"
      >
        <h2 className="text-xl font-bold text-foreground mb-4">Send Image To</h2>

        <div className="mb-4">
          <p className="text-sm font-semibold text-foreground mb-2">Send As:</p>
          <div className="flex gap-2">
            <button onClick={() => setSenderMode('user')} className={`flex-1 px-3 py-2 rounded text-sm ${senderMode === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}>You</button>
            <button onClick={() => setSenderMode('character')} className={`flex-1 px-3 py-2 rounded text-sm ${senderMode === 'character' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}>Character</button>
          </div>
        </div>

        {senderMode === 'user' && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Send to Characters:</p>
            <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20 max-h-56">
              {['active_created', 'npc_regular', 'npc_family', 'npc_fictitious', 'other'].map(typeKey => {
                const typeLabels = { active_created: 'Active Characters', npc_regular: 'NPC Regular', npc_family: 'NPC Family', npc_fictitious: 'NPC Fictitious', other: 'Other' };
                return (
                  <CharacterGroupUser key={typeKey} title={typeLabels[typeKey]} chars={groupedCharacters[typeKey]} selected={selectedRecipientCharacterIds}
                    onToggle={(charId) => { const s = new Set(selectedRecipientCharacterIds); s.has(charId) ? s.delete(charId) : s.add(charId); setSelectedRecipientCharacterIds(s); }} />
                );
              })}
            </div>
          </div>
        )}

        {senderMode === 'character' && (
          <div className="mb-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Sending As:</p>
              <select value={selectedSenderCharacterId || ''} onChange={(e) => setSelectedSenderCharacterId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground">
                <option value="">— Select character —</option>
                {[...groupedCharacters.active_created, ...groupedCharacters.npc_regular, ...groupedCharacters.npc_family, ...groupedCharacters.npc_fictitious, ...groupedCharacters.other].map((char) => (
                  <option key={char.id} value={char.id}>{char.displayName}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Send To:</p>
              <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20 max-h-40">
                {['active_created', 'npc_regular', 'npc_family', 'npc_fictitious', 'other'].map(typeKey => {
                  const typeLabels = { active_created: 'Active Characters', npc_regular: 'NPC Regular', npc_family: 'NPC Family', npc_fictitious: 'NPC Fictitious', other: 'Other' };
                  return (
                    <CharacterGroupCharacter key={typeKey} title={typeLabels[typeKey]} chars={groupedCharacters[typeKey]} selected={selectedRecipientCharacterIds} senderCharacterId={selectedSenderCharacterId}
                      onToggle={(charId) => { const s = new Set(selectedRecipientCharacterIds); s.has(charId) ? s.delete(charId) : s.add(charId); setSelectedRecipientCharacterIds(s); }} />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-col">
          {error && <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</div>}
          {sendLog && <div className="text-xs text-green-400 bg-green-400/10 px-3 py-2 rounded-lg max-h-24 overflow-y-auto font-mono">{sendLog.join('\n')}</div>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90">Cancel</button>
            <button
              onClick={handleSend}
              disabled={loading || (senderMode === 'user' ? selectedRecipientCharacterIds.size === 0 : !selectedSenderCharacterId || selectedRecipientCharacterIds.size === 0)}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}