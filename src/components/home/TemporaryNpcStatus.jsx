import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * TemporaryNpcStatus — the countdown and Make Permanent action for an NPC spawned from
 * a scene. The remaining time comes from the character's own authoritative
 * temporary_npc_expires_at, so it keeps counting while the app is closed and never
 * restarts when the contact is opened, messaged or re-added.
 */
function remainingLabel(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Expiring…";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m remaining` : `${Math.max(mins, 1)}m remaining`;
}

export default function TemporaryNpcStatus({ npc, onMakePermanent }) {
  const [label, setLabel] = useState(() => remainingLabel(npc.temporary_npc_expires_at));

  useEffect(() => {
    setLabel(remainingLabel(npc.temporary_npc_expires_at));
    const timer = setInterval(() => setLabel(remainingLabel(npc.temporary_npc_expires_at)), 30000);
    return () => clearInterval(timer);
  }, [npc.temporary_npc_expires_at]);

  return (
    <span className="flex items-center gap-1.5">
      <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-[9px] font-semibold text-amber-500 whitespace-nowrap">
        Temporary NPC
      </span>
      <span className="text-[9px] text-amber-500/90 whitespace-nowrap">{label}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onMakePermanent(npc); }}
        className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold whitespace-nowrap"
        title="Keep this NPC in your world permanently"
      >
        Make Permanent
      </button>
    </span>
  );
}