import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * Global popup for character invitations — when a character invites the user somewhere.
 * Bypasses the travel page and goes directly to the scene.
 * 
 * Props:
 *   invitation: { character, location, message }
 *   onAccept: () => void
 *   onDecline: () => void
 */
export default function CharacterInvitationPopup({ invitation, onAccept, onDecline }) {
  const navigate = useNavigate();

  if (!invitation) return null;

  const { character, location, message } = invitation;

  const handleAccept = () => {
    onAccept?.();
    // Skip travel page — go directly to scene
    if (location?.id) {
      const params = new URLSearchParams({
        locationId: location.id,
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
        <div className="bg-card border border-primary/30 rounded-2xl shadow-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden flex-shrink-0 flex items-center justify-center">
              {character?.avatar_url
                ? <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
                : <span className="text-sm font-bold text-foreground">{character?.name?.[0]}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{character?.name} invited you</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{location?.name}</span>
              </p>
              {message && <p className="text-xs text-muted-foreground/80 truncate mt-0.5 italic">"{message}"</p>}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAccept}
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Check className="w-4 h-4" /> Join them
            </button>
            <button
              onClick={onDecline}
              className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
            >
              <X className="w-4 h-4" /> Maybe later
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}