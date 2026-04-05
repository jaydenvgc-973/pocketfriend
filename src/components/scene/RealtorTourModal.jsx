import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Star, Home } from "lucide-react";
import { base44 } from "@/api/base44Client";

const REALTOR_NPC = {
  id: "npc_realtor",
  name: "Alex Chen",
  role: "Realtor",
  isNpc: true,
  avatar_url: null,
};

export default function RealtorTourModal({ isOpen, location, onClose, onAddRealtor }) {
  const [currentZoneIdx, setCurrentZoneIdx] = useState(0);
  const [commentary, setCommentary] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  const zones = location?.zones?.length > 0
    ? location.zones
    : [
        { zone_name: "Front Exterior" },
        { zone_name: "Living Room" },
        { zone_name: "Kitchen" },
        { zone_name: "Bedroom" },
        { zone_name: "Bathroom" },
      ];

  const currentZone = zones[currentZoneIdx];

  const getZoneCommentary = async (zoneName) => {
    if (commentary[zoneName]) return;
    setIsLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are Alex Chen, a friendly and enthusiastic real estate agent giving a tour of ${location?.name}.
You are currently showing the ${zoneName}.
${location?.description ? `Property description: ${location.description}` : ""}
Give a 2-3 sentence natural, engaging description of this room/area as a realtor would. Highlight features, potential, and atmosphere. Be warm and persuasive but not over the top.`,
      });
      setCommentary(prev => ({ ...prev, [zoneName]: result?.trim() }));
    } catch {
      setCommentary(prev => ({ ...prev, [zoneName]: `The ${zoneName} is a highlight of this property.` }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleZoneChange = (idx) => {
    setCurrentZoneIdx(idx);
    getZoneCommentary(zones[idx]?.zone_name);
  };

  // Load first zone on open
  React.useEffect(() => {
    if (isOpen && currentZone) {
      getZoneCommentary(currentZone.zone_name);
      onAddRealtor?.(REALTOR_NPC);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const zoneImage = currentZone?.image_urls?.[0] || location?.image_urls?.[0] || null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-card border border-border rounded-t-2xl overflow-hidden max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <Home className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Property Tour</p>
            <p className="text-xs text-muted-foreground">with {REALTOR_NPC.name} · {REALTOR_NPC.role}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Zone image */}
        {zoneImage && (
          <div className="h-44 flex-shrink-0 overflow-hidden relative">
            <img src={zoneImage} alt={currentZone?.zone_name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            <div className="absolute bottom-2 left-3">
              <p className="text-sm font-semibold text-white">{currentZone?.zone_name}</p>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Zone name (if no image) */}
          {!zoneImage && (
            <h3 className="text-base font-semibold text-foreground">{currentZone?.zone_name}</h3>
          )}

          {/* Realtor commentary */}
          <div className="bg-secondary/50 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-primary">A</span>
              </div>
              <p className="text-xs font-medium text-foreground">{REALTOR_NPC.name}</p>
            </div>
            {isLoading ? (
              <div className="flex gap-1 pl-8">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-1" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-2" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-3" />
              </div>
            ) : (
              <p className="text-sm text-foreground pl-8 leading-relaxed">
                {commentary[currentZone?.zone_name] || "Let me show you this area..."}
              </p>
            )}
          </div>

          {/* Zone tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {zones.map((zone, idx) => (
              <button
                key={idx}
                onClick={() => handleZoneChange(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  idx === currentZoneIdx
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                }`}
              >
                {zone.zone_name}
              </button>
            ))}
          </div>

          {/* Navigation arrows */}
          <div className="flex gap-2">
            <button
              onClick={() => handleZoneChange((currentZoneIdx - 1 + zones.length) % zones.length)}
              className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl bg-secondary hover:bg-secondary/80 transition-colors text-sm text-foreground"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <button
              onClick={() => handleZoneChange((currentZoneIdx + 1) % zones.length)}
              className="flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}