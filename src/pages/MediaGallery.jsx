import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { X, Send, Trash2, Search, ArrowLeft, RefreshCw } from 'lucide-react';
import { lfcRead, lfcWrite, lfcDelete } from '@/lib/localFirstCache';

function galleryPageCacheKey(ownerEmail, page, search, pageSize = 20) {
  const s = (search || '').trim().toLowerCase();
  const owner = (ownerEmail || 'anon').replace(/[^a-z0-9]/gi, '_');
  // v3: bumped to bust stale cache entries that had empty description fields
  return `mediaGallery:v3:${owner}:page:${page}:ps:${pageSize}:search:${s}`;
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

  /**
   * SESSION-LEVEL DEDUP INDEX
   *
   * VERIFIED ROOT CAUSE (Issue 1):
   * The previous implementation reset seenImageIdsRef on every page navigation
   * (useEffect with [currentPage, searchTerm] dependency). This meant that by the
   * time Page 5 loaded, the Set was empty — it had no memory of Pages 1–4.
   *
   * CORRECT BEHAVIOR:
   * seenImageIdsRef must accumulate across ALL page navigations in a gallery session.
   * It must NOT reset between pages — only when:
   *   - the user performs a full manual refresh (handleManualRefresh)
   *   - the search term changes (handleSearchChange)
   *   - an image is deleted (handleDeleteImage)
   * Page navigation alone must NOT clear this set.
   *
   * This ref survives React renders without triggering re-renders.
   */
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

      const freshImages = data.images || [];

      // ── CLIENT-SIDE CROSS-PAGE DEDUP ──────────────────────────────────────────
      // The backend rescans from scratch on every page request — it has no
      // shared cursor state between requests. When pages overlap (e.g. new messages
      // arrived between page 1 and page 5 requests, shifting the image index),
      // the same image may be returned on multiple pages.
      //
      // seenImageIdsRef accumulates ALL image IDs seen since this gallery session
      // started (or since the last full reset). It does NOT reset between pages.
      // Only search changes, manual refreshes, and deletes reset it.
      //
      // Dedup identity: use message ID (most stable), fallback to normalized URL.
      const seenBefore = seenImageIdsRef.current.size;
      const dedupedImages = freshImages.filter(img => {
        const key = img.id || img.messageId;
        if (!key) return true; // no key — cannot dedup, let through
        return !seenImageIdsRef.current.has(key);
      });

      // Add ALL new images from this page to the seen set for future pages
      dedupedImages.forEach(img => {
        const key = img.id || img.messageId;
        if (key) seenImageIdsRef.current.add(key);
      });

      const dupCount = freshImages.length - dedupedImages.length;
      console.log(
        `[MediaGallery] Page=${page} backend=${freshImages.length} ` +
        `seenBefore=${seenBefore} dups=${dupCount} new=${dedupedImages.length} ` +
        `totalSeenAfter=${seenImageIdsRef.current.size} ` +
        `firstKey=${dedupedImages[0]?.id || 'n/a'} lastKey=${dedupedImages[dedupedImages.length-1]?.id || 'n/a'}`
      );

      // ── CACHE MERGE LOGIC: Backend wins when it has more complete data ──
      // Never overwrite non-empty description with empty cached value.
      const mergedImages = dedupedImages.map(backendImg => {
        // If backend has description, use it fully — do not let stale cache shadow it
        if (backendImg.description && backendImg.description.length > 5) {
          return backendImg; // Fresh backend data takes priority
        }
        return backendImg; // Even if empty, use what backend returned
      });

      if (mergedImages.length > 0) {
        lfcWrite(user.email, cacheKey, {
          images: mergedImages,
          hasMore: data.hasMore === true,
          proof: data.proof,
        });
      }

      // Update images — if dedup removed everything but we had cache, keep cache showing.
      // Do not wipe the grid with an empty array just because this page returned all-dups.
      if (mergedImages.length > 0) {
        setPageImages(mergedImages);
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

  // initSettled gates the empty-state message — reset on page/search change
  // so we don't flash "0 images" during navigation.
  // IMPORTANT: do NOT reset seenImageIdsRef here. That only resets on
  // search changes, manual refreshes, and deletes — not page navigation.
  useEffect(() => {
    setInitSettled(false);
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
    // Search change = intentional gallery rebuild. Reset session dedup index.
    seenImageIdsRef.current = new Set();
    setSearchTerm(val);
    setCurrentPage(1);
    setHasMore(true);
  };

  const handleManualRefresh = () => {
    // Full manual refresh = intentional rebuild. Reset session dedup index.
    seenImageIdsRef.current = new Set();
    fetchPage(currentPage, searchTerm, { forceRefresh: true });
  };

  const handleSelectImage = (image) => {
    // DIAGNOSTIC: Log the exact backend item before modal receives it
    console.log('[MediaGallery] Image selected for modal:', {
      id: image.id,
      url: image.url?.substring(0, 80),
      description: image.description?.substring(0, 200),
      displayPrompt: image.displayPrompt?.substring(0, 200),
      hasDescription: !!image.description && image.description.length > 5,
      hasDisplayPrompt: !!image.displayPrompt && image.displayPrompt.length > 5,
      _diag: image._diag,
      gcScenePrompt: image.generationContext?.scene_prompt?.substring(0, 100),
      gcOriginalRaw: image.generationContext?.original_raw_prompt?.substring(0, 100),
    });
    setSelectedImage(image);
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
        // Delete = dataset changed. Reset dedup index and rebuild.
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
            <div>sessionDedup: {seenImageIdsRef.current.size} total unique IDs seen this session</div>
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
                  onClick={() => handleSelectImage(item)}
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
                  {/* Context indicator — shows whether this image has prompt metadata */}
                  {(item.originalPrompt || item.generationPrompt) && (
                    <div className="absolute bottom-1 left-1 px-1 py-0.5 bg-black/60 rounded text-[9px] text-white/80 pointer-events-none">
                      📝
                    </div>
                  )}
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
  // Resolve the best display prompt — full fallback chain matching backend output.
  // image.description is already the resolved value from fetchMediaGalleryPage.
  // CRITICAL: image.generationPrompt = gc.prompt = 10,000-char provider instruction blob.
  // Never use it as a display value. Use originalPrompt, scenePrompt, or description.
  const gc = image.generationContext || {};
  const displayPrompt =
    image.displayPrompt ||
    image.originalPrompt ||
    image.scenePrompt ||
    image.description ||
    image.imageDescription ||
    gc.original_raw_prompt ||
    gc.scene_prompt ||
    gc.resolved_description ||
    null;

  // DIAGNOSTIC: Log what the modal received
  React.useEffect(() => {
    console.log('[ImageDetailModal] Opened with:', {
      id: image.id,
      description: image.description?.substring(0, 200),
      displayPrompt: displayPrompt?.substring(0, 200),
      hasDescription: !!image.description && image.description.length > 5,
      hasDisplayPrompt: !!displayPrompt && displayPrompt.length > 5,
      originalPrompt: image.originalPrompt?.substring(0, 100),
      scenePrompt: image.scenePrompt?.substring(0, 100),
      imageDescription: image.imageDescription?.substring(0, 100),
      _diag: image._diag,
    });
  }, [image]);

  const hasSubjects = image.subjectNames && image.subjectNames.length > 0;

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
          <img src={image.url} alt={image.description} className="w-full max-h-64 object-contain" />
          <button onClick={onClose} className="absolute top-2 right-2 p-2 bg-black/50 rounded-lg hover:bg-black/70">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">From</p>
            <p className="text-sm text-foreground">{image.senderName}</p>
          </div>

          {/* Original generation prompt — required metadata */}
          {displayPrompt ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Prompt / Context</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {/* Strip internal [NAME REFERENCE KEY] scaffolding — user should only see clean scene description */}
                {displayPrompt
                  .replace(/\[NAME REFERENCE KEY[^\]]*?\]/g, '')
                  .replace(/\[END NAME REFERENCE KEY\]/g, '')
                  .replace(/\n\n+/g, '\n\n')
                  .trim()}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Prompt / Context</p>
              <p className="text-xs text-muted-foreground italic">No prompt/context saved for this image</p>
            </div>
          )}

          {/* Vision-analyzed description (separate from prompt) */}
          {image.imageDescription && image.imageDescription !== displayPrompt && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Image Description</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{image.imageDescription}</p>
            </div>
          )}

          {/* Subjects shown in the image */}
          {hasSubjects && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">People in Image</p>
              <p className="text-sm text-foreground">{image.subjectNames.join(', ')}</p>
            </div>
          )}

          {/* Location context */}
          {image.locationName && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Location</p>
              <p className="text-sm text-foreground">{image.locationName}{image.zoneName ? ` — ${image.zoneName}` : ''}</p>
            </div>
          )}
        </div>
        <div className="flex-shrink-0 border-t border-border p-4 bg-card flex gap-2">
          <button onClick={onSend} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center justify-center gap-2 text-sm font-medium">
            <Send className="w-4 h-4" /> Send to Character
          </button>
          <button onClick={onDelete} className="px-4 py-2 bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 flex items-center justify-center gap-2">
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
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [sendLog, setSendLog] = useState([]);
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user?.email) return;
    base44.entities.Character.filter({ owner_email: user.email, status: 'active' }, 'name', 200)
      .then(setCharacters)
      .catch(e => console.error('[SendImageModal] Failed to load characters:', e));
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
   * resolveDestinationConversationId
   *
   * ROOT CAUSE (confirmed by comparing ForwardMessageModal which WORKS):
   *
   * ForwardMessageModal (working) queries:
   *   Conversation.filter({ type: "direct", character_ids: [charId] })
   *   — no owner_email in the filter
   *   — client-side: character_ids.length === 1 && character_ids[0] === charId
   *
   * Previous SendImageModal (broken) queried:
   *   Conversation.filter({ owner_email: user.email, character_ids: charId })
   *   — combining owner_email + character_ids array filter may return 0 results
   *     if character_ids is stored differently or indexed differently in the DB
   *   — 0 results → creates a ghost conversation → image written to ghost thread
   *   — Chat page never sees the ghost thread → image never appears in chat
   *
   * FIX: mirror the ForwardMessageModal conversation query exactly.
   * Step 1: try { type: "direct", character_ids: [charId] } — same as Forward
   * Step 2: try { type: "chat", character_ids: [charId] } — Chat page creates type:"chat"
   * Step 3: try { character_ids: charId } — broadest fallback, no type restriction
   * Client-side filter: single-character, non-world-phone/bilateral threads only.
   * Only create a new conversation if all three queries return 0 direct results.
   */
  const resolveDestinationConversationId = async (charId, charName, log) => {
    log.push(`RESOLVE: charId=${charId} name=${charName}`);
    log.push(`RESOLVE: source convo=${image.parent_conversation_id || 'none'} — NOT used as destination`);

    // Client-side exclusion filter — identical to ForwardMessageModal + useChatLoadConvo
    const isDirectUserConvo = (c) => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      if (ids.length !== 1 || ids[0] !== charId) return false;
      if (c.shared_conversation_key) return false;
      if (c.channel === 'world_phone') return false;
      if (c.type === 'bilateral') return false;
      return true;
    };

    // Step 1: type:"direct" — matches ForwardMessageModal exactly
    try {
      const r1 = await base44.entities.Conversation.filter(
        { type: 'direct', character_ids: [charId] },
        '-last_message_date', 20
      );
      log.push(`RESOLVE: type=direct query returned ${r1.length}`);
      const direct1 = r1.filter(isDirectUserConvo);
      if (direct1.length > 0) {
        const best = direct1.sort((a, b) =>
          (b.last_message_date ? new Date(b.last_message_date).getTime() : 0) -
          (a.last_message_date ? new Date(a.last_message_date).getTime() : 0)
        )[0];
        log.push(`RESOLVE: Found via type=direct convo=${best.id}`);
        return best.id;
      }
    } catch (e) {
      log.push(`RESOLVE: type=direct query error: ${e.message}`);
    }

    // Step 2: type:"chat" — Chat page creates conversations with type:"chat"
    try {
      const r2 = await base44.entities.Conversation.filter(
        { type: 'chat', character_ids: [charId] },
        '-last_message_date', 20
      );
      log.push(`RESOLVE: type=chat query returned ${r2.length}`);
      const direct2 = r2.filter(isDirectUserConvo);
      if (direct2.length > 0) {
        const best = direct2.sort((a, b) =>
          (b.last_message_date ? new Date(b.last_message_date).getTime() : 0) -
          (a.last_message_date ? new Date(a.last_message_date).getTime() : 0)
        )[0];
        log.push(`RESOLVE: Found via type=chat convo=${best.id}`);
        return best.id;
      }
    } catch (e) {
      log.push(`RESOLVE: type=chat query error: ${e.message}`);
    }

    // Step 3: broadest — no type restriction, just character_ids
    try {
      const r3 = await base44.entities.Conversation.filter(
        { character_ids: charId },
        '-last_message_date', 50
      );
      log.push(`RESOLVE: broad query returned ${r3.length}`);
      const direct3 = r3.filter(isDirectUserConvo);
      if (direct3.length > 0) {
        const best = direct3.sort((a, b) =>
          (b.last_message_date ? new Date(b.last_message_date).getTime() : 0) -
          (a.last_message_date ? new Date(a.last_message_date).getTime() : 0)
        )[0];
        log.push(`RESOLVE: Found via broad query convo=${best.id}`);
        return best.id;
      }
    } catch (e) {
      log.push(`RESOLVE: broad query error: ${e.message}`);
    }

    // Step 4: create — only if truly no conversation exists
    log.push(`RESOLVE: No existing convo found — creating new`);
    const newConvo = await base44.entities.Conversation.create({
      title: `direct with ${charName}`,
      type: 'direct',
      character_ids: [charId],
    });
    log.push(`RESOLVE: Created new convo=${newConvo.id}`);
    return newConvo.id;
  };

  const handleSend = async () => {
    setError(null);
    setSendLog([]);
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
            log.push(`WARN: charId=${charId} not found in loaded character list — skipping`);
            continue;
          }

          log.push(`--- Sending to: ${char.name} (${charId}) ---`);
          log.push(`SOURCE image: url=${image.url?.substring(0, 60)}... sourceConvo=${image.parent_conversation_id || 'none'}`);

          const destConvoId = await resolveDestinationConversationId(charId, char.name || char.display_name, log);
          log.push(`DESTINATION convo=${destConvoId}`);

          if (image.parent_conversation_id && destConvoId === image.parent_conversation_id) {
            log.push(`NOTE: destination matches source convo — recipient is same character that sent this image originally`);
          }

          // Build image context block for the recipient character.
          // This tells the receiving character who/what is in the image so they
          // don't hallucinate. Includes: original prompt, subjects, location, and
          // whether the recipient character is IN the image.
          const recipientIsInImage = image.subjectIds && image.subjectIds.includes(charId);
          const subjectNamesStr = image.subjectNames && image.subjectNames.length > 0
            ? image.subjectNames.join(', ')
            : null;

          // Build a compact image_description for the recipient that combines
          // vision analysis + prompt context + subject identity.
          // This is what the character LLM reads when deciding how to respond.
          // Resolve the best available description for character context injection.
          // CRITICAL: image.generationPrompt = gc.prompt = 10,000-char provider blob — SKIP IT.
          // Use image.originalPrompt (gc.original_raw_prompt) or image.scenePrompt (gc.scene_prompt)
          // or image.description (already resolved by fetchMediaGalleryPage from the best field).
          const resolvedDisplayPrompt =
            image.originalPrompt ||
            image.scenePrompt ||
            image.description ||
            image.imageDescription ||
            null;

          const parts = [];
          if (image.imageDescription) parts.push(image.imageDescription);
          if (resolvedDisplayPrompt && resolvedDisplayPrompt !== image.imageDescription) {
            parts.push(`[Original prompt: ${resolvedDisplayPrompt}]`);
          }
          if (subjectNamesStr) parts.push(`[People shown: ${subjectNamesStr}]`);
          if (image.locationName) parts.push(`[Location: ${image.locationName}${image.zoneName ? ' — ' + image.zoneName : ''}]`);
          if (recipientIsInImage) parts.push(`[Note: ${char.name} is one of the people shown in this image]`);

          const composedDescription = parts.join(' ') || '';

          // generation_context carries the full subject/prompt metadata through to the
          // character response pipeline. ALIGNED WITH ForwardMessageModal: do NOT write
          // owner_email — it can cause RLS scope issues preventing Chat page readback.
          // Merge resolved_description into generation_context so the LLM always has it.
          const mergedGenerationContext = image.generationContext
            ? {
                ...image.generationContext,
                resolved_description: resolvedDisplayPrompt || composedDescription || undefined,
                original_raw_prompt: image.generationContext.original_raw_prompt || image.originalPrompt || resolvedDisplayPrompt || undefined,
              }
            : resolvedDisplayPrompt
            ? { resolved_description: resolvedDisplayPrompt, original_raw_prompt: resolvedDisplayPrompt }
            : undefined;

          const msg = await base44.entities.Message.create({
            conversation_id: destConvoId,
            sender_type: 'user',
            content: '',
            image_url: image.url,
            image_description: composedDescription || resolvedDisplayPrompt || undefined,
            image_analysis_status: (composedDescription || resolvedDisplayPrompt) ? 'complete' : 'pending',
            // Carry generation_context so character response pipeline has full subject metadata
            generation_context: mergedGenerationContext,
            timestamp: new Date().toISOString(),
          });

          log.push(`CONTEXT: recipientInImage=${recipientIsInImage} subjects="${subjectNamesStr || 'none'}" descLen=${composedDescription.length}`);

          if (!msg?.id) {
            throw new Error(`Message.create returned no ID for convo=${destConvoId}`);
          }
          log.push(`WRITE: message created id=${msg.id} image_url_set=${!!msg.image_url} image_description_len=${composedDescription.length} has_generation_context=${!!(image.generationContext)}`);

          // Readback verification — confirms the message actually persisted
          try {
            const readback = await base44.entities.Message.filter(
              { conversation_id: destConvoId, id: msg.id },
              '-created_date',
              1
            );
            const found = readback?.length > 0;
            const urlMatch = found && readback[0].image_url === image.url;
            log.push(`READBACK: found=${found} image_url_match=${urlMatch} msgId=${readback?.[0]?.id || 'none'}`);
            if (!found || !urlMatch) {
              console.error('[SendImageModal] PERSISTENCE FAILURE — readback mismatch', { found, urlMatch, readback });
              log.push(`READBACK FAILURE — image may not have persisted correctly`);
            }
          } catch (rbErr) {
            log.push(`READBACK ERROR: ${rbErr.message}`);
          }

          await base44.entities.Conversation.update(destConvoId, {
            last_message_preview: '📷 Photo',
            last_message_date: new Date().toISOString(),
          }).catch(() => {});

          log.push(`DONE: conversation preview updated, send complete`);
        }

        console.log('[SendImageModal] SEND COMPLETE:\n' + log.join('\n'));
        setSendLog(log);
        setSent(true);
        setTimeout(onSent, 1200);
        return; // early return — onSent called via timeout below

      } else {
        // Character → character via World Phone (existing working path — do not change)
        if (!selectedSenderCharacterId) { setError('Please select a sender character'); setLoading(false); return; }
        if (selectedRecipientCharacterIds.size === 0) { setError('Please select at least one recipient character'); setLoading(false); return; }
        if (selectedRecipientCharacterIds.has(selectedSenderCharacterId)) { setError('Cannot send to the same character you are sending as'); setLoading(false); return; }

        for (const receiverId of selectedRecipientCharacterIds) {
          log.push(`World Phone: sender=${selectedSenderCharacterId} → receiver=${receiverId}`);
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
          log.push(`World Phone OK: msg_id=${res.data.message_id}`);
        }
        console.log('[SendImageModal] WORLD PHONE SEND:\n' + log.join('\n'));
        setSendLog(log);
        setSent(true);
        setTimeout(onSent, 1200);
        return;
      }
    } catch (e) {
      console.error('[SendImageModal] Send failed:', e.message, '\nLog:\n' + log.join('\n'));
      setError(`Send failed: ${e.message}`);
      setSendLog(log);
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

        <div className="flex flex-col gap-2">
          {error && <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</div>}
          {sendLog.length > 0 && (
            <div className="text-xs bg-secondary/30 px-3 py-2 rounded-lg max-h-28 overflow-y-auto font-mono text-muted-foreground whitespace-pre-wrap">
              {sendLog.join('\n')}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90">Cancel</button>
            <button
              onClick={handleSend}
              disabled={loading || sent || (senderMode === 'user' ? selectedRecipientCharacterIds.size === 0 : !selectedSenderCharacterId || selectedRecipientCharacterIds.size === 0)}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sent ? '✓ Sent!' : loading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}