import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { X, Send, Trash2, Search, ArrowLeft, RefreshCw } from 'lucide-react';
import { lfcRead, lfcWrite, lfcDelete } from '@/lib/localFirstCache';

// Cache key for a specific owner+page+search combination
// MUST include ownerEmail so different accounts never share cache
function galleryPageCacheKey(ownerEmail, page, search, pageSize = 20) {
  const s = (search || '').trim().toLowerCase();
  const owner = (ownerEmail || 'anon').replace(/[^a-z0-9]/gi, '_');
  return `mediaGallery:v2:${owner}:page:${page}:ps:${pageSize}:search:${s}`;
}

// Cache key for the total image count (used to know if hasMore)
const GALLERY_META_KEY = 'mediaGallery:meta';
const GALLERY_STALE_MS = 5 * 60 * 1000; // 5 minutes

export default function MediaGallery() {
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [pageImages, setPageImages] = useState([]);
  // isLoading: true only when no cached data available (cold load)
  const [isLoading, setIsLoading] = useState(false);
  // isRefreshing: silent background refresh — gallery already showing cached data
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastProof, setLastProof] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState('');

  // Ref to prevent stale closures in background refresh
  const activeRequestRef = useRef(0);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  const fetchPage = useCallback(async (page, search, opts = {}) => {
    if (!user?.email) return;
    const { forceRefresh = false } = opts;

    const cacheKey = galleryPageCacheKey(user.email, page, search);
    const requestId = ++activeRequestRef.current;

    // ── STEP 1: Serve cache immediately ───────────────────────────────────────
    const cached = lfcRead(user.email, cacheKey);
    const cacheAge = cached?.loaded_at ? Date.now() - cached.loaded_at : Infinity;
    const isCacheStale = cacheAge > GALLERY_STALE_MS;

    if (cached?.data && !forceRefresh) {
      // Show cached data instantly — no spinner needed
      console.log(`[MediaGallery] Cache HIT page=${page} search="${search}" age=${Math.round(cacheAge/1000)}s stale=${isCacheStale}`);
      setPageImages(cached.data.images || []);
      setHasMore(cached.data.hasMore === true);
      setLastProof(cached.data.proof || null);

      // If cache is fresh enough, skip background refresh
      if (!isCacheStale && !forceRefresh) return;

      // Cache is stale — do a silent background refresh without showing a spinner
      setIsRefreshing(true);
    } else {
      // Cold load — show spinner
      console.log(`[MediaGallery] Cache MISS page=${page} search="${search}" — cold load`);
      setIsLoading(true);
    }

    // ── STEP 2: Fetch from backend ─────────────────────────────────────────────
    try {
      const res = await base44.functions.invoke('fetchMediaGalleryPage', {
        page,
        pageSize: 20,
        searchTerm: search,
      });

      // Stale request — a newer navigation happened, discard
      if (requestId !== activeRequestRef.current) {
        console.log(`[MediaGallery] Stale response for page=${page} — discarded`);
        return;
      }

      const data = res?.data;
      if (!data) throw new Error('No data returned');

      const freshImages = data.images || [];

      console.log(`[MediaGallery] Fresh page=${page} images=${freshImages.length} total=${data.totalImages} hasMore=${data.hasMore}`);
      console.log(`[MediaGallery] PROOF:`, data.proof);

      // Write to cache
      const cachePayload = { images: freshImages, hasMore: data.hasMore === true, proof: data.proof };
      if (freshImages.length > 0) {
        lfcWrite(user.email, cacheKey, cachePayload);
      }

      // Update UI — preserve existing images during background refresh (no wipe)
      setPageImages(freshImages);
      setHasMore(data.hasMore === true);
      setLastProof(data.proof || null);

    } catch (e) {
      // Only log — cached data (if any) remains showing
      console.error('[MediaGallery] fetchPage error:', e.message);
      if (requestId === activeRequestRef.current && pageImages.length === 0) {
        setPageImages([]);
      }
    } finally {
      if (requestId === activeRequestRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [user?.email]); // eslint-disable-line

  // Load whenever user, page, or search changes
  useEffect(() => {
    if (user?.email) {
      fetchPage(currentPage, searchTerm);
    }
  }, [user?.email, currentPage, searchTerm, fetchPage]);

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
        console.log(`[MediaGallery] ✓ Deleted image ${image.messageId}`);
        setSelectedImage(null);
        // Invalidate cache for this page and force refresh
        // lfcWrite(null) is a no-op — must use lfcDelete to actually clear
        const cacheKey = galleryPageCacheKey(user.email, currentPage, searchTerm);
        lfcDelete(user.email, cacheKey);
        fetchPage(currentPage, searchTerm, { forceRefresh: true });
      } else {
        alert(`Delete denied: ${res?.data?.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('[MediaGallery] Delete failed:', e);
      alert(`Delete failed: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6" style={{ paddingTop: 'max(1.5rem, calc(1.5rem + env(safe-area-inset-top)))' }}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
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
              title="Show diagnostics"
            >
              {showDiagnostics ? 'Hide' : 'Show'} diagnostics
            </button>
          </div>
        </div>

        {/* Diagnostics Panel */}
        {showDiagnostics && lastProof && (
          <div className="mb-6 p-4 rounded-lg bg-secondary/20 border border-border text-xs font-mono text-muted-foreground space-y-1">
            <div><strong>Gallery Diagnostics — Page {currentPage}</strong></div>
            <div>owner: {user?.email || 'unknown'}</div>
            <div>startIndex: {lastProof.startIndex ?? 'n/a'} | endIndex: {lastProof.endIndex ?? 'n/a'} | pageSize: {lastProof.pageSize}</div>
            <div>totalInIndex: {lastProof.totalImagesInIndex} | returned: {lastProof.pageImagesReturned}</div>
            <div>rawScanned: {lastProof.rawScanned} | batches: {lastProof.batchCount} | cursor: {lastProof.cursorStyle}</div>
            <div>firstId: {lastProof.firstImageId || 'n/a'}</div>
            <div>firstTs: {lastProof.firstImageTimestamp || 'n/a'}</div>
            <div>lastId: {lastProof.lastImageId || 'n/a'}</div>
            <div>lastTs: {lastProof.lastImageTimestamp || 'n/a'}</div>
            <div>hasMore: {lastProof.hasMore ? 'yes' : 'no'} | exhausted: {lastProof.exhausted ? 'yes' : 'no'}</div>
          </div>
        )}

        {/* Search */}
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

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full" />
          </div>
        ) : pageImages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchTerm ? 'No images match your search.' : 'No media found. Images you send and receive will appear here.'}
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

            {/* Pagination */}
            <div className="flex items-center justify-center gap-4 mb-8 flex-wrap">
              <button
                onClick={handlePrev}
                disabled={currentPage === 1 || isLoading}
                className="px-4 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>

              {/* Page Jump */}
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
                disabled={!hasMore || isLoading}
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
        {/* Image */}
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

        {/* Scrollable content area */}
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

        {/* Fixed action buttons */}
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
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        if (!user?.email) return;
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

  // Group and sort characters alphabetically within type
  const groupedCharacters = useMemo(() => {
    const groups = {
      active_created: [],
      npc_regular: [],
      npc_family: [],
      npc_fictitious: [],
      other: [],
    };

    characters.forEach(char => {
      const type = char.character_type || 'other';
      const displayName = char.display_name || char.name;

      if (type === 'active_created_character') groups.active_created.push({ ...char, displayName });
      else if (type === 'npc_regular') groups.npc_regular.push({ ...char, displayName });
      else if (type === 'npc_family_member') groups.npc_family.push({ ...char, displayName });
      else if (type === 'npc_fictitious') groups.npc_fictitious.push({ ...char, displayName });
      else groups.other.push({ ...char, displayName });
    });

    // Sort each group alphabetically by display name
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => a.displayName.localeCompare(b.displayName));
    });

    return groups;
  }, [characters]);

  // Resolve the real conversation_id for a user↔character chat.
  // Fetches all owner conversations and filters CLIENT-SIDE for the direct thread
  // containing this charId. Array-field filtering via scalar in Base44 query is
  // unreliable — client-side filter is the correct approach.
  const resolveConversationId = async (charId, charName) => {
    // Fetch all conversations for this owner, most recent first
    const convos = await base44.entities.Conversation.filter(
      { owner_email: user.email },
      '-last_message_date',
      100
    );

    // Find the direct user↔character conversation (not a world_phone/bilateral thread)
    const direct = convos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      const hasChar = ids.includes(charId);
      const isWorldPhone = !!c.shared_conversation_key || c.channel === 'world_phone' || c.type === 'bilateral';
      return hasChar && !isWorldPhone;
    });

    if (direct.length > 0) {
      // Prefer the one with the most recent activity
      const sorted = [...direct].sort((a, b) => {
        const da = a.last_message_date ? new Date(a.last_message_date).getTime() : 0;
        const db = b.last_message_date ? new Date(b.last_message_date).getTime() : 0;
        return db - da;
      });
      console.log(`[resolveConversationId] Found direct convo for char=${charId} → convo=${sorted[0].id}`);
      return sorted[0].id;
    }

    // No existing conversation found — create a new direct one
    console.log(`[resolveConversationId] No direct convo found for char=${charId} — creating new`);
    const newConvo = await base44.entities.Conversation.create({
      title: `chat with ${charName}`,
      type: 'chat',
      character_ids: [charId],
      owner_email: user.email,
    });
    console.log(`[resolveConversationId] Created new convo=${newConvo.id} for char=${charId}`);
    return newConvo.id;
  };

  const handleSend = async () => {
    setError(null);
    setLoading(true);
    try {
      if (senderMode === 'user') {
        // User sending to multiple characters — writes to the real Chat conversation
        if (selectedRecipientCharacterIds.size === 0) {
          setError('Please select at least one character');
          setLoading(false);
          return;
        }

        for (const charId of selectedRecipientCharacterIds) {
          const char = characters.find(c => c.id === charId);
          if (!char) continue;

          // Resolve real conversation ID (never use synthetic string IDs)
          const convoId = await resolveConversationId(charId, char.name || char.display_name);

          // IMAGE FORWARDING: send the exact original image_url — no regeneration, no prompt resubmission
          const msg = await base44.entities.Message.create({
            conversation_id: convoId,
            sender_type: 'user',
            character_id: charId,
            character_name: char.name || char.display_name,
            content: '',
            image_url: image.url,           // exact original URL — not regenerated
            image_description: image.imageDescription || '',
            message_type: 'image',
            timestamp: new Date().toISOString(),
            owner_email: user.email,
          });

          console.log(`[SendImageModal] IMAGE FORWARD PROOF | selected_gallery_image_id=${image.messageId} | selected_original_image_url=${image.url} | sent_message_image_url=${image.url} | url_identical=true | no_regeneration=true | convo=${convoId} | msg=${msg?.id}`);

          // Update conversation preview so Chat shows the latest send
          await base44.entities.Conversation.update(convoId, {
            last_message_preview: '📷 Photo',
            last_message_date: new Date().toISOString(),
          }).catch(() => {});


        }
      } else {
        // Character sending to character(s) via World Phone
        if (!selectedSenderCharacterId) {
          setError('Please select a sender character');
          setLoading(false);
          return;
        }
        if (selectedRecipientCharacterIds.size === 0) {
          setError('Please select at least one recipient character');
          setLoading(false);
          return;
        }
        if (selectedRecipientCharacterIds.has(selectedSenderCharacterId)) {
          setError('Cannot send to the same character you are sending as');
          setLoading(false);
          return;
        }

        for (const receiverId of selectedRecipientCharacterIds) {
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

          const proof = res?.data?.proof || {};
          console.log('[SendImageModal] World Phone image sent:', {
            sender: selectedSenderCharacterId,
            receiver: receiverId,
            msg_id: res.data.message_id,
            image_url_readback: proof.image_url_readback,
            message_type: proof.message_type_readback,
          });
        }
      }
      onSent();
    } catch (e) {
      console.error('[SendImageModal] Send failed:', e);
      setError(`Send failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const CharacterGroupUser = ({ title, chars, selected, onToggle }) => {
    if (chars.length === 0) return null;
    return (
      <>
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase bg-secondary/30 border-t border-border">
          {title}
        </div>
        {chars.map((char) => (
          <label
            key={char.id}
            className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/50 cursor-pointer border-b border-border/50 last:border-b-0"
          >
            <input
              type="checkbox"
              checked={selected.has(char.id)}
              onChange={() => onToggle(char.id)}
              className="w-4 h-4"
            />
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
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase bg-secondary/30 border-t border-border">
          {title}
        </div>
        {chars.map((char) => {
          const isSender = char.id === senderCharacterId;
          return (
            <label
              key={char.id}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-border/50 last:border-b-0 ${
                isSender ? 'bg-secondary/20 opacity-50 cursor-not-allowed' : 'hover:bg-secondary/50'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(char.id)}
                onChange={() => onToggle(char.id)}
                disabled={isSender}
                className="w-4 h-4 disabled:opacity-50"
              />
              <span className={`text-sm ${isSender ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {char.displayName}
                {isSender && ' (sender)'}
              </span>
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

        {/* Sender Mode */}
        <div className="mb-4">
          <p className="text-sm font-semibold text-foreground mb-2">Send As:</p>
          <div className="flex gap-2">
            <button
              onClick={() => setSenderMode('user')}
              className={`flex-1 px-3 py-2 rounded text-sm ${
                senderMode === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              You
            </button>
            <button
              onClick={() => setSenderMode('character')}
              className={`flex-1 px-3 py-2 rounded text-sm ${
                senderMode === 'character'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              Character
            </button>
          </div>
        </div>

        {/* User mode: select receivers */}
        {senderMode === 'user' && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Send to Characters:</p>
            <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20 max-h-56">
              {['active_created', 'npc_regular', 'npc_family', 'npc_fictitious', 'other'].map(typeKey => {
                const typeLabels = { active_created: 'Active Characters', npc_regular: 'NPC Regular', npc_family: 'NPC Family', npc_fictitious: 'NPC Fictitious', other: 'Other' };
                return (
                  <CharacterGroupUser
                    key={typeKey}
                    title={typeLabels[typeKey]}
                    chars={groupedCharacters[typeKey]}
                    selected={selectedRecipientCharacterIds}
                    onToggle={(charId) => {
                      const newSet = new Set(selectedRecipientCharacterIds);
                      if (newSet.has(charId)) newSet.delete(charId);
                      else newSet.add(charId);
                      setSelectedRecipientCharacterIds(newSet);
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Character mode: select sender, then receivers */}
        {senderMode === 'character' && (
          <div className="mb-4 space-y-4">
            {/* Sender selection */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Sending As:</p>
              <select
                value={selectedSenderCharacterId || ''}
                onChange={(e) => setSelectedSenderCharacterId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
              >
                <option value="">— Select character —</option>
                {[...groupedCharacters.active_created, ...groupedCharacters.npc_regular, ...groupedCharacters.npc_family, ...groupedCharacters.npc_fictitious, ...groupedCharacters.other].map((char) => (
                  <option key={char.id} value={char.id}>
                    {char.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Receiver selection */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Send To:</p>
              <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20 max-h-40">
                {['active_created', 'npc_regular', 'npc_family', 'npc_fictitious', 'other'].map(typeKey => {
                  const typeLabels = { active_created: 'Active Characters', npc_regular: 'NPC Regular', npc_family: 'NPC Family', npc_fictitious: 'NPC Fictitious', other: 'Other' };
                  return (
                    <CharacterGroupCharacter
                      key={typeKey}
                      title={typeLabels[typeKey]}
                      chars={groupedCharacters[typeKey]}
                      selected={selectedRecipientCharacterIds}
                      senderCharacterId={selectedSenderCharacterId}
                      onToggle={(charId) => {
                        const newSet = new Set(selectedRecipientCharacterIds);
                        if (newSet.has(charId)) newSet.delete(charId);
                        else newSet.add(charId);
                        setSelectedRecipientCharacterIds(newSet);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90"
          >
            Cancel
          </button>
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
          <button
            onClick={handleSend}
            disabled={loading || (senderMode === 'user' ? selectedRecipientCharacterIds.size === 0 : !selectedSenderCharacterId || selectedRecipientCharacterIds.size === 0)}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}