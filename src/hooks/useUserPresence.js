/**
 * useUserPresence
 *
 * Single hook that owns all user-presence state.
 * Source of truth: UserSettings.user_current_location_id + user_presence_status
 *
 * Usage:
 *   const { userPresence, setUserLocation, setUserAway, isAway } = useUserPresence(currentUser, settings, settingsId);
 *
 * Rules:
 * - owner_email is the sole ownership field — created_by is permanently forbidden
 * - User is "away" when user_presence_status === 'away' OR no location is set
 * - setUserLocation writes both location fields + presence_status: 'present'
 * - setUserAway clears location fields + sets presence_status: 'away'
 */

import { useCallback, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Read user presence from settings.
 * Returns a normalized presence object for use in maps, scenes, Home cards.
 */
export function readUserPresence(currentUser, settings) {
  if (!currentUser || !settings) {
    return { isAway: true, locationId: null, locationName: null, status: "away" };
  }

  const status = settings.user_presence_status || "away";
  const locationId = settings.user_current_location_id || null;
  const locationName = settings.user_current_location_name || null;

  // Away if status is away OR if present but no location is set
  const isAway = status === "away" || (!locationId && status !== "present");

  return {
    isAway,
    locationId: isAway ? null : locationId,
    locationName: isAway ? null : locationName,
    status: isAway ? "away" : "present",
    displayName: settings.fictional_world_name || currentUser.full_name || "You",
    ownerEmail: currentUser.email,
    ownerUserId: currentUser.id,
  };
}

/**
 * Hook: useUserPresence
 * Provides setUserLocation and setUserAway — both write immediately to UserSettings.
 */
export function useUserPresence(currentUser, settings, settingsId) {
  const queryClient = useQueryClient();
  // Optimistic local override — applied immediately on user action, cleared on successful refetch
  const [optimisticPresence, setOptimisticPresence] = useState(null);

  const queryKey = ["userSettings", currentUser?.email];

  const invalidate = useCallback(() => {
    if (!currentUser?.email) return;
    queryClient.invalidateQueries({ queryKey })
      .then(() => setOptimisticPresence(null)); // clear optimistic once server state arrives
  }, [currentUser?.email, queryClient]);

  /**
   * Write presence fields directly into the React Query cache so any component
   * on any page (Home, Travel, etc.) reads the updated values immediately —
   * without waiting for the DB write + invalidate round-trip.
   */
  const writeToCache = useCallback((presenceFields) => {
    if (!currentUser?.email) return;
    queryClient.setQueryData(queryKey, (old) => {
      if (!old) return old;
      // old may be a single object (useUserSettings shape) or an array (Travel query shape)
      if (Array.isArray(old)) {
        return old.map((item, idx) => idx === 0 ? { ...item, ...presenceFields } : item);
      }
      return { ...old, ...presenceFields };
    });
  }, [currentUser?.email, queryClient]);

  /**
   * Set user as present at a specific location.
   * Applies optimistic update immediately — backend write happens in parallel.
   */
  const setUserLocation = useCallback(async (locationId, locationName) => {
    let resolvedSettingsId = settingsId;

    if (!resolvedSettingsId && currentUser?.email) {
      // settingsId not yet loaded — fetch it directly before writing
      const list = await base44.entities.UserSettings.filter({ owner_email: currentUser.email });
      resolvedSettingsId = list[0]?.id;

      // No record exists yet — create one now so the write can succeed
      if (!resolvedSettingsId) {
        console.warn("[useUserPresence] setUserLocation: no UserSettings record found — creating one for", currentUser.email);
        const created = await base44.entities.UserSettings.create({
          owner_email: currentUser.email,
          owner_user_id: currentUser.id || null,
        });
        resolvedSettingsId = created?.id;
        if (!resolvedSettingsId) {
          console.error("[useUserPresence] setUserLocation: failed to create UserSettings — cannot write presence");
          return;
        }
        console.log("[useUserPresence] setUserLocation: created new UserSettings →", resolvedSettingsId);
        invalidate(); // refresh so the hook has the new record going forward
      }
    }

    if (!resolvedSettingsId) {
      console.error("[useUserPresence] setUserLocation: no settingsId after all attempts — cannot write presence");
      return;
    }

    const activeSettingsId = resolvedSettingsId;
    console.log("[useUserPresence] setUserLocation WRITE →", { activeSettingsId, locationId, locationName, email: currentUser?.email });
    // OPTIMISTIC: update local state AND shared React Query cache so Travel picks it up immediately
    const presenceFields = {
      user_current_location_id: locationId,
      user_current_location_name: locationName,
      user_presence_status: "present",
    };
    setOptimisticPresence({ isAway: false, locationId, locationName, status: "present" });
    writeToCache(presenceFields);
    base44.entities.UserSettings.update(activeSettingsId, {
      user_current_location_id: locationId,
      user_current_location_name: locationName,
      user_presence_status: "present",
      user_presence_updated_at: new Date().toISOString(),
    }).then((result) => {
      console.log("[useUserPresence] setUserLocation WRITE SUCCESS →", { saved_status: result?.user_presence_status, saved_loc: result?.user_current_location_name });
      invalidate();
    }).catch((err) => {
      console.error("[useUserPresence] setUserLocation WRITE FAILED →", err);
      setOptimisticPresence(null);
    });
  }, [settingsId, currentUser?.email, currentUser?.id, invalidate]);

  /**
   * Set user as Away (outside the app world).
   * Applies optimistic update immediately.
   */
  const setUserAway = useCallback(async () => {
    let resolvedSettingsId = settingsId;

    if (!resolvedSettingsId && currentUser?.email) {
      const list = await base44.entities.UserSettings.filter({ owner_email: currentUser.email });
      resolvedSettingsId = list[0]?.id;

      if (!resolvedSettingsId) {
        console.warn("[useUserPresence] setUserAway: no UserSettings record found — creating one for", currentUser.email);
        const created = await base44.entities.UserSettings.create({
          owner_email: currentUser.email,
          owner_user_id: currentUser.id || null,
        });
        resolvedSettingsId = created?.id;
        if (!resolvedSettingsId) {
          console.error("[useUserPresence] setUserAway: failed to create UserSettings — cannot write presence");
          return;
        }
        console.log("[useUserPresence] setUserAway: created new UserSettings →", resolvedSettingsId);
        invalidate();
      }
    }

    if (!resolvedSettingsId) {
      console.error("[useUserPresence] setUserAway: no settingsId after all attempts — cannot write presence");
      return;
    }

    const activeSettingsId = resolvedSettingsId;
    // OPTIMISTIC: update local state AND shared React Query cache
    const presenceFields = {
      user_current_location_id: null,
      user_current_location_name: null,
      user_presence_status: "away",
    };
    setOptimisticPresence({ isAway: true, locationId: null, locationName: null, status: "away" });
    writeToCache(presenceFields);
    base44.entities.UserSettings.update(activeSettingsId, {
      user_current_location_id: null,
      user_current_location_name: null,
      user_presence_status: "away",
      user_presence_updated_at: new Date().toISOString(),
    }).then(() => invalidate()).catch(() => {
      setOptimisticPresence(null);
    });
  }, [settingsId, currentUser?.email, currentUser?.id, invalidate]);

  // Merge: optimistic state wins over server state while pending
  const serverPresence = readUserPresence(currentUser, settings);
  const userPresence = optimisticPresence
    ? {
        ...serverPresence,
        ...optimisticPresence,
        displayName: serverPresence.displayName,
        ownerEmail: serverPresence.ownerEmail,
        ownerUserId: serverPresence.ownerUserId,
      }
    : serverPresence;

  return { userPresence, setUserLocation, setUserAway, isAway: userPresence.isAway };
}