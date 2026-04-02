import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, GitMerge, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ created_by: currentUser.email, status: 'active' }),
    enabled: !!currentUser?.email,
  });

  // Collect all NPCs/fictional characters from all active characters' fictional_relationships
  const npcs = characters
    .flatMap(c => (c.fictional_relationships || [])
      .filter(r => !r.related_character_id && r._from_family !== true) // only NPCs, exclude family-synced ones
      .map(r => ({ ...r, source_character_id: c.id }))
    )
    .filter((npc, idx, arr) => arr.findIndex(n => n.person_name?.toLowerCase() === npc.person_name?.toLowerCase()) === idx); // dedupe by name

  // Combine user + active characters + NPCs
  const allManageableItems = [
    ...(currentUser ? [{ type: 'user', data: currentUser }] : []),
    ...characters.map(c => ({ type: 'active', data: c })),
    ...npcs.map(npc => ({ type: 'npc', data: npc })),
  ];

  const renameMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('renameCharacter', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      setRenamingId(null);
      setNewName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('deleteCharacter', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('mergeCharacters', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
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
              queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
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
              .then(() => queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] }))
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
    
    if (hasUser) {
      // Merging with user: delete NPC duplicates
      const npcIds = selected.filter(id => id.startsWith('npc_'));
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
    } else {
      // Merge active characters only
      const charIds = selected.filter(id => !id.startsWith('npc_'));
      if (charIds.length >= 2) {
        mergeMutation.mutate({ characterIds: charIds });
      }
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
            
            return (
              <motion.div
                key={`${item.type}-${itemId}`}
                layout
                className={`border rounded-lg p-3 transition-colors ${
                  selectedForMerge.has(itemId) ? 'bg-primary/10 border-primary' : 'bg-card border-border'
                } ${isNPC ? 'opacity-75' : ''} ${isUser ? 'ring-1 ring-primary/30' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {mergeMode && (
                    <input
                      type="checkbox"
                      checked={selectedForMerge.has(itemId)}
                      onChange={() => toggleMergeSelection(itemId)}
                      className="w-4 h-4 rounded cursor-pointer"
                    />
                  )}
                  {isUser ? (
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-primary-foreground">{itemName?.[0]?.toUpperCase() || "?"}</span>
                    </div>
                  ) : isNPC ? (
                    <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-primary">{itemName?.[0]?.toUpperCase() || "?"}</span>
                    </div>
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
                        </p>
                        {isNPC && (
                          <>
                            <p className="text-xs text-muted-foreground">{itemData.relationship_type}</p>
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