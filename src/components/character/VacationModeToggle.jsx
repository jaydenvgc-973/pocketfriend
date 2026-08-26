import React, { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plane, Home, MapPin, Check, X } from "lucide-react";

/**
 * VacationModeToggle
 *
 * ON  → character is temporarily exempt from mandatory work and school attendance.
 *       Existing work/school schedules and enrollment remain intact — only enforcement
 *       is skipped. The character remains free to travel and participate normally.
 *       When ON, the user can configure Vacation Locations (the authoritative
 *       autonomous destination set) and a Vacation Home (temporary sleep/return target).
 * OFF → exemption is gone; existing obligations resume normally through their
 *       existing behavior. Vacation Location and Vacation Home authority end.
 *       Nothing needs to be reconstructed because Vacation Mode never erases or
 *       replaces those obligations or the permanent home.
 */
export default function VacationModeToggle({ character }) {
  const queryClient = useQueryClient();
  const isOn = character?.vacation_mode === true;
  const [optimistic, setOptimistic] = useState(null);
  const displayOn = optimistic ?? isOn;

  const vacationLocationIds = useMemo(
    () => Array.isArray(character?.vacation_location_ids) ? character.vacation_location_ids : [],
    [character?.vacation_location_ids]
  );
  const vacationHomeId = character?.vacation_home_location_id || null;

  const mutation = useMutation({
    mutationFn: async (next) => {
      await base44.entities.Character.update(character.id, { vacation_mode: next });
    },
    onMutate: async (next) => {
      setOptimistic(next);
      queryClient.setQueryData(["character", character.id], (prev) =>
        prev ? { ...prev, vacation_mode: next } : prev
      );
      if (character.owner_email) {
        queryClient.setQueryData(["characters", character.owner_email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((c) => (c.id === character.id ? { ...c, vacation_mode: next } : c));
        });
      }
    },
    onError: () => {
      setOptimistic(isOn);
      queryClient.setQueryData(["character", character.id], (prev) =>
        prev ? { ...prev, vacation_mode: isOn } : prev
      );
      if (character.owner_email) {
        queryClient.setQueryData(["characters", character.owner_email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((c) => (c.id === character.id ? { ...c, vacation_mode: isOn } : c));
        });
      }
    },
    onSettled: () => {
      setOptimistic(null);
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      if (character.owner_email) {
        queryClient.invalidateQueries({ queryKey: ["characters", character.owner_email] });
      }
    },
  });

  const handleToggle = () => {
    mutation.mutate(!displayOn);
  };

  // ── Vacation Locations + Vacation Home mutations ──
  const updateVacationConfig = useMutation({
    mutationFn: async (payload) => {
      await base44.entities.Character.update(character.id, payload);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      if (character.owner_email) {
        queryClient.invalidateQueries({ queryKey: ["characters", character.owner_email] });
      }
    },
  });

  const handleToggleLocation = async (locId) => {
    const current = new Set(vacationLocationIds);
    if (current.has(locId)) {
      current.delete(locId);
    } else {
      current.add(locId);
    }
    const nextIds = Array.from(current);
    // If removing the current vacation home, clear it
    const nextHome = nextIds.includes(vacationHomeId) ? vacationHomeId : null;
    updateVacationConfig.mutate({
      vacation_location_ids: nextIds,
      vacation_home_location_id: nextHome,
    });
  };

  const handleSetVacationHome = async (locId) => {
    updateVacationConfig.mutate({
      vacation_home_location_id: locId,
    });
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Plane className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-xs font-medium text-foreground">Vacation Mode</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {displayOn
              ? "On — temporarily exempt from work and school attendance. Schedules stay intact; switching off resumes normal obligations."
              : "Off — work and school obligations operate normally. Turn on to temporarily exempt this character from attendance."}
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={mutation.isPending}
          role="switch"
          aria-checked={displayOn}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            displayOn ? "bg-primary" : "bg-secondary border border-border"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              displayOn ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {displayOn && (
        <VacationLocationConfig
          character={character}
          vacationLocationIds={vacationLocationIds}
          vacationHomeId={vacationHomeId}
          onToggleLocation={handleToggleLocation}
          onSetVacationHome={handleSetVacationHome}
          isUpdating={updateVacationConfig.isPending}
        />
      )}
    </div>
  );
}

/**
 * VacationLocationConfig
 *
 * Shows the Vacation Locations selector and Vacation Home picker.
 * Fetches the user's locations via the existing LocationReference entity.
 * Only rendered when Vacation Mode is ON.
 */
