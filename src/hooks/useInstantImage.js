/**
 * useInstantImage
 *
 * Hook for the "Instant Image" app-drawer option.
 * Generates an image of the current scene without manual prompt entry.
 *
 * Flow:
 *   1. Build a scene-description prompt from the established conversation + character state
 *   2. Call InvokeLLM to produce a concise visual image prompt
 *   3. Hand that prompt to the existing createImageMessage pipeline via onImagePromptReady
 *
 * This does NOT create a new image generator. The output prompt feeds directly into
 * the existing createImageMessage → dispatchImageGeneration → generateImageAsync pipeline.
 * Identity, wardrobe, location, and subject resolution all remain in that pipeline.
 */

import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { buildInstantImagePrompt } from '@/lib/instantImagePrompt';

export function useInstantImage({ character, characterId, conversationId, messages, userSettings, onImagePromptReady }) {
  const [isGenerating, setIsGenerating] = useState(false);

  const triggerInstantImage = async () => {
    if (!character || !conversationId || isGenerating) return;
    setIsGenerating(true);

    try {
      const prompt = buildInstantImagePrompt(character, messages, userSettings);
      const imagePrompt = await base44.integrations.Core.InvokeLLM({ prompt });

      if (!imagePrompt?.trim()) {
        console.warn('[InstantImage] LLM returned empty prompt');
        return;
      }

      const cleaned = imagePrompt.trim();
      console.log(`[InstantImage] Generated prompt: "${cleaned.substring(0, 100)}"`);

      // Hand off to the existing image pipeline (createImageMessage in Chat.jsx)
      if (onImagePromptReady) {
        await onImagePromptReady(cleaned);
      }
    } catch (err) {
      console.error('[InstantImage] Failed:', err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return { triggerInstantImage, isGenerating };
}