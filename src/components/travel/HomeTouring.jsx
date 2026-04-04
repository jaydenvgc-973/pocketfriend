import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

const DEFAULT_ZONES = [
  { zone_name: "Front Exterior", zone_description: "The front of the property" },
  { zone_name: "Living Room", zone_description: "Main living space" },
  { zone_name: "Kitchen", zone_description: "Cooking and dining area" },
  { zone_name: "Bedroom", zone_description: "Master bedroom" },
  { zone_name: "Bathroom", zone_description: "Bathroom" },
  { zone_name: "Hallway", zone_description: "Main hallway" },
];

export default function HomeTouring({ location, character, onReactionChange }) {
  const [selectedZoneIdx, setSelectedZoneIdx] = useState(0);
  const zones = location?.zones && location.zones.length > 0 ? location.zones : DEFAULT_ZONES;
  const currentZone = zones[selectedZoneIdx] || zones[0];
  const zoneImage = currentZone?.image_urls?.[0] || location?.image_urls?.[0] || null;

  return (
    <div className="space-y-4">
      {/* Zone Image */}
      <div className="relative w-full h-64 rounded-xl overflow-hidden bg-secondary">
        <AnimatePresence mode="wait">
          {zoneImage && (
            <motion.img
              key={`${selectedZoneIdx}`}
              src={zoneImage}
              alt={currentZone.zone_name}
              className="w-full h-full object-cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Zone Name */}
      <div>
        <h3 className="text-base font-semibold text-foreground">{currentZone.zone_name}</h3>
        <p className="text-xs text-muted-foreground mt-1">{currentZone.zone_description}</p>
      </div>

      {/* Zone Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {zones.map((zone, idx) => (
          <button
            key={idx}
            onClick={() => setSelectedZoneIdx(idx)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              idx === selectedZoneIdx
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:bg-secondary/80"
            }`}
          >
            {zone.zone_name}
          </button>
        ))}
      </div>

      {/* Navigation Arrows */}
      <div className="flex gap-2">
        <button
          onClick={() => setSelectedZoneIdx(prev => (prev - 1 + zones.length) % zones.length)}
          className="flex-1 p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 mx-auto text-muted-foreground" />
        </button>
        <button
          onClick={() => setSelectedZoneIdx(prev => (prev + 1) % zones.length)}
          className="flex-1 p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
        >
          <ChevronRight className="w-4 h-4 mx-auto text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}