import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Heart, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CharacterAvatar from '@/components/chat/CharacterAvatar';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * ReligiousMemberSection
 *
 * Shared truth: LocationReference.religious_members[] (array of {character_id, character_name})
 * and Character.religious_location_id / Character.religious_location_name.
 *
 * Assigning from here writes BOTH sides. Character Profile reads from Character fields.
 * All queries use owner_email — never created_by.
 */
export default function ReligiousMemberSection({ location, onUpdate }) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const toggleChar = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ['characters', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const [active, npcs] = await Promise.all([
        base44.entities.Character.filter({ owner_email: currentUser.email, status: 'active', character_type: 'active_created_character' }),
        base44.entities.Character.filter({ owner_email: currentUser.email, character_type: { $in: ['npc_fictitious', 'npc_family_member'] } }),
      ]);
      const seen = new Set();
      return [...active, ...npcs.filter(c => c.status !== 'deleted' && c.status !== 'moved_away')].filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    },
    enabled: !!currentUser?.email,
  });

  const members = location.religious_members || [];
  const memberIds = new Set(members.map(m => m.character_id));
  const available = characters.filter(c => !memberIds.has(c.id) && (c.name || '').toLowerCase().includes(search.toLowerCase()));

  const handleAddSelected = async () => {
    if (selectedIds.size === 0) return;
    setLoading(true);
    const toAdd = characters.filter(c => selectedIds.has(c.id));
    const newMembers = [...members, ...toAdd.map(c => ({ character_id: c.id, character_name: c.name }))];
    try {
      await base44.entities.LocationReference.update(location.id, { religious_members: newMembers });
      await Promise.all(toAdd.map(c =>
        base44.entities.Character.update(c.id, {
          religious_location_id: location.id,
          religious_location_name: location.name,
        })
      ));
      // Patch character cache immediately so religious assignment shows without refresh
      const charCacheKey = ['characters', currentUser?.email];
      const cachedChars = queryClient.getQueryData(charCacheKey);
      if (Array.isArray(cachedChars)) {
        const patchedChars = cachedChars.map(c => {
          if (!toAdd.some(a => a.id === c.id)) return c;
          return { ...c, religious_location_id: location.id, religious_location_name: location.name };
        });
        queryClient.setQueryData(charCacheKey, patchedChars);
      }
      queryClient.invalidateQueries({ queryKey: ['locationReferences'] });
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      setSelectedIds(new Set());
      setShowPicker(false);
      setSearch('');
      onUpdate?.();
    } catch (err) {
      console.error('[ReligiousMemberSection] add error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (charId) => {
    const newMembers = members.filter(m => m.character_id !== charId);
    try {
      await base44.entities.LocationReference.update(location.id, { religious_members: newMembers });
      // Clear character side
      await base44.entities.Character.update(charId, {
        religious_location_id: null,
        religious_location_name: null,
      });
      queryClient.invalidateQueries({ queryKey: ['locationReferences', currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      onUpdate?.();
    } catch (err) {
      console.error('[ReligiousMemberSection] remove error:', err);
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4 mt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Heart className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-foreground">Congregation Members</h3>
          {members.length > 0 && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">{members.length}</span>}
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowPicker(v => !v)} className="h-8 gap-1 text-xs rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add Member
        </Button>
      </div>

      {/* Current members */}
      {members.length > 0 && (
        <div className="space-y-2">
          {members.map(m => {
            const char = characters.find(c => c.id === m.character_id);
            return (
              <div key={m.character_id} className="flex items-center gap-3 p-2.5 bg-secondary/40 rounded-xl border border-border">
                {char ? <CharacterAvatar character={char} size="sm" /> : (
                  <div className="w-7 h-7 rounded-full bg-violet-400/20 flex items-center justify-center text-xs font-bold text-violet-400">{(m.character_name || '?')[0]}</div>
                )}
                <span className="text-sm text-foreground flex-1">{m.character_name}</span>
                {char?.religion && <span className="text-xs text-muted-foreground">{char.religion}</span>}
                <button onClick={() => handleRemove(m.character_id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Picker */}
      <AnimatePresence>
        {showPicker && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-secondary/30 rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select members'}
                </p>
              </div>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search characters..."
                className="w-full h-8 px-3 rounded-lg bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {available.length === 0 && <p className="text-xs text-muted-foreground text-center py-3">No characters available</p>}
                {available.map(char => {
                  const isSelected = selectedIds.has(char.id);
                  return (
                    <button
                      key={char.id}
                      onClick={() => toggleChar(char.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-colors text-left ${
                        isSelected ? 'bg-primary/10 border-primary/50' : 'bg-card border-border hover:border-primary/40'
                      }`}
                    >
                      <CharacterAvatar character={char} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{char.name}</p>
                        {char.religion && char.religion !== 'None' && <p className="text-xs text-muted-foreground">{char.religion} · {char.belief_level?.replace('_', ' ')}</p>}
                      </div>
                      <div className={`w-4 h-4 rounded flex-shrink-0 border-2 transition-colors flex items-center justify-center ${
                        isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                      }`}>
                        {isSelected && <div className="w-2 h-2 rounded-sm bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  onClick={handleAddSelected}
                  disabled={selectedIds.size === 0 || loading}
                  className="flex-1 h-9 rounded-lg text-sm"
                >
                  {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />Adding...</> : `Add ${selectedIds.size > 0 ? `(${selectedIds.size})` : ''}`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowPicker(false); setSelectedIds(new Set()); setSearch(''); }}
                  className="flex-1 h-9 rounded-lg text-sm"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {members.length === 0 && !showPicker && (
        <p className="text-xs text-muted-foreground italic text-center py-2">No members assigned yet</p>
      )}
    </div>
  );
}