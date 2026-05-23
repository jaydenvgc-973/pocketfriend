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

  // SESSION DEDUP: accumulate across all pages in this gallery session
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

    // ── STEP 1: Show cache while loading fresh (UI responsiveness) ────────────────
    // Backend is source of truth. Cache is fallback display only.
    const cached = lfcRead(user.email, cacheKey);
    if (cached?.data?.images?.length > 0) {
      console.log(`[MediaGallery] Cache DISPLAY page=${page} (will fetch fresh)`);
      setPageImages(cached.data.images);
      setHasMore(cached.data.hasMore === true);
      setLastProof(cached.data.proof || null);
      setIsLoading(false);
      setInitSettled(true);
    } else {
      console.log(`[MediaGallery] Cache MISS page=${page} — loading from backend`);
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

      // ── DEDUP: accumulates across entire session ──────────────────────────────
      const seenBefore = seenImageIdsRef.current.size;
      const dedupedImages = freshImages.filter(img => {
        const key = img.id || img.messageId;
        if (!key) return true;
        return !seenImageIdsRef.current.has(key);
      });

      dedupedImages.forEach(img => {
        const key = img.id || img.messageId;
        if (key) seenImageIdsRef.current.add(key);
      });

      const dupCount = freshImages.length - dedupedImages.length;
      console.log(
        `[MediaGallery] Page=${page} backend=${freshImages.length} dedup=${dupCount} new=${dedupedImages.length} totalSeen=${seenImageIdsRef.current.size}`
      );

      // ── BACKEND DATA IS SOURCE OF TRUTH ────────────────────────────────────────
      if (dedupedImages.length > 0) {
        setPageImages(dedupedImages);
        lfcWrite(user.email, cacheKey, {
          images: dedupedImages,
          hasMore: data.hasMore === true,
          proof: data.proof,
        });
      } else if (!cached?.data?.images?.length) {
        // No cache and no new images — show empty
        setPageImages([]);
      }
      // else: keep showing cache if backend returned all dups

      setHasMore(data.hasMore === true);
      setLastProof(data.proof || null);

    } catch (e) {
      console.error('[MediaGallery] fetchPage error:', e.message);
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
    seenImageIdsRef.current = new Set();
    setSearchTerm(val);
    setCurrentPage(1);
    setHasMore(true);
  };

  const handleManualRefresh = () => {
    seenImageIdsRef.current = new Set();
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
            <div><strong>Gallery Diagnostics — Page {currentPage}</strong></div>
            <div>owner: {user?.email || 'unknown'}</div>
            <div>uniqueImages: {lastProof.uniqueImagesCollected ?? 'n/a'} | batches: {lastProof.batchCount ?? 'n/a'}</div>
            <div>msgsScanned: {lastProof.messagesScanned ?? 'n/a'} | runtime: {lastProof.runtimeMs ?? 'n/a'}ms</div>
            <div>hasMore: {lastProof.hasMore ? 'yes' : 'no'} | terminationReason: {lastProof.terminationReason || 'n/a'}</div>
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

  const stripInternalMetadata = (text) => {
    if (!text) return text;
    return text
      .replace(/\[NAME REFERENCE KEY[^\]]*?\]/g, '')
      .replace(/\[END NAME REFERENCE KEY\]/g, '')
      .replace(/\[REFERENCE KEY[^\]]*?\]/g, '')
      .replace(/\[END REFERENCE KEY\]/g, '')
      .replace(/\[CHARACTER ID[^\]]*?\]/g, '')
      .replace(/\[IDENTITY LOCK[^\]]*?\]/g, '')
      .replace(/\[PROVIDER INSTRUCTION[^\]]*?\]/g, '')
      .replace(/\(ID:\s*[a-z0-9]+\)/gi, '')
      .replace(/^\s*"[^"]*"\s*=\s*[^\n]*$/gm, '')
      .replace(/^\[CHARACTER\]\s*/i, '')
      .replace(/^\[USER\]\s*/i, '')
      .replace(/^\[JOINT\]\s*/i, '')
      .replace(/^Generated character photo\.\s*Scene:\s*/i, '')
      .replace(/\n\n+/g, '\n\n')
      .replace(/^\s+|\s+$/gm, '')
      .trim();
  };

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
          {displayPrompt && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Prompt / Description</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{stripInternalMetadata(displayPrompt)}</p>
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
  const [selectedCharacterIds, setSelectedCharacterIds] = useState(new Set());
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

  const handleSend = async () => {
    setError(null);
    setSendLog([]);
    setLoading(true);
    const log = [];

    try {
      if (selectedCharacterIds.size === 0) {
        setError('Please select at least one character');
        setLoading(false);
        return;
      }

      for (const charId of selectedCharacterIds) {
        const char = characters.find(c => c.id === charId);
        if (!char) continue;

        const destConvoId = await resolveConversationId(charId);
        const resolvedDisplayPrompt = image.displayPrompt || image.originalPrompt || image.scenePrompt || image.description || null;
        let composedDescription = resolvedDisplayPrompt || `Image sent to ${char.name}`;

        const msg = await base44.entities.Message.create({
          conversation_id: destConvoId,
          sender_type: 'user',
          content: '',
          image_url: image.url,
          image_description: composedDescription,
          image_analysis_status: 'complete',
          generation_context: image.generationContext || undefined,
          timestamp: new Date().toISOString(),
          owner_email: user.email,
        });

        if (!msg?.id) throw new Error('Message creation failed');
        log.push(`Sent to ${char.name}`);
      }

      setSendLog(log);
      setSent(true);
      setTimeout(onSent, 1200);
    } catch (e) {
      console.error('[SendImageModal] Send failed:', e);
      setError(`Send failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const resolveConversationId = async (charId) => {
    try {
      const r1 = await base44.entities.Conversation.filter({ type: 'direct', character_ids: [charId] }, '-last_message_date', 20);
      const direct1 = r1.filter(c => Array.isArray(c.character_ids) && c.character_ids.length === 1 && c.character_ids[0] === charId);
      if (direct1.length > 0) return direct1[0].id;

      const r2 = await base44.entities.Conversation.filter({ type: 'chat', character_ids: [charId] }, '-last_message_date', 20);
      const direct2 = r2.filter(c => Array.isArray(c.character_ids) && c.character_ids.length === 1 && c.character_ids[0] === charId);
      if (direct2.length > 0) return direct2[0].id;

      const newConvo = await base44.entities.Conversation.create({
        title: `chat with ${characters.find(c => c.id === charId)?.name || charId}`,
        type: 'direct',
        character_ids: [charId],
      });
      return newConvo.id;
    } catch (e) {
      throw new Error(`Failed to resolve conversation: ${e.message}`);
    }
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

        <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20 mb-4 max-h-56">
          {['active_created', 'npc_regular', 'npc_family', 'npc_fictitious', 'other'].map(typeKey => {
            const typeLabels = { active_created: 'Active Characters', npc_regular: 'NPC Regular', npc_family: 'NPC Family', npc_fictitious: 'NPC Fictitious', other: 'Other' };
            const chars = groupedCharacters[typeKey];
            if (chars.length === 0) return null;
            return (
              <div key={typeKey}>
                <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase bg-secondary/30 border-t border-border">{typeLabels[typeKey]}</div>
                {chars.map((char) => (
                  <label key={char.id} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 cursor-pointer border-b border-border/50 last:border-b-0">
                    <input type="checkbox" checked={selectedCharacterIds.has(char.id)} onChange={() => { const s = new Set(selectedCharacterIds); s.has(char.id) ? s.delete(char.id) : s.add(char.id); setSelectedCharacterIds(s); }} className="w-4 h-4" />
                    <span className="text-sm text-foreground">{char.displayName}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          {error && <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</div>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90">Cancel</button>
            <button
              onClick={handleSend}
              disabled={loading || sent || selectedCharacterIds.size === 0}
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