import { useState } from 'react';
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
  const [selectedForMerge, setSelectedForMerge] = useState(new Set());

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: roster = [] } = useQuery({
    queryKey: ['unifiedRoster', currentUser?.email],
    queryFn: () => fetchUnifiedRoster(base44, currentUser?.email),
    enabled: !!currentUser?.email,
  });

  // All items from unified roster (characters + NPCs)
  const allManageableItems = roster
    .filter(e => e.entity_type === 'character' || e.entity_type === 'user')
    .map(c => ({ type: c.is_user ? 'user' : 'active', data: c }));

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
      setSelectedForMerge(new Set());
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
      const match = itemId.match(/^npc_(.+)_(.+)$/);
      if (match) {
        const [, sourceCharId, oldPersonName] = match;
        if (oldPersonName === newName) {
          setRenamingId(null);
          return;
        }
        const sourceChar = characters.find(c => c.id === sourceCharId);
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
        }
      }
    } else {
      const char = characters.find(c => c.id === itemId);
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
        const match = itemId.match(/^npc_(.+)_(.+)$/);
        if (match) {
          const [, sourceCharId, personName] = match;
          const sourceChar = characters.find(c => c.id === sourceCharId);
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

  const toggleMergeSelection = (charId) => {
    const updated = new Set(selectedForMerge);
    if (updated.has(charId)) {
      updated.delete(charId);
    } else {
      updated.add(charId);
    }
    setSelectedForMerge(updated);
  };

  const submitMerge = () => {
    if (selectedForMerge.size < 2) return;
    const selected = Array.from(selectedForMerge);
    const hasUser = selected.includes('user');
    const npcIds = selected.filter(id => id.startsWith('npc_'));
    const charIds = selected.filter(id => !id.startsWith('npc_') && id !== 'user');

    if (hasUser) {
      // Merging with user: delete NPC duplicates
      npcIds.forEach(npcId => {
        const match = npcId.match(/^npc_(.+)_(.+)$/);
        if (match) {
          const [, sourceCharId, personName] = match;
          const sourceChar = characters.find(c => c.id === sourceCharId);
          if (sourceChar) {
            const updated = (sourceChar.fictional_relationships || []).filter(
              r => r.person_name !== personName
            );
            base44.entities.Character.update(sourceChar.id, { fictional_relationships: updated })
              .then(() => queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] }))
              .catch(() => {});
          }
        }
      });
      setSelectedForMerge(new Set());
      setMergeMode(false);
    } else if (npcIds.length >= 2 && charIds.length === 0) {
      // Merging NPCs: keep the first one, delete others
      const [primary, ...others] = npcIds;
      const primaryMatch = primary.match(/^npc_(.+)_(.+)$/);

      if (primaryMatch) {
        const [, primarySourceCharId, primaryPersonName] = primaryMatch;

        others.forEach(otherId => {
          const match = otherId.match(/^npc_(.+)_(.+)$/);
          if (match) {
            const [, sourceCharId, personName] = match;
            const sourceChar = characters.find(c => c.id === sourceCharId);
            if (sourceChar) {
              const updated = (sourceChar.fictional_relationships || []).filter(
                r => r.person_name !== personName
              );
              base44.entities.Character.update(sourceChar.id, { fictional_relationships: updated })
                .then(() => queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] }))
                .catch(() => {});
            }
          }
        });
      }
      setSelectedForMerge(new Set());
      setMergeMode(false);
    } else if (charIds.length === 1 && npcIds.length === 1) {
      // Merge active character with NPC: consolidate NPC data into active character, remove NPC
      const activeCharId = charIds[0];
      const npcId = npcIds[0];
      const npcMatch = npcId.match(/^npc_(.+)_(.+)$/);

      if (npcMatch) {
        const [, sourceCharId, personName] = npcMatch;
        const sourceChar = characters.find(c => c.id === sourceCharId);
        const activeChar = characters.find(c => c.id === activeCharId);
        const npcData = sourceChar?.fictional_relationships?.find(r => r.person_name === personName);

        if (sourceChar && activeChar && npcData) {
          // Merge NPC data into active character: take max relationship scores and richer descriptions
          const mergedRelationship = {
            ...npcData,
            related_character_id: activeCharId,
            person_name: activeChar.name,
            friendship_level: Math.max(npcData.friendship_level ?? 50, activeChar.friendship_level ?? 50),
            user_respect_level: Math.max(npcData.user_respect_level ?? 50, activeChar.user_respect_level ?? 50),
            romantic_level: Math.max(npcData.romantic_level ?? 0, activeChar.romantic_level ?? 0),
            attraction_level: Math.max(npcData.attraction_level ?? 0, activeChar.attraction_level ?? 0),
            chosen_family_level: Math.max(npcData.chosen_family_level ?? 0, activeChar.chosen_family_level ?? 0),
          };

          // Remove NPC from fictional_relationships of source character
          const updatedSourceRels = (sourceChar.fictional_relationships || []).filter(
            r => r.person_name !== personName
          );

          // Add merged relationship to active character if it doesn't already have this person
          const activeHasRelationship = (activeChar.fictional_relationships || []).some(
            r => r.person_name?.toLowerCase() === activeChar.name.toLowerCase()
          );
          const updatedActiveRels = activeHasRelationship
            ? (activeChar.fictional_relationships || []).map(r =>
                r.person_name?.toLowerCase() === activeChar.name.toLowerCase()
                  ? mergedRelationship
                  : r
              )
            : [...(activeChar.fictional_relationships || []), mergedRelationship];

          // Update both characters
          Promise.all([
            base44.entities.Character.update(sourceCharId, { fictional_relationships: updatedSourceRels }),
            base44.entities.Character.update(activeCharId, { fictional_relationships: updatedActiveRels }),
          ]).then(() => {
            queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
            setSelectedForMerge(new Set());
            setMergeMode(false);
          }).catch(() => {});
        }
      }
    } else if (charIds.length >= 2) {
      // Merge active characters only
      mergeMutation.mutate({ characterIds: charIds });
    }
  };

  const editable = characters.filter(c => !c.is_protected && !c.is_default);

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
              setSelectedForMerge(new Set());
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
          allManageableItems.map((item) => {
            const isNPC = item.type === 'npc';
            const isUser = item.type === 'user';
            const itemData = item.data;
            // Create truly unique IDs: user prefix, character ID for active, or source_character_id::person_name for NPCs
            const itemId = isUser ? 'user' : (isNPC ? `npc_${itemData.source_character_id}_${itemData.person_name}` : itemData.id);
            const itemName = isUser ? itemData.full_name : (isNPC ? itemData.person_name : itemData.name);
            const isSelected = selectedForMerge.has(itemId);
            
            return (
              <motion.div
                key={`${item.type}-${itemId}`}
                layout
                className={`border rounded-lg p-3 transition-colors cursor-pointer ${
                  isSelected ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-primary/50'
                } ${isNPC ? 'opacity-75' : ''} ${isUser ? 'ring-1 ring-primary/30' : ''}`}
                onClick={() => mergeMode && toggleMergeSelection(itemId)}
              >
                <div className="flex items-center gap-3">
                  {mergeMode && (
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? 'bg-primary border-primary' : 'border-border'
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  )}
                  {isUser ? (
                    itemData.avatar_url ? (
                      <img src={itemData.avatar_url} alt={itemName} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-primary-foreground">{getInitial(itemName)}</span>
                      </div>
                    )
                  ) : isNPC ? (
                    itemData.avatar_url ? (
                      <img src={itemData.avatar_url} alt={itemName} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-white">{getInitial(itemName)}</span>
                      </div>
                    )
                  ) : (
                    <CharacterAvatar character={itemData} size="sm" />
                  )}
                  <div className="flex-1 min-w-0">
                    {renamingId === itemId ? (
                      <div className="flex gap-1">
                        <Input
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          className="h-8 text-sm flex-1"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') submitRename(itemId, isNPC);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={() => submitRename(itemId, isNPC)}
                          className="h-8 px-2 rounded-lg"
                        >
                          Save
                        </Button>
                      </div>
                    ) : (
                       <div className="min-w-0 flex-1">
                         <p className="text-sm font-medium text-foreground">
                           {itemName}
                           {isUser && <span className="text-xs text-primary ml-2">(You)</span>}
                           {!isUser && !isNPC && itemData.is_active_character && <span className="text-xs text-primary ml-2 flex items-center gap-1"><Star className="w-3 h-3 fill-primary" /> Active</span>}
                         </p>
                         {isNPC && (
                           <>
                             {itemData.relationship_type && <p className="text-xs text-muted-foreground">{itemData.relationship_type}</p>}
                             {itemData.source_character_name && <p className="text-xs text-muted-foreground/60">{itemData.source_character_name}'s world</p>}
                             {itemData.description && <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-2">{itemData.description}</p>}
                           </>
                         )}
                       </div>
                     )}
                  </div>
                  {!mergeMode && !isUser && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleRename(itemId, itemName, isNPC)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                        title="Rename"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(itemId, isNPC)}
                        className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
      </div>

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
          disabled={mergeMutation.isPending}
        >
          {mergeMutation.isPending ? 'Merging...' : `Merge ${selectedForMerge.size} Characters`}
        </Button>
      )}

      {mergeMode && selectedForMerge.size < 2 && (
        <p className="text-xs text-muted-foreground text-center py-2">Select 2+ characters to merge</p>
      )}
    </div>
  );
}