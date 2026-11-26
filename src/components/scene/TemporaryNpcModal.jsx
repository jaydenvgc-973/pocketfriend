import React from "react";
import { X, UserPlus } from "lucide-react";

/**
 * TemporaryNpcModal — the informational modal shown when the user spawns an NPC in a
 * scene. It explains the 24-hour lifespan and how to keep them. Close only dismisses
 * this explanation: it never cancels the spawn.
 */
export default function TemporaryNpcModal({ isOpen, status, npcName, error, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-card border border-border rounded-2xl p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Temporary NPC</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          This NPC will remain in your world for 24 hours from the time of creation. You can make them
          permanent through NPC Connect at the bottom of the Home page. If they are not made permanent
          before their expiration date and time, they will automatically be removed.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Their creation and expiration date and time are shown in their NPC Connect entry.
        </p>

        {status === "spawning" && (
          <p className="text-xs text-primary">Someone is walking in…</p>
        )}
        {status === "ready" && npcName && (
          <p className="text-xs text-foreground">{npcName} has arrived.</p>
        )}
        {status === "error" && (
          <p className="text-xs text-destructive">{error || "They couldn't make it in. Try again."}</p>
        )}

        <button
          onClick={onClose}
          className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}