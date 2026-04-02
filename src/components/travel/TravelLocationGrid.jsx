import { MapPin } from "lucide-react";

const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "💼", school: "🏫", gym: "🏋️", grocery: "🛒",
  religion: "🛐", food_drink: "🍽️", outdoor: "🌳", social: "🍸",
  medical: "🏨", business: "🏢", government: "🏛️", public: "🗺️", generic: "📍",
};

export default function TravelLocationGrid({ locations, selectedLocation, onSelect }) {
  if (locations.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      {locations.map(loc => {
        const isSelected = selectedLocation?.id === loc.id;
        const firstImage = loc.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0]
          || loc.image_urls?.[0]
          || null;
        const emoji = CATEGORY_EMOJIS[loc.category] || "📍";
        const occupants = loc.resident_character_names || [];

        return (
          <button
            key={loc.id}
            onClick={() => onSelect(isSelected ? null : loc)}
            className={`relative rounded-2xl overflow-hidden aspect-square border-2 transition-all ${
              isSelected ? "border-primary shadow-lg shadow-primary/20" : "border-transparent"
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
              {occupants.length > 0 && (
                <p className="text-[10px] text-white/70 truncate">{occupants.slice(0, 2).join(", ")}</p>
              )}
            </div>

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