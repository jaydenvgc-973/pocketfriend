import React from "react";

/**
 * TemporaryNpcStatus — the temporary designation, the fixed lifespan and the Make
 * Permanent action for an NPC spawned from a scene.
 *
 * Creation and expiration are predetermined facts recorded once on the character
 * (temporary_npc_spawned_at / temporary_npc_expires_at). They are displayed as they
 * were written — no countdown, no timer, no refresh, and nothing that needs the app to
 * stay open. Expiration itself is carried out by the single scheduled event created for
 * that timestamp, never by this component.
 */

const TIME_ZONE = "America/New_York";

function formatMoment(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} at ${time}`;
}

export default function TemporaryNpcStatus({ npc, onMakePermanent }) {
  const created = formatMoment(npc.temporary_npc_spawned_at);
  const expires = formatMoment(npc.temporary_npc_expires_at);

  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-[9px] font-semibold text-amber-500 whitespace-nowrap">
        Temporary NPC
      </span>
      {created && (
        <span className="text-[9px] text-amber-500/90 leading-tight">
          Created: {created}
        </span>
      )}
      {expires && (
        <span className="text-[9px] text-amber-500/90 leading-tight">
          Expires: {expires}
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onMakePermanent(npc); }}
        className="mt-0.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold whitespace-nowrap"
        title="Keep this NPC in your world permanently"
      >
        Make Permanent
      </button>
    </div>
  );
}