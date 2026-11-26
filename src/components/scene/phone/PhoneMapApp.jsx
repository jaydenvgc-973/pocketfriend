import React, { useEffect, useState } from "react";
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
 */
export default function PhoneMapApp({ locations = [], characters = [], allCharacters = [], ownerEmail, onBack }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Coordinates are assigned exactly as the Travel page does when its map opens.
    const saveLocation = async (id, updates) => { await base44.entities.LocationReference.update(id, updates); };
    ensureLocationsMapped(locations, saveLocation)
      .then(() => { if (ownerEmail) queryClient.invalidateQueries({ queryKey: ["locationReferences", ownerEmail] }); })
      .catch(() => {})
      .finally(() => setReady(true));
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
        {ready && <LivePresenceMap locations={locations} characters={characters} allCharacters={allCharacters} />}
      </div>
    </div>
  );
}