import { useState } from "react";
import { carViewUrls } from "@/lib/ownerBelongings";
import { buildRideNarrative, buildRidePrompt, rideSeating, rideViewForAction } from "@/lib/sceneRide";

/**
 * useSceneRide — Take a Ride as a scene that happens inside the car.
 *
 * Confirming a ride does not move anybody and does not open a new place. It establishes the
 * car as the current scene: the riders are the cast, the owner's own recorded vehicle is the
 * environment, the destination chosen for the ride is kept here, and the ride is recorded in
 * the feed as an event that has already begun.
 *
 * The ride ends in exactly one way — Arrive at Destination — which hands the preserved
 * destination to the established Next Scene transition. Nothing here travels, remembers, or
 * generates anything of its own.
 */
export function useSceneRide({
  drawImage,
  location,
  nextSceneParticipants = [],
  currentUser,
  displayName,
  observeMode,
  setMessages,
  handleNextSceneConfirm,
}) {
  const [ride, setRide] = useState(null);

  // The picture for a moment inside the car: the view follows what is happening, and only
  // the people doing it are in frame.
  const buildRideShot = (currentRide, actionId, actorIds) => {
    if (!currentRide) return null;
    const ids = (actorIds || []).filter(Boolean);
    const view = rideViewForAction({ actionId, actorIds: ids, seating: currentRide.seating });
    const visibleIds = ids.length > 0 ? ids : [currentRide.seating?.driver?.id].filter(Boolean);
    // A moment happens with the car safely stopped, so nobody is driving while it happens.
    return { visibleIds, prompt: buildRidePrompt(currentRide, { view, visibleIds, stopped: true }) };
  };

  const drawRide = (currentRide, shot) => drawImage({
    strictCastOnly: true,
    actionFocusIds: shot.visibleIds,
    actionOverridePrompt: buildRidePrompt(currentRide, shot),
    extraReferenceImages: carViewUrls(currentRide.car),
  });

  const handleRideConfirm = (payload) => {
    const owner = payload?.ride || null;
    const car = owner?.car || null;
    const destination = payload?.destination || null;
    // Without a recorded vehicle or a destination there is no ride: the established
    // transition handles the choice exactly as it always has.
    if (!owner?.ownerId || !car || !destination?.id) return handleNextSceneConfirm(payload);

    const travelers = nextSceneParticipants.filter((p) => (payload.travelerIds || []).includes(p.id));
    const userInCar = payload.mode === "go" && !observeMode && !!currentUser?.id;
    // The account holder takes a seat only when they chose to ride along.
    const riders = [...(userInCar ? [{ id: currentUser.id, name: displayName, isUser: true }] : []), ...travelers];
    const driverId = owner.ownerType === "character"
      ? (travelers.find((t) => t.id === owner.ownerId)?.id || travelers[0]?.id || null)
      : (userInCar ? currentUser.id : travelers[0]?.id || null);
    const seating = rideSeating({ riders, driverId });
    const narrative = buildRideNarrative({
      riders,
      ownerName: owner.ownerName,
      ownerIsUser: owner.ownerType === "user",
      car,
      destinationName: payload.spaceLabel || destination.name,
      originName: location?.name,
    });
    const rideStarted = { id: `ride_start_${Date.now()}`, sender: "narrative", content: narrative, is_canon_event: true, timestamp: new Date().toISOString() };

    if (!userInCar) {
      // Sending them: the characters ride and arrive through the established transition. The
      // account holder is never put into a car they did not get into.
      setMessages((prev) => [...prev, rideStarted]);
      return handleNextSceneConfirm(payload);
    }

    const nextRide = {
      ...owner, car, destination,
      zoneName: payload.zoneName || "", unitId: payload.unitId || "",
      environmentId: payload.environmentId || "", spaceLabel: payload.spaceLabel || "",
      travelerIds: payload.travelerIds || [], riders, seating, userInCar,
    };
    setRide(nextRide);
    // The ride has begun: an event that already happened, never something said out loud.
    setMessages((prev) => [...prev, rideStarted]);
    // The top picture is the car itself — the front cabin, the driver and the seat beside them.
    drawRide(nextRide, { view: "front_seats", visibleIds: [seating.driver?.id, seating.frontPassenger?.id].filter(Boolean), stopped: false });
  };

  // Arriving is the ride's only ending: the same transition every scene uses, with the
  // destination already chosen, so nothing is asked for a second time.
  const handleArriveAtDestination = () => {
    if (!ride) return;
    const payload = {
      destination: ride.destination, zoneName: ride.zoneName, unitId: ride.unitId,
      environmentId: ride.environmentId, spaceLabel: ride.spaceLabel,
      travelerIds: ride.travelerIds, mode: "go",
    };
    setRide(null);
    return handleNextSceneConfirm(payload);
  };

  return { ride, handleRideConfirm, handleArriveAtDestination, buildRideShot };
}