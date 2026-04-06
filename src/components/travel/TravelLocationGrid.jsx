import { MapPin } from "lucide-react";
import { isLocationActiveNow } from "@/lib/workScheduleUtils";

const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "💼", school: "🏫", gym: "🏋️", grocery: "🛒",
  religion: "🛐", food_drink: "🍽️", outdoor: "🌳", social: "🍸",
  medical: "🏨", business: "🏢", government: "🏛️", public: "🗺️", generic: "📍",
};

export default function TravelLocationGrid({ locations, selectedLocation, onSelect, activeCharacterIds = [], charactersByLocationId = {} }) {
  if (locations.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      {locations.map(loc => {
        const isSelected = selectedLocation?.id === loc.id;
        const firstImage = loc.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0]
          || loc.image_urls?.[0]
          || null;
        const emoji = CATEGORY_EMOJIS[loc.category] || "📍";
        const openStatus = isLocationActiveNow(loc); // true = open, false = closed, null = no hours
        const isClosed = openStatus === false;

        // Active character residents
        const residentIds = loc.resident_character_ids || [];
        const residentNames = loc.resident_character_names || [];
        const activeResidentIds = residentIds.filter(id => activeCharacterIds.includes(id));
        const hasActiveResidents = activeResidentIds.length > 0;
        const occupants = hasActiveResidents
          ? residentIds.reduce((acc, id, i) => {
              if (activeCharacterIds.includes(id) && residentNames[i]) acc.push(residentNames[i]);
              return acc;
            }, [])
          : [];

        // NPC/family residents listed directly on the location
        const npcResidents = (loc.resident_family_members || []).map(n => n.name).filter(Boolean);

        // Combined: active character residents + NPC residents
        const allOccupants = [...occupants, ...npcResidents];
        const isVacant = loc.category === 'home' && residentIds.length === 0 && npcResidents.length === 0;

        // For non-home locations, show characters currently there via current_location_id
        const currentlyHere = charactersByLocationId[loc.id] || [];

        return (
          <button
            key={loc.id}
            onClick={() => onSelect(isSelected ? null : loc)}
            className={`relative rounded-2xl overflow-hidden aspect-square border-2 transition-all ${
              isSelected ? "border-primary shadow-lg shadow-primary/20" : isClosed ? "border-transparent opacity-60" : "border-transparent"
            }`}
          >
            {/* Background image or fallback */}
            {firstImage ? (
              <img src={firstImage} alt={loc.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-secondary flex items-center justify-center">
                <span className="text-4xl">{emoji}</span>
              </div>
            )}

            {/* Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

            {/* Name */}
            <div className="absolute bottom-0 left-0 right-0 p-2.5">
              <p className="text-xs font-semibold text-white leading-tight truncate">{loc.name}</p>
              {allOccupants.length > 0 ? (
                <p className="text-[10px] text-white/70 truncate">{allOccupants.slice(0, 2).join(", ")}</p>
              ) : currentlyHere.length > 0 ? (
                <p className="text-[10px] text-white/70 truncate">{currentlyHere.slice(0, 2).join(", ")}</p>
              ) : isVacant ? (
                <p className="text-[10px] text-white/40 italic">Vacant</p>
              ) : null}
            </div>

            {/* Closed badge */}
            {isClosed && (
              <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded-full">
                <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">Closed</span>
              </div>
            )}

            {/* Selected checkmark */}
            {isSelected && (
              <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                <span className="text-white text-xs font-bold">✓</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}