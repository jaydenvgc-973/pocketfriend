import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Home } from 'lucide-react';

/**
 * HousingStatusField
 *
 * Exposes the character's EXISTING housing fields (housing_context + is_homeless)
 * as an editable dropdown in the profile's Main Identity section.
 *
 * Housing status describes the character's living circumstances. It is never derived
 * from, and never changes, current_home_location_id — a character can be homeless with
 * a home location (a park, or someone else's house) and that stays true here.
 */

export const HOUSING_STATUS_OPTIONS = [
  { value: 'stable_home',         label: 'Stable Housing' },
  { value: 'temporary_shelter',   label: 'Temporary Shelter' },
  { value: 'homeless_unsheltered', label: 'Homeless / Unsheltered' },
];

const KNOWN_VALUES = new Set(HOUSING_STATUS_OPTIONS.map((o) => o.value));

// housing_context is authoritative when it holds a value. A record that only carries
// is_homeless=true reads as homeless / unsheltered. Nothing is inferred from Home Location.
export function resolveHousingStatus(character) {
  if (character?.housing_context) return character.housing_context;
  if (character?.is_homeless) return 'homeless_unsheltered';
  return '';
}

export default function HousingStatusField({ character }) {
  const queryClient = useQueryClient();
  const stored = resolveHousingStatus(character);
  const isKnown = KNOWN_VALUES.has(stored);

  const updateMutation = useMutation({
    mutationFn: (value) => {
      const patch = { housing_context: value };
      // The chosen status states homelessness for the two statuses that speak to it.
      // Temporary shelter says nothing about it, so that flag is left exactly as it was.
      if (value === 'homeless_unsheltered') patch.is_homeless = true;
      if (value === 'stable_home') patch.is_homeless = false;
      return base44.entities.Character.update(character.id, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
    },
  });

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Home className="w-4 h-4 text-primary" />
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Housing Status</p>
      </div>

      <select
        value={isKnown ? stored : ''}
        onChange={(e) => updateMutation.mutate(e.target.value)}
        disabled={updateMutation.isPending}
        className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm focus:ring-1 focus:ring-primary/50 outline-none disabled:opacity-60"
      >
        {/* A stored value outside the three established statuses is shown as-is so it is
            never silently replaced — picking one of the options below is a real change. */}
        {!isKnown && (
          <option value="">
            {stored ? `Current: ${stored.replace(/_/g, ' ')}` : '— Not set —'}
          </option>
        )}
        {HOUSING_STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {character?.is_homeless && stored !== 'homeless_unsheltered' && (
        <p className="text-[11px] text-amber-500">
          Homelessness is recorded for this character.
        </p>
      )}

      <p className="text-[10px] text-muted-foreground">
        Living circumstances only — separate from Home Location.
      </p>
    </div>
  );
}