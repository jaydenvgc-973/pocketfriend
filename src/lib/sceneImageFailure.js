/**
 * A PICTURE THE IMAGE SERVICE REFUSED.
 *
 * The top picture of a Scenes page is drawn by the image generator. When the service
 * refuses a request (a content filter, or a failed call), nothing is drawn — and until
 * now the refusal was invisible: the place's own empty reference image stayed on screen
 * looking like the completed activity. This publishes the refusal so the picture area can
 * say what actually happened, and clears it the moment a picture is drawn again.
 *
 * Nothing here generates, retries or replaces an image: it only reports.
 */
const listeners = new Set();
let failed = false;

function emit() {
  listeners.forEach((listener) => listener(failed));
}

export function publishSceneImageFailure() {
  if (failed) return;
  failed = true;
  emit();
}

export function publishSceneImageSuccess() {
  if (!failed) return;
  failed = false;
  emit();
}

export function subscribeSceneImageFailure(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isSceneImageFailed() {
  return failed;
}