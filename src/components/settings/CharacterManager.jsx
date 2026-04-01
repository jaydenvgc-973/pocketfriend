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

  const handleRename = (charId, oldName) => {
    setRenamingId(charId);
    setNewName(oldName);
  };

  const submitRename = (charId) => {
    if (!newName.trim() || newName === characters.find(c => c.id === charId).name) {
      setRenamingId(null);
      return;
    }
    renameMutation.mutate({ characterId: charId, newDisplayName: newName });
  };

  const handleDelete = (charId) => {
    if (window.confirm('Soft delete this character? All history is preserved and recoverable.')) {
      deleteMutation.mutate({ characterId: charId });
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
    const ids = Array.from(selectedForMerge);
    mergeMutation.mutate({ characterIds: ids });
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
        {editable.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No editable characters</p>
        ) : (
          editable.map(char => (
            <motion.div
              key={char.id}
              layout
              className={`border rounded-lg p-3 transition-colors ${
                selectedForMerge.has(char.id) ? 'bg-primary/10 border-primary' : 'bg-card border-border'
              }`}
            >
              <div className="flex items-center gap-3">
                {mergeMode && (
                  <input
                    type="checkbox"
                    checked={selectedForMerge.has(char.id)}
                    onChange={() => toggleMergeSelection(char.id)}
                    className="w-4 h-4 rounded cursor-pointer"
                  />
                )}
                <CharacterAvatar character={char} size="sm" />
                <div className="flex-1 min-w-0">
                  {renamingId === char.id ? (
                    <div className="flex gap-1">
                      <Input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        className="h-8 text-sm flex-1"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') submitRename(char.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => submitRename(char.id)}
                        className="h-8 px-2 rounded-lg"
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-foreground">{char.name}</p>
                  )}
                </div>
                {!mergeMode && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleRename(char.id, char.name)}
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                      title="Rename"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(char.id)}
                      className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))
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