import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { X, Home, MapPin, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LeaveLocationModal({ isOpen, onClose, locationName, broughtCharacters, onLeaveWithChars, onLeaveCharactersBehind }) {
  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Leave {locationName}?</h3>
                <p className="text-xs text-muted-foreground mt-0.5">What happens to the others?</p>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {broughtCharacters.length > 0 && (
              <div className="flex gap-2 pb-2">
                {broughtCharacters.map(c => (
                  <div key={c.id} className="flex flex-col items-center gap-1">
                    <div className="w-9 h-9 rounded-full bg-secondary border border-border overflow-hidden flex items-center justify-center">
                      {c.avatar_url
                        ? <img src={c.avatar_url} alt={c.name} className="w-full h-full object-cover" />
                        : <span className="text-xs font-bold text-foreground">{c.name?.[0]}</span>
                      }
                    </div>
                    <span className="text-[9px] text-muted-foreground truncate max-w-[48px]">{c.name.split(" ")[0]}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2.5">
              {/* Leave WITH characters */}
              <button
                onClick={onLeaveWithChars}
                className="w-full flex items-start gap-3 p-3.5 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                  <LogOut className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {broughtCharacters.length > 0
                      ? `Leave together`
                      : "Leave"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {broughtCharacters.length > 0
                      ? `${broughtCharacters.map(c => c.name.split(" ")[0]).join(", ")} will return home or go where they're scheduled.`
                      : "You leave the location."}
                  </p>
                </div>
              </button>

              {/* Leave characters BEHIND */}
              {broughtCharacters.length > 0 && (
                <button
                  onClick={onLeaveCharactersBehind}
                  className="w-full flex items-start gap-3 p-3.5 rounded-xl border border-border hover:border-amber-500/40 hover:bg-amber-500/5 transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-amber-500/10 transition-colors">
                    <MapPin className="w-4 h-4 text-muted-foreground group-hover:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Leave them here</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {broughtCharacters.map(c => c.name.split(" ")[0]).join(", ")} stay at {locationName}. Their card will show them here.
                    </p>
                  </div>
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}