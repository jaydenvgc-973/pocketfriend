/**
 * HomeAnchorsEditor
 *
 * Lets the user designate up to 2 "Home Anchor" characters — the continuity anchors
 * whose presence is required for the Home page to consider its character load complete.
 *
 * These IDs are stored in UserSettings.home_anchor_character_ids (ordered array).
 * The bootstrap guard in useOwnedCharacters reads them and triggers recovery if any are missing.
 *
 * PRIMARY ANCHOR  [0] = e.g. Ethan
 * FALLBACK ANCHOR [1] = e.g. Melody
 *
 * Source of truth: UserSettings.home_anchor_character_ids
 */

import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Anchor, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CharacterAvatar from '@/components/chat/CharacterAvatar';

const MAX_ANCHORS = 2;

export default function HomeAnchorsEditor({ userSettings, activeCharacters }) {
  const queryClient = useQueryClient();
  const currentAnchors = userSettings?.home_anchor_character_ids || [];
  const [selected, setSelected] = useState(currentAnchors);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: async (newAnchors) => {
      if (!userSettings?.id) throw new Error('No UserSettings record found');
      return base44.entities.UserSettings.update(userSettings.id, {
        home_anchor_character_ids: newAnchors,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userSettings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const toggleAnchor = (charId) => {
    setSelected(prev => {
      if (prev.includes(charId)) {
        return prev.filter(id => id !== charId);
      }
      if (prev.length >= MAX_ANCHORS) {
        // Replace the last entry — slots are [0]=primary, [1]=fallback
        return [...prev.slice(0, MAX_ANCHORS - 1), charId];
      }
      return [...prev, charId];
    });
    setSaved(false);
  };

  const isDirty = JSON.stringify(selected) !== JSON.stringify(currentAnchors);

  const eligibleChars = (activeCharacters || [])
    .filter(c => c.character_type === 'active_created_character' && c.status !== 'deleted')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Anchor className="w-4 h-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Home Anchor Characters</p>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Select up to 2 continuity anchor characters. Home verifies these are loaded before
        treating the character list as complete. If an anchor is missing, Home triggers a
        recovery fetch. <span className="text-primary font-medium">First selected = primary anchor. Second = fallback.</span>
      </p>

      {selected.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {selected.map((id, idx) => {
            const char = eligibleChars.find(c => c.id === id);
            if (!char) return null;
            return (
              <div key={id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs text-primary font-medium">
                <span>{idx === 0 ? '①' : '②'}</span>
                <span>{char.name}</span>
                <button onClick={() => toggleAnchor(id)} className="hover:text-destructive transition-colors ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto">
        {eligibleChars.map(char => {
          const anchorIdx = selected.indexOf(char.id);
          const isSelected = anchorIdx !== -1;
          return (
            <button
              key={char.id}
              onClick={() => toggleAnchor(char.id)}
              className={`flex items-center gap-2 p-2 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'bg-primary/10 border-primary/50'
                  : 'bg-secondary border-border hover:border-primary/30'
              }`}
            >
              <div className="flex-shrink-0">
                <CharacterAvatar character={char} size="sm" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{char.name}</p>
              </div>
              {isSelected && (
                <span className="text-[10px] text-primary font-bold flex-shrink-0">
                  {anchorIdx === 0 ? '①' : '②'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!isDirty || mutation.isPending}
          onClick={() => mutation.mutate(selected)}
          className="rounded-xl"
        >
          {mutation.isPending ? 'Saving...' : 'Save Anchors'}
        </Button>
        {saved && (
          <span className="text-xs text-green-400 flex items-center gap-1">
            <Check className="w-3 h-3" /> Saved
          </span>
        )}
        {mutation.isError && (
          <span className="text-xs text-destructive">{mutation.error?.message}</span>
        )}
      </div>
    </div>
  );
}