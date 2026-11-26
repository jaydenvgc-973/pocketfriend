import { base44 } from "@/api/base44Client";

/**
 * ownerBelongings.js — the one place that reads and writes an owner's Property / Belongings.
 *
 * One record per owner (the account holder or one character), keyed by owner_type + owner_id,
 * so a car or pet is always the correct owner's. Nothing here invents a vehicle or an animal:
 * an owner without a car has no car, and an owner without a pet has no pet.
 */

export const CAR_VIEWS = [
  { key: "exterior", label: "Exterior", hint: "Full-body view: body style and color." },
  { key: "driver_seat", label: "Driver's Seat", hint: "Interior from the driver's position." },
  { key: "back_row", label: "Back Row", hint: "The rear seating area." },
  { key: "front_seats", label: "Front Seats / Windshield", hint: "Front cabin, seats and windshield." },
];

export const PET_TYPES = [
  { value: "dog", label: "Dog" },
  { value: "cat", label: "Cat" },
  { value: "bird", label: "Bird" },
  { value: "fish", label: "Fish" },
  { value: "rabbit", label: "Rabbit" },
  { value: "hamster", label: "Hamster / Guinea pig" },
  { value: "reptile", label: "Reptile" },
  { value: "horse", label: "Horse" },
  { value: "other", label: "Other — type it in" },
];

export function emptyCar() {
  return { label: "", color: "", description: "", views: {} };
}

export function emptyPet() {
  return { pet_type: "", pet_type_custom: "", name: "", image_url: "", notes: "" };
}

/** Every reference this car has, in view order. */
export function carViewUrls(car) {
  const views = car?.views || {};
  return CAR_VIEWS.map((v) => views[v.key]).filter((u) => typeof u === "string" && u.trim().length > 0);
}

export function carLabel(car) {
  const label = String(car?.label || "").trim();
  const color = String(car?.color || "").trim();
  if (label && color) return `${color} ${label}`;
  return label || (carViewUrls(car).length > 0 ? "car" : "");
}

/** A car exists only when the owner actually recorded one. */
export function hasCar(car) {
  if (!car) return false;
  return String(car.label || "").trim().length > 0 || carViewUrls(car).length > 0;
}

export function hasPet(pet) {
  if (!pet) return false;
  return !!(String(pet.pet_type || "").trim() || String(pet.pet_type_custom || "").trim() || String(pet.name || "").trim() || pet.image_url);
}

/** What the animal actually is, in the owner's own words when they typed one. */
export function petLabel(pet) {
  const custom = String(pet?.pet_type_custom || "").trim();
  if (custom) return custom;
  const preset = PET_TYPES.find((p) => p.value === pet?.pet_type);
  return preset ? preset.label.toLowerCase() : "pet";
}

export async function loadBelongings(ownerEmail, ownerType, ownerId) {
  if (!ownerEmail || !ownerId) return null;
  const rows = await base44.entities.OwnerBelongings.filter({ owner_email: ownerEmail, owner_type: ownerType, owner_id: ownerId }, "-updated_date", 1);
  return rows?.[0] || null;
}

/** Every belongings record on the account, so a scene can look one up by owner id. */
export async function loadAccountBelongings(ownerEmail) {
  if (!ownerEmail) return [];
  return await base44.entities.OwnerBelongings.filter({ owner_email: ownerEmail }, "-updated_date", 200);
}

/** Save one owner's belongings. Updates the owner's existing record, never creates a second. */
export async function saveBelongings({ existing, ownerType, ownerId, ownerEmail, ownerName, patch }) {
  const body = { ...patch };
  if (existing?.id) return await base44.entities.OwnerBelongings.update(existing.id, body);
  return await base44.entities.OwnerBelongings.create({
    owner_type: ownerType,
    owner_id: ownerId,
    owner_email: ownerEmail,
    owner_name: ownerName || "",
    ...body,
  });
}

// ── IMAGE PROMPTS ────────────────────────────────────────────────────────────
// All four views describe the SAME vehicle: the label and color are repeated in each one,
// and the interior views are drawn against the exterior so they stay the same car.

export function carViewPrompt(car, viewKey) {
  const label = carLabel(car) || "car";
  const extra = String(car?.description || "").trim();
  const tail = extra ? ` ${extra}` : "";
  switch (viewKey) {
    case "driver_seat":
      return `Photorealistic interior photograph of the same ${label} — the driver's seat viewpoint: steering wheel, dashboard and cockpit, seats and trim exactly matching the supplied reference of this vehicle.${tail} No people.`;
    case "back_row":
      return `Photorealistic interior photograph of the rear seating area of the same ${label} — empty back seats, seat fabric and trim exactly matching the supplied references of this vehicle.${tail} No people.`;
    case "front_seats":
      return `Photorealistic interior photograph of the front cabin of the same ${label} seen from the back seat — driver's seat, passenger seat and windshield, trim exactly matching the supplied references of this vehicle.${tail} No people.`;
    default:
      return `Photorealistic automotive photograph of a ${label}, full-body exterior three-quarter view, parked on a neutral street in natural daylight, the whole vehicle in frame, accurate body style and paint.${tail} No people, no added text.`;
  }
}

/** The references a new view is drawn against, so the four views are one vehicle. */
export function carReferenceUrls(car, viewKey) {
  const views = car?.views || {};
  const primary = views.exterior;
  if (viewKey !== "exterior" && primary) return [primary];
  return CAR_VIEWS.filter((v) => v.key !== viewKey).map((v) => views[v.key]).filter(Boolean);
}

export function petPrompt(pet) {
  const type = petLabel(pet);
  const name = String(pet?.name || "").trim();
  return `Photorealistic photograph of a ${type}${name ? ` named ${name}` : ""} in a warm home interior, full body, natural light, sharp detail, the animal's breed, coloring and markings clearly visible. No people.`;
}

/** Take a Ride — the occupants inside the owner's actual vehicle. */
export function buildRidePrompt(car, occupants = [], driverName = null) {
  const label = carLabel(car) || "car";
  const names = occupants.map((o) => o?.name).filter(Boolean);
  const driver = driverName || names[0] || null;
  const passengers = names.filter((n) => n !== driver);
  const seatText = [
    driver ? `${driver} is in the driver's seat, hands on the wheel` : null,
    passengers.length > 0 ? `${passengers.join(" and ")} ${passengers.length === 1 ? "is" : "are"} in the passenger and rear seats` : null,
  ].filter(Boolean).join("; ");
  return `An in-car photograph taken from inside a moving ${label}: ${seatText || "the cabin is empty"}. The body color, seats, dashboard, trim and interior of the vehicle exactly match the supplied vehicle reference images. Everyone is fully dressed in their own clothes. The windows show a soft, blurred street outside. No additional passengers, no people outside the car.`;
}

/** Walk Pet — the selected actor with the pet registered on their own profile. */
export function buildWalkPetPrompt(ownerName, pet) {
  const type = petLabel(pet);
  const name = String(pet?.name || "").trim();
  return `${ownerName || "They"} walking ${name ? `${name}, their ${type},` : `their ${type},`} on a leash along a park path in daylight, the animal exactly as in the supplied pet reference image — same breed, coloring and markings — natural relaxed pace, photorealistic. No other people.`;
}

/** An occasional pet in a home picture — never in every one, never outside the home. */
export function buildHomePetNote(pet) {
  const type = petLabel(pet);
  const name = String(pet?.name || "").trim();
  return ` The household's ${type}${name ? ` ${name}` : ""} is resting quietly in the background of the room, small and unobtrusive, exactly the animal in its own reference image.`;
}