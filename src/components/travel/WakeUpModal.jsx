import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Moon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WakeUpModal({
  isOpen,
  onClose,
  character,
  wakeTime,
  onLeaveAsleep,
  onWakeUp,
  isProcessing,
}) {
  if (!isOpen || !character) return null;

  const formatTime = (timeStr) => {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(":").map(Number);
    const suffix = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-[60] flex items-end justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Wake up?</h3>
              </div>
              <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-foreground font-medium">
                  {character.name} is asleep right now.
                </p>
                {wakeTime && (
                  <p className="text-xs text-muted-foreground">
                    Expected to be up around {formatTime(wakeTime)}.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                You can leave them sleeping or wake them up to ask if they'll come along.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={onLeaveAsleep}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Leave them asleep
                </button>
                <button
                  onClick={onWakeUp}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Waking...
                    </>
                  ) : (
                    "Wake them up"
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}