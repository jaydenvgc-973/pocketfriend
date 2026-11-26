import React, { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import LivePresenceMap from "@/components/travel/LivePresenceMap";
import { ensureLocationsMapped } from "@/lib/mapCoordinates";

/**
 * PhoneMapApp — the existing Travel Live Presence Map, shown inside the phone.
 *
 * It is the same map component Travel renders, fed the same account locations and the same
 * authoritative character presence. Nothing here is a second map: no separate location data,
 * no separate refresh, and opening it moves nobody.
 *
 * The map is shown AT ONCE. Its pins are positioned from the locations it is given
 * (the map derives each building's position from the location's own category), so it never
 * waits on anything. Saving coordinates is background housekeeping and must never hold the
 * map back — a phone that sits blank while that runs is a broken phone.
 */
export default function PhoneMapApp({ locations = [], characters = [], allCharacters = [], ownerEmail, onBack }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const saveLocation = async (id, updates) => { await base44.entities.LocationReference.update(id, updates); };
    ensureLocationsMapped(locations, saveLocation)
      .then(() => { if (ownerEmail) queryClient.invalidateQueries({ queryKey: ["locationReferences", ownerEmail] }); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-3 py-2 text-white/90">
        <button onClick={onBack} className="p-1 rounded-full hover:bg-white/10"><ChevronLeft className="w-4 h-4" /></button>
        <MapPin className="w-3.5 h-3.5" />
        <span className="text-[11px] font-semibold">Map</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2 text-foreground">
        <LivePresenceMap locations={locations} characters={characters} allCharacters={allCharacters} />
      </div>
    </div>
  );
}