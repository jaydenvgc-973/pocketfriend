/**
 * useAlarmExecutionTimer
 *
 * THE WIRE: Connects registered pending_alarm_time → processScheduledCharacterAlarms
 * at the exact alarm time.
 *
 * This is NOT polling. Each alarm gets its own dedicated setTimeout that fires
 * exactly at the alarm time. No repeated scanning, no cron, no global sweep.
 *
 * Flow:
 *   1. On mount: load all characters with pending_alarm_time for the current user.
 *      - Overdue alarms → fire processScheduledCharacterAlarms immediately.
 *      - Future alarms → set a dedicated setTimeout for each.
 *   2. Subscribe to Character updates: when pending_alarm_time changes, update timers.
 *   3. When a timer fires: call processScheduledCharacterAlarms via base44.functions.invoke.
 *      The existing execution side handles the authorized wake and clears pending_alarm_time.
 *   4. Clean up all timers on unmount.
 *
 * This hook does NOT modify registration (characterAlarm) or execution
 * (processScheduledCharacterAlarms). It only connects the two at the alarm time.
 */
import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

export function useAlarmExecutionTimer() {
  // Map of characterId → timeoutId
  const timersRef = useRef(new Map());

  // Fire the alarm for a single character via the existing execution pipeline.
  const fireAlarm = async (characterId) => {
    try {
      await base44.functions.invoke("processScheduledCharacterAlarms", {
        character_id: characterId,
      });
    } catch (err) {
      console.warn(`[useAlarmExecutionTimer] fire failed for ${characterId}:`, err?.message);
    }
  };

  // Set (or reset) a timer for a single character's alarm.
  const setTimer = (characterId, alarmTimeIso) => {
    // Clear any existing timer for this character
    const existing = timersRef.current.get(characterId);
    if (existing) clearTimeout(existing);

    if (!alarmTimeIso) {
      timersRef.current.delete(characterId);
      return;
    }

    const delay = new Date(alarmTimeIso).getTime() - Date.now();

    if (delay <= 0) {
      // Overdue — fire immediately
      timersRef.current.delete(characterId);
      fireAlarm(characterId);
    } else {
      // Future — set a dedicated setTimeout
      const timeoutId = setTimeout(() => {
        timersRef.current.delete(characterId);
        fireAlarm(characterId);
      }, delay);
      timersRef.current.set(characterId, timeoutId);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    const init = async () => {
      try {
        // Check if authenticated
        const isAuthed = await base44.auth.isAuthenticated();
        if (!isAuthed || cancelled) return;

        // Load all characters for the current user that have pending_alarm_time
        const chars = await base44.entities.Character.list("-updated_date", 500);
        if (cancelled) return;

        for (const char of chars) {
          if (char.pending_alarm_time) {
            setTimer(char.id, char.pending_alarm_time);
          }
        }

        // Subscribe to Character updates to detect new/canceled alarms
        try {
          unsubscribe = base44.entities.Character.subscribe((event) => {
            if (cancelled) return;
            if (!event?.data) return;

            const char = event.data;
            const alarmTime = char.pending_alarm_time;

            // On any update, sync the timer for this character
            if (event.type === "delete") {
              const existing = timersRef.current.get(char.id);
              if (existing) {
                clearTimeout(existing);
                timersRef.current.delete(char.id);
              }
            } else {
              // create or update — set/clear timer based on pending_alarm_time
              setTimer(char.id, alarmTime || null);
            }
          });
        } catch (subErr) {
          console.warn("[useAlarmExecutionTimer] subscribe failed:", subErr?.message);
        }
      } catch (err) {
        console.warn("[useAlarmExecutionTimer] init failed:", err?.message);
      }
    };

    init();

    return () => {
      cancelled = true;
      if (unsubscribe) {
        try { unsubscribe(); } catch {}
      }
      // Clear all timers
      for (const timeoutId of timersRef.current.values()) {
        clearTimeout(timeoutId);
      }
      timersRef.current.clear();
    };
  }, []);
}