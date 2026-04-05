import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * Global popup for incoming visitor requests.
 * Shown on ANY screen when a character wants to visit the user's home.
 * 
 * Props:
 *   request: { character, homeLocation, message }
 *   onAccept: () => void
 *   onDecline: () => void
 */
export default function VisitorRequestPopup({ request, onAccept, onDecline }) {
  const navigate = useNavigate();

  if (!request) return null;

  const { character, homeLocation, message } = request;

  const handleAccept = () => {
    onAccept?.();
    // Bypass travel — go directly to scene at the home
    if (homeLocation?.id) {
      const params = new URLSearchParams({
        locationId: homeLocation.id,
        characterIds: character?.id || "",
      });
      navigate(`/scene?${params.toString()}`);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.96 }}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-4"
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden flex-shrink-0 flex items-center justify-center">
              {character?.avatar_url
                ? <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
                : <span className="text-sm font-bold text-foreground">{character?.name?.[0]}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{character?.name} wants to visit</p>
              <p className="text-xs text-muted-foreground truncate">{message || `at ${homeLocation?.name}`}</p>
            </div>
            <Home className="w-4 h-4 text-primary flex-shrink-0" />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAccept}
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Check className="w-4 h-4" /> Let them in
            </button>
            <button
              onClick={onDecline}
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
            >
              <X className="w-4 h-4" /> Not now
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}