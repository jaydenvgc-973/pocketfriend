import { useState } from "react";
import {
  buildTryOnPrompt,
  resolveTryOnZone,
  buildPetInteractionPrompt,
  buildVehicleTestPrompt,
} from "@/lib/sceneTryOnPrompt";

/**
 * useSceneMerchandiseInteraction — TRY ON, PLAY WITH and TEST, as one scene interaction.
 *
 * All three are the same thing for different merchandise: one chosen person, the EXACT
 * item from the product card, the established top-Scenes image, and a line in the scene.
 * None of them charges anything, creates an owner, or moves anybody: the character stays
 * in the store and the purchase is still the only step that transacts.
 *
 * The state and handler names the scene and its actor picker already use are kept
 * (tryOnRequest / setTryOnRequest / handleTryOnConfirm), so the existing "who does this?"
 * selector serves all three without a second selector.
 */
export function useSceneMerchandiseInteraction({
  observeMode,
  observeCast,
  selectedPeopleHere,
  userParticipant,
  displayName,
  location,
  activeZone,
  locationZones,
  sceneParticipants,
  isHomeLocation,
  isRestrictedEnv,
  firstImage,
  selectImageParticipants,
  characters,
  locationMap,
  generateSceneImage,
  setMessages,
}) {
  const [request, setRequest] = useState(null);

  const run = async (current, person) => {
    const { msg, itemImageUrl, kind } = current;
    const family = msg.item_merchandise || null;
    const currentZone = activeZone || locationZones?.[0]?.zone_name;
    // An existing zone of this business: the fitting rooms or sales floor for clothing,
    // the sales floor for animals, the showroom for vehicles. None is ever created.
    const zoneName = kind === "try_on"
      ? resolveTryOnZone(location, family, currentZone)
      : currentZone;

    const prompt = kind === "play_with"
      ? buildPetInteractionPrompt({
          itemLabel: msg.item_label,
          actorName: person.name,
          locationName: location?.name,
          zoneName,
          details: msg.item_details,
        })
      : kind === "test_vehicle"
        ? buildVehicleTestPrompt({
            itemLabel: msg.item_label,
            actorName: person.name,
            locationName: location?.name,
            zoneName,
            details: msg.item_details,
          })
        : buildTryOnPrompt({
            itemLabel: msg.item_label,
            itemKind: msg.item_kind,
            merchandiseFamily: family,
            actorName: person.name,
            locationName: location?.name,
            zoneName,
          });

    const url = await generateSceneImage({
      location, locationZones, activeZone: zoneName, sceneParticipants, userParticipant,
      isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap,
      actionOverridePrompt: prompt,
      actionFocusIds: [person.id],
      extraReferenceImages: [itemImageUrl],
    });

    // A test drive's own picture becomes the starting point for the vehicle's driver's seat
    // reference, so the purchase modal can carry it in. The card keeps its merchandise image.
    if (kind === "test_vehicle" && url) {
      setMessages((prev) => prev.map((m) => m.id === msg.id
        ? { ...m, item_details: { ...(m.item_details || {}), test_image_url: url } }
        : m));
    }

    const where = zoneName ? ` in the ${zoneName}` : "";
    const line = kind === "play_with"
      ? `${person.name} plays with the ${msg.item_label || "animal"}${where}.`
      : kind === "test_vehicle"
        ? `${person.name} sits in the ${msg.item_label || "vehicle"} and takes it for a short drive around the lot${where}.`
        : `${person.name} tries on the ${msg.item_label || "item"}${where}.`;

    // The scene remembers what happened — an ordinary scene activity, not a purchase.
    setMessages((prev) => [...prev, {
      id: `${kind}_${Date.now()}`,
      sender: "activity",
      emoji: kind === "play_with" ? "🐾" : kind === "test_vehicle" ? "🚗" : "🪞",
      content: line,
      timestamp: new Date().toISOString(),
    }]);
  };

  const begin = (msg, itemImageUrl, kind) => {
    if (!msg || !itemImageUrl) return;
    const cast = observeMode ? observeCast : selectedPeopleHere;
    if (cast.length > 0) {
      setRequest({ msg, itemImageUrl, kind, cast });
      return;
    }
    // Nobody else is in the scene: the account holder does it themselves.
    if (userParticipant && !observeMode) {
      run({ msg, itemImageUrl, kind }, { id: userParticipant.id, name: displayName });
    }
  };

  const confirm = (person) => {
    const current = request;
    setRequest(null);
    if (current && person) run(current, person);
  };

  return {
    tryOnRequest: request,
    setTryOnRequest: setRequest,
    handleTryOn: (msg, url) => begin(msg, url, "try_on"),
    handlePlayWith: (msg, url) => begin(msg, url, "play_with"),
    handleTestVehicle: (msg, url) => begin(msg, url, "test_vehicle"),
    handleTryOnConfirm: confirm,
  };
}