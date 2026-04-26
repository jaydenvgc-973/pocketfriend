import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapPin, Check, AlertCircle, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function HomeLocationField({ character, currentUser }) {
  const queryClient = useQueryClient();
  const [selectedLocationId, setSelectedLocationId] = useState(character?.current_home_location_id || '');
  const [showRepair, setShowRepair] = useState(false);
  const [isRepairingLink, setIsRepairingLink] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Fetch ALL user-visible locations using the same authoritative source as Locations page
  // This includes owned, character-linked, resident-linked, and admin-shared locations
  const { data: fetchResult, isLoading } = useQuery({
    queryKey: ['userLocations', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return { locations: [], totalCount: 0 };
      // Use the same function that the Locations page uses — applies all visibility rules
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return {
        locations: res?.data?.locations || [],
        totalCount: res?.data?.totalCount || 0,
        summary: res?.data?.summary || {},
      };
    },
    enabled: !!currentUser?.email,
  });

  const userLocations = fetchResult?.locations || [];
  const totalCount = fetchResult?.totalCount || 0;
  const isTruncated = userLocations.length < totalCount;

  // Check for residence assignment on Locations page (fallback truth)
  const [locationPageHome, setLocationPageHome] = useState(null);
  useEffect(() => {
    // Scan all locations to see if this character is assigned as a resident
    for (const loc of userLocations) {
      const inResidents = (loc.resident_character_ids || []).includes(character?.id);
      const inResidentsArr = (loc.residents || []).some(r => r.character_id === character?.id);
      if (inResidents || inResidentsArr) {
        setLocationPageHome({ id: loc.id, name: loc.name });
        break;
      }
    }
  }, [userLocations, character?.id]);

  // Detect conflict: profile field doesn't match location page assignment
  const hasConflict = selectedLocationId !== locationPageHome?.id && locationPageHome;

  // Update character's home
  const updateHomeMutation = useMutation({
    mutationFn: (homeLocId) =>
      base44.entities.Character.update(character.id, {
        current_home_location_id: homeLocId
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      setShowRepair(false);
    }
  });

  const handleRepairLink = async () => {
    if (!locationPageHome?.id) return;
    setIsRepairingLink(true);
    try {
      await updateHomeMutation.mutateAsync(locationPageHome.id);
    } finally {
      setIsRepairingLink(false);
    }
  };

  if (character?.is_default) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Home Location</p>
        <p className="text-sm text-muted-foreground italic">Default character — home is fixed</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Home Location</p>
        </div>
        {hasConflict && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <AlertCircle className="w-3 h-3 text-amber-500" />
            <span className="text-xs text-amber-600">Conflict detected</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {/* Profile field selector */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-2">
            Set Home (Profile)
          </label>
          <select
            value={selectedLocationId}
            onChange={(e) => {
              setSelectedLocationId(e.target.value);
              updateHomeMutation.mutate(e.target.value);
            }}
            className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm focus:ring-1 focus:ring-primary/50 outline-none"
          >
            <option value="">— Not set —</option>
            {userLocations.map(loc => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        {/* Conflict display and repair button */}
        {hasConflict && (
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-2"
            >
              <p className="text-xs text-amber-700">
                This character's home is listed on the Locations page ({locationPageHome.name}), but the movement system is not reading it correctly.
              </p>
              <button
                onClick={handleRepairLink}
                disabled={isRepairingLink}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-700 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {isRepairingLink ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-amber-700/30 border-t-amber-700 animate-spin" />
                    Repairing...
                  </>
                ) : (
                  <>
                    <Check className="w-3 h-3" />
                    Repair Home Link
                  </>
                )}
              </button>
            </motion.div>
          </AnimatePresence>
        )}

        {/* Show current resolved home if no conflict */}
        {!selectedLocationId && !locationPageHome && (
          <p className="text-xs text-red-500">No home assigned. Character may disappear on return-home.</p>
        )}
        {!selectedLocationId && locationPageHome && !showRepair && (
          <p className="text-xs text-blue-500">Home found on Locations page: {locationPageHome.name}</p>
        )}

        {/* Truncation warning */}
        {isTruncated && (
          <div className="p-2 rounded-lg bg-red-500/5 border border-red-500/20">
            <p className="text-xs text-red-600 font-medium">
              ⚠️ Truncated: showing {userLocations.length} of {totalCount} locations
            </p>
          </div>
        )}

        {/* Diagnostics toggle */}
        <button
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground text-xs transition-colors"
        >
          <span>Show Dropdown Diagnostics</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} />
        </button>

        {/* Diagnostics panel */}
        {showDiagnostics && (
          <div className="p-3 rounded-lg bg-slate-950/20 border border-border space-y-2 max-h-48 overflow-y-auto">
            <p className="text-xs font-mono text-muted-foreground">
              Total locations: {userLocations.length} / {totalCount}
            </p>
            {fetchResult?.summary && (
              <>
                <p className="text-xs font-mono text-muted-foreground">
                  Owned: {fetchResult.summary.ownedByAccount || 0}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  Char-linked: {fetchResult.summary.characterLinked || 0}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  Admin-shared: {fetchResult.summary.adminShared || 0}
                </p>
              </>
            )}
            <p className="text-xs font-mono text-muted-foreground border-t border-border pt-2 mt-2">Dropdown options:</p>
            <div className="space-y-1">
              {userLocations.slice(0, 20).map(loc => (
                <p key={loc.id} className="text-xs font-mono text-muted-foreground truncate">
                  • {loc.name} <span className="text-muted-foreground/50">({loc.id.slice(0, 8)})</span>
                </p>
              ))}
              {userLocations.length > 20 && (
                <p className="text-xs font-mono text-muted-foreground">
                  ... and {userLocations.length - 20} more
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}