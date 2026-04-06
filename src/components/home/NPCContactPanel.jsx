import React, { useState } from 'react';
import { Users, X, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function NPCContactPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: npcCharacters = [] } = useQuery({
    queryKey: ['npcCharacters'],
    queryFn: async () => {
      const chars = await base44.entities.Character.filter({
        character_type: 'npc',
        status: 'active'
      });
      return chars;
    },
    staleTime: 30000,
  });

  const handleContactNPC = (characterId) => {
    setIsOpen(false);
    navigate(`/chat/${characterId}`);
  };

  const handleDeleteNPC = async (e, characterId) => {
    e.stopPropagation();
    
    if (!window.confirm('Permanently delete this NPC? This cannot be undone.')) return;

    try {
      await base44.entities.Character.delete(characterId);
      queryClient.invalidateQueries({ queryKey: ['npcCharacters'] });
    } catch (err) {
      alert('Failed to delete NPC: ' + err.message);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors"
      >
        <Users className="w-4 h-4" />
        Contact NPC ({npcCharacters.length})
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            className="absolute top-full right-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-lg z-50"
          >
            {npcCharacters.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground text-center">
                No NPCs to contact
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {npcCharacters.map((npc) => (
                  <motion.button
                    key={npc.id}
                    onClick={() => handleContactNPC(npc.id)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-secondary transition-colors text-left border-b border-border last:border-b-0"
                    whileHover={{ x: 2 }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{npc.name}</p>
                      {npc.occupation && (
                        <p className="text-xs text-muted-foreground truncate">{npc.occupation}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => handleDeleteNPC(e, npc.id)}
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      title="Delete NPC"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </motion.button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}