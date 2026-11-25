import { useEffect, useRef } from "react";

/**
 * useSceneSpaceImage — WHEN the top Scenes picture is drawn.
 *
 * It never draws anything itself: every picture still goes through the existing
 * generateSceneImage. It only decides when that picture belongs to what is on screen.
 *
 * The picture belongs to the selected scene space — the property, the unit inside it, and
 * the room. A manual change of any of them draws one picture of the NEW space, and a
 * picture already being drawn is finished first so an outdated earlier request can never
 * become the image of the space now on screen.
 *
 * An activity that draws its own picture (Brush Teeth in the bathroom, Make Bed in the
 * bedroom) never comes through here, so no second, generic picture replaces it.
 */
export function useSceneSpaceImage({
  locationId,
  isRabbitHole,
  spaceKey,
  selectionKey,
  sceneImage,
  setSceneImage,
  isGeneratingImage,
  drawImage,
  imageRequested,
  setImageRequested,
  participantsReady,
  observeMode,
  observeCastCount,
}) {
  const pendingSelectionRef = useRef(false);
  const pendingSpaceRef = useRef(false);

  // A change of cast re-renders the scene with those people. A picture already being drawn
  // finishes first, so the new cast is never replaced by the previous one.
  useEffect(() => {
    if (!participantsReady) return;
    if (isGeneratingImage) { pendingSelectionRef.current = true; return; }
    setSceneImage(null);
  }, [selectionKey]);

  useEffect(() => {
    if (!pendingSelectionRef.current || isGeneratingImage || !participantsReady) return;
    pendingSelectionRef.current = false;
    setSceneImage(null);
  }, [isGeneratingImage]);

  // A space chosen while a picture was being drawn is drawn once that picture lands.
  useEffect(() => {
    if (!pendingSpaceRef.current || isGeneratingImage) return;
    pendingSpaceRef.current = false;
    setSceneImage(null);
  }, [isGeneratingImage]);

  // The picture follows the selected space. Only a change of space reaches this, because a
  // chosen space clears the image — an activity's own picture is never cleared.
  useEffect(() => {
    if (!imageRequested || !participantsReady) return;
    if (!locationId || isRabbitHole) return;
    if (sceneImage || isGeneratingImage) return;
    // A watched space with nobody cast in it still shows the room itself — the empty place is
    // a picture too. It is never left blank while the user is looking at it.
    drawImage();
  }, [locationId, spaceKey, selectionKey, sceneImage, imageRequested, participantsReady]);

  /** A manual space change asks for the new space's picture — once. */
  const requestSpaceImage = () => {
    setImageRequested(true);
    if (isGeneratingImage) { pendingSpaceRef.current = true; return; }
    setSceneImage(null);
  };

  return { requestSpaceImage };
}