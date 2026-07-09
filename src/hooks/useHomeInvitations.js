import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * useHomeInvitations
 *
 * Restores character-initiated invitations on the homepage.
 *
 * Behavior:
 * 1. When settings are loaded, checks for existing pending_character_invites
 *    in UserSettings (from a previous trigger the user hasn't dismissed).
 * 2. If none exist, calls checkAndTriggerInvites (session-gated, delayed)
 *    to let characters invite the user without being prompted first.
 * 3. Sets the invitations state so InviteOutModal renders them.
 *
 * Gates:
 * - Session-gated: only triggers once per browser session (sessionStorage)
 * - Delayed: waits 8s after settings load so it doesn't compete with critical startup
 * - Non-blocking: fire-and-forget — failures are silently ignored
 */
export function useHomeInvitations({ settingsLoaded, userSettings, setInvitations }) {
  const triggerFiredRef = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!settingsLoaded || !userSettings?.id || triggerFiredRef.current) return;
    triggerFiredRef.current = true;

    // Step 1: Check for existing pending invites from a previous trigger
    const existingInvites = userSettings.pending_character_invites;
    if (Array.isArray(existingInvites) && existingInvites.length > 0) {
      setInvitations(existingInvites);
      return; // Don't trigger new ones — user hasn't dismissed the current batch
    }

    // Step 2: Session-gated trigger for new invitations
    const sessionKey = "home_invite_check_done";
    if (sessionStorage.getItem(sessionKey)) return;

    const timer = setTimeout(async () => {
      sessionStorage.setItem(sessionKey, "1");
      try {
        const res = await base44.functions.invoke("checkAndTriggerInvites", {});
        const data = res?.data;
        if (data?.shouldShow && Array.isArray(data.invitations) && data.invitations.length > 0) {
          setInvitations(data.invitations);
          // Invalidate settings cache so the next Home mount reads the updated
          // pending_character_invites from the server, not stale cache.
          queryClient.invalidateQueries({ queryKey: ["userSettings"] });
        }
      } catch (err) {
        // Silently fail — invitations are non-critical enrichment
        console.warn("[useHomeInvitations] checkAndTriggerInvites failed:", err?.message);
      }
    }, 8000); // 8s delay — let critical startup queries finish first

    return () => clearTimeout(timer);
  }, [settingsLoaded, userSettings?.id, userSettings?.pending_character_invites, setInvitations]);
}