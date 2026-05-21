import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { X, Send, Trash2, Search, ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

const IMAGES_PER_PAGE = 20;

export default function MediaGallery() {
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  const [hasMore, setHasMore] = useState(true);

  // Load paginated batch of images on demand
  // Uses skip-based pagination: page 1 = skip 0, page 2 = skip 20, etc.
  // Fetches IMAGES_PER_PAGE + 1 to detect if more pages exist, then slices back to 20.
  // No $exists filter (not supported) — filter by image_url presence in JS after fetch.
  // Fetches a wider batch (IMAGES_PER_PAGE * 3) to account for JS-side filtering of
  // records without image_url, then slices to the correct window.
  const FETCH_BATCH = IMAGES_PER_PAGE * 4; // wider net to find enough image records
  const { data: currentPageImages = [], isLoading, refetch: refetchCurrentPage } = useQuery({
    queryKey: ['media_gallery_page', user?.email, currentPage, searchTerm],
    queryFn: async () => {
      if (!user?.email) return [];
      try {
        const searchLower = searchTerm.toLowerCase();
        // Skip = (page - 1) * 20 image records. Because we don't know how many non-image
        // records exist before our target window, we fetch a larger batch from the correct
        // timestamp offset and filter down. We use skip on the raw query as an approximation.
        const skip = (currentPage - 1) * IMAGES_PER_PAGE;

        // Fetch a broad batch ordered newest first, skipping already-seen pages
        const messages = await base44.entities.Message.list('-timestamp', FETCH_BATCH, skip * 2);

        // Filter to only messages that have an image_url
        const seen = new Set();
        const withImages = messages.filter(m => {
          if (!m.image_url) return false;
          if (seen.has(m.image_url)) return false;
          seen.add(m.image_url);
          if (searchTerm) {
            const desc = (m.image_description || m.content || '').toLowerCase();
            const name = (m.character_name || 'you').toLowerCase();
            return desc.includes(searchLower) || name.includes(searchLower);
          }
          return true;
        });

        // Take only 20 for display, +1 to detect hasMore
        const pageSlice = withImages.slice(0, IMAGES_PER_PAGE + 1);
        const hasNextPage = pageSlice.length > IMAGES_PER_PAGE;
        setHasMore(hasNextPage);

        const items = pageSlice.slice(0, IMAGES_PER_PAGE).map(m => ({
          id: m.id,
          url: m.image_url,
          description: m.image_description || m.content?.slice(0, 100) || 'Image',
          senderType: m.sender_type,
          senderName: m.character_name || 'You',
          characterId: m.character_id,
          conversationId: m.conversation_id,
          timestamp: m.timestamp,
          sourceType: 'message',
          messageId: m.id,
        }));

        return items;
      } catch (e) {
        console.error('[MediaGallery] Failed to load media page:', e);
        return [];
      }
    },
    enabled: !!user?.email,
  });

  const paginatedMedia = currentPageImages;

  return (
    <div className="min-h-screen bg-background p-6" style={{ paddingTop: 'max(1.5rem, calc(1.5rem + env(safe-area-inset-top)))' }}>
      <div className="max-w-7xl mx-auto">
        {/* Header with back button */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Media Gallery</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Page {currentPage}{hasMore ? '+' : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6 flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or description..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder-muted-foreground"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full" />
          </div>
        ) : paginatedMedia.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchTerm ? 'No images match your search.' : 'No media found.'}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
              {paginatedMedia.map((item) => (
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

            {/* Pagination Controls */}
            <div className="flex items-center justify-center gap-2 mb-8">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>

              <span className="text-sm text-muted-foreground px-4">
                Page {currentPage}
              </span>

              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={!hasMore}
                className="px-4 py-2 rounded-lg bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      {/* Image Detail Modal */}
      {selectedImage && (
        <ImageDetailModal
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
          onSend={() => {
            setShowSendModal(true);
          }}
          onDelete={async () => {
            try {
              // Delete the message containing the image
              await base44.entities.Message.delete(selectedImage.messageId);
              setSelectedImage(null);
              // Refresh the current page after deletion
              refetchCurrentPage();
            } catch (e) {
              console.error('[MediaGallery] Delete failed:', e);
              alert(`Delete failed: ${e.message}`);
            }
          }}
        />
      )}

      {/* Send to Characters Modal */}
      {showSendModal && selectedImage && (
        <SendImageModal
          image={selectedImage}
          onClose={() => setShowSendModal(false)}
          onSent={() => {
            setShowSendModal(false);
            setSelectedImage(null);
          }}
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