import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Heart, MapPin, Plus, Search, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * CharacterReligionSection
 *
 * Source-of-truth lookup order for linked worship location:
 *   1. Query ALL LocationReference records with category='religion' where character appears
 *      in religious_members[] OR worker_character_ids[] (congregation, clergy, staff, volunteer)
 *   2. Fall back to Character.religious_location_id if present
 *
 * This means a character listed at a church/mosque/temple WILL show their place of worship
 * even if Character.religious_location_id was never written.
 *
 * Religion is NOT required — a character can attend a worship location without having
 * a religion set (exploring, family, community, volunteer, socially curious, etc.)
 *
 * Natural labels: Church / Mosque / Synagogue / Mandir / Temple — never "religious location".
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const RELIGION_PLACE_TYPE = {
  christian: 'Church',
  catholic: 'Church',
  protestant: 'Church',
  baptist: 'Church',
  methodist: 'Church',
  evangelical: 'Church',
  mormon: 'Church',
  'latter-day': 'Church',
  coptic: 'Church',
  orthodox: 'Church',
  islam: 'Mosque',
  muslim: 'Mosque',
  sunni: 'Mosque',
  shia: 'Mosque',
  sufi: 'Mosque',
  masjid: 'Mosque / Masjid',
  jewish: 'Synagogue',
  judaism: 'Synagogue',
  hindu: 'Mandir / Hindu Temple',
  hinduism: 'Mandir / Hindu Temple',
  buddhi: 'Buddhist Temple',
  sikh: 'Gurdwara',
};

const LOCATION_PLACE_TYPE = {
  // Derive from location name or denomination if character religion is absent
  church: 'Church',
  chapel: 'Church',
  cathedral: 'Cathedral',
  mosque: 'Mosque',
  masjid: 'Mosque / Masjid',
  synagogue: 'Synagogue',
  temple: 'Temple',
  mandir: 'Mandir',
  gurdwara: 'Gurdwara',
  monastery: 'Monastery',
  shrine: 'Shrine',
  parish: 'Church',
  ministry: 'Church',
  baptist: 'Church',
  evangelical: 'Church',
  christian: 'Church',
  catholic: 'Church',
  protestant: 'Church',
  islamic: 'Mosque',
  hindu: 'Mandir / Hindu Temple',
  buddhist: 'Buddhist Temple',
  jewish: 'Synagogue',
};

function getPlaceTypeFromReligion(religion) {
  if (!religion) return null;
  const lower = religion.toLowerCase();
  for (const [key, label] of Object.entries(RELIGION_PLACE_TYPE)) {
    if (lower.includes(key)) return label;
  }
  return null;
}

function getPlaceTypeFromLocation(location) {
  if (!location) return 'Place of Worship';
  const text = `${location.name || ''} ${location.religion_denomination || ''}`.toLowerCase();
  for (const [key, label] of Object.entries(LOCATION_PLACE_TYPE)) {
    if (text.includes(key)) return label;
  }
  return 'Place of Worship';
}

function getPlaceType(religion, location) {
  return getPlaceTypeFromReligion(religion) || getPlaceTypeFromLocation(location) || 'Place of Worship';
}

