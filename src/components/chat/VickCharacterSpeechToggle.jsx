/**
 * VickCharacterSpeechToggle
 *
 * Renders below the chat input ONLY when the active character is Vick Servicio.
 *
 * OFF (default): Vick speaks in full service-operator mode with diagnostic authority.
 * ON: Vick speaks the way he would to another character — same knowledge,
 *     in-world language only, no app/internal terminology.
 *
 * State persists in localStorage so it survives navigation and refresh.
 * Does not reset between messages.
 */
import React, { useState, useCallback } from "react";

const STORAGE_KEY = "vick_character_speech_mode";

export function useVickCharacterSpeechMode() {
  const [enabled, setEnabled] = React.useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggle = React.useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  return { characterSpeechMode: enabled, toggleCharacterSpeechMode: toggle };
}

export default function VickCharacterSpeechToggle({ enabled, onToggle }) {
  return (
    <div className="px-4 pb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex-shrink-0">
          Character Speech Mode
        </span>
        <span className="text-[10px] text-muted-foreground/60 truncate hidden sm:block">
          {enabled
            ? "Vick speaks in-world only"
            : "Full service operator mode"}
        </span>
      </div>
      <button
        onClick={onToggle}
        aria-label={`Character Speech Mode is ${enabled ? "on" : "off"}`}
        className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
          enabled ? "bg-primary" : "bg-secondary border border-border"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            enabled ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
      <span
        className={`text-[10px] font-bold flex-shrink-0 ${
          enabled ? "text-primary" : "text-muted-foreground/50"
        }`}
      >
        {enabled ? "ON" : "OFF"}
      </span>
    </div>
  );
}