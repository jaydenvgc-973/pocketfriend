/**
 * instantImagePrompt.js — RETIRED
 *
 * Instant Image no longer builds its own scene description here. A second,
 * independent scene-description pathway was exactly what let Instant Image drift
 * from the established scene that character-initiated images already respect.
 *
 * The single description pathway now lives in src/hooks/useInstantImageAction.js:
 * it reads the authoritative character location (buildCharacterInScene), the shared
 * co-presence truth (resolveCoPresence), the established narratives and the resolved
 * people at that location, then hands the result to the existing
 * createImageMessage → dispatchImageGeneration → generateImageAsync pipeline.
 *
 * Nothing imports this module. It is kept as a tombstone so a future reader does not
 * reintroduce a parallel prompt builder.
 */

export function buildInstantImagePrompt() {
  throw new Error(
    'buildInstantImagePrompt is retired. Instant Image builds its scene description in src/hooks/useInstantImageAction.js so it uses the same authoritative context as character-generated images.'
  );
}