import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Heart, MapPin } from 'lucide-react';

/**
 * CharacterReligionSection
 *
 * Displays religion, belief level, and linked place of worship.
 * Source of truth: Character.religion / belief_level / religious_location_id / religious_location_name
 * The linked location is managed from the location page (ReligiousMemberSection), which
 * writes both sides. This component is read-display-only for the linked location.
 * 
 * Natural language: church / mosque / synagogue / mandir / temple — never "religious location".
 */

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
  jewish: 'Synagogue',
  judaism: 'Synagogue',
  hindu: 'Mandir / Hindu Temple',
  hinduism: 'Mandir / Hindu Temple',
  buddhi: 'Temple / Monastery',
  sikh: 'Gurdwara',
};

function getPlaceType(religion) {
  if (!religion) return 'Place of Worship';
  const lower = religion.toLowerCase();
  for (const [key, label] of Object.entries(RELIGION_PLACE_TYPE)) {
    if (lower.includes(key)) return label;
  }
  return 'Place of Worship';
}

const BELIEF_LABELS = {
  devout: 'Devout',
  moderate: 'Moderately Practicing',
  in_name_only: 'Cultural / In Name Only',
};

export default function CharacterReligionSection({ character }) {
  const queryClient = useQueryClient();
  const religion = (character.religion || '').trim();
  const hasReligion = religion && religion !== 'None' && religion.toLowerCase() !== 'none';
  const placeType = getPlaceType(religion);
  const beliefLabel = BELIEF_LABELS[character.belief_level] || character.belief_level || 'Moderate';

  const handleClearLocation = async () => {
    if (!window.confirm(`Remove ${placeType} link from ${character.name}'s profile?`)) return;
    await base44.entities.Character.update(character.id, {
      religious_location_id: null,
      religious_location_name: null,
    });
    queryClient.invalidateQueries({ queryKey: ['character', character.id] });
  };

  if (!hasReligion) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4">
        <p className="text-xs text-muted-foreground italic">No religion set. Edit via the Personality / Bio section.</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      {/* Faith + Belief Level */}
      <div className="flex items-center gap-3">
        <Heart className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-foreground">{religion}</p>
          <p className="text-xs text-muted-foreground">{beliefLabel}</p>
        </div>
      </div>

      {/* Place of Worship */}
      {character.religious_location_name ? (
        <div className="bg-violet-500/8 border border-violet-500/20 rounded-xl p-3 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-violet-400" />
              <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">{placeType}</p>
            </div>
            <button
              onClick={handleClearLocation}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              unlink
            </button>
          </div>
          <p className="text-sm font-medium text-foreground">{character.religious_location_name}</p>
          <p className="text-xs text-muted-foreground">
            {character.belief_level === 'devout'
              ? `Attends regularly — deeply committed to ${religion.toLowerCase()} practice.`
              : character.belief_level === 'moderate'
              ? `Attends on occasion — moderately practicing.`
              : `Identifies culturally but does not attend regularly.`}
          </p>
        </div>
      ) : (
        <div className="bg-secondary/40 rounded-xl p-3 flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground italic">
            No {placeType.toLowerCase()} linked. Assign one from the location page under Congregation Members.
          </p>
        </div>
      )}
    </div>
  );
}