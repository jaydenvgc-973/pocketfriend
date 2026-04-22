import React, { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, MapPin, Users, Navigation, Plus, Wrench, Map } from "lucide-react";
import LivePresenceMap from "@/components/travel/LivePresenceMap";
import { ensureLocationsMapped } from "@/lib/mapCoordinates";
import FixLocationsButton from "@/components/home/FixLocationsButton";
import { toDisplay12h } from "@/lib/timeFormat";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import TravelLocationGrid from "@/components/travel/TravelLocationGrid";
import TravelCharacterSelector from "@/components/travel/TravelCharacterSelector";
import CharacterAvailabilityPopup from "@/components/travel/CharacterAvailabilityPopup";
import BusyCharacterPopup from "@/components/travel/BusyCharacterPopup";
import WakeUpModal from "@/components/travel/WakeUpModal";
import RealLocationModal from "@/components/travel/RealLocationModal";
import { getCharacterTravelAvailability, isCharacterHome } from "@/lib/travelAvailability";
import { isLocationActiveNow, isCharacterAtWork } from "@/lib/workScheduleUtils";
import { isCharacterAsleep } from "@/lib/sleepUtils";
import { canCharacterTravelToLocation } from "@/lib/characterEditableListResolver";
import { resolveTravelPresenceEntities, getPresenceAtLocation, isLocationEmpty } from "@/lib/travelPresenceResolver";
import { shouldVGCResidentBeAtHome } from "@/lib/vgcTowersPresenceEngine";

