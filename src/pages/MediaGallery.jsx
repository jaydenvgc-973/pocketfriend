import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { X, Send, Trash2, Search, ArrowLeft, RefreshCw } from 'lucide-react';
import { lfcRead, lfcWrite, lfcDelete } from '@/lib/localFirstCache';

function galleryPageCacheKey(ownerEmail, page, search, pageSize = 20) {
  const s = (search || '').trim().toLowerCase();
  const owner = (ownerEmail || 'anon').replace(/[^a-z0-9]/gi, '_');
  return `mediaGallery:v4:${owner}:page:${page}:ps:${pageSize}:search:${s}`;
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

  // PER-REQUEST DEDUP: reset on every page fetch (page-based pagination, not infinite scroll)
  // Must NOT accumulate across pages — page 2 legitimately re-uses IDs scanned in the backend
  // for prior pages. Cross-page dedup via frontend ref causes empty results after refresh.
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

    // ── CRITICAL: Reset per-request dedup on every fetch ─────────────────────────
    // Page-based pagination: backend already deduped within its full scan.
    // Frontend dedup here only prevents duplicates within this single response.
    // Cross-page accumulation causes empty results after refresh (stale IDs filter fresh data).
    seenImageIdsRef.current = new Set();

    // ── STEP 1: Show cache while loading fresh (UI responsiveness) ────────────────
    // Backend is source of truth. Cache is a visual fallback only — never source of truth.
    // Cache must NEVER prevent a backend fetch from completing.
    const cached = lfcRead(user.email, cacheKey);
    if (cached?.data?.images?.length > 0 && !forceRefresh) {
      console.log(`[MediaGallery] Cache DISPLAY page=${page} age=${cached.loaded_at ? Math.round((Date.now()-cached.loaded_at)/1000) : '?'}s (fetching fresh in background)`);
      setPageImages(cached.data.images);
      setHasMore(cached.data.hasMore === true);
      setLastProof(cached.data.proof || null);
      setIsLoading(false);
      setInitSettled(true);
    } else {
      console.log(`[MediaGallery] Cache MISS/FORCE page=${page} — loading from backend`);
      setIsLoading(true);
    }

    // ── STEP 2: Always fetch fresh backend (no cache bypass) ─────────────────────
    setIsRefreshing(true);
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

      // ── DEDUP: within this single response only (NOT across pages) ─────────────
      // The backend already handles full-dataset dedup via normalized URL.
      // This frontend dedup only catches cases where the same message appears
      // twice in a single backend response (should not happen, but defensive).
      const responseDedup = new Set();
      const dedupedImages = freshImages.filter(img => {
        const key = img.id || img.messageId;
        if (!key) return true;
        if (responseDedup.has(key)) return false;
        responseDedup.add(key);
        return true;
      });

      const dupCount = freshImages.length - dedupedImages.length;
      if (dupCount > 0) {
        console.warn(`[MediaGallery] Page=${page} intra-response duplicates removed: ${dupCount}`);
      }
      console.log(
        `[MediaGallery] Page=${page} backend=${freshImages.length} dedupedThisPage=${dedupedImages.length} hasMore=${data.hasMore} uniqueImagesInBackendIndex=${data.proof?.uniqueImagesCollected ?? '?'}`
      );

      // ── BACKEND DATA IS SOURCE OF TRUTH — always update from fresh response ──
      // Backend wins regardless of cache state.
      // Only skip update if backend returned 0 images AND cache has valid data
      // (protects against transient backend errors wiping a good gallery).
      if (dedupedImages.length > 0) {
        setPageImages(dedupedImages);
        lfcWrite(user.email, cacheKey, {
          images: dedupedImages,
          hasMore: data.hasMore === true,
          proof: data.proof,
        });
      } else if (!cached?.data?.images?.length) {
        // Truly empty: no cache, no backend data
        setPageImages([]);
        console.log(`[MediaGallery] Page=${page} — backend and cache both empty`);
      } else {
        // Backend returned empty but cache has data — possible transient error or legitimately past end.
        // Keep showing cache, log as mismatch.
        console.warn(`[MediaGallery] Page=${page} — backend returned 0 images but cache has ${cached.data.images.length}. Keeping cache. proof:`, data.proof);
      }

      setHasMore(data.hasMore === true);
      setLastProof(data.proof || null);

    } catch (e) {
      console.error('[MediaGallery] fetchPage error:', e.message);
      // On error: keep showing cache if available, do not blank the gallery
    } finally {
      if (requestId === activeRequestRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
        setInitSettled(true);
      }
    }
  }, [user?.email]);

  useEffect(() => {
    if (user?.email) {
      fetchPage(currentPage, searchTerm);
    }
  }, [user?.email, currentPage, searchTerm, fetchPage]);

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
    // Search change: clear cache keys related to search (new search = new dataset)
    setSearchTerm(val);
    setCurrentPage(1);
    setHasMore(true);
    setPageImages([]);
    setInitSettled(false);
  };

  const handleManualRefresh = () => {
    // Manual refresh: bypass cache entirely
    if (user?.email) {
      const cacheKey = galleryPageCacheKey(user.email, currentPage, searchTerm);
      lfcDelete(user.email, cacheKey);
    }
    fetchPage(currentPage, searchTerm, { forceRefresh: true });
  };

  const handleSelectImage = (image) => {
    console.log('[MediaGallery] Image selected:', { id: image.id, hasPrompt: !!image.displayPrompt });
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
            <div><strong>Gallery Diagnostics v4 (offset-based) — Page {currentPage}</strong></div>
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
            {lastProof.terminationReason === 'runtime_limit' && (
              <div className="text-amber-400">⚠ Scan hit time limit — some older images may not be indexed. Try refreshing.</div>
            )}
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
              ? `Page ${currentPage} is beyond the gallery.`
              : searchTerm ? 'No images match your search.' : 'No media found.'}
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

