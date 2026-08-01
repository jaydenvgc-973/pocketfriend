import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { MapPin, X, ChevronDown, ChevronUp, Briefcase, DollarSign } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * OccupationLocationPicker
 *
 * Reusable component for selecting a location from the location list
 * and linking it as an occupation or education site.
 *
 * Supports two modes:
 *  - Physical location: links to an existing LocationReference record
 *  - Rabbit Hole: a custom non-physical workplace name with its own pay fields
 *
 * Props:
 *   characterId: string (null during creation)
 *   linkType: 'occupation' | 'education'
 *   currentLocationId: string|null (location name when in rabbit hole mode)
 *   currentTitle: string
 *   onLinkChange: ({ locationId, locationName, title, isRabbitHole, payType, payRate }) => void
 *   placeholder: string
 *   hideTitle: boolean
 *   isRabbitHole: boolean (from parent state)
 *   payType: 'hourly' | 'annual' (rabbit hole only)
 *   payRate: number (rabbit hole only)
 */
export default function OccupationLocationPicker({
  characterId,
  linkType = 'occupation',
  currentLocationId,
  currentTitle = '',
  onLinkChange,
  placeholder = 'e.g. Job title or role',
  hideTitle = false,
  isRabbitHole: rabbitHoleMode = false,
  payType: currentPayType = 'hourly',
  payRate: currentPayRate = 0,
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [title, setTitle] = useState(currentTitle);
  const [search, setSearch] = useState('');
  // In rabbit hole mode the custom name is carried via locationName from the parent.
  // currentLocationId holds the name string when in rabbit hole mode (see JobBlock prop wiring).
  const [rabbitHoleName, setRabbitHoleName] = useState(
    rabbitHoleMode ? (typeof currentLocationId === 'string' ? currentLocationId : '') : ''
  );

  // Sync rabbitHoleName when the parent switches characters or updates the link externally.
  // useState only initializes once, so without this effect the name field would be stale
  // after loading a different character with an existing rabbit hole occupation.
  useEffect(() => {
    if (rabbitHoleMode && typeof currentLocationId === 'string') {
      setRabbitHoleName(currentLocationId);
    } else if (!rabbitHoleMode) {
      setRabbitHoleName('');
    }
  }, [rabbitHoleMode, currentLocationId]);

  // Sync title when parent changes (e.g. switching characters)
  useEffect(() => { setTitle(currentTitle); }, [currentTitle]);

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
    onLinkChange({ locationId: location.id, locationName: location.name, title, isRabbitHole: false, payType: null, payRate: null });
  };

  const handleClear = () => {
    setRabbitHoleName('');
    onLinkChange({ locationId: null, locationName: null, title, isRabbitHole: false, payType: null, payRate: null });
  };

  const handleRabbitHoleSelect = () => {
    setShowPicker(false);
    setSearch('');
    onLinkChange({ locationId: null, locationName: rabbitHoleName || '', title, isRabbitHole: true, payType: currentPayType, payRate: currentPayRate });
  };

  const handleRabbitHoleNameChange = (val) => {
    setRabbitHoleName(val);
    onLinkChange({ locationId: null, locationName: val, title, isRabbitHole: true, payType: currentPayType, payRate: currentPayRate });
  };

  const handlePayTypeChange = (val) => {
    onLinkChange({ locationId: null, locationName: rabbitHoleName || '', title, isRabbitHole: true, payType: val, payRate: currentPayRate });
  };

  const handlePayRateChange = (val) => {
    onLinkChange({ locationId: null, locationName: rabbitHoleName || '', title, isRabbitHole: true, payType: currentPayType, payRate: parseFloat(val) || 0 });
  };

  return (
    <div className="space-y-2">
      {/* Title input — hidden when parent already provides a Job Title field */}
      {!hideTitle && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            {linkType === 'occupation' ? 'Job Title' : 'Course / Program'}
          </label>
          <Input
            value={title}
            onChange={e => {
              setTitle(e.target.value);
              onLinkChange({
                locationId: currentLocationId,
                locationName: selectedLocation?.name || null,
                title: e.target.value,
                isRabbitHole: rabbitHoleMode,
                payType: currentPayType,
                payRate: currentPayRate,
              });
            }}
            placeholder={placeholder}
            className="rounded-xl text-sm h-10"
          />
        </div>
      )}

      {/* Location link */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {linkType === 'occupation' ? 'Linked Workplace (optional)' : 'Linked Location (optional)'}
        </label>

        {rabbitHoleMode ? (
          /* ── RABBIT HOLE MODE — custom name + pay fields ── */
          <div className="space-y-2 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/30">
            <div className="flex items-center gap-2">
              <Briefcase className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <span className="text-xs font-medium text-amber-400 flex-1">Rabbit Hole (Custom Workplace)</span>
              <button
                onClick={handleClear}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <Input
              value={rabbitHoleName || ''}
              onChange={e => handleRabbitHoleNameChange(e.target.value)}
              placeholder="Enter custom workplace name (e.g. Paterson Development Co.)"
              className="rounded-lg text-xs h-9"
            />
            {/* Pay fields — same structure as WorkLocationEditor on the profile */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Pay Type</label>
                <select
                  value={currentPayType}
                  onChange={e => handlePayTypeChange(e.target.value)}
                  className="w-full h-8 px-2 bg-input border border-border rounded-lg text-xs text-foreground"
                >
                  <option value="hourly">Hourly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">
                  Rate ({currentPayType === 'hourly' ? '$/hr' : '$/yr'})
                </label>
                <div className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <Input
                    type="number"
                    value={currentPayRate}
                    onChange={e => handlePayRateChange(e.target.value)}
                    className="h-8 rounded-lg text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : selectedLocation ? (
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

        {showPicker && !rabbitHoleMode && (
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
              {/* Rabbit Hole option — always at the top of the list */}
              <button
                onClick={handleRabbitHoleSelect}
                className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-amber-500/10 transition-colors border-b border-border"
              >
                <Briefcase className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-amber-400">Rabbit Hole (Custom Name)</p>
                  <p className="text-[10px] text-muted-foreground">Enter a non-physical workplace</p>
                </div>
              </button>
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