const BELIEF_LABELS = {
  devout: 'Devout',
  moderate: 'Moderately Practicing',
  in_name_only: 'Cultural / In Name Only',
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function CharacterReligionSection({ character }) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(false);

  const religion = (character.religion || '').trim();
  const hasReligion = religion && religion !== 'None' && religion.toLowerCase() !== 'none';
  const beliefLabel = BELIEF_LABELS[character.belief_level] || character.belief_level || '';

  // ── Step 1: Query ALL religion-category locations the user owns ──────────────
  const { data: worshipLocations = [], isLoading: locLoading } = useQuery({
    queryKey: ['worshipLocations', character.id],
    queryFn: async () => {
      const user = await base44.auth.me();
      if (!user?.email) return [];
      // Fetch all religion-category locations visible to this user
      const locs = await base44.entities.LocationReference.filter({ category: 'religion' });
      return locs;
    },
    staleTime: 30_000,
  });

  // ── Step 2: Find which locations this character belongs to ───────────────────
  // Check religious_members[], worker_character_ids[], and Character.religious_location_id
  const linkedLocations = worshipLocations.filter(loc => {
    const inMembers = (loc.religious_members || []).some(m => m.character_id === character.id);
    const inWorkers = (loc.worker_character_ids || []).includes(character.id);
    const isDirectLink = loc.id === character.religious_location_id;
    return inMembers || inWorkers || isDirectLink;
  });

  const primaryLocation = linkedLocations[0] || null;
  const placeType = getPlaceType(religion, primaryLocation);

  // Member role label
  function getMemberRole(loc) {
    const asMember = (loc.religious_members || []).find(m => m.character_id === character.id);
    if (asMember) return asMember.role || 'Congregation Member';
    if ((loc.worker_character_ids || []).includes(character.id)) {
      const jobTitle = loc.worker_job_titles?.[character.id];
      return jobTitle || 'Staff / Volunteer';
    }
    return 'Member';
  }

  // ── Unlink: remove from religious_members + clear character field ────────────
  const handleUnlink = async (loc) => {
    if (!window.confirm(`Remove ${character.name} from ${loc.name}?`)) return;
    // Remove from location
    const updatedMembers = (loc.religious_members || []).filter(m => m.character_id !== character.id);
    await base44.entities.LocationReference.update(loc.id, { religious_members: updatedMembers });
    // Clear character fields if this was the stored location
    if (character.religious_location_id === loc.id) {
      await base44.entities.Character.update(character.id, {
        religious_location_id: null,
        religious_location_name: null,
      });
    }
    queryClient.invalidateQueries({ queryKey: ['worshipLocations', character.id] });
    queryClient.invalidateQueries({ queryKey: ['character', character.id] });
  };

  // ── Link: add to religious_members + write character fields ─────────────────
  const handleLink = async (loc) => {
    setLinking(true);
    // Add to location religious_members
    const existingMembers = loc.religious_members || [];
    if (!existingMembers.some(m => m.character_id === character.id)) {
      const updatedMembers = [
        ...existingMembers,
        {
          character_id: character.id,
          character_name: character.name,
          joined_date: new Date().toISOString(),
          role: 'congregation_member',
        },
      ];
      await base44.entities.LocationReference.update(loc.id, { religious_members: updatedMembers });
    }
    // Write character fields
    await base44.entities.Character.update(character.id, {
      religious_location_id: loc.id,
      religious_location_name: loc.name,
    });
    queryClient.invalidateQueries({ queryKey: ['worshipLocations', character.id] });
    queryClient.invalidateQueries({ queryKey: ['character', character.id] });
    setShowPicker(false);
    setSearch('');
    setLinking(false);
  };

  // Filtered picker options (exclude already linked)
  const linkedIds = new Set(linkedLocations.map(l => l.id));
  const pickerOptions = worshipLocations.filter(loc =>
    !linkedIds.has(loc.id) &&
    (!search || loc.name.toLowerCase().includes(search.toLowerCase()))
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">

      {/* Faith row — only if religion is set */}
      {hasReligion && (
        <div className="flex items-center gap-3">
          <Heart className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground">{religion}</p>
            {beliefLabel && <p className="text-xs text-muted-foreground">{beliefLabel}</p>}
          </div>
        </div>
      )}

      {/* Loading */}
      {locLoading && (
        <p className="text-xs text-muted-foreground italic px-1">Looking up worship locations…</p>
      )}

      {/* Linked location cards */}
      {!locLoading && linkedLocations.map(loc => (
        <div key={loc.id} className="bg-violet-500/8 border border-violet-500/20 rounded-xl p-3 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-violet-400" />
              <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">
                {getPlaceType(religion, loc)}
              </p>
            </div>
            <button
              onClick={() => handleUnlink(loc)}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              unlink
            </button>
          </div>
          <p className="text-sm font-medium text-foreground">{loc.name}</p>
          <p className="text-xs text-muted-foreground">{getMemberRole(loc)}</p>
        </div>
      ))}

      {/* Not linked — show message + link button */}
      {!locLoading && linkedLocations.length === 0 && (
        <div className="bg-secondary/40 rounded-xl p-3 flex items-start gap-2">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground italic">
            {hasReligion
              ? `No ${placeType.toLowerCase()} linked yet.`
              : 'No place of worship linked yet.'}
          </p>
        </div>
      )}

      {/* Link / add worship location button */}
      {!locLoading && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPicker(p => !p)}
          className="w-full h-8 text-xs gap-1 rounded-xl"
        >
          <Plus className="w-3 h-3" />
          {linkedLocations.length > 0 ? 'Link another place of worship' : 'Link a place of worship'}
          {showPicker ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
        </Button>
      )}

      {/* Location picker */}
      {showPicker && (
        <div className="bg-secondary/40 border border-border rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 bg-background border border-border rounded-lg px-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search worship locations…"
              className="flex-1 h-8 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')}>
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>

          {pickerOptions.length === 0 && (
            <p className="text-xs text-muted-foreground italic text-center py-2">
              {worshipLocations.length === 0
                ? 'No worship locations found. Add one from the Places page.'
                : 'No other worship locations available.'}
            </p>
          )}

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {pickerOptions.map(loc => (
              <button
                key={loc.id}
                onClick={() => !linking && handleLink(loc)}
                disabled={linking}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-border bg-card hover:border-violet-500/40 hover:bg-violet-500/5 transition-colors text-left"
              >
                <MapPin className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{loc.name}</p>
                  {loc.religion_denomination && (
                    <p className="text-xs text-muted-foreground">{loc.religion_denomination}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No religion note */}
      {!hasReligion && linkedLocations.length === 0 && !showPicker && (
        <p className="text-xs text-muted-foreground/60 italic px-1">
          No religion set — you can still link a place of worship above if the character attends one.
        </p>
      )}
    </div>
  );
}