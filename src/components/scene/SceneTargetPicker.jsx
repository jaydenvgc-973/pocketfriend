import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Users, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * SceneTargetPicker — chooses WHICH character a directed scene interaction is aimed at.
 *
 * Kiss / Flirt With / Argue With need a target chosen by the user. Only the people who
 * are actually present in this scene are offered, and the user always picks one — no
 * target is ever chosen automatically. Selecting a person hands them back to the scene,
 * which runs the interaction through the existing narrative/interaction pathway.
 *
 * It is also the selector for WHO performs an activity in a watched scene. There it is
 * `multiple`: any number of the people here can take part in the same activity, from one
 * to everyone present. Nothing is preselected — the observer picks exactly who joins, and
 * confirms once the group is right. A directed interaction stays single-choice.
 */
export default function SceneTargetPicker({
  action,
  targets = [],
  onSelect,
  onClose,
  heading = null,
  hint = null,
  multiple = false,
  selectedIds = [],
  onConfirm = null,
  confirmLabel = "Do it together",
}) {
  const [picked, setPicked] = useState(selectedIds || []);
  if (!action) return null;
  const verb = String(action.label || "").toLowerCase();
  // The same picker also chooses WHO performs an activity in a watched scene, so its
  // heading can be asked differently without changing how a target is chosen.
  const title = heading || `${action.emoji} ${action.label} — who?`;
  const subtitle = hint || "Only people who are here can be chosen.";

  const toggle = (person) => {
    setPicked((prev) => (prev.includes(person.id) ? prev.filter((id) => id !== person.id) : [...prev, person.id]));
  };
  const chosen = targets.filter((t) => picked.includes(t.id));

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
                {title}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {subtitle}
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
                <p className="text-xs">
                  {action.adults_only
                    ? "No adult is taking part in this scene for that."
                    : `No one here to ${verb}.`}
                </p>
              </div>
            ) : (
              targets.map((person) => {
                const isPicked = picked.includes(person.id);
                return (
                  <button
                    key={person.id}
                    onClick={() => (multiple ? toggle(person) : onSelect?.(person))}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${isPicked ? "bg-primary/10" : "hover:bg-secondary"}`}
                  >
                    <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                      {person.avatar_url
                        ? <img src={person.avatar_url} alt={person.name} className="w-full h-full object-cover" />
                        : <span className="text-xs font-bold text-foreground">{person.name?.[0]}</span>
                      }
                    </div>
                    <p className={`flex-1 min-w-0 text-sm font-medium truncate ${isPicked ? "text-primary" : "text-foreground"}`}>{person.name}</p>
                    {multiple
                      ? (isPicked
                        ? <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3 text-primary-foreground" /></span>
                        : <span className="w-5 h-5 rounded-full border border-border flex-shrink-0" />)
                      : <span className="text-base leading-none">{action.emoji}</span>
                    }
                  </button>
                );
              })
            )}
          </div>

          {multiple && targets.length > 0 && (
            <div className="px-4 py-3 border-t border-border space-y-2">
              <p className="text-[11px] text-muted-foreground">
                {chosen.length === 0
                  ? "Pick who takes part — one person or several."
                  : `${chosen.length} ${chosen.length === 1 ? "person" : "people"}: ${chosen.map((c) => c.name).join(", ")}`}
              </p>
              <Button
                onClick={() => onConfirm?.(chosen)}
                disabled={chosen.length === 0}
                className="w-full rounded-xl"
              >
                {confirmLabel}
              </Button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}