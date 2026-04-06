import { useState } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Pencil, Trash2, GitMerge, Check, Star, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

export default function CharacterManager() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mergeConfirmModal, setMergeConfirmModal] = useState(null);
  const [mergeError, setMergeError] = useState(null);
  const [mergeSuccess, setMergeSuccess] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  // Fetch characters directly with real IDs
  const { data: characters = [], isLoading } = useQuery({
    queryKey: ['charactersDirect', currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ created_by: currentUser.email }, '-created_date'),
    enabled: !!currentUser?.email,
  });

  const visibleChars = characters.filter(c =>
    c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
  );

  const renameMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('renameCharacter', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charactersDirect', currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      setRenamingId(null);
      setNewName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('deleteCharacter', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charactersDirect', currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('mergeCharacters', data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['charactersDirect', currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ['unifiedRoster', currentUser?.email] });
      setMergeMode(false);
      setSelectedIds(new Set());
      setMergeConfirmModal(null);
      setMergeError(null);
      setMergeSuccess(res?.data?.message || 'Merge complete!');
      setTimeout(() => setMergeSuccess(null), 5000);
    },
    onError: (err) => {
      setMergeError(err?.message || 'Merge failed. Please try again.');
    },
  });

  const submitRename = (charId) => {
    if (!newName.trim()) { setRenamingId(null); return; }
    const char = characters.find(c => c.id === charId);
    if (newName === char?.name) { setRenamingId(null); return; }
    renameMutation.mutate({ characterId: charId, newDisplayName: newName });
  };

  const handleDelete = (charId) => {
    if (window.confirm('Soft delete this character? All history is preserved.')) {
      deleteMutation.mutate({ characterId: charId });
    }
  };

  const toggleSelect = (id) => {
    const updated = new Set(selectedIds);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    setSelectedIds(updated);
  };

  const openMergeConfirm = () => {
    if (selectedIds.size < 2) return;
    const selectedChars = visibleChars.filter(c => selectedIds.has(c.id));
    setMergeConfirmModal(selectedChars);
    setMergeError(null);
  };

  const confirmMerge = (primaryId) => {
    const allIds = Array.from(selectedIds);
    mergeMutation.mutate({ characterIds: allIds, primaryCharacterId: primaryId });
  };

  // Detect duplicate names
  const nameGroups = new Map();
  visibleChars.forEach(c => {
    const key = c.name?.toLowerCase().trim();
    if (!key) return;
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key).push(c);
  });
  const duplicateNames = Array.from(nameGroups.entries())
    .filter(([, group]) => group.length >= 2)
    .map(([name]) => name);

  const mergableChars = visibleChars.filter(c => !c.is_default && !c.is_protected);

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
            onClick={() => { setMergeMode(false); setSelectedIds(new Set()); setMergeError(null); }}
            variant="outline"
            className="rounded-lg"
          >
            Cancel
          </Button>
        )}
      </div>

      {mergeSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-xs text-emerald-600">
          ✓ {mergeSuccess}
        </div>
      )}

      {duplicateNames.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-700 space-y-1">
          <p><strong>{duplicateNames.length}</strong> duplicate name(s) detected: <em>{duplicateNames.join(', ')}</em></p>
          <p className="text-amber-600/80">Use Merge to consolidate them into one record.</p>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground text-center py-6">Loading...</p>
      ) : visibleChars.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">No characters found</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {visibleChars.map((char) => {
            const isSelected = selectedIds.has(char.id);
            const isDuplicate = duplicateNames.includes(char.name?.toLowerCase().trim());
            return (
              <motion.div
                key={char.id}
                layout
                className={`rounded-xl border-2 p-3 transition-all ${mergeMode ? 'cursor-pointer' : ''} ${
                  isSelected ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-primary/40'
                }`}
                onClick={() => mergeMode && toggleSelect(char.id)}
              >
                <div className="flex items-center gap-3">
                  {mergeMode && (
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? 'bg-primary border-primary' : 'border-border'
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  )}
                  <div className="flex-shrink-0">
                    <CharacterAvatar character={char} size="md" />
                  </div>
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
                        <Button size="sm" onClick={() => submitRename(char.id)} className="h-8 px-2 rounded-lg">Save</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{char.name}</p>
                        {char.is_default && <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Default</span>}
                        {char.character_type === 'active' && !char.is_default && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground flex items-center gap-1">
                            <Star className="w-2.5 h-2.5" /> Active
                          </span>
                        )}
                        {isDuplicate && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 flex items-center gap-1">
                            <AlertCircle className="w-2.5 h-2.5" /> Duplicate
                          </span>
                        )}
                      </div>
                    )}
                    {!renamingId && char.occupation && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{char.occupation}</p>
                    )}
                  </div>
                  {!mergeMode && renamingId !== char.id && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingId(char.id); setNewName(char.name); }}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                        title="Rename"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!char.is_default && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(char.id); }}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
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
          })}
        </div>
      )}

      {mergableChars.length > 1 && !mergeMode && (
        <Button onClick={() => setMergeMode(true)} variant="outline" size="sm" className="w-full rounded-lg gap-2">
          <GitMerge className="w-4 h-4" /> Merge Characters
        </Button>
      )}

      {mergeMode && (
        <div className="space-y-2">
          {selectedIds.size >= 2 ? (
            <Button onClick={openMergeConfirm} size="sm" className="w-full rounded-lg">
              Merge {selectedIds.size} Selected Characters
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">Select 2 or more characters to merge</p>
          )}
        </div>
      )}

      {mergeConfirmModal && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => !mergeMutation.isPending && setMergeConfirmModal(null)}
        >
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">Choose the Master Character</h3>
            <p className="text-xs text-muted-foreground">
              Tap the character to keep as master. All others will be merged into it.
            </p>
            {mergeError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-xs text-destructive">
                {mergeError}
              </div>
            )}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {mergeConfirmModal.map((char) => (
                <button
                  key={char.id}
                  onClick={() => !mergeMutation.isPending && confirmMerge(char.id)}
                  disabled={mergeMutation.isPending}
                  className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/60 hover:bg-primary/5 transition-colors flex gap-3 items-center disabled:opacity-50"
                >
                  <CharacterAvatar character={char} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{char.name}</p>
                    {char.occupation && <p className="text-xs text-muted-foreground truncate">{char.occupation}</p>}
                    {char.personality_summary && <p className="text-xs text-muted-foreground truncate">{char.personality_summary}</p>}
                  </div>
                  {char.is_default && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary flex-shrink-0">Default</span>
                  )}
                </button>
              ))}
            </div>
            {mergeMutation.isPending && (
              <p className="text-xs text-muted-foreground text-center animate-pulse">Merging... this may take a moment</p>
            )}
            <Button
              onClick={() => setMergeConfirmModal(null)}
              variant="outline" size="sm" className="w-full rounded-lg"
              disabled={mergeMutation.isPending}
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