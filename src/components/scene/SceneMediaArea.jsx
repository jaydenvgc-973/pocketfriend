import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, MapPin, ChevronDown, ChevronUp, Check, ZoomIn, Sparkles, Tv } from "lucide-react";
import WatchVideoPanel from "@/components/scene/WatchVideoPanel";
import { buildWatchContextLabel } from "@/lib/videoEmbedSanitizer";

const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "💼", school: "🏫", gym: "🏋️", grocery: "🛒",
  food_drink: "🍽️", outdoor: "🌳", social: "🍸", medical: "🏨",
  bar: "🍸", generic: "📍", transportation: "🚉"
};

/**
 * SceneMediaArea
 *
 * The Scene top-image area — extracted from Scene.jsx for maintainability.
 *
 * Includes the COLLAPSE/EXPAND feature (reuses the exact pattern from
 * GatheringRoomWatchParty): a ChevronUp button collapses the image, releasing
 * its vertical space so the conversation/text area gets more room. A collapsed
 * bar with a "Show" + ChevronDown button expands it back.
 *
 * Collapse/expand has NO side effects:
 *   - does NOT generate another image
 *   - does NOT regenerate
 *   - does NOT trigger Refresh
 *   - does NOT reset the Scene
 *   - does NOT remove or modify participants
 *   - does NOT alter conversation state
 *   - does NOT leave the Scene
 *
 * Refresh and collapse/expand are completely separate actions.
 */
export default function SceneMediaArea({
  location,
  locationZones,
  activeZone,
  onZoneChange,
  sceneImage,
  isGeneratingImage,
  onRefresh,
  onLightbox,
  // Watch video
  watchVideoActive,
  onToggleWatchVideo,
  watchContext,
  onWatchStarted,
  onWatchAnalysisComplete,
  onWatchStopped,
  // Display name for watch party narratives
  displayName,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showZonePicker, setShowZonePicker] = useState(false);

  const currentZoneForAction = locationZones.find((z) => z.zone_name === activeZone) || locationZones[0];

  // Watch video takes priority — it's independent of collapse
  if (watchVideoActive) {
    return (
      <div className="relative flex-shrink-0" style={{ zIndex: 0, height: "40dvh" }}>
        <WatchVideoPanel
          onClose={() => { onToggleWatchVideo?.(); }}
          onStarted={(ctx) => { onWatchStarted?.(ctx); }}
          onAnalysisComplete={({ linkAnalysisContext, linkData, title }) => { onWatchAnalysisComplete?.({ linkAnalysisContext, linkData, title }); }}
          onStopped={() => onWatchStopped?.()}
        />
      </div>
    );
  }

  // Collapsed bar — releases vertical space, conversation gets more room
  if (isCollapsed) {
    return (
      <div className="flex-shrink-0">
        <div className="h-9 flex items-center justify-between px-4 bg-secondary border-b border-border">
          <span className="text-[11px] text-muted-foreground truncate">
            {sceneImage ? "📷 Scene image hidden" : "📷 Scene area collapsed"}
          </span>
          <button
            onClick={() => setIsCollapsed(false)}
            className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
          >
            Show <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Expanded image area
  return (
    <div className="relative flex-shrink-0" style={{ zIndex: 0, height: "40dvh" }}>
      {isGeneratingImage ? (
        <div className="w-full h-full bg-secondary flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="w-4 h-4 animate-pulse" />
            <span className="text-xs">Setting the scene...</span>
          </div>
        </div>
      ) : sceneImage ? (
        <button onClick={() => onLightbox?.(sceneImage)} className="w-full h-full block group relative">
          <img src={sceneImage} alt={location.name} className="w-full h-full object-cover" style={{ imageOrientation: 'from-image' }} />
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <ZoomIn className="w-6 h-6 text-white drop-shadow" />
          </div>
        </button>
      ) : (
        <div className="w-full h-full bg-secondary flex items-center justify-center">
          <span className="text-5xl">{CATEGORY_EMOJIS[location.category]}</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/60 pointer-events-none" />

      {/* Zone picker */}
      {locationZones.length > 1 && (
        <div className="absolute top-2 left-2 z-[200]">
          <button
            onClick={() => setShowZonePicker((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/50 text-white text-xs font-medium hover:bg-black/70 transition-colors"
          >
            <MapPin className="w-3 h-3" />
            <span>{activeZone || locationZones[0]?.zone_name || "Zone"}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showZonePicker ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {showZonePicker && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl overflow-hidden min-w-[140px] z-[200]"
              >
                {locationZones.map((zone) => (
                  <button
                    key={zone.zone_name}
                    onClick={() => { onZoneChange?.(zone.zone_name); setShowZonePicker(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-secondary transition-colors ${
                      activeZone === zone.zone_name ? "text-primary font-medium" : "text-foreground"
                    }`}
                  >
                    {activeZone === zone.zone_name && <Check className="w-3 h-3 flex-shrink-0" />}
                    <span className={activeZone === zone.zone_name ? "" : "ml-5"}>{zone.zone_name}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Refresh + Collapse buttons — completely separate actions */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
        <button
          onClick={onRefresh}
          disabled={isGeneratingImage}
          className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60 transition-colors disabled:opacity-50"
          title="Refresh scene image"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingImage ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1.5 rounded-lg bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
          title="Collapse scene image"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}