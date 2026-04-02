import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, MapPin, Check, User, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import CharacterAvailabilityPopup from "@/components/travel/CharacterAvailabilityPopup";
import { getCharacterTravelAvailability } from "@/lib/travelAvailability";

const CATEGORY_EMOJI = {
  home: "🏠", workplace: "💼", gym: "🏋️", food_drink: "🍽️",
  outdoor: "🌳", social: "🍸", medical: "🏥", school: "🏫",
  grocery: "🛒", religion: "🛐", business: "🏢", government: "🏛️",
  public: "🗺️", generic: "📍",
};

export default function Travel() {
  const navigate = useNavigate();
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [selectedCharIds, setSelectedCharIds] = useState(new Set());
  const [unavailablePopup, setUnavailablePopup] = useState(null); // [{ character, reason, availableAt }]
  const [isTraveling, setIsTraveling] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });
  const userSettings = settings[0] || {};

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ created_by: currentUser.email, status: "active" }),
    enabled: !!currentUser?.email,
  });

  const { data: locationsRaw = [] } = useQuery({
    queryKey: ["locationReferences", currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
  });

  const locationMap = Object.fromEntries(locationsRaw.map(l => [l.id, l]));

  // Filter out workplaces/schools (not travel destinations)
  const travelableLocations = locationsRaw.filter(l =>
    !['workplace', 'school', 'education', 'business', 'government'].includes(l.category)
  );

  const toggleCharacter = (charId) => {
    const char = characters.find(c => c.id === charId);
    if (!char) return;

    // Check availability before selecting
    const avail = getCharacterTravelAvailability(char, locationMap);
    if (!avail.available) {
      setUnavailablePopup([{ character: char, reason: avail.reason, availableAt: avail.availableAt }]);
      return;
    }

    setSelectedCharIds(prev => {
      const next = new Set(prev);
      if (next.has(charId)) next.delete(charId);
      else next.add(charId);
      return next;
    });
  };

  const handleTravel = () => {
    if (!selectedLocation) return;

    // Validate all selected characters are still available
    const unavailableNow = [];
    for (const charId of selectedCharIds) {
      const char = characters.find(c => c.id === charId);
      if (!char) continue;
      const avail = getCharacterTravelAvailability(char, locationMap);
      if (!avail.available) {
        unavailableNow.push({ character: char, reason: avail.reason, availableAt: avail.availableAt });
      }
    }

    if (unavailableNow.length > 0) {
      setUnavailablePopup(unavailableNow);
      return;
    }

    // All good — go to scene
    setIsTraveling(true);
    const params = new URLSearchParams({
      locationId: selectedLocation.id,
      characterIds: Array.from(selectedCharIds).join(","),
    });
    setTimeout(() => {
      navigate(`/scene?${params.toString()}`);
    }, 800);
  };

  const userDisplayName = userSettings.fictional_world_name || currentUser?.full_name || "You";
  const userAvatarUrl = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 z-10">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-foreground">Travel</h1>
          <p className="text-xs text-muted-foreground">Choose where to go</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {/* LOCATION GRID */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Locations</p>
          {travelableLocations.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <MapPin className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">No locations yet</p>
              <Link to="/locations">
                <Button variant="outline" size="sm" className="rounded-xl mt-2">Add Locations</Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {travelableLocations.map(loc => {
                const isSelected = selectedLocation?.id === loc.id;
                const firstImage = loc.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0] || null;
                const emoji = CATEGORY_EMOJI[loc.category] || "📍";
                return (
                  <motion.button
                    key={loc.id}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setSelectedLocation(isSelected ? null : loc)}
                    className={`relative aspect-square rounded-2xl overflow-hidden border-2 transition-all ${
                      isSelected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
                    }`}
                  >
                    {firstImage ? (
                      <img src={firstImage} alt={loc.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-secondary flex items-center justify-center">
                        <span className="text-3xl">{emoji}</span>
                      </div>
                    )}
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    <p className="absolute bottom-1.5 left-0 right-0 text-center text-[10px] font-medium text-white px-1 leading-tight truncate">
                      {loc.name}
                    </p>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        {/* CHARACTER SELECTION — appears after location picked */}
        <AnimatePresence>
          {selectedLocation && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="space-y-3"
            >
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Who's coming?</p>
                <p className="text-xs text-muted-foreground">Going to <span className="font-medium text-foreground">{selectedLocation.name}</span></p>
              </div>

              {/* USER always first */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedCharIds(prev => {
                  const next = new Set(prev);
                  if (next.has("__user__")) next.delete("__user__");
                  else next.add("__user__");
                  return next;
                })}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all ${
                  selectedCharIds.has("__user__") ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {userAvatarUrl
                    ? <img src={userAvatarUrl} alt={userDisplayName} className="w-full h-full object-cover" />
                    : <User className="w-5 h-5 text-primary" />
                  }
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{userDisplayName}</p>
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">You</span>
                  </div>
                  <p className="text-xs text-emerald-400">Available</p>
                </div>
                {selectedCharIds.has("__user__") && (
                  <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </motion.button>

              {/* CHARACTERS */}
              {characters.map(char => {
                const avail = getCharacterTravelAvailability(char, locationMap);
                const isSelected = selectedCharIds.has(char.id);
                return (
                  <motion.button
                    key={char.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => toggleCharacter(char.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all ${
                      !avail.available
                        ? "border-border bg-card opacity-70"
                        : isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="relative w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {char.avatar_url
                        ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                        : <span className="text-sm font-bold text-primary">{char.name?.[0]}</span>
                      }
                      {!avail.available && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <span className="text-lg">🔒</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{char.name}</p>
                      {avail.available ? (
                        <p className="text-xs text-emerald-400">Available</p>
                      ) : (
                        <p className={`text-xs ${avail.reason?.color || "text-muted-foreground"} truncate`}>
                          {avail.reason?.message?.replace(`${char.name} `, "") || "Unavailable"}
                        </p>
                      )}
                    </div>
                    {avail.available && isSelected && (
                      <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    {!avail.available && avail.availableAt && (
                      <p className="text-[10px] text-muted-foreground flex-shrink-0 max-w-[80px] text-right leading-tight">{avail.availableAt}</p>
                    )}
                  </motion.button>
                );
              })}

              {/* TRAVEL BUTTON */}
              <div className="pt-2">
                <Button
                  onClick={handleTravel}
                  disabled={selectedCharIds.size === 0 || isTraveling}
                  className="w-full h-12 rounded-2xl gap-2 text-base font-semibold"
                >
                  <Navigation className="w-5 h-5" />
                  {isTraveling ? "Heading there..." : `Go to ${selectedLocation.name}`}
                </Button>
                {selectedCharIds.size === 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-2">Select at least one person going</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Unavailable popup */}
      <AnimatePresence>
        {unavailablePopup && (
          <CharacterAvailabilityPopup
            unavailable={unavailablePopup}
            onClose={() => setUnavailablePopup(null)}
          />
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}