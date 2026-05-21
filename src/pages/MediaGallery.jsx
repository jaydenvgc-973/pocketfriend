import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { X, Send, Trash2, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export default function MediaGallery() {
  const [selectedImage, setSelectedImage] = useState(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  // Load all messages with images (owner_email scoped)
  const { data: mediaItems = [], isLoading } = useQuery({
    queryKey: ['media_gallery', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      try {
        const messages = await base44.entities.Message.filter(
          { image_url: { $exists: true } },
          '-timestamp',
          200
        );
        // Deduplicate by image_url, keep most recent
        const seen = new Set();
        const deduplicated = messages.filter(m => {
          if (seen.has(m.image_url)) return false;
          seen.add(m.image_url);
          return true;
        });
        return deduplicated.map(m => ({
          id: m.id,
          url: m.image_url,
          description: m.image_description || m.content?.slice(0, 100) || 'Untitled',
          senderType: m.sender_type,
          senderName: m.character_name || 'User',
          characterId: m.character_id,
          conversationId: m.conversation_id,
          timestamp: m.timestamp,
        }));
      } catch (e) {
        console.error('[MediaGallery] Failed to load messages:', e);
        return [];
      }
    },
    enabled: !!user?.email,
  });

  const filteredMedia = mediaItems.filter(item =>
    item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.senderName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-foreground">Media Gallery</h1>
        </div>

        {/* Search */}
        <div className="mb-6 flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-foreground placeholder-muted-foreground"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full" />
          </div>
        ) : filteredMedia.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No media found.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredMedia.map((item) => (
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

function ImageDetailModal({ image, onClose, onSend }) {
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const chars = await base44.entities.Character.filter({}, '-created_date', 100);
        setCharacters(chars);
      } catch (e) {
        console.error('[SendImageModal] Failed to load characters:', e);
      }
    };
    load();
  }, []);

  const handleSend = async () => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      for (const charId of selected) {
        const char = characters.find(c => c.id === charId);
        if (!char) continue;
        // Create a message with the image in the character's chat
        await base44.entities.Message.create({
          conversation_id: `${charId}_user`, // Simple conversation id
          sender_type: senderMode === 'user' ? 'user' : 'character',
          character_id: senderMode === 'user' ? charId : senderMode,
          character_name: senderMode === 'user' ? null : senderMode,
          content: image.description,
          image_url: image.url,
          timestamp: new Date().toISOString(),
        });
      }
      onSent();
    } catch (e) {
      console.error('[SendImageModal] Send failed:', e);
    } finally {
      setLoading(false);
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
        className="bg-card rounded-lg max-w-md w-full p-6"
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

        {/* Character List */}
        <div className="mb-4 max-h-48 overflow-y-auto border border-border rounded-lg">
          {characters.map((char) => (
            <label
              key={char.id}
              className="flex items-center gap-2 p-2 hover:bg-secondary/50 cursor-pointer"
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
              <span className="text-sm text-foreground">{char.display_name || char.name}</span>
            </label>
          ))}
        </div>

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
            disabled={loading || selected.size === 0}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}