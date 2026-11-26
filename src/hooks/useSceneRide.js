import { useState } from "react";
import { buildRideNarrative, rideSeating, rideViewForAction, rideImageRequest, RIDE_STOPPED_ACTION_IDS, RIDE_SOLO_ACTION_IDS } from "@/lib/sceneRide";
import { activityBehaviorFor } from "@/lib/sceneActivityBehavior";

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

  // The picture for a moment inside the car: only the camera moves, and only the people
  // doing the thing are in frame. Their seats never change with the view.
  const buildRideShot = (currentRide, action, actorIds, recipientIds = []) => {
    if (!currentRide) return null;
    const ids = (actorIds || []).filter(Boolean);
    const recipients = (recipientIds || []).filter(Boolean);
    const actionId = action?.id || null;
    // One person doing something is framed on that person; a moment between two people is
    // framed as that moment. Either way the camera follows what is actually being done.
    const framedActors = RIDE_SOLO_ACTION_IDS.has(actionId) && recipients.length === 0 ? ids.slice(0, 1) : ids;
    const visibleIds = [...framedActors, ...recipients];
    const view = rideViewForAction({ actionId, actorIds: visibleIds, seating: currentRide.seating });
    // A moment that takes the driver's hands off the wheel pulls the car over first.
    const stopped = RIDE_STOPPED_ACTION_IDS.has(actionId);
    // The activity itself travels with the request: it is the subject of the picture.
    const actionDetail = action ? {
      id: action.id,
      label: action.label,
      emoji: action.emoji,
      behavior: activityBehaviorFor(action),
      verb: action.verb,
      pastVerb: action.past_verb,
      actorIds: framedActors,
      recipientIds: recipients,
    } : null;
    return { view, visibleIds, stopped, action: actionDetail };
  };

  // Every ride picture — the first one and every one after it — comes from the same
  // vehicle references, the same seating and the same authoritative hour.
  const drawRide = (currentRide, shot) => drawImage(rideImageRequest(currentRide, shot));

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

    // Confirming a ride always establishes the ride. Whether the account holder is riding
    // along or watching decides only whether they occupy a seat — never whether the car
    // becomes the scene. The destination is kept for Arrive at Destination, so confirming
    // a ride can never skip straight to it.
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
      travelerIds: ride.travelerIds,
      // Only a ride the account holder was actually in takes them to the destination with
      // the others; a ride they watched leaves them exactly where they are.
      mode: ride.userInCar ? "go" : "send",
    };
    setRide(null);
    return handleNextSceneConfirm(payload);
  };

  return { ride, handleRideConfirm, handleArriveAtDestination, buildRideShot };
}