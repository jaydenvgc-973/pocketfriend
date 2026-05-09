/**
 * AlarmTool
 *
 * Wakes the currently active character from sleep — as if their OWN alarm went off.
 * Does NOT wake the whole world. Targeted single-character update only.
 *
 * Narrative framing: "Their alarm went off." NOT "the user woke them."
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlarmClock, X, Moon, BatteryLow } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";

export default function AlarmTool({ isOpen, onClose, character, characterId, currentUser, queryClient: qcProp }) {
  const queryClientInternal = useQueryClient();
  const queryClient = qcProp || queryClientInternal;

  const [isWaking, setIsWaking] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success'|'info'|'error', text: string }

  if (!isOpen || !character) return null;

  const presenceStatus = character.resolved_presence_status || character.location_status || "";
  const isAsleep = presenceStatus === "sleeping" || presenceStatus === "napping";

  const handleAlarm = async () => {
    if (!isAsleep) {
      setResult({ type: "info", text: `${character.name?.split(" ")[0]} is already awake.` });
      return;
    }

    setIsWaking(true);
    setResult(null);

    // Calculate sleep duration to determine exhaustion
    const sleepStart = character.last_sleep_start ? new Date(character.last_sleep_start).getTime() : null;
    const wakeTime = character.wake_up_time || "07:00";
    const [wh, wm] = wakeTime.split(":").map(Number);
    const now = new Date();
    const scheduledWake = new Date(now);
    scheduledWake.setHours(wh, wm, 0, 0);
    if (scheduledWake < now) scheduledWake.setDate(scheduledWake.getDate() + 1);

    const minutesEarlyMs = scheduledWake - now;
    const minutesEarly = minutesEarlyMs > 0 ? Math.round(minutesEarlyMs / 60000) : 0;
    const isEarlyWake = minutesEarly > 30;

    // Determine tiredness state
    let sleepDebtHours = character.sleep_debt_hours || 0;
    if (sleepStart) {
      const hoursSlept = (Date.now() - sleepStart) / 3600000;
      const neededHours = 7.5;
      if (hoursSlept < neededHours) {
        sleepDebtHours = Math.min(sleepDebtHours + (neededHours - hoursSlept), 24);
      }
    }

    const newEmotionalState = isEarlyWake || sleepDebtHours > 2 ? "tired" : "calm";

    try {
      // Targeted single-character wake — owner_email scoped
      await base44.entities.Character.update(characterId, {
        resolved_presence_status: "home",
        location_status: "home",
        current_activity: isEarlyWake ? "just woke up (alarm, earlier than usual)" : "just woke up (alarm)",
        emotional_state: newEmotionalState,
        sleep_debt_hours: Math.round(sleepDebtHours * 10) / 10,
        sleep_interrupted_at: new Date().toISOString(),
        resolved_last_updated_at: new Date().toISOString(),
      });

      // Scoped cache invalidation — only this character
      queryClient.invalidateQueries({ queryKey: ["character", characterId] });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });

      const firstName = character.name?.split(" ")[0] || "They";
      if (isEarlyWake) {
        setResult({
          type: "success",
          text: `${firstName}'s alarm went off early. They're awake but tired — may need coffee or a nap later.`,
        });
      } else {
        setResult({
          type: "success",
          text: `${firstName}'s alarm went off. They're up and starting their day.`,
        });
      }
    } catch (err) {
      setResult({ type: "error", text: "Wake failed. Please try again." });
    } finally {
      setIsWaking(false);
    }
  };

  const firstName = character.name?.split(" ")[0] || "Character";

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="alarm-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-5 pb-8 space-y-4"
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <AlarmClock className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Alarm</h3>
              <p className="text-xs text-muted-foreground">
                {isAsleep ? `Wake ${firstName} with their alarm` : `${firstName} is already awake`}
              </p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Status */}
          <div className={`px-4 py-3 rounded-xl flex items-center gap-3 ${
            isAsleep ? "bg-indigo-500/10 border border-indigo-500/20" : "bg-secondary border border-border"
          }`}>
            {isAsleep ? (
              <Moon className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            ) : (
              <AlarmClock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            )}
            <p className="text-sm text-foreground">
              {isAsleep
                ? `${firstName} is currently sleeping.`
                : `${firstName} is already awake.`}
            </p>
          </div>

          {/* Sleep debt context */}
          {isAsleep && (character.sleep_debt_hours || 0) > 1.5 && (
            <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
              <BatteryLow className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-400">
                {firstName} is carrying sleep debt — waking early may leave them exhausted.
              </p>
            </div>
          )}

          {/* Result feedback */}
          {result && (
            <div className={`px-3 py-2.5 rounded-xl text-xs font-medium ${
              result.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : result.type === "info"
                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            }`}>
              {result.text}
            </div>
          )}

          {/* Action button */}
          {isAsleep && !result && (
            <button
              onClick={handleAlarm}
              disabled={isWaking}
              className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <AlarmClock className="w-4 h-4" />
              {isWaking ? "Waking up…" : `Sound ${firstName}'s Alarm`}
            </button>
          )}

          <p className="text-[10px] text-muted-foreground/50 text-center">
            The character interprets this as their own alarm — not as the user waking them.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}