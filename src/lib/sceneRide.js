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
import { carLabel } from "@/lib/ownerBelongings";

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
  // rest and quiet
  "relax", "nap",
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

/** Which of the four established vehicle views this moment is drawn from. */
export function rideViewForAction({ actorIds = [], seating = null } = {}) {
  if (!seating?.driver) return "front_seats";
  const ids = (actorIds || []).filter(Boolean);
  const everyoneInBack = ids.length > 0 && ids.every((id) => seating.back.some((b) => b.id === id));
  if (everyoneInBack) return "back_row";
  if (ids.length === 1 && ids[0] === seating.driver.id) return "driver_seat";
  return "front_seats";
}

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
 * references. Only the people the chosen view actually frames are named; being off-camera
 * never means a person has left the car.
 */
export function buildRidePrompt(ride, { view = "front_seats", visibleIds = [], stopped = false } = {}) {
  const car = ride?.car || {};
  const label = carLabel(car) || "car";
  const extra = String(car.description || "").trim();
  const owner = ride?.ownerName || "the owner";
  const nameOf = (id) => (ride?.riders || []).find((r) => r.id === id)?.name || null;
  const seatOf = (id) => {
    if (!id) return null;
    if (id === ride?.seating?.driver?.id) return "driver's seat, hands on the wheel";
    if (id === ride?.seating?.frontPassenger?.id) return "front passenger seat";
    if ((ride?.seating?.back || []).some((b) => b.id === id)) return "back seat";
    return "seated in the cabin";
  };
  const visible = (visibleIds || []).map((id) => ({ name: nameOf(id), seat: seatOf(id) })).filter((v) => v.name);
  const inFrame = visible.length > 0
    ? `In frame: ${visible.map((v) => `${v.name} in the ${v.seat}`).join("; ")}.`
    : "No one is in frame — only the vehicle's cabin.";

  const motion = stopped
    ? "The car is pulled over at the kerb, stationary, engine idling."
    : "The car is moving; the street beyond the glass is softly blurred.";

  const vehicleTruth = `The vehicle is ${owner}'s ${label}${extra ? `, ${extra}` : ""}. Its body, paint, seats, dashboard, steering wheel, trim and interior are exactly the vehicle in the supplied reference images — same make, model, colours and materials.`;

  const viewText = view === "driver_seat"
    ? `Photorealistic photograph taken from the driver's position inside this car: steering wheel and dashboard in the foreground, the road ahead through the windshield.`
    : view === "back_row"
      ? `Photorealistic photograph taken from the front of the cabin looking back at the rear seating area of this car.`
      : view === "exterior"
        ? `Photorealistic photograph of this car seen from outside, the whole vehicle in frame.`
        : `Photorealistic photograph taken from the rear of the cabin looking forward inside this car: front cabin, driver's seat, passenger seat and the windshield with the street beyond.`;

  return `${viewText} ${vehicleTruth} ${inFrame} Nobody else is in the car — no additional passengers, no one outside the vehicle. Everyone in frame is fully dressed in their own clothes, each face, hair and build exactly as in their own reference image. ${motion}`;
}