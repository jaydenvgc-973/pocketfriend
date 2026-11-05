/**
 * useInstantImage
 *
 * Trigger hook for the "Instant Image" app-drawer option.
 *
 * It delegates to the caller's Instant Image handler (Chat.jsx → useInstantImageAction),
 * which builds the scene description from the authoritative character location, the
 * shared co-presence resolver and the established narratives, then hands the result to
 * the existing createImageMessage → dispatchImageGeneration → generateImageAsync pipeline.
 *
 * There is deliberately no scene-description logic here: one description pathway only,
 * so Instant Image cannot drift from what character-initiated images already respect.
 * This hook owns just the in-flight state for the menu.
 */

import { useState } from 'react';

export function useInstantImage({ character, characterId, conversationId, onImagePromptReady }) {
  const [isGenerating, setIsGenerating] = useState(false);

  const triggerInstantImage = async () => {
    if (!character || !conversationId || isGenerating) return;
    setIsGenerating(true);

    try {
      if (onImagePromptReady) await onImagePromptReady();
    } catch (err) {
      console.error('[InstantImage] Failed:', err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return { triggerInstantImage, isGenerating };
}