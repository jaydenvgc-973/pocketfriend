import { useState, useRef, useEffect } from 'react';
import { MapPin, ChevronDown, X } from 'lucide-react';

/**
 * LocationSelectorDropdown
 *
 * Lets the user pick an existing app location (any type, including residential,
 * because user-created calendar events are user-controlled) OR type a custom name.
 *
 * Props:
 *   locations      – array of LocationReference records
 *   value          – { location_id, location_name, custom_location } | null
 *   onChange       – (value) => void
 */

// Category labels for display
const CATEGORY_LABELS = {
  residential: 'Home',
  commercial: 'Business',
  entertainment: 'Entertainment',
  food_and_drink: 'Food & Drink',
  health: 'Health',
  education: 'Education',
  recreation: 'Recreation',
  community: 'Community',
  religious: 'Religious',
  government: 'Government',
  retail: 'Retail',
  other: 'Other',
};

export default function LocationSelectorDropdown({ locations = [], value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = locations.filter(loc => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (loc.name || '').toLowerCase().includes(q) ||
      (loc.category || '').toLowerCase().includes(q) ||
      (loc.location_type || '').toLowerCase().includes(q)
    );
  });

  const handleSelect = (loc) => {
    onChange({
      location_id: loc.id,
      location_name: loc.name,
      location_category: loc.category || loc.location_type || null,
      custom_location: false,
    });
    setOpen(false);
    setSearch('');
    setShowCustom(false);
  };

  const handleCustomSubmit = () => {
    if (!customText.trim()) return;
    onChange({
      location_id: null,
      location_name: customText.trim(),
      location_category: null,
      custom_location: true,
    });
    setShowCustom(false);
    setOpen(false);
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
    setCustomText('');
    setShowCustom(false);
  };

  const displayLabel = value?.location_name || null;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-input border border-border rounded-lg text-sm text-left focus:outline-none focus:ring-1 focus:ring-primary/50 hover:border-primary/40 transition-colors"
      >
        <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className={`flex-1 truncate ${displayLabel ? 'text-foreground' : 'text-muted-foreground'}`}>
          {displayLabel || 'Select location…'}
        </span>
        {value ? (
          <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" onClick={handleClear} />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
          {/* Search box */}
          <div className="p-2 border-b border-border">
            <input
              type="text"
              placeholder="Search locations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="w-full px-2 py-1.5 bg-input border border-border rounded-md text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {/* Location list */}
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No locations found.</p>
            )}
            {filtered.map(loc => {
              const catLabel = CATEGORY_LABELS[loc.category || loc.location_type] || (loc.category || loc.location_type || '');
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => handleSelect(loc)}
                  className="w-full flex items-start gap-2 px-3 py-2 hover:bg-secondary/60 text-left transition-colors"
                >
                  <MapPin className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{loc.name}</div>
                    {catLabel && <div className="text-[10px] text-muted-foreground">{catLabel}</div>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom location entry */}
          <div className="border-t border-border p-2">
            {!showCustom ? (
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-secondary/40 transition-colors"
              >
                + Enter a custom location
              </button>
            ) : (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Custom location name…"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCustomSubmit(); }}
                  autoFocus
                  className="flex-1 px-2 py-1.5 bg-input border border-border rounded-md text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  disabled={!customText.trim()}
                  className="px-2 py-1.5 bg-primary text-primary-foreground text-xs rounded-md disabled:opacity-40"
                >
                  Use
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}