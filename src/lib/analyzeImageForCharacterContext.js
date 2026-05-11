/**
 * analyzeImageForCharacterContext
 *
 * Shared visual intake pipeline used across ALL routes that send images to characters:
 *   - pages/Chat (direct chat + text/phone mode)
 *   - components/chat/WorldContactsPopup (world phone)
 *   - pages/GroupChat (via generateGroupChatResponse backend — reads stored field)
 *   - pages/Scene (any image shared in scene context)
 *   - Forwarded images (ForwardMessageModal preserves or re-runs analysis)
 *   - Generated character images (stored after generation completes)
 *
 * CONTRACT:
 *   - Analyzes the image with vision BEFORE the character LLM call
 *   - Returns { imageAnalysisContext: string, imageDescription: string | null }
 *   - imageAnalysisContext is ready to inject into any character prompt
 *   - If analysis fails: returns a FAIL-VISIBLE context block — never empty string that allows hallucination
 *   - Stores image_description + image_analysis_status durably on the Message record (non-blocking)
 *   - Analysis failure does NOT block the message — it surfaces a "cannot see image" context instead
 *
 * RULES:
 *   - Never swallow errors silently
 *   - Never return an empty string on failure (that would allow character to hallucination)
 *   - Uses the shared base44 client imported from @/api/base44Client
 *   - messageId is optional — if absent, description is returned but not stored
 */

import { base44 } from "@/api/base44Client";

/**
 * @param {object} params
 * @param {string} params.imageUrl - The image URL to analyze
 * @param {string|null} [params.messageId] - Message ID to store result on (optional)
 * @param {string} [params.context] - e.g. "user_uploaded", "forwarded", "generated_character_photo"
 * @returns {Promise<{ imageAnalysisContext: string, imageDescription: string | null }>}
 */
export async function analyzeImageForCharacterContext({ imageUrl, messageId = null, context = "user_uploaded" }) {
  if (!imageUrl) {
    return { imageAnalysisContext: "", imageDescription: null };
  }

  // If this is a generated character photo (sender_type=character, image produced by generateImageAsync),
  // the character already knows what they sent — skip analysis to avoid circular context injection.
  // Callers should pass context="generated_character_photo" in that case.
  if (context === "generated_character_photo") {
    return { imageAnalysisContext: "", imageDescription: null };
  }

  try {
    console.log(`[ImageAnalysis] Starting vision analysis | context=${context} | url=${imageUrl.substring(0, 80)}`);

    const analysisResult = await base44.integrations.Core.InvokeLLM({
      prompt: `Analyze this image and provide a detailed, factual visual description in 2-4 sentences.
Describe exactly what you see: people (appearance, expressions, clothing, pose), objects, setting/environment, text visible, colors, lighting, and any notable details.
Do NOT interpret meaning or make assumptions beyond what is literally visible.
If the image is blurry, dark, or unclear, describe that explicitly.
Return ONLY the description text, nothing else.`,
      file_urls: [imageUrl],
    });

    const imageDescription = (typeof analysisResult === "string" ? analysisResult : "").trim();
    console.log(`[ImageAnalysis] ✓ Description (${context}): "${imageDescription.substring(0, 150)}"`);

    if (imageDescription && imageDescription.length > 5) {
      // Store durably on message record — non-blocking, never throws
      if (messageId) {
        base44.entities.Message.update(messageId, {
          image_description: imageDescription,
          image_analysis_status: "complete",
        }).catch(err => console.warn(`[ImageAnalysis] Failed to store description on message ${messageId}: ${err?.message}`));
      }

      const imageAnalysisContext = `

════════════════════════════════════
IMAGE — VISUAL ANALYSIS (${context})
════════════════════════════════════
Analysis status: complete
Visual description: ${imageDescription}

CRITICAL RULES FOR RESPONDING TO THIS IMAGE:
• You may respond ONLY based on the visual description above
• Do NOT invent details not present in the description
• Do NOT pretend to know what is in the image beyond what is described
• If the user asks about something not visible in the description, say you cannot make it out clearly
• React naturally to what the description actually shows
════════════════════════════════════`;

      return { imageAnalysisContext, imageDescription };
    }

    // Analysis returned empty — fail visibly, do NOT allow hallucination
    console.warn(`[ImageAnalysis] ⚠️ Empty description returned for context=${context}`);
    if (messageId) {
      base44.entities.Message.update(messageId, {
        image_analysis_status: "failed",
        image_analysis_error: "Vision analysis returned empty description",
      }).catch(() => {});
    }

    return {
      imageAnalysisContext: `\n\nIMAGE SHARED — ANALYSIS FAILED:\nAn image was sent but the visual analysis returned no content. You may acknowledge you received an image but cannot make out its contents. Do NOT describe or invent what the image shows.`,
      imageDescription: null,
    };

  } catch (err) {
    console.warn(`[ImageAnalysis] Analysis failed (${context}): ${err?.message}`);
    if (messageId) {
      base44.entities.Message.update(messageId, {
        image_analysis_status: "failed",
        image_analysis_error: err?.message || "Unknown error",
      }).catch(() => {});
    }

    return {
      imageAnalysisContext: `\n\nIMAGE SHARED — ANALYSIS FAILED:\nAn image was sent but could not be analyzed (error: ${err?.message || "unknown"}). You may acknowledge you received an image but cannot make out its contents. Do NOT describe or invent what the image shows.`,
      imageDescription: null,
    };
  }
}

/**
 * Build an image analysis prompt block from a PREVIOUSLY stored image_description.
 * Used when a message already has image_description stored (e.g. forwarded messages,
 * or when the generating function stored it after generation).
 *
 * Returns empty string if no description is stored — caller should call analyzeImageForCharacterContext
 * for a live analysis in that case.
 *
 * @param {string|null} imageDescription - The stored image_description from the Message record
 * @param {string} [context] - e.g. "forwarded", "recalled"
 * @returns {string}
 */
export function buildImageContextFromStoredDescription(imageDescription, context = "recalled") {
  if (!imageDescription || imageDescription.length < 5) return "";
  return `

════════════════════════════════════
IMAGE — STORED VISUAL DESCRIPTION (${context})
════════════════════════════════════
Visual description: ${imageDescription}

CRITICAL RULES:
• Respond ONLY based on the visual description above
• Do NOT invent details not present
• React naturally to what the description shows
════════════════════════════════════`;
}