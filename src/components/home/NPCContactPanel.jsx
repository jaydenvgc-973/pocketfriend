import React, { useState } from 'react';
import { Users, X, ChevronDown, UserCheck, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function NPCContactPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: currentUser = null } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch NPCs by owner_email ONLY — this is the authoritative ownership field for NPCs.
  // created_by_id (the platform system field) can be wrong due to admin-session creation,
  // so we NEVER filter by created_by for NPCs. owner_email is the source of truth.
  const { data: npcCharacters = [] } = useQuery({
    queryKey: ['npc-characters', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const results = await base44.entities.Character.filter({
        owner_email: currentUser.email,
        character_type: { $in: ['npc', 'family_npc'] },
      });
      // Final guard: strictly enforce owner_email matches and exclude protected_active
      return results.filter(c =>
        c.owner_email === currentUser.email &&
        !c.protected_active
      );
    },
    enabled: !!currentUser?.email,
  });

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (isOpen && !e.target.closest('[data-npc-panel]')) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleContactNPC = (npc) => {
    setIsOpen(false);
    // Navigate to chat with the NPC character directly
    navigate(`/chat/${npc.id}`);
  };

  const handleDeleteNPC = async (e, npcId) => {
    e.stopPropagation();
    if (!window.confirm('Permanently delete this NPC? This cannot be undone.')) return;
    try {
      await base44.entities.Character.delete(npcId);
      queryClient.invalidateQueries({ queryKey: ['npc-characters', currentUser?.email] });
    } catch (err) {
      alert('Failed to delete NPC: ' + err.message);
    }
  };

  const handleCheckForNPCs = async () => {
    if (!currentUser?.email) return;
    setIsChecking(true);
    try {
      // ONLY query by owner_email — never by created_by, which can return cross-account NPCs
      // due to the platform's created_by_id being set at creation time and not correctable.
      const allChars = await base44.entities.Character.filter({ owner_email: currentUser.email });

      // Find NPC-type characters that aren't tagged correctly — strictly scoped to this account
      const needsTagging = allChars.filter(c =>
        c.owner_email === currentUser.email &&
        (c.character_type === 'background' || (!c.character_type && !c.is_default && !c.is_active_character)) &&
        c.protected_active !== true &&
        c.status !== 'deleted'
      );
      await Promise.all(
        needsTagging.map(c => base44.entities.Character.update(c.id, { character_type: 'npc' }))
      );
      queryClient.invalidateQueries({ queryKey: ['npc-characters', currentUser.email] });
    } finally {
      setIsChecking(false);
    }
  };

  const handleMarkAsActive = async (e, npc) => {
    e.stopPropagation();
    try {
      // Set character_type to 'active' AND protected_active=true so no system process ever re-adds them
      await base44.entities.Character.update(npc.id, {
        character_type: 'active',
        protected_active: true,
      });
      queryClient.invalidateQueries({ queryKey: ['npc-characters', currentUser?.email] });
    } catch (err) {
      alert('Failed to update character: ' + err.message);
    }
  };

  return (
    <div className="relative w-full" data-npc-panel>
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
            className="fixed left-4 right-4 z-40 bg-card border border-border rounded-xl shadow-lg"
            style={{
              bottom: '80px',
              maxHeight: '200px',
              overflowY: 'auto'
            }}
          >
            {/* Check for NPCs option — always visible at top */}
            <div className="border-b border-border">
              <button
                onClick={handleCheckForNPCs}
                disabled={isChecking}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
                {isChecking ? 'Checking...' : 'Check for NPCs on this account'}
              </button>
            </div>

            {npcCharacters.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground text-center">
                No NPCs found — try "Check for NPCs" above
              </div>
            ) : (
              <div>
                {npcCharacters.map((npc) => (
                  <motion.button
                    key={npc.id}
                    onClick={() => handleContactNPC(npc)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-secondary transition-colors text-left border-b border-border last:border-b-0"
                    whileHover={{ x: 2 }}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {npc.avatar_url && npc.avatar_url.trim() ? (
                        <img src={npc.avatar_url} alt={npc.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" onError={(e) => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-primary">{npc.name?.[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{npc.name}</p>
                        <p className="text-xs text-muted-foreground truncate capitalize">{npc.character_type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => handleMarkAsActive(e, npc)}
                        className="p-1 rounded hover:bg-blue-500/10 text-muted-foreground hover:text-blue-400 transition-colors"
                        title="Not an NPC — move to active characters"
                      >
                        <UserCheck className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteNPC(e, npc.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete NPC"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
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