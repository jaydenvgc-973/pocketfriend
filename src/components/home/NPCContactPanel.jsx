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

  const { data: currentUser = null } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  // Get active character names and the user's own character name to filter out
  const defaultCharacter = characters.find(c => c.is_default);
  const activeCharacterNames = characters
    .filter(c => c.status !== 'deleted' && c.status !== 'moved_away')
    .map(c => c.name?.toLowerCase());

  // Extract fictional NPCs from all characters' fictional_relationships
  // Filter out NPCs that share names with active characters or the user
  // Deduplicate only exact name matches from the same source character
  const npcCharacters = characters.flatMap(char => 
    (char.fictional_relationships || []).map(rel => ({
      ...rel,
      characterId: rel.related_character_id,
      name: rel.person_name,
      sourceCharacterId: char.id,
      id: `${char.id}-${rel.related_character_id}`
    }))
  ).reduce((acc, npc) => {
    const nameLower = npc.name?.toLowerCase().trim();
    
    // Filter out: active characters, user's own character
    if (activeCharacterNames.includes(nameLower) || 
        nameLower === defaultCharacter?.name?.toLowerCase()) {
      return acc;
    }
    
    // Only filter if exact same name from same source character already exists
    const isDuplicate = acc.some(existing => 
      existing.name?.toLowerCase().trim() === nameLower && 
      existing.sourceCharacterId === npc.sourceCharacterId
    );
    
    if (!isDuplicate) {
      acc.push(npc);
    }
    
    return acc;
  }, []);

  const handleContactNPC = (npc) => {
    setIsOpen(false);
    // If fictional NPC has a related_character_id, navigate to that character's chat
    // Otherwise, navigate with npc name as a parameter for fictional chat
    if (npc.characterId) {
      navigate(`/chat/${npc.characterId}`);
    } else {
      // For NPCs without a linked character, pass NPC data via state
      navigate(`/chat?npcName=${encodeURIComponent(npc.name)}&sourceCharId=${npc.sourceCharacterId}`);
    }
  };

  const handleDeleteNPC = async (e, sourceCharId, targetCharId) => {
    e.stopPropagation();
    
    if (!window.confirm('Permanently delete this NPC? This cannot be undone.')) return;

    try {
      const char = characters.find(c => c.id === sourceCharId);
      if (char) {
        const updated = {
          fictional_relationships: (char.fictional_relationships || []).filter(
            rel => rel.related_character_id !== targetCharId
          )
        };
        await base44.entities.Character.update(sourceCharId, updated);
        queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      }
    } catch (err) {
      alert('Failed to delete NPC: ' + err.message);
    }
  };

  return (
    <div className="relative w-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors"
      >
        <Users className="w-4 h-4" />
        Contact NPC ({npcCharacters.length})
        <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            className="absolute left-0 right-0 top-full mt-2 w-full bg-card border border-border rounded-xl shadow-lg z-40 max-h-80 overflow-y-auto"
          >
            {npcCharacters.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground text-center">
                No NPCs to contact
              </div>
            ) : (
              <div>
                {npcCharacters.map((npc, idx) => (
                  <motion.button
                    key={idx}
                    onClick={() => handleContactNPC(npc)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-secondary transition-colors text-left border-b border-border last:border-b-0"
                    whileHover={{ x: 2 }}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {npc.avatar_url ? (
                        <img src={npc.avatar_url} alt={npc.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-primary">{npc.name?.[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{npc.name}</p>
                        {npc.relationship_type && (
                          <p className="text-xs text-muted-foreground truncate">{npc.relationship_type}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        handleDeleteNPC(e, npc.sourceCharacterId, npc.characterId);
                      }}
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