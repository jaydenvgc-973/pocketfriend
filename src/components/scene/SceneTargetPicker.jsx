import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Users } from "lucide-react";

/**
 * SceneTargetPicker — chooses WHICH character a directed scene interaction is aimed at.
 *
 * Kiss / Flirt With / Argue With need a target chosen by the user. Only the people who
 * are actually present in this scene are offered, and the user always picks one — no
 * target is ever chosen automatically. Selecting a person hands them back to the scene,
 * which runs the interaction through the existing narrative/interaction pathway.
 */
export default function SceneTargetPicker({ action, targets = [], onSelect, onClose }) {
  if (!action) return null;
  const verb = String(action.label || "").toLowerCase();

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <span className="text-base leading-none">{action.emoji}</span>
                {action.label} — who?
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Only people who are here can be chosen.
              </p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {targets.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Users className="w-5 h-5" />
                <p className="text-xs">No one here to {verb}.</p>
              </div>
            ) : (
              targets.map((person) => (
                <button
                  key={person.id}
                  onClick={() => onSelect(person)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                    {person.avatar_url
                      ? <img src={person.avatar_url} alt={person.name} className="w-full h-full object-cover" />
                      : <span className="text-xs font-bold text-foreground">{person.name?.[0]}</span>
                    }
                  </div>
                  <p className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">{person.name}</p>
                  <span className="text-base leading-none">{action.emoji}</span>
                </button>
              ))
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}