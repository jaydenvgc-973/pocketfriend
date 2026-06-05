import React, { useState } from 'react';
import { Users, X, ChevronDown, UserCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorldContactsUnread } from '@/hooks/useWorldContactsUnread';

export default function NPCContactPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: currentUser = null } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  // Use ONLY the service-role backend fetch — it uses owner_email with service role,
  // which catches ALL npc_fictitious records including those created by service role
  // that may lack owner_email on the record itself (RLS-scoped queries would miss them).
  // Fetch from both sources (like Settings does) to catch ALL npc_fictitious
  const { data: regularNPCs = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      return base44.entities.Character.filter({ owner_email: currentUser.email }, "-created_date", 300);
    },
    enabled: !!currentUser?.email,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: npcBackendResult = [] } = useQuery({
    queryKey: ['npc-characters', currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.id) return [];
      const res = await base44.functions.invoke('fetchNPCsForUser', {});
      return res?.data?.npcs || [];
    },
    enabled: !!currentUser?.id,
    staleTime: 15 * 60 * 1000,  // match useOwnedCharacters — prevents duplicate fetches
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (failureCount >= 2) return false;
      const is429 = error?.message?.includes('429') || error?.status === 429;
      return !is429; // never retry 429s — they are rate limits, not transient errors
    },
    retryDelay: (attempt) => Math.min(5000 * 2 ** attempt, 30000),
    placeholderData: (prev) => prev, // CRITICAL: never show empty on 429 — hold last known good
  });

  // Merge and deduplicate
  const allNPCs = (() => {
    const seen = new Set();
    return [...regularNPCs, ...npcBackendResult].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return !['active_created_character', 'deleted', 'soft_deleted'].includes(c.status);
    });
  })();

  // Show npc_fictitious AND npc_world_service characters in the contact panel dropdown
  // npc_world_service = permanent world-service operators (e.g. Vick Servicio) — always contactable
  const npcCharacters = allNPCs.filter(
    c => (c.character_type === 'npc_fictitious' || c.character_type === 'npc_world_service') && c.status !== 'deleted'
  );

  // Sort by name
  const sortedNpcCharacters = npcCharacters.sort((a, b) => {
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // Get unread counts for World Contacts
  const { unreadByContact, globalUnreadCount } = useWorldContactsUnread(
    currentUser?.id,
    sortedNpcCharacters.length > 0
      ? sortedNpcCharacters.map(c => ({ person_name: c.name, id: c.id }))
      : []
  );

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
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ['npc-characters', currentUser?.id] });
    } catch (err) {
      alert('Failed to delete NPC: ' + err.message);
    }
  };

  const handleMarkAsActive = async (e, npc) => {
    e.stopPropagation();
    try {
      await base44.entities.Character.update(npc.id, {
        character_type: 'active_created_character',
      });
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ['npc-characters', currentUser?.id] });
    } catch (err) {
      alert('Failed to update character: ' + err.message);
    }
  };

  return (
    <div className="relative w-full" data-npc-panel>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors relative"
      >
        <Users className="w-4 h-4" />
        Contacts: {sortedNpcCharacters.length} NPCs
        {globalUnreadCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center"
          >
            {globalUnreadCount > 9 ? '9+' : globalUnreadCount}
          </motion.div>
        )}
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
            {sortedNpcCharacters.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground text-center">
                No NPCs to contact
              </div>
            ) : (
              <div>
                {sortedNpcCharacters.map((npc) => (
                  <motion.button
                    key={npc.id}
                    onClick={() => handleContactNPC(npc)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-secondary transition-colors text-left border-b border-border last:border-b-0 relative"
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
                    {unreadByContact[npc.name] > 0 && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="w-4 h-4 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0"
                      >
                        {unreadByContact[npc.name] > 9 ? '9+' : unreadByContact[npc.name]}
                      </motion.div>
                    )}
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