// Modal components and SendImageModal follow...
function ImageDetailModal({ image, onClose, onSend, onDelete }) {
  // Backend returns pre-cleaned displayPrompt — use it directly
  const displayPrompt = image.displayPrompt || image.description || null;

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

          {/* Category-specific prompt/context display */}
          {image.imageCategory === 'ai_generated_with_context' && displayPrompt && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Generation Prompt / Context</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{displayPrompt}</p>
            </div>
          )}

          {image.imageCategory === 'ai_generated_missing_context' && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">⚠ Context Missing</p>
              <p className="text-xs text-amber-600/80">This image was AI-generated but the generation context was not saved. Original prompt is unrecoverable.</p>
            </div>
          )}

          {image.imageCategory === 'user_uploaded' && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">User-Uploaded Image</p>
              {image.imageDescription ? (
                <>
                  <p className="text-xs text-muted-foreground mb-1">No generation prompt — this was uploaded by you.</p>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mt-2 mb-1">Image Description</p>
                  <p className="text-sm text-foreground">{image.imageDescription}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">This image was uploaded by you — no generation prompt.</p>
              )}
            </div>
          )}

          {image.imageCategory === 'character_sent_image' && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Character-Sent Image</p>
              {image.imageDescription ? (
                <>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mt-2 mb-1">Image Description</p>
                  <p className="text-sm text-foreground">{image.imageDescription}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">This image was sent by {image.senderName}.</p>
              )}
            </div>
          )}

          {(image.imageCategory === 'legacy_missing_context' || image.imageCategory === 'unknown') && displayPrompt && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Description</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{displayPrompt}</p>
            </div>
          )}

          {(image.imageCategory === 'legacy_missing_context' || image.imageCategory === 'unknown') && !displayPrompt && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Legacy Image</p>
              <p className="text-xs text-muted-foreground">This is a legacy image with no recoverable prompt or context data.</p>
            </div>
          )}

          {/* Subjects shown in the image */}
          {image.subjectNames && image.subjectNames.length > 0 && (
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

  const resolveDestinationConversationId = async (charId, charName, log) => {
    log.push(`RESOLVE: charId=${charId} name=${charName}`);
    const isDirectUserConvo = (c) => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      if (ids.length !== 1 || ids[0] !== charId) return false;
      if (c.shared_conversation_key) return false;
      if (c.channel === 'world_phone') return false;
      if (c.type === 'bilateral') return false;
      return true;
    };

    try {
      const r1 = await base44.entities.Conversation.filter({ type: 'direct', character_ids: [charId] }, '-last_message_date', 20);
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

    try {
      const r2 = await base44.entities.Conversation.filter({ type: 'chat', character_ids: [charId] }, '-last_message_date', 20);
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

    try {
      const r3 = await base44.entities.Conversation.filter({ character_ids: charId }, '-last_message_date', 50);
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
            log.push(`WARN: charId=${charId} not found`);
            continue;
          }

          log.push(`--- Sending to: ${char.name} ---`);
          const destConvoId = await resolveDestinationConversationId(charId, char.name || char.display_name, log);

          const recipientIsInImage = image.subjectIds && image.subjectIds.includes(charId);
          const subjectNamesStr = image.subjectNames && image.subjectNames.length > 0 ? image.subjectNames.join(', ') : null;
          // Use backend-cleaned displayPrompt; it's already sanitized
          const resolvedDisplayPrompt = image.displayPrompt || image.imageDescription || null;

          const parts = [];
          if (image.imageDescription) parts.push(image.imageDescription);
          if (resolvedDisplayPrompt && resolvedDisplayPrompt !== image.imageDescription) {
            parts.push(`[Original prompt: ${resolvedDisplayPrompt}]`);
          }
          if (subjectNamesStr) parts.push(`[People shown: ${subjectNamesStr}]`);
          if (image.locationName) parts.push(`[Location: ${image.locationName}${image.zoneName ? ' — ' + image.zoneName : ''}]`);
          if (recipientIsInImage) parts.push(`[Note: ${char.name} is one of the people shown in this image]`);

          let composedDescription = parts.join(' ').trim();
          if (!composedDescription && resolvedDisplayPrompt) composedDescription = resolvedDisplayPrompt;
          if (!composedDescription && image.imageDescription) composedDescription = image.imageDescription;
          if (!composedDescription) composedDescription = `Image sent to ${char.name}${image.locationName ? ` at ${image.locationName}` : ''}`;

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
            image_description: composedDescription,
            image_analysis_status: composedDescription ? 'complete' : 'pending',
            generation_context: mergedGenerationContext,
            timestamp: new Date().toISOString(),
            owner_email: user.email,
          });

          if (!msg?.id) throw new Error(`Message.create returned no ID`);
          log.push(`WRITE: message created id=${msg.id}`);
        }

        console.log('[SendImageModal] SEND COMPLETE:\n' + log.join('\n'));
        setSendLog(log);
        setSent(true);
        setTimeout(onSent, 1200);
        return;

      } else {
        if (!selectedSenderCharacterId) { setError('Please select a sender character'); setLoading(false); return; }
        if (selectedRecipientCharacterIds.size === 0) { setError('Please select at least one recipient character'); setLoading(false); return; }
        if (selectedRecipientCharacterIds.has(selectedSenderCharacterId)) { setError('Cannot send to the same character'); setLoading(false); return; }

        for (const receiverId of selectedRecipientCharacterIds) {
         log.push(`World Phone: sender=${selectedSenderCharacterId} → receiver=${receiverId}`);
         // Use backend-cleaned displayPrompt for World Phone
         const wpResolvedPrompt = image.displayPrompt || image.imageDescription || null;
         const wpDescription = wpResolvedPrompt || image.imageDescription || '';
          log.push(`World Phone: image_url=${image.url?.substring(0,60)}... descLen=${wpDescription.length}`);
          const res = await base44.functions.invoke('sendWorldPhoneMessage', {
            sender_character_id: selectedSenderCharacterId,
            recipient_identifier: receiverId,
            requested_message: '',
            image_url: image.url,
            image_description: wpDescription,
            generation_context: image.generationContext || undefined,
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
      console.error('[SendImageModal] Send failed:', e.message);
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
        className="bg-card rounded-lg max-w-md w-full p-6 flex flex-col max-h-[95vh] overflow-hidden"
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
          <div className="mb-4 flex-1 flex flex-col min-h-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex-shrink-0">Send to Characters:</p>
            <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20">
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
          <div className="mb-4 flex-1 flex flex-col min-h-0 gap-4">
            <div className="flex-shrink-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Sending As:</p>
              <select value={selectedSenderCharacterId || ''} onChange={(e) => setSelectedSenderCharacterId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground">
                <option value="">— Select character —</option>
                {[...groupedCharacters.active_created, ...groupedCharacters.npc_regular, ...groupedCharacters.npc_family, ...groupedCharacters.npc_fictitious, ...groupedCharacters.other].map((char) => (
                  <option key={char.id} value={char.id}>{char.displayName}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 flex flex-col min-h-0">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex-shrink-0">Send To:</p>
              <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20">
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

        <div className="flex-shrink-0 border-t border-border pt-2 flex flex-col gap-2">
          {error && <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</div>}
          {sendLog.length > 0 && (
            <div className="text-xs bg-secondary/30 px-3 py-2 rounded-lg max-h-24 overflow-y-auto font-mono text-muted-foreground whitespace-pre-wrap">
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