function VacationLocationConfig({ character, vacationLocationIds, vacationHomeId, onToggleLocation, onSetVacationHome, isUpdating }) {
  const [showPicker, setShowPicker] = useState(false);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);

  // Sleep-eligible categories (matches VALID_SLEEP_CATEGORIES in enforceCharacterLocationPresence)
  // Plus environment-based eligibility: locations with a residential or community environment
  // are also sleep-eligible, even if their primary category is not in this set.
  const SLEEP_ELIGIBLE_CATEGORIES = new Set([
    'home', 'hotel', 'shelter', 'generic', 'jail_prison', 'transportation'
  ]);
  const SLEEP_PERMITTING_ENV_TYPES = new Set(['residential', 'community']);

  const isSleepEligible = (loc) => {
    if (!loc) return false;
    if (SLEEP_ELIGIBLE_CATEGORIES.has(loc.category)) return true;
    if (Array.isArray(loc.environments)) {
      return loc.environments.some(env => SLEEP_PERMITTING_ENV_TYPES.has(env.type));
    }
    return false;
  };

  const loadLocations = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const me = await base44.auth.me();
      if (!me?.email) { setLoading(false); return; }
      const locs = await base44.entities.LocationReference.filter({ owner_email: me.email });
      setLocations(locs || []);
    } catch (e) {
      console.warn("Failed to load locations for vacation config:", e);
    }
    setLoading(false);
  };

  // Load locations on mount when Vacation Mode is ON — the collapsed display needs
  // location names to show persisted selections without requiring the user to open
  // Manage. vacation_location_ids are on the character record, but the names come
  // from LocationReference entities. Without this load, navigating away and back
  // shows "No vacation locations selected yet" even though the IDs are persisted.
  React.useEffect(() => {
    if (locations.length === 0 && !loading) {
      loadLocations();
    }
  }, []);

  const selectedLocations = locations.filter(l => vacationLocationIds.includes(l.id));
  const vacationHomeLocation = locations.find(l => l.id === vacationHomeId) || null;

  return (
    <div className="border-t border-border pt-3 space-y-3">
      {/* Vacation Locations */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-primary" />
            Vacation Locations
          </p>
          <button
            onClick={() => setShowPicker(s => !s)}
            className="text-xs text-primary hover:underline"
          >
            {showPicker ? "Done" : "Manage"}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
          While Vacation Mode is ON, autonomous travel is restricted to these locations. The permanent home is not eligible unless included here.
        </p>

        {selectedLocations.length === 0 && !showPicker && (
          <p className="text-xs text-muted-foreground italic">No vacation locations selected yet.</p>
        )}

        <div className="space-y-1.5">
          {selectedLocations.map(loc => (
            <div key={loc.id} className="flex items-center justify-between bg-secondary/50 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-foreground truncate">{loc.name}</span>
                {vacationHomeId === loc.id && (
                  <span className="text-[10px] text-primary font-medium flex-shrink-0">★ Home</span>
                )}
              </div>
              <button
                onClick={() => onToggleLocation(loc.id)}
                disabled={isUpdating}
                className="text-muted-foreground hover:text-destructive flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {showPicker && (
          <div className="mt-2 border border-border rounded-lg p-2 max-h-60 overflow-y-auto space-y-1">
            {loading && <p className="text-xs text-muted-foreground text-center py-2">Loading...</p>}
            {!loading && locations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">No locations found.</p>
            )}
            {!loading && locations.map(loc => {
              const isSelected = vacationLocationIds.includes(loc.id);
              return (
                <button
                  key={loc.id}
                  onClick={() => onToggleLocation(loc.id)}
                  disabled={isUpdating}
                  className={`w-full flex items-center justify-between text-left px-2 py-1.5 rounded-md transition-colors ${
                    isSelected ? "bg-primary/10" : "hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-foreground truncate">{loc.name}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">({loc.category})</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Vacation Home */}
      {vacationLocationIds.length > 0 && (
        <div className="border-t border-border pt-2">
          <p className="text-xs font-medium text-foreground flex items-center gap-1.5 mb-1.5">
            <Home className="w-3.5 h-3.5 text-primary" />
            Vacation Home
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
            Temporary sleep/return target while Vacation Mode is ON. Must be a sleep-eligible selected location — home, hotel, shelter, generic, transportation, or any location with a residential or community environment.
          </p>
          <div className="space-y-1">
            {selectedLocations.map(loc => {
              const sleepEligible = isSleepEligible(loc);
              const isCurrentHome = vacationHomeId === loc.id;
              return (
                <button
                  key={loc.id}
                  onClick={() => sleepEligible && onSetVacationHome(loc.id)}
                  disabled={!sleepEligible || isUpdating}
                  className={`w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-lg transition-colors ${
                    isCurrentHome ? "bg-primary/15 border border-primary/30" : "bg-secondary/50 hover:bg-secondary"
                  } ${!isSleepEligible ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Home className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs text-foreground truncate">{loc.name}</span>
                    {!sleepEligible && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">(not sleep-eligible)</span>
                    )}
                  </div>
                  {isCurrentHome && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}