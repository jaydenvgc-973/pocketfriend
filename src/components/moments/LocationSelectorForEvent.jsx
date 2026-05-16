import { useState, useMemo } from 'react';
import { MapPin, ChevronDown, X } from 'lucide-react';

/**
 * LocationSelectorForEvent
 *
 * Shows a searchable dropdown of real app LocationReference records.
 * Allows any location (including residential) for user-created events.
 * Falls back to a custom text entry only if the user explicitly chooses it.
 *
 * Props:
 *   locations: LocationReference[]
 *   value: { location_id, location_name, custom_location } | null
 *   onChange: (value) => void
 */
export default function LocationSelectorForEvent({ locations = [], value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');

  // Category display labels
  const CATEGORY_LABELS = {
    home: 'Home', hotel: 'Hotel', shelter: 'Shelter', workplace: 'Workplace',
    gym: 'Gym', social: 'Social', outdoor: 'Outdoor', food_drink: 'Food & Drink',
    medical: 'Medical', education: 'Education', grocery: 'Grocery',
    religion: 'Religious', government: 'Government', public: 'Public',
    business: 'Business', school: 'School', community: 'Community',
    generic: 'General', jail: 'Jail', prison: 'Prison',
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return locations.slice(0, 40);
    const q = search.toLowerCase();
    return locations.filter(l =>
      l.name?.toLowerCase().includes(q) ||
      l.category?.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [locations, search]);

  const handleSelectLocation = (loc) => {
    onChange({
      location_id: loc.id,
      location_name: loc.name,
      location_category: loc.category || null,
      custom_location: false,
    });
    setOpen(false);
    setSearch('');
    setCustomMode(false);
  };

  const handleCustomSubmit = () => {
    if (!customText.trim()) return;
    onChange({
      location_id: null,
      location_name: customText.trim(),
      location_category: null,
      custom_location: true,
    });
    setCustomMode(false);
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setCustomText('');
    setCustomMode(false);
  };

  // Display the selected value
  if (value?.location_name && !open) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-input border border-primary/40 rounded-lg text-sm">
        <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="flex-1 text-foreground truncate">{value.location_name}</span>
        {value.location_category && (
          <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
            {CATEGORY_LABELS[value.location_category] || value.location_category}
          </span>
        )}
        {value.custom_location && (
          <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">custom</span>
        )}
        <button onClick={handleClear} className="text-muted-foreground hover:text-foreground ml-1">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Trigger button */}
      {!open && (
        <button
          type="button"
          onClick={() => { setOpen(true); setSearch(''); setCustomMode(false); }}
          className="w-full flex items-center gap-2 px-3 py-2 bg-input border border-border rounded-lg text-sm text-muted-foreground hover:border-primary/40 transition-colors"
        >
          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left">Select a location…</span>
          <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
        </button>
      )}

      {/* Dropdown panel */}
      {open && (
        <div className="w-full bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              type="text"
              placeholder="Search locations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-2 py-1.5 bg-input border border-border rounded text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {/* Custom mode inline */}
          {customMode ? (
            <div className="p-2 space-y-2">
              <p className="text-xs text-muted-foreground">Enter a custom location name:</p>
              <input
                autoFocus
                type="text"
                placeholder="e.g. My friend's backyard…"
                value={customText}
                onChange={e => setCustomText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCustomSubmit()}
                className="w-full px-2 py-1.5 bg-input border border-border rounded text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  disabled={!customText.trim()}
                  className="flex-1 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium disabled:opacity-40"
                >
                  Use this location
                </button>
                <button
                  type="button"
                  onClick={() => setCustomMode(false)}
                  className="px-3 py-1.5 bg-secondary text-muted-foreground rounded text-xs"
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <>
              <ul className="max-h-48 overflow-y-auto">
                {filtered.length === 0 && (
                  <li className="px-3 py-3 text-xs text-muted-foreground text-center">No locations found</li>
                )}
                {filtered.map(loc => (
                  <li key={loc.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectLocation(loc)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/60 transition-colors text-left"
                    >
                      <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 text-sm text-foreground truncate">{loc.name}</span>
                      {loc.category && (
                        <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded flex-shrink-0">
                          {CATEGORY_LABELS[loc.category] || loc.category}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Custom fallback at bottom */}
              <div className="border-t border-border p-2">
                <button
                  type="button"
                  onClick={() => setCustomMode(true)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 text-center transition-colors"
                >
                  + Enter a custom location instead
                </button>
              </div>

              <div className="border-t border-border p-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); setSearch(''); }}
                  className="w-full text-xs text-muted-foreground py-1 text-center"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}