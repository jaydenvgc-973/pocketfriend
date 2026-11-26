/**
 * sceneRide.js — Take a Ride, as a scene that happens inside the car.
 *
 * A ride is not a new place and not a new travel system: the car is the scene's temporary
 * environment, described entirely by the owner's own Property / Belongings record. This file
 * holds the three things the ride needs from that record:
 *   - which established activities make sense inside a moving car,
 *   - the narrative that establishes the ride has begun,
 *   - the vehicle facts and the camera view the top picture is drawn from.
 *
 * Nothing here invents a vehicle, a passenger, or a seat: every fact comes from the owner's
 * car record and from the people actually riding.
 */
import { carLabel, carViewUrls } from "@/lib/ownerBelongings";
import { getEasternLightingDescriptor } from "@/lib/sceneImagePromptBuilder";

/**
 * The established activities that physically make sense inside a car. Everything else the
 * venue offers — cooking, showering, brushing teeth, making a bed, sleeping, a venue's own
 * business — is not offered while the scene is a car. Send Money and Receive Money are
 * scene controls, not activities, and stay available in the strip's General folder.
 */
export const IN_CAR_ACTION_IDS = new Set([
  // social, friendship and interpersonal — the established directed interactions
  "goof_around", "show_appreciation", "bond_with", "flirt_with", "kiss", "moonwink",
  "argue_with", "fight_with",
  // eating and drinking something already with them
  "eat", "drink",
  // resting in a seat — never an action that needs a couch, a bed or a bathroom
  "relax",
  // conversation and passing the time
  "talk", "chat", "joke", "flirt", "ask", "ask_question", "ask_help", "pass_note",
  "group", "one_on_one", "overhear", "notice_watching",
  // things done sitting in a seat
  "music", "read", "check_phone", "observe", "people_watch", "cloud_watch",
  "watch_sunset", "sketch",
]);

/** Is this established activity one a person can actually do inside a car? */
export function isInCarActivity(action) {
  return !!action?.id && IN_CAR_ACTION_IDS.has(action.id);
}

const listNames = (names) => {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
};

// ── SEATING ──────────────────────────────────────────────────────────────────
// The owner drives their own car. The account holder drives when the car is theirs. The
// front passenger takes the seat beside the driver and everyone else sits in the back.
// Seating is decided once, when the ride begins, and never shuffled between pictures.
export function rideSeating({ riders = [], driverId = null }) {
  const list = (riders || []).filter((r) => r?.id);
  const driver = list.find((r) => r.id === driverId) || list[0] || null;
  const rest = list.filter((r) => r.id !== driver?.id);
  return { driver, frontPassenger: rest[0] || null, back: rest.slice(1) };
}

/**
 * Which of the four established vehicle views this moment is drawn from. The view is only
 * where the camera stands — the seats, the wheel and the people in them never move.
 */
export function rideViewForAction({ actorIds = [], seating = null } = {}) {
  if (!seating?.driver) return "front_seats";
  const ids = (actorIds || []).filter(Boolean);
  const inBack = (id) => (seating.back || []).some((b) => b.id === id);
  // Anyone in the back seat is seen from the front of the cabin, looking back at them.
  if (ids.some(inBack)) return "back_row";
  if (ids.length === 1 && ids[0] === seating.driver.id) return "driver_seat";
  return "front_seats";
}

/**
 * The established actions that need the car stopped: they take the driver's hands off the
 * wheel. Everything else happens while the car is moving, with the driver still driving.
 */
export const RIDE_STOPPED_ACTION_IDS = new Set([
  "goof_around", "show_appreciation", "bond_with", "flirt_with", "kiss", "moonwink",
  "argue_with", "fight_with", "eat", "drink",
]);

// ── THE RIDE BEGINS ──────────────────────────────────────────────────────────
/**
 * The canonical line that establishes the ride. It is an event that has already happened —
 * who got in, whose car it is, and where they are headed — written from the people and the
 * vehicle that were actually chosen. It is never phrased as something the user said.
 */
export function buildRideNarrative({ riders = [], ownerName, ownerIsUser = false, car, destinationName, originName }) {
  const names = (riders || []).map((r) => r?.name).filter(Boolean);
  const carName = carLabel(car) || "car";
  const whose = ownerIsUser ? "your" : `${ownerName}'s`;
  const destination = destinationName || "their destination";
  const origin = originName || "the kerb";

  if (names.length === 1 && riders[0]?.isUser) {
    return `You settle into ${whose} ${carName} and close the door. A moment later the engine turns over and the car pulls away from ${origin}, heading for ${destination}.`;
  }

  const variants = [
    `${listNames(names)} settle into ${whose} ${carName}, the doors closing behind them. After a moment the engine starts, and they pull away from ${origin}, bound for ${destination}.`,
    `${listNames(names)} get into ${whose} ${carName} and shut the doors. The engine catches, and the car eases away from ${origin} toward ${destination}.`,
    `The doors of ${whose} ${carName} close on ${listNames(names)}, and a moment later the car pulls out from ${origin} and heads for ${destination}.`,
  ];
  // A different phrasing each ride, always from the same established facts.
  return variants[Math.abs(`${carName}${destination}${names.join("")}`.length) % variants.length];
}

