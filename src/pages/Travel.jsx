import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, MapPin, Users, Navigation } from "lucide-react";
import { toDisplay12h } from "@/lib/timeFormat";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import TravelLocationGrid from "@/components/travel/TravelLocationGrid";
import TravelCharacterSelector from "@/components/travel/TravelCharacterSelector";
import CharacterAvailabilityPopup from "@/components/travel/CharacterAvailabilityPopup";
import BusyCharacterPopup from "@/components/travel/BusyCharacterPopup";
import WakeUpModal from "@/components/travel/WakeUpModal";
import { getCharacterTravelAvailability, isCharacterHome } from "@/lib/travelAvailability";
import { isLocationActiveNow, isCharacterAtWork } from "@/lib/workScheduleUtils";
import { isCharacterAsleep } from "@/lib/sleepUtils";

export default function Travel() {
  const navigate = useNavigate();
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState([]);
  const [convincedCharacterIds, setConvincedCharacterIds] = useState([]); // chars who agreed despite being busy
  const [unavailablePopup, setUnavailablePopup] = useState(null); // array of { character, reason, availableAt }
  const [busyPopup, setBusyPopup] = useState(null); // { character, reason, charId }
  const [isTraveling, setIsTraveling] = useState(false);
  const [isConvincing, setIsConvincing] = useState(false);
  const [wakeUpModal, setWakeUpModal] = useState(null); // { character, pendingCharacterId }
  const [isWakingUp, setIsWakingUp] = useState(false);

  const { data: currentUser = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: settingsList = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ created_by: currentUser.email, status: "active" }),
    enabled: !!currentUser?.email,
  });

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
  const displayName = settings.fictional_world_name || currentUser?.full_name || "You";

  /**
   * Format operating hours for a location into a human-readable string.
   */
  const formatOperatingHours = (location) => {
    const hours = location?.operating_hours;
    if (!hours || hours.length === 0) return null;
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const fmt = (t) => toDisplay12h(t);
    // Group days with same hours
    const unique = hours.map(w => `${fmt(w.open_time)} – ${fmt(w.close_time)}`);
    const first = unique[0];
    const allSame = unique.every(u => u === first);
    if (allSame) return first;
    return hours.map(w => `${w.day_of_week != null ? dayNames[w.day_of_week] + " " : ""}${fmt(w.open_time)} – ${fmt(w.close_time)}`).join(", ");
  };

  /**
   * For a given location, check if we're allowed to visit it.
   * Returns:
   *   { canVisit, activeResidents (all), homeResidents (home now), awayResidents (away now), npcResidents, blockedBy }
   */
  const checkHomeAccess = (location) => {
    if (!location || location.category !== "home") {
      return { canVisit: true, blockedBy: null, activeResidents: [], homeResidents: [], awayResidents: [], npcResidents: [] };
    }

    // Active characters who live here
    const activeResidents = characters.filter(c => location.resident_character_ids?.includes(c.id));
    const homeResidents = activeResidents.filter(c => isCharacterHome(c, locationMap));
    const awayResidents = activeResidents.filter(c => !isCharacterHome(c, locationMap));

    // NPC residents actually listed ON the location record
    const npcResidents = location.resident_family_members || [];

    // Can visit if any active resident is home OR there are NPC residents listed on this location
    const canVisit = homeResidents.length > 0 || npcResidents.length > 0;

    // If no one at all lives here, always allow entry
    if (activeResidents.length === 0 && npcResidents.length === 0) {
      return { canVisit: true, blockedBy: null, activeResidents: [], homeResidents: [], awayResidents: [], npcResidents: [] };
    }

    return {
      canVisit,
      blockedBy: !canVisit ? awayResidents[0] : null,
      activeResidents,
      homeResidents,
      awayResidents,
      npcResidents,
    };
  };

  const toggleCharacter = (charId) => {
    const char = characters.find(c => c.id === charId);
    if (!char) return;

    // Check if character is asleep — offer wake-up option instead of blocking
    if (isCharacterAsleep(char)) {
      setWakeUpModal({ character: char, pendingCharacterId: charId });
      return;
    }

    const availability = getCharacterTravelAvailability(char, locationMap);
    if (!availability.available) {
      // If they're busy (not unavailable due to other reasons), show convince popup
      if (availability.isBusy) {
        setBusyPopup({ character: char, reason: availability.reason, charId });
        return;
      }
      // Otherwise show unavailable popup
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
      // Call LLM to generate convince response
      const char = characters.find(c => c.id === busyPopup.charId);
      if (!char) return;

      const convinceRes = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${char.name}. You are currently busy: ${busyPopup.reason}.
The user is trying to convince you to come with them anyway. Based on your personality (${char.personality_summary || "friendly"}), would you agree to reschedule or join them?

Respond naturally in 1-2 sentences. Either agree reluctantly ("okay fine, let me just...") or politely decline with a reason.`,
      });

      const response = convinceRes?.trim() || "Sorry, I really can't leave right now.";
      
      // 50/50 chance they agree
      const agreed = Math.random() > 0.5;

      if (agreed) {
        setSelectedCharacterIds(prev =>
          prev.includes(busyPopup.charId) ? prev : [...prev, busyPopup.charId]
        );
        setConvincedCharacterIds(prev =>
          prev.includes(busyPopup.charId) ? prev : [...prev, busyPopup.charId]
        );
        setBusyPopup(null);
      } else {
        // Show their response
        setUnavailablePopup([{
          character: char,
          reason: {
            iconType: "info",
            message: response,
            color: "text-muted-foreground",
          },
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
      const char = characters.find(c => c.id === wakeUpModal.pendingCharacterId);
      if (!char) return;

      // Generate personality-based wake response
      const wakeRes = await base44.functions.invoke('generateWakeUpResponse', {
        characterId: char.id,
        characterData: char,
      });

      if (!wakeRes?.data?.success) {
        throw new Error('Failed to generate wake response');
      }

      const { outcome, moodModifier, prepTimeMs } = wakeRes.data;
      const wakeResponse = wakeRes.data.wakeResponse;

      // Store wake context temporarily for venue interaction
      sessionStorage.setItem(`char_wake_${char.id}`, JSON.stringify({
        woken: true,
        moodModifier,
        timestamp: Date.now(),
      }));

      // Show the wake response
      setUnavailablePopup([{
        character: char,
        reason: {
          iconType: 'info',
          message: wakeResponse,
          color: outcome === 'refused' ? 'text-amber-400' : 'text-foreground',
        },
        availableAt: outcome === 'refused' ? 'They declined' : `Getting ready... (${Math.ceil(prepTimeMs / 1000)}s)`,
      }]);

      // If they agreed or are negotiating, add them after prep time
      if (outcome !== 'refused') {
        await new Promise(r => setTimeout(r, prepTimeMs));
        setSelectedCharacterIds(prev =>
          prev.includes(char.id) ? prev : [...prev, char.id]
        );
        setUnavailablePopup(null);
      }
    } catch (err) {
      console.error('Wake-up failed:', err);
      setUnavailablePopup([{
        character: wakeUpModal.character,
        reason: {
          iconType: 'error',
          message: 'Failed to wake them up',
          color: 'text-destructive',
        },
        availableAt: 'Try again',
      }]);
    } finally {
      setIsWakingUp(false);
      setWakeUpModal(null);
    }
  };

  const handleLeaveAsleep = () => {
    setWakeUpModal(null);
  };

  const handleTravel = async () => {
    if (!selectedLocation) return;

    // Check if the venue is currently closed (only for locations with defined hours)
    const isOpen = isLocationActiveNow(selectedLocation);
    if (isOpen === false) {
      const hoursStr = formatOperatingHours(selectedLocation);
      setUnavailablePopup([{
        character: { id: "closed", name: selectedLocation.name, avatar_url: null },
        reason: {
          iconType: "out",
          message: `${selectedLocation.name} is closed right now.`,
          color: "text-amber-400",
        },
        availableAt: hoursStr ? `Hours: ${hoursStr}` : "Check back later",
      }]);
      return;
    }

    // Check home access
    const homeAccess = checkHomeAccess(selectedLocation);
    if (!homeAccess.canVisit) {
      const awayNames = homeAccess.awayResidents.map(c => c.name).join(", ") || homeAccess.blockedBy?.name || "Everyone";
      setUnavailablePopup([{
        character: homeAccess.blockedBy || { id: "blocked", name: selectedLocation.name, avatar_url: null },
        reason: { iconType: "out", message: `${awayNames} ${homeAccess.awayResidents.length === 1 ? "isn't" : "aren't"} home right now.`, color: "text-amber-400" },
        availableAt: "Come back when they're home",
      }]);
      return;
    }

    // Validate selected characters — skip ones who were already convinced
    const unavailable = selectedCharacterIds
      .filter(id => !convincedCharacterIds.includes(id))
      .map(id => {
        const char = characters.find(c => c.id === id);
        if (!char) return null;
        const avail = getCharacterTravelAvailability(char, locationMap);
        return avail.available ? null : { character: char, reason: avail.reason, availableAt: avail.availableAt };
      })
      .filter(Boolean);

    if (unavailable.length > 0) {
      setUnavailablePopup(unavailable);
      return;
    }

    setIsTraveling(true);

    // Travel takes realistic time: 2–8 seconds simulated delay
    const travelMs = 2000 + Math.random() * 6000;
    await new Promise(r => setTimeout(r, travelMs));

    // Navigate to scene page with location + characters
    const params = new URLSearchParams({
      locationId: selectedLocation.id,
      characterIds: selectedCharacterIds.join(","),
    });
    navigate(`/scene?${params.toString()}`);
  };

  const travelLabel = selectedCharacterIds.length === 0
    ? "Go alone"
    : `Go with ${selectedCharacterIds.length} character${selectedCharacterIds.length > 1 ? "s" : ""}`;

  // Sort locations: those with images first (alphabetically), then those without images (alphabetically)
  const sortedLocations = [...locationsData].sort((a, b) => {
    const aHasImages = (a.zones || []).some(z => z.image_urls?.length > 0);
    const bHasImages = (b.zones || []).some(z => z.image_urls?.length > 0);

    if (aHasImages !== bHasImages) {
      return bHasImages ? 1 : -1; // images first
    }
    return (a.name || "").localeCompare(b.name || ""); // alphabetically within each group
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
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
         {/* Character selection */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Who's coming?</p>
                  </div>
                  <TravelCharacterSelector
                    characters={characters}
                    currentUser={currentUser}
                    displayName={displayName}
                    selectedIds={selectedCharacterIds}
                    locationMap={locationMap}
                    onToggle={toggleCharacter}
                  />
                </div>

                {/* Travel location search textbox - must activate on first tap */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Search or select location:</p>
                  <input
                    type="text"
                    placeholder="Type location name..."
                    className="w-full px-4 py-2 rounded-xl bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground text-sm"
                    onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                    onInput={(e) => {
                      // Filter locations based on search input
                      const searchTerm = e.target.value.toLowerCase();
                      if (searchTerm) {
                        const filtered = sortedLocations.filter(l => 
                          l.name.toLowerCase().includes(searchTerm)
                        );
                        if (filtered.length > 0) {
                          setSelectedLocation(filtered[0]);
                        }
                      }
                    }}
                  />
                </div>

         {/* Location grid */}
         <div>
           <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Where are you going?</p>
           <TravelLocationGrid
             locations={sortedLocations}
             selectedLocation={selectedLocation}
             onSelect={setSelectedLocation}
             activeCharacterIds={characters.map(c => c.id)}
             charactersByLocationId={characters.reduce((acc, c) => {
               const locId = c.current_location_id;
               if (locId) { acc[locId] = acc[locId] || []; acc[locId].push(c.name); }
               return acc;
             }, {})}
           />
         </div>

        {/* Travel button */}
        <AnimatePresence>
          {selectedLocation && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="sticky bottom-20 pb-2"
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

                  // If closed, show nothing about who's there — just the closed notice
                  if (isClosed) {
                    return (
                      <div className="text-center py-1">
                        <p className="text-xs text-amber-400">{selectedLocation.name} is currently closed.</p>
                      </div>
                    );
                  }

                  // Build presence summary
                  const lines = [];

                  if (isHome) {
                    homeAccess.homeResidents.forEach(c => lines.push({ name: c.name, status: "home", color: "text-green-400" }));
                    homeAccess.awayResidents.forEach(c => lines.push({ name: c.name, status: "not home", color: "text-amber-400" }));
                    (selectedLocation.resident_family_members || []).forEach(n => {
                      if (n.name) lines.push({ name: n.name, status: "home", color: "text-green-400" });
                    });
                  } else {
                    // Active characters on shift here
                    characters
                      .filter(c => selectedLocation.worker_character_ids?.includes(c.id) && isCharacterAtWork(c, selectedLocation))
                      .forEach(c => lines.push({ name: c.name, status: "working", color: "text-blue-400" }));

                    // NPC workers (keyed by npc_ prefix in worker_job_titles)
                    const realCharIds = new Set(characters.map(c => c.id));
                    Object.entries(selectedLocation.worker_job_titles || {}).forEach(([key, jobTitle]) => {
                      if (!realCharIds.has(key) && key.startsWith("npc_")) {
                        const npcName = key.replace(/^npc_/, "").replace(/_/g, " ");
                        lines.push({ name: npcName, status: jobTitle || "working", color: "text-blue-400" });
                      }
                    });
                  }

                  const presenceSummary = lines.length > 0 ? (
                    <div className="space-y-0.5">
                      {lines.map((l, i) => (
                        <p key={i} className="text-xs">
                          <span className="text-foreground font-medium">{l.name}</span>
                          <span className={`ml-1 ${l.color}`}>is {l.status}</span>
                        </p>
                      ))}
                    </div>
                  ) : null;

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

      <BottomNav />
    </div>
  );
}