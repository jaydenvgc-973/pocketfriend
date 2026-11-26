import { useEffect, useRef } from "react";
import { loadBelongings, hasCar } from "@/lib/ownerBelongings";

/**
 * useRideSceneImage — a scene that was reached by car shows the ride.
 *
 * Once the destination scene's own picture has landed, the people who rode are drawn
 * inside the owner's actual vehicle, against that vehicle's registered references. It
 * happens once per scene, only for a scene opened by a confirmed ride, and only when the
 * owner really has a car recorded.
 */
export function useRideSceneImage({ rideOwnerId, rideOwnerType, ownerEmail, participantsReady, location, sceneImage, isGeneratingImage, drawRide }) {
  const drawn = useRef(false);

  useEffect(() => {
    if (!rideOwnerId || drawn.current) return;
    if (!participantsReady || !location || !sceneImage || isGeneratingImage) return;
    drawn.current = true;
    loadBelongings(ownerEmail, rideOwnerType || "character", rideOwnerId).then((record) => {
      const car = record?.car;
      if (hasCar(car)) drawRide(car);
    });
  }, [rideOwnerId, rideOwnerType, ownerEmail, participantsReady, location?.id, sceneImage, isGeneratingImage]);
}