// ── WHAT THE CHARACTERS KNOW ─────────────────────────────────────────────────
/**
 * The vehicle, as the scene's own context block. It goes into the same circumstances block
 * every other scene fact goes into, so the characters speak from it rather than from a
 * guess: whose car it is, what it is, and where it is going.
 */
export function buildRideContextBlock(ride) {
  if (!ride?.car) return "";
  const car = ride.car;
  const label = carLabel(car) || "car";
  const extra = String(car.description || "").trim();
  const riders = (ride.riders || []).filter((r) => r?.name);
  const driver = ride.seating?.driver;
  const passengers = riders.filter((r) => r.id !== driver?.id).map((r) => r.name);
  const owner = ride.ownerName || "the owner";
  return `=== RIDING IN A CAR (ALREADY TRUE) ===
- Everyone in this scene is inside ${owner}'s ${label}${extra ? ` — ${extra}` : ""}, on the way to ${ride.destination?.name || "their destination"}.
- The vehicle is established and exact: ${label}. Its body, paint, seats, dashboard and trim are the ones recorded for it. Never describe a different car, a different colour, or an interior that contradicts this.
- ${driver?.name ? `${driver.name} is driving.` : ""}${passengers.length > 0 ? ` ${listNames(passengers)} ${passengers.length === 1 ? "is" : "are"} in the car with them.` : ""} Nobody else is in the car.
- This is a car interior, not a room: the street outside is only visible through the windows, and the car does not have a kitchen, bathroom or bedroom.
- Ordinary conversation carries on normally. The car does not need to be mentioned in every line, and nobody announces that they are in a car.
- The car is moving. An action that needs the car stopped is preceded by the car safely pulling over.`;
}

// ── THE PICTURE ──────────────────────────────────────────────────────────────
/**
 * The top picture during a ride, drawn from one of the vehicle's four established
 * references. The camera moves; the vehicle and the people in their seats do not.
 * Only the people the chosen view frames are named — being off-camera never means a
 * person has left the car.
 */
