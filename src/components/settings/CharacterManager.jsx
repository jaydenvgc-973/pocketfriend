import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, GitMerge, ChevronDown, ChevronUp, Check, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchUnifiedRoster, getInitial } from '@/lib/unifiedRosterUtils';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

export default function CharacterManager() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState(new Map()); // key -> entry object

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userSettingsList = [] } = useQuery({
    queryKey: ['userSettings'],
    queryFn: () => base44.entities.UserSettings.list(),
    enabled: !!currentUser?.email,
  });
  const userSettings = userSettingsList[0] || {};

  const { data: roster = [] } = useQuery({
    queryKey: ['unifiedRoster', currentUser?.email],
    queryFn: () => fetchUnifiedRoster(base44, currentUser?.email),
    enabled: !!currentUser?.email,
  });

  // All items from unified roster (user + characters + family + world people)
  // EXCLUDE merged/deleted characters from the list
  const allManageableItems = roster
    .filter(e => e.entity_type !== undefined && e.status !== 'merged' && e.status !== 'deleted' && e.status !== 'soft_deleted')
    .map(c => {
      if (c.is_user) return { type: 'user', data: c };
      if (c.is_family) return { type: 'family', data: c };
      if (c.is_world_person) return { type: 'world_person', data: c };
      return { type: 'character', data: c };
    });

  const renameMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('renameCharacter', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
      setRenamingId(null);
      setNewName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('deleteCharacter', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('mergeCharacters', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
      setMergeMode(false);
      setSelectedForMerge(new Map());
      setMergeConfirmModal(null);
    },
  });

  const handleRename = (charId, oldName, isNPC = false) => {
    setRenamingId(charId);
    setNewName(oldName);
  };

  const submitRename = (itemId, isNPC = false) => {
    if (!newName.trim()) {
      setRenamingId(null);
      return;
    }
    if (isNPC) {
      // Parse itemId to get sourceCharId and old personName
      const match = itemId.match(/^npc_(.+?)_(.+)$/);
      if (match && match[1]) {
        const [, sourceCharId, oldPersonName] = match;
        if (oldPersonName === newName) {
          setRenamingId(null);
          return;
        }
        const sourceChar = roster.find(c => c.id === sourceCharId && c.is_character);
        if (sourceChar) {
          const updated = (sourceChar.fictional_relationships || []).map(r =>
            r.person_name === oldPersonName ? { ...r, person_name: newName } : r
          );
          base44.entities.Character.update(sourceCharId, { fictional_relationships: updated })
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
            setRenamingId(null);
            setNewName('');
          })
            .catch(() => {});
        } else {
          setRenamingId(null);
        }
      } else {
        setRenamingId(null);
      }
    } else {
      const char = roster.find(c => c.id === itemId);
      if (!newName.trim() || newName === char?.name) {
        setRenamingId(null);
        return;
      }
      renameMutation.mutate({ characterId: itemId, newDisplayName: newName });
    }
  };

  const handleDelete = (itemId, isNPC = false) => {
    if (isNPC) {
      if (window.confirm('Remove this NPC from the world?')) {
        // Parse itemId to get sourceCharId and personName
        const match = itemId.match(/^npc_(.+?)_(.+?)_\d+$/);
        if (match) {
          const [, sourceCharId, personName] = match;
          const sourceChar = roster.find(c => c.id === sourceCharId);
          if (sourceChar) {
            const updated = (sourceChar.fictional_relationships || []).filter(
              r => r.person_name !== personName
            );
            base44.entities.Character.update(sourceCharId, { fictional_relationships: updated })
              .then(() => queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] }))
              .catch(() => {});
          }
        }
      }
    } else {
      if (window.confirm('Soft delete this character? All history is preserved and recoverable.')) {
        deleteMutation.mutate({ characterId: itemId });
      }
    }
  };

  // Auto-detect duplicates: same name appears on multiple cards
  const detectDuplicates = () => {
    const nameMap = new Map();
    const duplicateGroups = [];
    
    allManageableItems.forEach((item, idx) => {
      const itemData = item.data;
      const itemName = item.type === 'user'
        ? (userSettings.fictional_world_name || itemData.full_name || currentUser?.full_name || 'You')
        : itemData.name;
      const normalizedName = itemName.toLowerCase().trim();
      
      if (!nameMap.has(normalizedName)) {
        nameMap.set(normalizedName, []);
      }
      nameMap.get(normalizedName).push({ item, idx, itemName, type: item.type });
    });
    
    // Build groups where count >= 2
    nameMap.forEach((group, name) => {
      if (group.length >= 2) {
        duplicateGroups.push({ name, items: group });
      }
    });
    
    return duplicateGroups;
  };

  // Auto-detect orphan NPCs (NPC with no active character counterpart) + ghost NPCs
  const detectOrphanNPCs = () => {
    const activeCharIds = new Set(roster.filter(c => c.is_character && c.status === 'active').map(c => c.id));
    const orphans = [];
    const ghosts = [];
    
    allManageableItems.forEach((item, idx) => {
      const isNPC = item.type === 'world_person' || item.type === 'family';
      if (isNPC) {
        const itemData = item.data;
        const sourceCharExists = activeCharIds.has(itemData.source_character_id);
        
        // Orphan: NPC whose source character doesn't exist as active
        if (!sourceCharExists) {
          orphans.push({ item, idx, itemData });
        }
        
        // Ghost NPC: Active character exists, so NPC should be merged into it
        if (sourceCharExists) {
          ghosts.push({ item, idx, itemData, sourceCharId: itemData.source_character_id });
        }
      }
    });
    
    return { orphans, ghosts };
  };

  const [mergeConfirmModal, setMergeConfirmModal] = useState(null);

  const duplicates = detectDuplicates();
  const { orphans, ghosts } = detectOrphanNPCs();

  // selectedForMerge stores objects: { key, type, charId, sourceCharId, personName }
  const toggleMergeSelection = (entry) => {
    const updated = new Map(selectedForMerge);
    if (updated.has(entry.key)) {
      updated.delete(entry.key);
    } else {
      updated.set(entry.key, entry);
    }
    setSelectedForMerge(updated);
  };

  const submitMerge = () => {
    if (selectedForMerge.size < 2) return;
    const selectedEntries = Array.from(selectedForMerge.values());
    // item is stored directly on the entry — no lookup needed
    const selectedItems = selectedEntries.map(entry => ({ item: entry.item, entry })).filter(e => e.item);
    setMergeConfirmModal({ selectedItems, selectedEntries });
  };

  const confirmMerge = (masterEntry) => {
    if (!mergeConfirmModal) return;
    const { selectedEntries } = mergeConfirmModal;

    // Handle character-to-character merges only (not NPC deduplication)
    const charEntries = selectedEntries.filter(e => e.type === 'character');
    
    if (charEntries.length >= 2) {
      // All selected character IDs — master is designated via primaryCharacterId
      const charIds = charEntries.map(e => e.charId);
      // Get master's avatar_url to propagate
      const masterItem = charEntries.find(e => e.charId === masterEntry.charId);
      const masterAvatarUrl = masterItem?.item?.data?.avatar_url || null;
      mergeMutation.mutate({ 
        characterIds: charIds, 
        primaryCharacterId: masterEntry.charId,
        masterAvatarUrl,
        masterName: masterItem?.item?.data?.name || null,
      });
      setMergeConfirmModal(null);
    } else {
      // NPC-only merge (deduplication)
      const npcEntries = selectedEntries.filter(e => e.type === 'npc');
      const masterName = masterEntry.personName;
      
      const allChars = roster.filter(c => c.is_character || c.fictional_relationships);
      Promise.all(allChars.map(char => {
        const rels = char.fictional_relationships || [];
        const seen = new Map();
        rels.forEach(r => {
          const key = r.person_name?.toLowerCase();
          if (!key) return;
          if (!seen.has(key)) {
            seen.set(key, { ...r });
          } else {
            const existing = seen.get(key);
            seen.set(key, {
              ...existing,
              friendship_level: Math.max(existing.friendship_level ?? 50, r.friendship_level ?? 50),
              user_respect_level: Math.max(existing.user_respect_level ?? 50, r.user_respect_level ?? 50),
              romantic_level: Math.max(existing.romantic_level ?? 0, r.romantic_level ?? 0),
              attraction_level: Math.max(existing.attraction_level ?? 0, r.attraction_level ?? 0),
            });
          }
        });
        const deduped = Array.from(seen.values());
        if (deduped.length === rels.length) return Promise.resolve();
        return base44.entities.Character.update(char.id, { fictional_relationships: deduped });
      }))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
        setSelectedForMerge(new Map());
        setMergeMode(false);
        setMergeConfirmModal(null);
      })
      .catch(() => {});
    }
  };

  const editable = roster.filter(c => !c.is_protected && !c.is_default && !c.is_user);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Manage Characters</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Rename, merge, or delete characters</p>
        </div>
        {mergeMode && (
          <Button
            size="sm"
            onClick={() => {
              setMergeMode(false);
              setSelectedForMerge(new Map());
            }}
            variant="outline"
            className="rounded-lg"
          >
            Cancel
          </Button>
        )}
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {allManageableItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No characters or NPCs</p>
        ) : (
          allManageableItems.map((item, index) => {
            const isNPC = item.type === 'world_person' || item.type === 'family';
            const isUser = item.type === 'user';
            const itemData = item.data;
            // Stable key — use sourceCharId+personName for NPCs; fall back to index to avoid duplicate key crashes
            const npcName = itemData.person_name || itemData.name || `unnamed_${index}`;
            const itemKey = isUser ? 'user' : (isNPC ? `npc_${itemData.source_character_id}_${npcName}_${index}` : itemData.id);
            const mergeEntry = isUser
              ? { key: 'user', type: 'user', item }
              : isNPC
              ? { key: itemKey, type: 'npc', sourceCharId: itemData.source_character_id, personName: npcName, item }
              : { key: itemKey, type: 'character', charId: itemData.id, item };
            // For user, always use the in-world name from settings if set
            const itemName = isUser
              ? (userSettings.fictional_world_name || itemData.full_name || currentUser?.full_name || 'You')
              : itemData.name;
            const isSelected = selectedForMerge.has(itemKey);
            
            return (
              <motion.div
                 key={`${item.type}-${itemKey}`}
                 layout
                 className={`rounded-xl border-2 p-4 transition-all cursor-pointer ${
                   isSelected ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-primary/40'
                 } ${isUser ? 'ring-2 ring-primary/30' : ''}`}
                 onClick={() => mergeMode && toggleMergeSelection(mergeEntry)}
                >
                 <div className="flex items-center gap-3">
                  {mergeMode && (
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? 'bg-primary border-primary' : 'border-border'
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  )}
                  {isUser ? (() => {
                   const userAvatar = itemData.avatar_url
                     || userSettings?.generated_avatar_urls?.[0]
                     || userSettings?.reference_image_urls?.[0]
                     || null;
                   return userAvatar ? (
                     <img src={userAvatar} alt={itemName} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                   ) : (
                     <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                       <span className="text-sm font-semibold text-primary-foreground">{getInitial(itemName)}</span>
                     </div>
                   );
                  })() : isNPC ? (
                    itemData.avatar_url ? (
                      <img src={itemData.avatar_url} alt={itemName} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-purple-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-semibold text-white">{getInitial(itemName)}</span>
                      </div>
                    )
                  ) : (
                    <div className="flex-shrink-0">
                      <CharacterAvatar character={itemData} size="md" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                   {renamingId === itemKey ? (
                     <div className="flex gap-1">
                       <Input
                         value={newName}
                         onChange={e => setNewName(e.target.value)}
                         className="h-8 text-sm flex-1"
                         autoFocus
                         onKeyDown={e => {
                           if (e.key === 'Enter') submitRename(itemKey, isNPC);
                           if (e.key === 'Escape') setRenamingId(null);
                         }}
                       />
                       <Button
                         size="sm"
                         onClick={() => submitRename(itemKey, isNPC)}
                         className="h-8 px-2 rounded-lg"
                       >
                         Save
                       </Button>
                     </div>
                   ) : (
                     <>
                       <div className="flex items-center gap-2">
                         <p className="text-base font-semibold text-foreground">
                           {itemName}
                         </p>
                         {isUser && <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">You</span>}
                         {!isUser && !isNPC && itemData.is_active_character && <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium flex items-center gap-1"><Star className="w-3 h-3 fill-primary" /> Active</span>}
                       </div>
                       {isNPC && itemData.appearance_notes && (
                         <p className="text-sm text-muted-foreground">{itemData.appearance_notes}</p>
                       )}
                       {!isUser && !isNPC && (
                         <div className="flex flex-wrap gap-1 mt-0.5">
                           {itemData.character_type && (
                             <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{itemData.character_type}</span>
                           )}
                           {itemData.personality_summary && (
                             <p className="text-xs text-muted-foreground line-clamp-1 w-full">{itemData.personality_summary}</p>
                           )}
                         </div>
                       )}
                     </>
                   )}
                  </div>
                  {!mergeMode && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRename(itemKey, itemName, isNPC)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors flex-shrink-0"
                        title="Rename"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!isUser && (
                        <button
                          onClick={() => handleDelete(itemKey, isNPC)}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg transition-colors flex-shrink-0"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Alert duplicates & ghost NPCs */}
      {(duplicates.length > 0 || ghosts.length > 0) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-700 space-y-1">
          {duplicates.length > 0 && (
            <p><strong>{duplicates.length}</strong> duplicate(s) detected: {duplicates.map(d => d.name).join(', ')}</p>
          )}
          {ghosts.length > 0 && (
            <p><strong>{ghosts.length}</strong> ghost NPC(s) found — these should be merged into active characters</p>
          )}
        </div>
      )}

      {editable.length > 1 && !mergeMode && (
        <Button
          onClick={() => setMergeMode(true)}
          variant="outline"
          size="sm"
          className="w-full rounded-lg gap-2"
        >
          <GitMerge className="w-4 h-4" /> Merge Characters
        </Button>
      )}

      {mergeMode && selectedForMerge.size >= 2 && (
        <Button
          onClick={submitMerge}
          size="sm"
          className="w-full rounded-lg"
        >
          Merge {selectedForMerge.size} Characters
        </Button>
      )}

      {mergeMode && selectedForMerge.size < 2 && (
        <p className="text-xs text-muted-foreground text-center py-2">Select 2+ characters to merge</p>
      )}

      {/* Merge confirmation modal */}
      {mergeConfirmModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setMergeConfirmModal(null)}>
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">Merge Characters</h3>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {mergeConfirmModal.selectedItems.map(({ item, entry }) => {
                const isNPC = item.type === 'world_person' || item.type === 'family';
                const isUser = item.type === 'user';
                const itemData = item.data;
                const itemName = isUser
                  ? (userSettings.fictional_world_name || itemData.full_name || currentUser?.full_name || 'You')
                  : itemData.name;
                const description = isUser 
                  ? null 
                  : (isNPC ? itemData.appearance_notes : itemData.personality_summary);
                const avatarUrl = isUser 
                  ? (itemData.avatar_url || userSettings?.generated_avatar_urls?.[0] || userSettings?.reference_image_urls?.[0])
                  : (itemData.avatar_url);

                return (
                  <button
                    key={entry.key}
                    onClick={() => confirmMerge(entry)}
                    className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/60 hover:bg-primary/5 transition-colors flex gap-3 items-start"
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={itemName} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 mt-0.5" />
                    ) : (
                      <div className={`w-10 h-10 rounded-lg ${isUser ? 'bg-primary' : isNPC ? 'bg-purple-500' : 'bg-secondary'} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <span className={`text-xs font-semibold ${isUser || isNPC ? 'text-white' : 'text-foreground'}`}>
                          {itemName[0].toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{itemName}</p>
                      {description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
                      )}
                      <p className="text-xs text-primary/80 mt-1 font-medium">
                        👆 Tap to keep this one as master
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground italic">
              Select the character that should remain as the master — others will be merged into it.
            </p>
            <Button
              onClick={() => setMergeConfirmModal(null)}
              variant="outline"
              size="sm"
              className="w-full rounded-lg"
            >
              Cancel
            </Button>
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}