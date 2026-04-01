import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { MapPin, X, ChevronDown, ChevronUp, Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * OccupationLocationPicker
 * 
 * Reusable component for selecting a location from the location list
 * and linking it as an occupation or education site.
 * 
 * Used in: CreateCharacter, CharacterProfile, EditCharacterProfile (Settings).
 * 
 * Props:
 *   characterId: string (null during creation)
 *   linkType: 'occupation' | 'education'
 *   currentLocationId: string|null
 *   currentTitle: string
 *   onLinkChange: ({ locationId, locationName, title }) => void
 *   placeholder: string
 */
export default function OccupationLocationPicker({
  characterId,
  linkType = 'occupation',
  currentLocationId,
  currentTitle = '',
  onLinkChange,
  placeholder = 'e.g. Job title or role',
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [title, setTitle] = useState(currentTitle);
  const [search, setSearch] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locationReferences', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
  });

  // Filter by relevant category
  // School and Education are the same system
  const OCCUPATION_CATS = ['workplace', 'business', 'food_drink', 'gym', 'medical', 'social', 'grocery', 'religion', 'school', 'education', 'government', 'generic'];
  const EDUCATION_CATS = ['education', 'school', 'generic', 'business', 'government'];
  const relevantCats = linkType === 'occupation' ? OCCUPATION_CATS : EDUCATION_CATS;

  const filteredLocations = locations.filter(loc => {
    const matchesCat = relevantCats.includes(loc.category);
    const matchesSearch = !search || loc.name.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const selectedLocation = locations.find(l => l.id === currentLocationId);

  const handleSelect = (location) => {
    setShowPicker(false);
    setSearch('');
    onLinkChange({ locationId: location.id, locationName: location.name, title });
  };

  const handleClear = () => {
    onLinkChange({ locationId: null, locationName: null, title });
  };

  return (
    <div className="space-y-2">
      {/* Title input */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {linkType === 'occupation' ? 'Job Title' : 'Course / Program'}
        </label>
        <Input
          value={title}
          onChange={e => {
            setTitle(e.target.value);
            onLinkChange({ locationId: currentLocationId, locationName: selectedLocation?.name || null, title: e.target.value });
          }}
          placeholder={placeholder}
          className="rounded-xl text-sm h-10"
        />
      </div>

      {/* Location link */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {linkType === 'occupation' ? 'Linked Workplace (optional)' : 'Linked Location (optional)'}
        </label>

        {selectedLocation ? (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-primary/10 border border-primary/30">
            <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="text-sm text-foreground flex-1 truncate">{selectedLocation.name}</span>
            <button
              onClick={handleClear}
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowPicker(v => !v)}
            className="w-full flex items-center gap-2 p-2.5 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-sm"
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span className="flex-1 text-left text-xs">Link to a location from your list</span>
            {showPicker ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}

        {showPicker && (
          <div className="border border-border rounded-xl overflow-hidden bg-card">
            <div className="p-2 border-b border-border">
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search locations..."
                className="h-8 text-xs rounded-lg"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredLocations.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No matching locations found.</p>
              )}
              {filteredLocations.map(loc => (
                <button
                  key={loc.id}
                  onClick={() => handleSelect(loc)}
                  className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-secondary transition-colors border-b border-border/50 last:border-b-0"
                >
                  <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{loc.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{loc.category?.replace('_', ' ')}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}