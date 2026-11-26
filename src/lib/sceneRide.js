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
 * A moment between two people — framed as that moment, never as two people sitting apart.
 */
const RIDE_PAIR_ACTION_IDS = new Set([
  "kiss", "flirt_with", "bond_with", "show_appreciation", "goof_around",
  "argue_with", "fight_with", "moonwink", "pass_note",
]);

/** Looking out at the world: the glass, the road and the dashboard are the picture. */
const RIDE_VIEW_OUT_ACTION_IDS = new Set(["watch_sunset", "cloud_watch", "people_watch", "observe"]);

/** One person doing something to or with something — framed on that person. */
export const RIDE_SOLO_ACTION_IDS = new Set(["drink", "eat", "relax", "read", "music", "check_phone", "sketch"]);

/** Which established reference belongs to each camera. */
const VIEW_REFERENCE = {
  front_seats: "front_seats",
  driver_seat: "driver_seat",
  driver_focus: "driver_seat",
  passenger_seat: "front_seats",
  interaction: "front_seats",
  windshield: "front_seats",
  back_row: "back_row",
  exterior: "exterior",
};

/**
 * The vehicle's own four references, with the one that matches this camera first, so the
 * picture is built from the view it is actually taken from. The rest stay supplied, so the
 * model keeps the whole vehicle's geometry — the wheel, the doors, the seat positions.
 */
export function orderedCarViewUrls(car, view = "front_seats") {
  const key = VIEW_REFERENCE[view] || "front_seats";
  const primary = car?.views?.[key];
  const urls = carViewUrls(car);
  if (typeof primary !== "string" || !primary.trim()) return urls;
  return [primary, ...urls.filter((u) => u !== primary)];
}

/**
 * Where the camera stands for this moment. The view is chosen from what is actually being
 * done and where the person doing it is sitting — never from a single default composition.
 * The seats, the wheel and the people in them never move: only the camera does.
 */
