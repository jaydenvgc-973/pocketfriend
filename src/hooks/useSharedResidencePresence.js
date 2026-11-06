import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * useSharedResidenceParticipants
 *
 * The people ACTUALLY present at a shared residential location, across accounts.
 * Presence — not a session, not ownership — is the participation authority, so
 * the projection comes from the same backend function the Gathering Rooms use
 * (getGatheringRoomParticipants) in location mode.
 */
export function useSharedResidenceParticipants(locationId, enabled = true) {
  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["sharedResidenceParticipants", locationId],
    queryFn: async () => {
      if (!locationId) return [];
      const res = await base44.functions.invoke("getGatheringRoomParticipants", {
        location_id: locationId,
      });
      return res?.data?.participants || [];
    },
    enabled: !!locationId && enabled,
  });

  return { participants: data, isLoading, refetch };
}