export function buildRidePrompt(ride, { view = "front_seats", visibleIds = [], stopped = false, lighting = null } = {}) {
  const car = ride?.car || {};
  const label = carLabel(car) || "car";
  const extra = String(car.description || "").trim();
  const owner = ride?.ownerName || "the owner";
  const seating = ride?.seating || {};
  const nameOf = (id) => (ride?.riders || []).find((r) => r.id === id)?.name || null;
  const seatOf = (id) => {
    if (!id) return null;
    if (id === seating.driver?.id) return "driver's seat";
    if (id === seating.frontPassenger?.id) return "front passenger seat";
    if ((seating.back || []).some((b) => b.id === id)) return "back seat";
    return "seated in the cabin";
  };
  const visible = (visibleIds || []).map((id) => ({ name: nameOf(id), seat: seatOf(id) })).filter((v) => v.name);
  const inFrame = visible.length > 0
    ? `In frame: ${visible.map((v) => `${v.name} in the ${v.seat}`).join("; ")}.`
    : "No one is in frame — only the vehicle's cabin.";

  // The whole seating plan, stated once so no picture can reshuffle it.
  const seatLines = [
    seating.driver ? `- ${seating.driver.name}: driver's seat, behind the steering wheel.` : null,
    seating.frontPassenger ? `- ${seating.frontPassenger.name}: front passenger seat, beside the driver.` : null,
    ...(seating.back || []).map((b) => `- ${b.name}: back seat.`),
  ].filter(Boolean);

  const motion = stopped
    ? "The car is pulled over and stationary, engine idling; the driver's hands are off the wheel for this moment."
    : "The car is moving; the driver's hands stay on the wheel and their eyes on the road, and the street beyond the glass is softly blurred.";

  const cameraText = view === "driver_seat"
    ? `CAMERA (this picture only): just behind and beside the driver's shoulder, looking forward past them toward the windshield — the back of the driver's head and their shoulder in the near foreground, hands on the wheel, dashboard and instrument panel below, the road ahead beyond the glass.`
    : view === "back_row"
      ? `CAMERA (this picture only): inside the cabin at the front, turned around to look back into the rear seating area — the back-seat occupants' faces, the rear side windows and the street behind them. The front seats are foreground shapes in the near frame; the windshield is behind the camera, not in the picture.`
      : view === "exterior"
        ? `CAMERA (this picture only): outside the vehicle on the street, the whole car in frame with its surroundings.`
        : `CAMERA (this picture only): inside the cabin behind the front seats, looking forward over the driver's shoulder toward the windshield — the driver's seat, the front passenger seat, the dashboard and steering wheel, and the road ahead beyond the glass.`;

  const light = lighting ? ` TIME OF DAY (authoritative): ${lighting}. The street outside, the windows and the dashboard show exactly that light. The reference photographs were taken at their own time of day — use them only for the car's shape and interior, never for its lighting.` : "";

  return `${cameraText}

VEHICLE GEOMETRY (absolute — the camera moves, the car does not):
- The vehicle is ${owner}'s ${label}${extra ? `, ${extra}` : ""}. Its body, paint, seats, dashboard, steering wheel, door panels and trim are exactly the vehicle in the supplied reference photographs — same make, model, colours, materials and proportions.
- Those photographs are four views of ONE vehicle: the exterior, the driver's position, the front cabin and the rear seating area. They show where the steering wheel, the dashboard, the windshield, the front seats and the back seats actually are. Keep that exact layout.
- The steering wheel, dashboard and windshield stay where the references show them. No seat moves, turns around, is swapped, added or removed, and the wheel is never mirrored to the other side of the car.
- Every occupant faces forward, toward the windshield. In a view taken from behind them you see the backs of their heads and shoulders — the same people facing the same way, never turned seats.

SEATING (fixed for this whole ride):
${seatLines.join("\n")}

${inFrame} Anyone not listed is still in the car but outside this camera's frame — never add a person, never move someone to fill a seat.

${motion}${light}

CONTINUITY: this is one continuous ride. Each person's face, hair, hairstyle, hair length and texture, skin, build, clothes, shoes and accessories are exactly the same as in the other pictures of this ride — only the camera position and what they are doing change.`;
}

/**
 * The vehicle as the picture's environment — said instead of any room. It replaces the
 * zone/room note, so a picture taken inside a car can never be composed as a living room.
 */
export function buildVehicleEnvironmentNote(ride, lighting) {
  const label = carLabel(ride?.car) || "car";
  return `ENVIRONMENT (authoritative): the entire picture is inside the cabin of ${label} — seats, dashboard, windows, trim. No room, no walls, no furniture, no domestic interior, no floor plan of any building. The street is only visible through the car's own glass. Apply ${lighting}; the reference photographs are for the car's geometry only, never for its time of day.`;
}

/**
 * The last word in the prompt, after the identity bundles: one continuous ride, the same
 * people in the same seats, the same clothes, the same hour.
 */
export function buildRideContinuityLock(ride, lighting) {
  const seating = ride?.seating || {};
  const riders = (ride?.riders || []).filter((r) => r?.name);
  const who = riders.map((r) => `${r.name} — ${r.id === seating.driver?.id ? "driver's seat" : r.id === seating.frontPassenger?.id ? "front passenger seat" : "back seat"}`).join("; ");
  return ` RIDE CONTINUITY LOCK (absolute, overrides any other instruction about attire, pose, seating or lighting): this is one unbroken car ride. ${who ? `Seats, fixed: ${who}. ` : ""}Everyone stays in their own seat and faces the windshield. Nobody changes clothes, hairstyle or appearance between pictures of this ride, and no outfit is invented for anyone who already has one on. The steering wheel, dashboard and seats never move. ${lighting ? `The time of day is ${lighting} — the same hour as the rest of this ride.` : ""} The car is the environment; a room, house or living room must never appear.`;
}

/**
 * Everything one ride picture needs, from the same place, so the first picture and every
 * picture after it are drawn from the identical vehicle, seating and time.
 */
export function rideImageRequest(ride, { view = "front_seats", visibleIds = [], stopped = false } = {}) {
  const lighting = getEasternLightingDescriptor();
  return {
    strictCastOnly: true,
    actionFocusIds: visibleIds,
    actionOverridePrompt: buildRidePrompt(ride, { view, visibleIds, stopped, lighting }),
    environmentRefsOverride: carViewUrls(ride?.car),
    environmentNote: buildVehicleEnvironmentNote(ride, lighting),
    postPromptLock: buildRideContinuityLock(ride, lighting),
    keepImageOnFailure: true,
    maxRefsPerPerson: 1,
    supersede: true,
  };
}