export function rideViewForAction({ actionId = null, actorIds = [], seating = null } = {}) {
  if (!seating?.driver) return "front_seats";
  const ids = (actorIds || []).filter(Boolean);
  const driverId = seating.driver.id;
  const passengerId = seating.frontPassenger?.id || null;
  const inBack = (id) => (seating.back || []).some((b) => b.id === id);

  // A moment between two people is framed as that moment, from the side of the cabin.
  if (RIDE_PAIR_ACTION_IDS.has(actionId) && ids.length >= 2) {
    return ids.some(inBack) ? "back_row" : "interaction";
  }
  // Watching the world go by: the windshield, the road and the dashboard are the picture.
  if (RIDE_VIEW_OUT_ACTION_IDS.has(actionId)) return "windshield";
  // One person doing something is framed on that person, from their own side of the car.
  if (ids.length === 1) {
    if (ids[0] === driverId) return "driver_focus";
    if (ids[0] === passengerId) return "passenger_seat";
    if (inBack(ids[0])) return "back_row";
  }
  // A conversation between people in the same row is seen from inside that row.
  if (ids.some(inBack)) return "back_row";
  if (ids.includes(driverId) && ids.includes(passengerId)) return "front_seats";
  if (ids.includes(driverId)) return "driver_focus";
  if (ids.includes(passengerId)) return "passenger_seat";
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
export function buildRidePrompt(ride, { view = "front_seats", visibleIds = [], stopped = false, lighting = null, action = null } = {}) {
  const car = ride?.car || {};
  const label = carLabel(car) || "car";
  const extra = String(car.description || "").trim();
  const owner = ride?.ownerName || "the owner";
  const seating = ride?.seating || {};
  const hasRefs = carViewUrls(car).length > 0;
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

  // Each camera is a genuinely different place to stand inside (or outside) the same car.
  // They are not rewordings of one composition.
  const CAMERA_TEXT = {
    front_seats: `from between and slightly behind the two front seats, high enough to see both occupants' faces in three-quarter as they look ahead — the wheel and dashboard between them, the windshield and the road beyond.`,
    driver_seat: `just behind and beside the driver's shoulder, looking forward past them toward the windshield — the back of the driver's head and shoulder in the near foreground, hands on the wheel, the instrument panel below, the road ahead beyond the glass.`,
    driver_focus: `inside the cabin from the front passenger side, turned three-quarters toward the driver — the driver's face, hands and the wheel, the dashboard, and the driver's own door and window behind them.`,
    passenger_seat: `inside the cabin from the driver's side, across toward the front passenger — the passenger's face and upper body in three-quarter view, their own door and window behind them, the dashboard and console in the near foreground.`,
    interaction: `from the front corner of the cabin between the dashboard and the passenger door, framing the two front occupants from the side so they are seen turned toward one another — both faces readable in three-quarter, the space between them at the centre of the frame.`,
    back_row: `inside the cabin at the front, turned around to look back into the rear seating area — the back-seat occupants, the rear side windows and the street behind them. The front seats are foreground shapes in the near frame; the windshield is behind the camera, not in the picture.`,
    windshield: `low in the cabin at the dashboard, looking forward through the windshield — the glass, the wipers, the hood, the street and the sky beyond, with the instrument panel along the bottom of the frame. Occupants may be absent, or only at the edge of the frame.`,
    exterior: `outside the vehicle on the street, the whole car in frame with its surroundings.`,
  };
  const cameraText = `CAMERA (this picture only): ${CAMERA_TEXT[view] || CAMERA_TEXT.front_seats}`;

  const light = lighting ? ` TIME OF DAY (authoritative): ${lighting}. The street outside, the windows and the dashboard show exactly that light. The reference photographs were taken at their own time of day — use them only for the car's shape and interior, never for its lighting.` : "";

  // The activity is the subject of the picture; the car is only where it happens.
  const actionBlock = (() => {
    if (!action?.label) return "";
    const actors = (action.actorIds || []).map(nameOf).filter(Boolean);
    const recipients = (action.recipientIds || []).map(nameOf).filter(Boolean);
    const actorText = listNames(actors);
    const recipientText = listNames(recipients);
    const done = action.behavior === "immediate";
    const verb = (done ? action.pastVerb : action.verb) || String(action.label).toLowerCase();
    const doing = [actorText || "Someone", verb, recipientText].filter(Boolean).join(" ");
    const onlyActor = actorText && recipients.length === 0 ? ` Only ${actorText} is doing this — nobody else in the car is.` : "";
    const receives = recipientText ? ` ${actorText || "They"} is the one doing it; ${recipientText} receives it and reacts.` : "";
    return `

ACTION — THE SUBJECT OF THIS PICTURE (the reason it exists): ${doing}${done ? " — already done; depict it as it stands." : " — happening right now."}
- The action is what the camera is looking at. The car is only the environment around it. People sitting still is NOT this action.
- Its physical evidence must be visible in the frame: hands, objects, posture, eyelines and the space between the people must make it unmistakable.${onlyActor}${receives}
- ⛔ NOBODY LOOKS AT THE CAMERA. Nobody poses for a photograph or turns to face the lens. Each person's attention is on what they are doing, or on the person they are doing it with.`;
  })();

  return `${cameraText}${actionBlock}

VEHICLE GEOMETRY (absolute — the camera moves, the car does not):
- The vehicle is ${owner}'s ${label}${extra ? `, ${extra}` : ""}. ${hasRefs ? `Its body, paint, seats, dashboard, steering wheel, door panels and trim are exactly the vehicle in the supplied reference photographs — same make, model, colours, materials and proportions.` : `Its interior is the ordinary cabin of that exact vehicle, consistent with the written description above.`}
${hasRefs ? `- The supplied photographs are views of ONE vehicle: the exterior, the driver's position, the front cabin and the rear seating area. The one matching this camera comes first; the rest are beside it so the whole cabin stays consistent. They show where the steering wheel, the dashboard, the windshield, the front seats and the back seats actually are. Keep that exact layout.` : `- Keep one consistent cabin: the same wheel, dashboard, seats and trim in every picture of this ride.`}
- The steering wheel, dashboard and windshield stay where the references show them. No seat moves, turns around, is swapped, added or removed, and the wheel is never mirrored to the other side of the car.
- Every occupant sits facing forward in their own seat, toward the windshield. A camera placed behind them may still see their faces in three-quarter as they look to the road, the mirrors or each other — but no seat is turned, no body is turned around, and nobody turns to face the lens.

SEATING (fixed for this whole ride):
${seatLines.join("\n")}

${inFrame} Anyone not listed is still in the car but outside this camera's frame — never add a person, never move someone to fill a seat, and never replace anyone with a different-looking person. Each occupant's face, skin tone, hair and build come only from that person's own reference photograph: the driver is ${seating.driver?.name || "the established driver"} and stays ${seating.driver?.name || "the established driver"}, never a substitute, never a stock driver.

${motion}${light}

CONTINUITY: this is one continuous ride. Each person's face, hair, hairstyle, hair length and texture, skin, build, clothes, shoes and accessories are exactly the same as in the other pictures of this ride — only the camera position and what they are doing change. ⛔ Clothing is their established outfit (or, with none on file, exactly what their own reference photograph shows). No jacket, coat, scarf, hat or accessory is added or removed because the camera moved or because of what they are doing.`;
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
  return ` RIDE CONTINUITY LOCK (absolute, overrides any other instruction about attire, pose, seating or lighting): this is one unbroken car ride. ${who ? `Seats, fixed: ${who}. ` : ""}Everyone stays in their own seat and faces forward in it — toward the windshield, or toward whoever they are interacting with — and nobody ever turns to look into the camera or poses for a photograph. Nobody changes clothes, hairstyle or appearance between pictures of this ride, and no outfit is invented for anyone who already has one on. The steering wheel, dashboard and seats never move. ${lighting ? `The time of day is ${lighting} — the same hour as the rest of this ride.` : ""} The car is the environment; a room, house or living room must never appear.`;
}

/**
 * Everything one ride picture needs, from the same place, so the first picture and every
 * picture after it are drawn from the identical vehicle, seating and time.
 */
export function rideImageRequest(ride, { view = "front_seats", visibleIds = [], stopped = false, action = null } = {}) {
  const lighting = getEasternLightingDescriptor();
  return {
    strictCastOnly: true,
    actionFocusIds: visibleIds,
    actionOverridePrompt: buildRidePrompt(ride, { view, visibleIds, stopped, lighting, action }),
    // The view this picture is taken from comes first, with the rest of the vehicle's own
    // references beside it — every ride picture keeps all four, never a generic interior.
    environmentRefsOverride: orderedCarViewUrls(ride?.car, view),
    environmentNote: buildVehicleEnvironmentNote(ride, lighting),
    postPromptLock: buildRideContinuityLock(ride, lighting),
    keepImageOnFailure: true,
    maxRefsPerPerson: 1,
    supersede: true,
  };
}