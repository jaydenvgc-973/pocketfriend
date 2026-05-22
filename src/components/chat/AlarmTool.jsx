/**
 * AlarmTool
 *
 * Four modes:
 *   1. Ring Now — wake the character immediately as if their alarm fired
 *   2. Set Alarm — pick a time and schedule it
 *   3. View scheduled alarm
 *   4. Cancel scheduled alarm
 *
 * Framing: The character's OWN alarm — not the user waking them.
 */
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlarmClock, X, Moon, BatteryLow, Bell, BellOff, Clock, CheckCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { getCharacterSleepState } from "@/lib/characterSleepState";

export default function AlarmTool({ isOpen, onClose, character, characterId, currentUser, queryClient: qcProp }) {
  const queryClientInternal = useQueryClient();
  const queryClient = qcProp || queryClientInternal;

  const [view, setView] = useState("main"); // main | schedule
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success'|'info'|'error', text: string }
  const [pendingAlarm, setPendingAlarm] = useState(character?.pending_alarm_time || null);
  const [scheduleTime, setScheduleTime] = useState("");

  // Sync pending alarm from character prop when it changes
  useEffect(() => {
    setPendingAlarm(character?.pending_alarm_time || null);
  }, [character?.pending_alarm_time]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setView("main");
      setResult(null);
      setScheduleTime("");
      setPendingAlarm(character?.pending_alarm_time || null);
    }
  }, [isOpen]);

  if (!isOpen || !character) return null;

  const sleepState = getCharacterSleepState(character);
  const isAsleep = sleepState.isSleeping;
  const firstName = character.name?.split(" ")[0] || "Character";
  // Only show confirmed reason — never infer from needs values
  const sleepContextDesc = sleepState.confirmed_reason && sleepState.confidence >= 0.8
    ? sleepState.visible_label
    : sleepState.isLikelyStale
    ? 'Sleep state unverified — no proof found'
    : null;

  const invoke = async (action, extra = {}) => {
    setIsLoading(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('characterAlarm', {
        characterId, action, ...extra,
      });
      const data = res?.data;
      if (data?.success) {
        setResult({ type: "success", text: data.message });
        if (action === 'ring_now' || action === 'cancel') {
          setPendingAlarm(null);
          queryClient.invalidateQueries({ queryKey: ["character", characterId] });
          queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
        }
        if (action === 'schedule') {
          setPendingAlarm(data.pending_alarm_time);
          setView("main");
        }
      } else {
        setResult({ type: "error", text: data?.error || "Something went wrong." });
      }
    } catch (err) {
      // Show diagnostic detail — NOT a vague friendly message.
      // The root cause must be visible so the user or admin can act on it.
      const rawMsg = err?.message || '';
      let diagMsg = `Alarm failed (${action}): ${rawMsg || 'unknown error'}`;

      // Parse HTTP status from message for clear diagnosis
      if (rawMsg.includes('404')) {
        diagMsg = `404 — Character not found or lookup failed. Character ID: ${characterId}. This may be an RLS scope issue or the character was deleted. Run Settings → Troubleshooting → Alarm for full diagnosis.`;
      } else if (rawMsg.includes('403')) {
        diagMsg = `403 — Permission denied. This character may not belong to your account. Character ID: ${characterId}.`;
      } else if (rawMsg.includes('401')) {
        diagMsg = `401 — Not authenticated. Please refresh the page and sign in again.`;
      } else if (rawMsg.includes('429') || rawMsg.toLowerCase().includes('rate limit')) {
        diagMsg = `429 — Rate limit hit. Wait 30 seconds and try again.`;
      } else if (rawMsg.includes('500')) {
        diagMsg = `500 — Server error in characterAlarm function. Character ID: ${characterId}. Check backend logs.`;
      }

      setResult({ type: "error", text: diagMsg });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRingNow = () => invoke('ring_now');

  const handleSchedule = () => {
    if (!scheduleTime) return;
    // Build a full ISO datetime for today at the chosen time (EST)
    const [h, m] = scheduleTime.split(':').map(Number);
    const dt = new Date();
    dt.setHours(h, m, 0, 0);
    // If already past, schedule for tomorrow
    if (dt <= new Date()) dt.setDate(dt.getDate() + 1);
    invoke('schedule', { scheduled_time: dt.toISOString() });
  };

  const handleCancel = () => invoke('cancel');

  // Format stored alarm for display
  const formatAlarm = (isoStr) => {
    if (!isoStr) return null;
    try {
      return new Date(isoStr).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch { return isoStr; }
  };

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
                {isAsleep ? `${firstName} is sleeping` : `${firstName} is awake`}
              </p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Sleep status banner */}
          <div className={`px-4 py-3 rounded-xl flex items-start gap-3 ${
            isAsleep ? "bg-indigo-500/10 border border-indigo-500/20" : "bg-secondary border border-border"
          }`}>
            {isAsleep
              ? <Moon className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
              : <AlarmClock className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            }
            <div>
              <p className="text-sm text-foreground">
                {isAsleep ? `${firstName} is currently ${sleepState.isNapping ? 'napping' : 'sleeping'}.` : `${firstName} is already awake.`}
              </p>
              {isAsleep && sleepContextDesc && (
                <p className={`text-xs mt-0.5 ${sleepState.isLikelyStale ? 'text-amber-400/80' : 'text-indigo-300/70'}`}>{sleepContextDesc}</p>
              )}
              {isAsleep && sleepState.isLikelyStale && !sleepContextDesc && (
                <p className="text-xs text-amber-400/80 mt-0.5">⚠ Sleep state unverified — run Settings → Troubleshooting → Sleep to diagnose</p>
              )}
            </div>
          </div>

          {/* Scheduled alarm display */}
          {pendingAlarm && (
            <div className="px-4 py-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-primary">Alarm Scheduled</p>
                  <p className="text-sm text-foreground">{formatAlarm(pendingAlarm)}</p>
                </div>
              </div>
              <button
                onClick={handleCancel}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors disabled:opacity-50"
              >
                <BellOff className="w-3.5 h-3.5" />
                Cancel
              </button>
            </div>
          )}

          {/* Sleep debt warning */}
          {isAsleep && (character.sleep_debt_hours || 0) > 1.5 && (
            <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
              <BatteryLow className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-400">
                {firstName} is carrying sleep debt — early wake may leave them exhausted.
              </p>
            </div>
          )}

          {/* Result feedback */}
          {result && (
            <div className={`px-3 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 ${
              result.type === "success"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : result.type === "info"
                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            }`}>
              {result.type === "success" && <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />}
              {result.text}
            </div>
          )}

          {/* Schedule view */}
          {view === "schedule" ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">Set alarm time</p>
              <input
                type="time"
                value={scheduleTime}
                onChange={e => setScheduleTime(e.target.value)}
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-foreground text-base focus:outline-none focus:border-primary"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setView("main")}
                  className="flex-1 h-11 rounded-xl border border-border text-muted-foreground text-sm hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSchedule}
                  disabled={!scheduleTime || isLoading}
                  className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Bell className="w-4 h-4" />
                  {isLoading ? "Saving…" : "Set Alarm"}
                </button>
              </div>
            </div>
          ) : (
            /* Main action buttons */
            <div className="space-y-2">
              {/* Ring Now */}
              <button
                onClick={handleRingNow}
                disabled={isLoading || !isAsleep}
                className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
              >
                <AlarmClock className="w-4 h-4" />
                {isLoading ? "Waking up…" : `Ring ${firstName}'s Alarm Now`}
              </button>

              {/* Schedule */}
              <button
                onClick={() => { setResult(null); setView("schedule"); }}
                disabled={isLoading}
                className="w-full h-11 rounded-xl border border-border text-foreground text-sm flex items-center justify-center gap-2 hover:bg-secondary/60 transition-colors disabled:opacity-40"
              >
                <Clock className="w-4 h-4 text-muted-foreground" />
                Set Alarm Time
              </button>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/50 text-center">
            {firstName} interprets this as their own alarm — not as you waking them.
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}