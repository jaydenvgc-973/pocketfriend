import { motion } from "framer-motion";
import { X, Clock, Briefcase, Moon, BookOpen, Dumbbell, Wine, AlertTriangle, Sparkles, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

const STATUS_ICONS = {
  sleep: Moon,
  work: Briefcase,
  school: BookOpen,
  gym: Dumbbell,
  bar: Wine,
  hospital: AlertTriangle,
  prayer: Sparkles,
  out: MapPin,
};

export default function CharacterAvailabilityPopup({ unavailable, onClose }) {
  if (!unavailable || unavailable.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Can't join right now</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {unavailable.map(({ character, reason, availableAt }) => {
            const StatusIcon = STATUS_ICONS[reason.iconType] || MapPin;
            return (
              <div key={character.id} className="flex items-start gap-3 p-3 rounded-xl bg-secondary/50 border border-border">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {character.avatar_url
                    ? <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
                    : <span className="text-sm font-bold text-primary">{character.name?.[0]}</span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{character.name}</p>
                    <StatusIcon className={`w-3.5 h-3.5 ${reason.color}`} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{reason.message}</p>
                  {availableAt && (
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{availableAt}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <Button onClick={onClose} className="w-full rounded-xl" variant="outline">Got it</Button>
      </motion.div>
    </div>
  );
}