export default function Travel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [hasRunDistribution, setHasRunDistribution] = useState(false);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState([]);
  const [convincedCharacterIds, setConvincedCharacterIds] = useState([]);
  const [unavailablePopup, setUnavailablePopup] = useState(null);
  const [busyPopup, setBusyPopup] = useState(null);
  const [isTraveling, setIsTraveling] = useState(false);
  const [isConvincing, setIsConvincing] = useState(false);
  const [wakeUpModal, setWakeUpModal] = useState(null);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [showRealLocationModal, setShowRealLocationModal] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [distributeResult, setDistributeResult] = useState(null);
  const [isDistributing, setIsDistributing] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const { data: currentUser = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: settingsList = [] } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserSettings.filter({ created_by: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  // Active playable characters only
  const { data: activeCharacters = [] } = useQuery({
    queryKey: ["activeCharacters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({
      created_by: currentUser.email,
      status: "active",
      character_type: "active_created_character"
    }),
    enabled: !!currentUser?.email,
    staleTime: 0,
    gcTime: 0,
  });

  // npc_fictitious — via backend (catches service-account-created ones)
  const { data: backendNpcFictitious = [] } = useQuery({
    queryKey: ["npcCharacters", currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.id) return [];
      const res = await base44.functions.invoke('fetchNPCsForUser', {});
      return (res?.data?.npcs || []).filter(c => c.character_type === 'npc_fictitious');
    },
    enabled: !!currentUser?.id,
    staleTime: 0,
    gcTime: 0,
  });

  // npc_fictitious — via direct RLS query (catches user-created ones)
  const { data: rlsNpcFictitious = [] } = useQuery({
    queryKey: ["npcFictitiousRls", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { created_by: currentUser.email, character_type: 'npc_fictitious' },
      '-created_date',
      300
    ),
    enabled: !!currentUser?.email,
    staleTime: 0,
    gcTime: 0,
  });

  // npc_family_member — via created_by (user-created family records)
  const { data: rlsFamilyByCreatedBy = [] } = useQuery({
    queryKey: ["npcFamilyMembers", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { created_by: currentUser.email, character_type: 'npc_family_member' },
      '-created_date',
      300
    ),
    enabled: !!currentUser?.email,
    staleTime: 0,
    gcTime: 0,
  });

  // npc_family_member — via owner_email (service-created or migrated family records)
  const { data: rlsFamilyByOwnerEmail = [] } = useQuery({
    queryKey: ["npcFamilyMembersByOwner", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { owner_email: currentUser.email, character_type: 'npc_family_member' },
      '-created_date',
      300
    ),
    enabled: !!currentUser?.email,
    staleTime: 0,
    gcTime: 0,
  });

  // Merge all sources, deduplicated
  const npcCharacters = (() => {
    const seen = new Set();
    return [...backendNpcFictitious, ...rlsNpcFictitious].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  const npcFamilyMembers = (() => {
    const seen = new Set();
    return [...rlsFamilyByCreatedBy, ...rlsFamilyByOwnerEmail].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })();

  // travelCompanions: active_created_character + npc_fictitious ONLY (who can come with you)
  const travelCompanions = [...activeCharacters, ...npcCharacters];

  const { data: locationsData = [] } = useQuery({
    queryKey: ["locationReferences", currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke("fetchAllLocationsForUser", {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
  });

  const locationMap = Object.fromEntries(locationsData.map(l => [l.id, l]));
  const settings = settingsList[0] || {};

  // ALL character records for internal family scanning (parent character lookup)
  const allCharactersForFamilyScan = [...activeCharacters, ...npcCharacters, ...npcFamilyMembers];

  // UNIFIED PRESENCE RESOLVER — single source of truth for map, popup, counts
  // Includes: active_created, npc_fictitious, npc_family_member, internal family
  const allPresenceEntities = useMemo(() => resolveTravelPresenceEntities({
    currentUser,
    activeCharacters,
    npcFictitious: npcCharacters,
    npcFamilyMembers,
    allCharacters: allCharactersForFamilyScan,
    locations: locationsData,
  }), [
    currentUser?.id,
    activeCharacters.length,
    npcCharacters.length,
    npcFamilyMembers.length,
    locationsData.length,
  ]);

  // mapCharacters: raw character records fed to LivePresenceMap pin builder
  // Includes all character types — family members now included
  const mapCharacters = allCharactersForFamilyScan;

  // VGC Towers residents (for travel-away count)
  const vgcTowers = locationsData.find(l => l.name === 'VGC Towers');
  const vgcTowersResidents = allPresenceEntities.filter(e =>
    (e.character_type === 'npc_fictitious' || e.character_type === 'npc_family_member') &&
    e.residence_location_id === vgcTowers?.id
  );

  // Ensure every location has saved map coordinates
  useEffect(() => {
    if (!locationsData.length || !currentUser?.email) return;
    const saveLocation = async (locationId, updates) => {
      await base44.entities.LocationReference.update(locationId, updates);
      queryClient.invalidateQueries({ queryKey: ['locationReferences', currentUser.email] });
    };
    ensureLocationsMapped(locationsData, saveLocation).catch(() => {});
  }, [locationsData.length, currentUser?.email]);

  // Auto-distribute VGC NPCs on page load so UI shows their real locations
  useEffect(() => {
    if (!currentUser?.email || hasRunDistribution) return;
    setHasRunDistribution(true);
    base44.functions.invoke('distributeVGCTowersNPCs', {})
      .then(() => new Promise(r => setTimeout(r, 1000)))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['npcCharacters', currentUser.email] });
        queryClient.invalidateQueries({ queryKey: ['activeCharacters', currentUser.email] });
        queryClient.invalidateQueries({ queryKey: ['locationReferences', currentUser.email] });
      })
      .catch(() => {});
  }, [currentUser?.email, hasRunDistribution]);
  const displayName = settings.fictional_world_name || currentUser?.full_name || "You";

  const formatOperatingHours = (location) => {
    const hours = location?.operating_hours;
    if (!hours || hours.length === 0) return null;
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const fmt = (t) => toDisplay12h(t);
    const unique = hours.map(w => `${fmt(w.open_time)} – ${fmt(w.close_time)}`);
    const first = unique[0];
    const allSame = unique.every(u => u === first);
    if (allSame) return first;
    return hours.map(w => `${w.day_of_week != null ? dayNames[w.day_of_week] + " " : ""}${fmt(w.open_time)} – ${fmt(w.close_time)}`).join(", ");
  };

  const checkHomeAccess = (location) => {
    if (!location || location.category !== "home") {
      return { canVisit: true, blockedBy: null, homeResidents: [] };
    }
    
    // Use unified presence resolver (allPresenceEntities) — consistent with map + popup
    const presentHere = getPresenceAtLocation(location, allPresenceEntities);
    const homeResidents = presentHere.map(e => ({ name: e.display_name }));
    
    const userHasKey = (settings.home_key_holders || []).some(k => k.location_id === location.id);
    const hasAssignedResidents = (location.resident_character_ids || []).length > 0 ||
      (location.resident_family_members || []).length > 0;
    const canVisit = homeResidents.length > 0 || hasAssignedResidents || userHasKey;
    
    if (!hasAssignedResidents && homeResidents.length === 0) {
      return { canVisit: true, blockedBy: null, homeResidents: [] };
    }
    
    return {
      canVisit,
      blockedBy: !canVisit ? { name: location.name } : null,
      homeResidents,
    };
  };

  const toggleCharacter = (charId) => {
    const char = travelCompanions.find(c => c.id === charId);
    if (!char) return;
    
    // Check age-based travel restrictions
    if (selectedLocation) {
      const travelAllowed = canCharacterTravelToLocation(char, selectedLocation);
      if (!travelAllowed.allowed) {
        setUnavailablePopup([{
          character: char,
          reason: { iconType: "error", message: travelAllowed.reason, color: "text-destructive" },
          availableAt: "Cannot travel to this location",
        }]);
        return;
      }
    }
    
    if (isCharacterAsleep(char)) {
      setWakeUpModal({ character: char, pendingCharacterId: charId });
      return;
    }
    const availability = getCharacterTravelAvailability(char, locationMap);
    if (!availability.available) {
      if (availability.isBusy) {
        setBusyPopup({ character: char, reason: availability.reason, charId });
        return;
      }
      setUnavailablePopup([{ character: char, reason: availability.reason, availableAt: availability.availableAt }]);
      return;
    }
    setSelectedCharacterIds(prev =>
      prev.includes(charId) ? prev.filter(id => id !== charId) : [...prev, charId]
    );
  };

  const handleConvinceCharacter = async () => {
    if (!busyPopup?.charId) return;
    setIsConvincing(true);
    try {
      const char = travelCompanions.find(c => c.id === busyPopup.charId);
      if (!char) return;
      const convinceRes = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${char.name}. You are currently busy: ${busyPopup.reason}.
The user is trying to convince you to come with them anyway. Based on your personality (${char.personality_summary || "friendly"}), would you agree to reschedule or join them?

Respond naturally in 1-2 sentences. Either agree reluctantly ("okay fine, let me just...") or politely decline with a reason.`,
      });
      const response = convinceRes?.trim() || "Sorry, I really can't leave right now.";
      const agreed = Math.random() > 0.5;
      if (agreed) {
        setSelectedCharacterIds(prev => prev.includes(busyPopup.charId) ? prev : [...prev, busyPopup.charId]);
        setConvincedCharacterIds(prev => prev.includes(busyPopup.charId) ? prev : [...prev, busyPopup.charId]);
        setBusyPopup(null);
      } else {
        setUnavailablePopup([{
          character: char,
          reason: { iconType: "info", message: response, color: "text-muted-foreground" },
          availableAt: "Maybe ask them later",
        }]);
        setBusyPopup(null);
      }
    } catch (err) {
      console.error('Convince failed:', err);
      setBusyPopup(null);
    } finally {
      setIsConvincing(false);
    }
  };

  const handleWakeUp = async () => {
    if (!wakeUpModal?.pendingCharacterId) return;
    setIsWakingUp(true);
    try {
      const char = travelCompanions.find(c => c.id === wakeUpModal.pendingCharacterId);
      if (!char) return;
      const wakeRes = await base44.functions.invoke('generateWakeUpResponse', {
        characterId: char.id,
        characterData: char,
      });
      if (!wakeRes?.data?.success) throw new Error('Failed to generate wake response');
      const { outcome, moodModifier, prepTimeMs } = wakeRes.data;
      const wakeResponse = wakeRes.data.wakeResponse;
      sessionStorage.setItem(`char_wake_${char.id}`, JSON.stringify({ woken: true, moodModifier, timestamp: Date.now() }));
      setUnavailablePopup([{
        character: char,
        reason: {
          iconType: 'info',
          message: wakeResponse,
          color: outcome === 'refused' ? 'text-amber-400' : 'text-foreground',
        },
        availableAt: outcome === 'refused' ? 'They declined' : `Getting ready... (${Math.ceil(prepTimeMs / 1000)}s)`,
      }]);
      if (outcome !== 'refused') {
        await new Promise(r => setTimeout(r, prepTimeMs));
        setSelectedCharacterIds(prev => prev.includes(char.id) ? prev : [...prev, char.id]);
        setUnavailablePopup(null);
      }
    } catch (err) {
      console.error('Wake-up failed:', err);
      setUnavailablePopup([{
        character: wakeUpModal.character,
        reason: { iconType: 'error', message: 'Failed to wake them up', color: 'text-destructive' },
        availableAt: 'Try again',
      }]);
    } finally {
      setIsWakingUp(false);
      setWakeUpModal(null);
    }
  };

  const handleLeaveAsleep = () => setWakeUpModal(null);

  const handleRealLocationConfirm = async (locationData) => {
    setIsTraveling(true);
    try {
      const res = await base44.functions.invoke('createLocationFromVerified', {
        verifiedLocationId: locationData.verifiedLocationId,
      });
      const locationReferenceId = res?.data?.location_reference_id;
      if (!locationReferenceId) throw new Error('Failed to create location');
      const travelMs = 2000 + Math.random() * 4000;
      await new Promise(r => setTimeout(r, travelMs));
      const params = new URLSearchParams({ locationId: locationReferenceId, characterIds: selectedCharacterIds.join(",") });
      navigate(`/scene?${params.toString()}`);
    } catch (err) {
      console.error('Real location travel failed:', err);
      setUnavailablePopup([{
        character: { id: "real_location", name: locationData.name, avatar_url: null },
        reason: { iconType: "out", message: `Couldn't load ${locationData.name}. Try again.`, color: "text-destructive" },
        availableAt: null,
      }]);
    } finally {
      setIsTraveling(false);
    }
  };

  const handleTravel = async () => {
    if (!selectedLocation) return;
    const isOpen = isLocationActiveNow(selectedLocation);
    if (isOpen === false) {
      const hoursStr = formatOperatingHours(selectedLocation);
      setUnavailablePopup([{
        character: { id: "closed", name: selectedLocation.name, avatar_url: null },
        reason: { iconType: "out", message: `${selectedLocation.name} is closed right now.`, color: "text-amber-400" },
        availableAt: hoursStr ? `Hours: ${hoursStr}` : "Check back later",
      }]);
      return;
    }
    const homeAccess = checkHomeAccess(selectedLocation);
    if (!homeAccess.canVisit) {
      setUnavailablePopup([{
        character: { id: "blocked", name: selectedLocation.name, avatar_url: null },
        reason: { iconType: "out", message: "No one's home right now.", color: "text-amber-400" },
        availableAt: "Come back when they're home",
      }]);
      return;
    }
    const unavailable = selectedCharacterIds
      .filter(id => !convincedCharacterIds.includes(id))
      .map(id => {
        const char = travelCompanions.find(c => c.id === id);
        if (!char) return null;
        const avail = getCharacterTravelAvailability(char, locationMap);
        return avail.available ? null : { character: char, reason: avail.reason, availableAt: avail.availableAt };
      })
      .filter(Boolean);
    if (unavailable.length > 0) { setUnavailablePopup(unavailable); return; }
    setIsTraveling(true);
    const travelMs = 2000 + Math.random() * 6000;
    await new Promise(r => setTimeout(r, travelMs));
    const params = new URLSearchParams({ locationId: selectedLocation.id, characterIds: selectedCharacterIds.join(",") });
    navigate(`/scene?${params.toString()}`);
  };

  const handleSoloTravel = async (locationId) => {
    const location = locationsData.find(l => l.id === locationId);
    if (!location) return;

    const isOpen = isLocationActiveNow(location);
    if (isOpen === false) {
      const hoursStr = formatOperatingHours(location);
      setUnavailablePopup([{
        character: { id: "closed", name: location.name, avatar_url: null },
        reason: { iconType: "out", message: `${location.name} is closed right now.`, color: "text-amber-400" },
        availableAt: hoursStr ? `Hours: ${hoursStr}` : "Check back later",
      }]);
      return;
    }

    setIsTraveling(true);
    const travelMs = 2000 + Math.random() * 4000;
    await new Promise(r => setTimeout(r, travelMs));
    const params = new URLSearchParams({ locationId });
    navigate(`/scene?${params.toString()}`);
  };

  const travelLabel = selectedCharacterIds.length === 0
    ? "Go alone"
    : `Go with ${selectedCharacterIds.length} character${selectedCharacterIds.length > 1 ? "s" : ""}`;

  const sortedLocations = [...locationsData].sort((a, b) => {
    const aHasImages = (a.zones || []).some(z => z.image_urls?.length > 0);
    const bHasImages = (b.zones || []).some(z => z.image_urls?.length > 0);
    if (aHasImages !== bHasImages) return bHasImages ? 1 : -1;
    return (a.name || "").localeCompare(b.name || "");
  });

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 z-10">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-foreground">Travel</h1>
          <p className="text-xs text-muted-foreground">Choose a place, then who's coming</p>
        </div>
        <FixLocationsButton currentUserEmail={currentUser?.email} />
        <button
          onClick={() => setShowMap(!showMap)}
          className={`p-2 rounded-lg transition-colors ${showMap ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
          title="Live Presence Map"
        >
          <Map className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          title="Debug Travel Issues"
        >
          <Wrench className="w-5 h-5" />
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">

        {/* Live Presence Map */}
        <AnimatePresence>
          {showMap && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-2 pb-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live World Map</p>
                <LivePresenceMap
                  locations={locationsData}
                  characters={mapCharacters}
                  onLocationClick={(locationId) => {
                    const loc = locationsData.find(l => l.id === locationId);
                    if (loc) setSelectedLocation(loc);
                  }}
                  onLocationPanelGoHere={handleSoloTravel}
                />
                <p className="text-[10px] text-muted-foreground text-center">Tap a location to select it · Character pins show real-time presence</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Who's coming?</p>
          </div>
          <TravelCharacterSelector
            characters={travelCompanions}
            currentUser={currentUser}
            displayName={displayName}
            selectedIds={selectedCharacterIds}
            locationMap={locationMap}
            onToggle={toggleCharacter}
          />
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Search or select location:</p>
          <input
            type="text"
            placeholder="Type location name..."
            className="w-full px-4 py-2 rounded-xl bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground text-sm"
            onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
            onInput={(e) => {
              const searchTerm = e.target.value.toLowerCase();
              if (searchTerm) {
                const filtered = sortedLocations.filter(l => l.name.toLowerCase().includes(searchTerm));
                if (filtered.length > 0) setSelectedLocation(filtered[0]);
              }
            }}
          />
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Where are you going?</p>
          <TravelLocationGrid
            locations={sortedLocations}
            selectedLocation={selectedLocation}
            onSelect={setSelectedLocation}
            characters={mapCharacters}
          />
          <Button onClick={() => setShowRealLocationModal(true)} variant="outline" size="sm" className="w-full rounded-xl gap-2">
            <Plus className="w-4 h-4" />
            Visit a Real Location
          </Button>
        </div>

        <AnimatePresence>
          {selectedLocation && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="sticky bottom-24 pb-2"
            >
              <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <MapPin className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selectedLocation.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {selectedCharacterIds.length === 0 ? "Going alone" : `${selectedCharacterIds.length + 1} people`}
                    </p>
                  </div>
                </div>
                {(() => {
                  const homeAccess = checkHomeAccess(selectedLocation);
                  const isHome = selectedLocation.category === "home";
                  const isClosed = isLocationActiveNow(selectedLocation) === false;

                  if (isClosed) {
                    return (
                      <div className="text-center py-1">
                        <p className="text-xs text-amber-400">{selectedLocation.name} is currently closed.</p>
                      </div>
                    );
                  }

                  // Use unified resolver — same source as map pins and counts
                  const presentHere = getPresenceAtLocation(selectedLocation, allPresenceEntities);
                  const lines = [];

                  presentHere.forEach(entity => {
                    const name = entity.display_name;
                    if (lines.find(l => l.name === name)) return;
                    let status = entity.resolved_presence_status || (isHome ? 'home' : 'here');
                    let color = isHome ? 'text-green-400' : 'text-blue-400';
                    if (status === 'visiting') { color = 'text-amber-400'; }
                    if (status === 'home') { color = 'text-green-400'; }

                    // Annotate workers on shift
                    if (!isHome && entity.resolved_current_location_id === selectedLocation.id) {
                      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
                      const dayOfWeek = nowET.getDay();
                      const currentTime = `${String(nowET.getHours()).padStart(2, '0')}:${String(nowET.getMinutes()).padStart(2, '0')}`;
                      const workerShifts = selectedLocation.worker_shifts || {};
                      const shift = workerShifts[entity.id];
                      if (shift && shift.days?.includes(dayOfWeek) && currentTime >= shift.start && currentTime <= shift.end) {
                        status = 'working';
                        color = 'text-purple-400';
                      }
                    }

                    lines.push({ name, status, color });
                  });

                  const presenceSummary = lines.length > 0 ? (
                    <div className={lines.length > 4 ? "grid grid-cols-2 gap-x-3 gap-y-0.5" : "space-y-0.5"}>
                      {lines.map((l, i) => (
                        <p key={i} className="text-xs truncate">
                          <span className="text-foreground font-medium">{l.name}</span>
                          <span className={`ml-1 ${l.color}`}>is {l.status}</span>
                        </p>
                      ))}
                    </div>
                  ) : null;

                  // VGC Towers: show how many residents are out
                  let vgcTowersNote = null;
                  if (isHome && vgcTowers && selectedLocation.id === vgcTowers.id && vgcTowersResidents.length > 0) {
                    const residentsAway = vgcTowersResidents.filter(r => r.is_away).length;
                    if (residentsAway > 0) {
                      vgcTowersNote = (
                        <p className="text-xs text-amber-400 mt-2">
                          {residentsAway} resident{residentsAway > 1 ? 's' : ''} out traveling
                        </p>
                      );
                    }
                  }

                  if (isHome && !homeAccess.canVisit) {
                    return (
                      <div className="space-y-2">
                        {presenceSummary}
                        <div className="text-center py-1">
                          <p className="text-xs text-amber-400">Nobody's home right now. Come back later.</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <>
                      {presenceSummary}
                      {vgcTowersNote}
                      <Button onClick={handleTravel} disabled={isTraveling} className="w-full h-12 rounded-xl gap-2">
                        <Navigation className="w-4 h-4" />
                        {isTraveling ? "Traveling..." : travelLabel}
                      </Button>
                      {isTraveling && <p className="text-xs text-muted-foreground text-center animate-pulse">On your way to {selectedLocation.name}...</p>}
                    </>
                  );
                })()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {locationsData.length === 0 && (
          <div className="text-center py-12 space-y-3">
            <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto" />
            <p className="text-sm font-medium text-foreground">No locations yet</p>
            <p className="text-xs text-muted-foreground">Add locations in the Places tab first.</p>
            <Link to="/locations">
              <Button variant="outline" size="sm" className="rounded-xl mt-2">Go to Places</Button>
            </Link>
          </div>
        )}
      </div>

      <AnimatePresence>
        {unavailablePopup && (
          <CharacterAvailabilityPopup
            unavailable={unavailablePopup}
            onClose={() => setUnavailablePopup(null)}
          />
        )}
      </AnimatePresence>

      <BusyCharacterPopup
        isOpen={!!busyPopup}
        character={busyPopup?.character}
        busyReason={busyPopup?.reason}
        onConvince={handleConvinceCharacter}
        onClose={() => setBusyPopup(null)}
        isProcessing={isConvincing}
      />

      <WakeUpModal
        isOpen={!!wakeUpModal}
        onClose={handleLeaveAsleep}
        character={wakeUpModal?.character}
        wakeTime={wakeUpModal?.character?.wake_up_time}
        onLeaveAsleep={handleLeaveAsleep}
        onWakeUp={handleWakeUp}
        isProcessing={isWakingUp}
      />

      <RealLocationModal
        isOpen={showRealLocationModal}
        onClose={() => setShowRealLocationModal(false)}
        onConfirm={(locationData) => {
          setShowRealLocationModal(false);
          handleRealLocationConfirm(locationData);
        }}
      />

      <BottomNav />

      <AnimatePresence>
        {showDebug && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-28 right-4 w-80 max-h-96 bg-card border border-border rounded-xl shadow-lg overflow-y-auto z-40 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Debug Info</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setIsDistributing(true);
                    setDistributeResult(null);
                    try {
                      const res = await base44.functions.invoke('distributeVGCTowersNPCs', {});
                      setDistributeResult(res?.data || { error: 'No response' });
                      // Refetch characters so UI reflects new locations immediately
                      await queryClient.invalidateQueries({ queryKey: ['npcCharacters', currentUser?.id] });
                      await queryClient.invalidateQueries({ queryKey: ['activeCharacters', currentUser?.email] });
                      await queryClient.invalidateQueries({ queryKey: ['npcFamilyMembers', currentUser?.email] });
                      await queryClient.invalidateQueries({ queryKey: ['npcFamilyMembersByOwner', currentUser?.email] });
                    } catch (e) {
                      setDistributeResult({ error: e.message });
                    } finally {
                      setIsDistributing(false);
                    }
                  }}
                  disabled={isDistributing}
                  className="text-xs px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
                >
                  {isDistributing ? 'Running...' : 'Distribute NPCs'}
                </button>
                <button onClick={() => setShowDebug(false)} className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
            </div>

            {distributeResult && (
              <div className={`text-[10px] rounded-lg p-2 space-y-1 ${distributeResult.error ? 'bg-destructive/10 border border-destructive/30' : 'bg-green-500/10 border border-green-500/30'}`}>
                {distributeResult.error ? (
                  <p className="text-destructive font-medium">Error: {distributeResult.error}</p>
                ) : (
                  <>
                    <p className="text-green-400 font-semibold">✓ {distributeResult.distributed}/{distributeResult.totalVGCResidents} NPCs moved — UI refreshed</p>
                    {distributeResult.finalNPCStates?.map((s, i) => (
                      <p key={i} className={`truncate ${s.flag === 'NOWHERE_FIX' ? 'text-amber-400' : 'text-muted-foreground'}`}>
                        • {s.name} → <span className="text-blue-400">{s.location}</span>
                      </p>
                    ))}
                    {distributeResult.ineligible?.length > 0 && (
                      <p className="text-amber-400 mt-1">Ineligible: {distributeResult.ineligible.map(x => `${x.name} (${x.reason})`).join(', ')}</p>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="space-y-1 text-xs">
              <p className="font-medium text-muted-foreground">Locations: {locationsData.length}</p>
              {locationsData.map(l => (
                <div key={l.id} className="text-[10px] text-muted-foreground/70 truncate">• {l.name} (id: {l.id.slice(0, 8)})</div>
              ))}
            </div>
            <div className="space-y-1 text-xs border-t border-border pt-2">
              <p className="font-medium text-muted-foreground">Active Characters: {activeCharacters.length}</p>
              {[...activeCharacters].sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || '')).map(c => (
                  <div key={c.id} className="text-[10px] text-muted-foreground/70">
                    • {c.name}: {c.resolved_current_location_name || "unknown"}
                  </div>
                ))}
            </div>
            <div className="space-y-1 text-xs border-t border-border pt-2">
              <p className="font-medium text-muted-foreground">NPC Fictitious: {npcCharacters.length} · Family: {npcFamilyMembers.length}</p>
              {[...npcCharacters, ...npcFamilyMembers].sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || '')).map(c => (
                <div key={c.id} className="text-[10px]">
                  <span className={c.character_type === 'npc_family_member' ? 'text-purple-400/70' : 'text-muted-foreground/70'}>• {c.name} ({c.character_type}):</span>
                  {c.resolved_current_location_name ? (
                    <span className="text-blue-400"> {c.resolved_current_location_name}</span>
                  ) : c.current_home_location_id ? (
                    <span className="text-amber-400"> home ({locationMap[c.current_home_location_id]?.name || c.current_home_location_id.slice(0, 8)})</span>
                  ) : (
                    <span className="text-red-400"> [NO LOCATION]</span>
                  )}
                </div>
              ))}
              {npcCharacters.length === 0 && npcFamilyMembers.length === 0 && (
                <p className="text-[10px] text-muted-foreground/50">No NPC or family characters found</p>
              )}
            </div>
            <div className="space-y-1 text-xs border-t border-border pt-2">
              <p className="font-medium text-muted-foreground">Unified Presence: {allPresenceEntities.length} total · {allPresenceEntities.filter(e => e.is_currently_present).length} present</p>
              {allPresenceEntities.filter(e => e.effective_presence_type === 'npc_family_member').map(e => (
                <div key={e.id} className="text-[10px]">
                  <span className="text-purple-400/70">• {e.display_name} (family):</span>
                  <span className={e.is_currently_present ? 'text-green-400' : 'text-red-400'}> {e.resolved_current_location_name || '[no location]'}</span>
                  {e.source_type === 'internal_family' && <span className="text-muted-foreground/50"> [internal]</span>}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}