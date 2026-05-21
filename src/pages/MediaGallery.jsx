import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { X, Send, Trash2, Search, ArrowLeft } from 'lucide-react';

export default function MediaGallery() {
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState(null);

  // Cursor stack: index = page number (1-based), value = rawCursor to pass for that page.
  // Page 1 always starts at rawCursor=0.
  // After page N loads, its nextRawCursor is pushed so page N+1 knows where to start.
  // This guarantees no raw-message skipping of valid images between pages.
  const [currentPage, setCurrentPage] = useState(1);
  const [cursorStack, setCursorStack] = useState([0]); // cursorStack[0] = cursor for page 1
  const [hasMore, setHasMore] = useState(true);
  const [pageImages, setPageImages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastProof, setLastProof] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  // Fetch whenever user, page, or searchTerm changes
  const fetchPage = useCallback(async (page, cursors, search) => {
    if (!user?.email) return;
    setIsLoading(true);
    try {
      const rawCursor = cursors[page - 1] ?? 0;
      console.log(`[MediaGallery] fetchPage page=${page} rawCursor=${rawCursor} search="${search}"`);

      const res = await base44.functions.invoke('fetchMediaGalleryPage', {
        rawCursor,
        searchTerm: search,
      });

      const data = res?.data;
      if (!data) throw new Error('No data returned from fetchMediaGalleryPage');

      console.log('[MediaGallery] PROOF:', data.proof);

      setPageImages(data.images || []);
      setHasMore(data.hasMore === true);
      setLastProof(data.proof);

      // Validate ownership: all images must belong to currentUser
      if (data.currentUserEmail && user?.email && data.currentUserEmail !== user.email) {
        console.error(`[MediaGallery] OWNERSHIP MISMATCH: response user=${data.currentUserEmail}, current=${user.email}`);
      }

      // Log verification paths for diagnostics
      if (data.images?.length > 0) {
        console.log(`[MediaGallery] Page ${page} verification paths:`, data.images.map(img => ({
          id: img.id,
          verificationPath: img.verificationPath,
          hasOwnEmail: !!img.ownerEmail,
        })));
      }

      // Store nextRawCursor so the next page can use it
      if (data.nextRawCursor != null) {
        setCursorStack(prev => {
          const next = [...prev];
          next[page] = data.nextRawCursor; // index = page number (page 2 cursor at index 2, etc.)
          return next;
        });
      }
    } catch (e) {
      console.error('[MediaGallery] fetchPage error:', e.message);
      setPageImages([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.email]);

  // Initial load and on page/search change
  useEffect(() => {
    if (user?.email) {
      fetchPage(currentPage, cursorStack, searchTerm);
    }
  }, [user?.email, currentPage, searchTerm]); // eslint-disable-line

  const handleNext = () => {
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
  };

  const handlePrev = () => {
    if (currentPage <= 1) return;
    setCurrentPage(p => p - 1);
  };

  const handleSearchChange = (val) => {
    setSearchTerm(val);
    setCurrentPage(1);
    setCursorStack([0]); // reset cursor stack on new search
    setHasMore(true);
  };

  const handleDeleteImage = async (image) => {
    if (!user?.email) {
      alert('User not authenticated');
      return;
    }
    if (image.ownerEmail !== user.email) {
      alert(`Cannot delete image. Ownership mismatch: image owner=${image.ownerEmail}, current user=${user.email}`);
      console.warn(`[MediaGallery] BLOCKED delete: image owned by ${image.ownerEmail}, current user is ${user.email}`);
      return;
    }
    try {
      console.log(`[MediaGallery] Deleting message ${image.messageId} (owned by ${image.ownerEmail})`);
      await base44.entities.Message.delete(image.messageId);
      setSelectedImage(null);
      // Refetch current page with same cursor
      await fetchPage(currentPage, cursorStack, searchTerm);
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
              <p className="text-sm text-muted-foreground mt-1">
                Page {currentPage}{hasMore ? '+' : ''} • {pageImages.length} images
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="text-xs px-2 py-1 rounded-lg bg-secondary/40 text-muted-foreground hover:text-foreground"
            title="Show ownership diagnostics"
          >
            {showDiagnostics ? 'Hide' : 'Show'} diagnostics
          </button>
        </div>

        {/* Diagnostics Panel */}
        {showDiagnostics && lastProof && (
          <div className="mb-6 p-4 rounded-lg bg-secondary/20 border border-border text-xs font-mono text-muted-foreground space-y-1">
            <div><strong>Ownership Diagnostics:</strong></div>
            <div>currentUser: {user?.email || 'unknown'}</div>
            <div>responseUser: {lastProof.currentUserEmail || 'unknown'}</div>
            <div>rawScanned: {lastProof.rawScanned}</div>
            <div>validFound: {lastProof.validFound}</div>
            <div>blockedCrossOwner: {lastProof.blockedCrossOwner}</div>
            <div>blockedUnverified: {lastProof.blockedUnverified}</div>
            <div>excluded: {lastProof.excluded}</div>
            <div>exhausted: {lastProof.exhausted ? 'yes' : 'no'}</div>
            <div>nextRawCursor: {lastProof.nextRawCursor !== null ? lastProof.nextRawCursor : 'none (end)'}</div>
            {pageImages.length > 0 && (
              <>
                <div className="mt-2"><strong>Verification Paths:</strong></div>
                {pageImages.map((img, i) => (
                  <div key={i} className="text-[10px]">
                    img{i}: {img.verificationPath || 'unknown'} {img.ownerEmail ? `(direct: ${img.ownerEmail})` : '(inherited)'}
                  </div>
                ))}
              </>
            )}
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
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer border border-border hover:border-primary/50 transition-all"
                  onClick={() => setSelectedImage(item)}
                >
                  <img
                    src={item.url}
                    alt={item.description}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => {
                      e.target.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22%3E%3Crect fill=%22%23333%22 width=%22200%22 height=%22200%22/%3E%3C/svg%3E';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Send className="w-5 h-5 text-white" />
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-4 mb-8">
              <button
                onClick={handlePrev}
                disabled={currentPage === 1 || isLoading}
                className="px-4 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">Page {currentPage}</span>
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
        className="bg-card rounded-lg max-w-2xl w-full overflow-hidden"
      >
        <div className="relative">
          <img
            src={image.url}
            alt={image.description}
            className="w-full max-h-96 object-contain"
          />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 p-2 bg-black/50 rounded-lg hover:bg-black/70"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted-foreground mb-2">From: {image.senderName}</p>
          <p className="text-foreground mb-4">{image.description}</p>
          <div className="flex gap-2">
            <button
              onClick={onSend}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center justify-center gap-2"
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
        </div>
      </motion.div>
    </motion.div>
  );
}

function SendImageModal({ image, onClose, onSent }) {
  const [characters, setCharacters] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [senderMode, setSenderMode] = useState('user');
  const [recipient, setRecipient] = useState(null); // For character-to-character sends
  const [loading, setLoading] = useState(false);
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

  // Group and sort characters
  const groupedCharacters = useMemo(() => {
    const groups = {
      user: [],
      active_created: [],
      npc_regular: [],
      npc_family: [],
      npc_fictitious: [],
      other: [],
    };

    characters.forEach(char => {
      const type = char.character_type || 'other';
      const sorted = { ...char, displayName: char.display_name || char.name };

      if (type === 'active_created_character') groups.active_created.push(sorted);
      else if (type === 'npc_regular') groups.npc_regular.push(sorted);
      else if (type === 'npc_family_member') groups.npc_family.push(sorted);
      else if (type === 'npc_fictitious') groups.npc_fictitious.push(sorted);
      else groups.other.push(sorted);
    });

    // Sort each group alphabetically
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => a.displayName.localeCompare(b.displayName));
    });

    return groups;
  }, [characters]);

  const handleSend = async () => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      for (const charId of selected) {
        const char = characters.find(c => c.id === charId);
        if (!char) continue;

        if (senderMode === 'user') {
          // User sending to character — use Text/Chat system
          await base44.entities.Message.create({
            conversation_id: `${charId}_user`,
            sender_type: 'user',
            character_id: charId,
            content: image.description,
            image_url: image.url,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Character sending to character — use World Phone system
          await base44.functions.invoke('sendWorldPhoneMessage', {
            senderCharacterId: charId,
            recipientCharacterId: charId, // Will be replaced by actual recipient selection if needed
            messageContent: image.description,
            imageUrl: image.url,
            messageType: 'image',
          });
        }
      }
      onSent();
    } catch (e) {
      console.error('[SendImageModal] Send failed:', e);
      alert(`Send failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const CharacterGroup = ({ title, chars }) => {
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
              onChange={() => {
                const newSet = new Set(selected);
                if (newSet.has(char.id)) newSet.delete(char.id);
                else newSet.add(char.id);
                setSelected(newSet);
              }}
              className="w-4 h-4"
            />
            <span className="text-sm text-foreground">{char.displayName}</span>
          </label>
        ))}
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

        {/* Recipient selector for character-to-character */}
        {senderMode === 'character' && (
          <div className="mb-4">
            <p className="text-sm font-semibold text-foreground mb-2">Send To Character:</p>
            <select
              value={recipient || ''}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground"
            >
              <option value="">— Select recipient —</option>
              {characters.map((char) => (
                <option key={char.id} value={char.id}>
                  {char.display_name || char.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Character List — for user sends, shows who receives the image */}
        {senderMode === 'user' && (
          <div className="mb-4 flex-1 overflow-y-auto border border-border rounded-lg bg-secondary/20">
            <CharacterGroup title="Active Characters" chars={groupedCharacters.active_created} />
            <CharacterGroup title="NPC Regular" chars={groupedCharacters.npc_regular} />
            <CharacterGroup title="NPC Family Members" chars={groupedCharacters.npc_family} />
            <CharacterGroup title="NPC Fictitious" chars={groupedCharacters.npc_fictitious} />
            <CharacterGroup title="Other" chars={groupedCharacters.other} />
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
          <button
            onClick={handleSend}
            disabled={loading || (senderMode === 'user' ? selected.size === 0 : !recipient)}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}