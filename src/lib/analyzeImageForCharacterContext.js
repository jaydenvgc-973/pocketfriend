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
import { isValidImageDescription } from "@/lib/imageDescriptionValidator";

// ── TRANSPORT METADATA DETECTOR ────────────────────────────────────────────────
// A routing label like "Image sent to X" is NOT image analysis.
// Reject it before it can feed character context.
const TRANSPORT_PATTERNS = [
  /image sent to/i,
  /photo shared/i,
  /sent\s+to\s+[A-Z][a-z]/,
  /shared\s+with\s+[A-Z]/i,
  /uploaded\s+image/i,
  /image\s+attachment/i,
  /photo\s+attachment/i,
];

function isTransportMetadata(text) {
  if (!text || text.trim().length < 2) return false;
  const normalized = text.trim().toLowerCase();
  for (const pat of TRANSPORT_PATTERNS) {
    if (pat.test(text)) return true;
  }
  if (normalized.includes('sent to') || normalized.includes('shared with') || normalized.includes('image attachment')) {
    return true;
  }
  return false;
}

// Detailed prompt for Gallery sends — richer than the standard user-upload analysis
const GALLERY_SEND_PROMPT = `Provide a rich, detailed visual description of this image.
Include ALL of the following that are visible:
- People shown: apparent age range, gender presentation, clothing details, expressions, poses
- Objects visible: food, drinks, furniture, decorations, vehicles, any notable items
- Setting and environment: indoor/outdoor, type of location (restaurant, home, park, etc.)
- Lighting and atmosphere: warm/cool, time of day, mood
- Relationship or context clues: are people together? What are they doing?
- Any text, signs, or notable details visible

Be specific, factual, and thorough. Minimum 3-5 sentences.
Do NOT speculate beyond what is literally visible.
Return ONLY the description text, nothing else.`;

// Standard prompt for regular uploaded images
const STANDARD_UPLOAD_PROMPT = `Analyze this image and provide a detailed, factual visual description in 2-4 sentences.
Describe exactly what you see: people (appearance, expressions, clothing, pose), objects, setting/environment, text visible, colors, lighting, and any notable details.
Do NOT interpret meaning or make assumptions beyond what is literally visible.
If the image is blurry, dark, or unclear, describe that explicitly.
Return ONLY the description text, nothing else.`;

/**
 * @param {object} params
 * @param {string} params.imageUrl - The image URL to analyze
 * @param {string|null} [params.messageId] - Message ID to store result on (optional)
 * @param {string} [params.context] - e.g. "user_uploaded", "forwarded", "generated_character_photo", "media_gallery_send"
 * @param {boolean} [params.requireDetailedAnalysis] - If true, use rich Gallery Send prompt
 * @returns {Promise<{ imageAnalysisContext: string, imageDescription: string | null, analysisStatus: string }>}
 */
export async function analyzeImageForCharacterContext({ imageUrl, messageId = null, context = "user_uploaded", requireDetailedAnalysis = false }) {
  if (!imageUrl) {
    return { imageAnalysisContext: "", imageDescription: null, analysisStatus: 'skipped' };
  }

  // If this is a generated character photo (sender_type=character, image produced by generateImageAsync),
  // the character already knows what they sent — skip analysis to avoid circular context injection.
  // Callers should pass context="generated_character_photo" in that case.
  if (context === "generated_character_photo") {
    return { imageAnalysisContext: "", imageDescription: null, analysisStatus: 'skipped' };
  }

  // Use richer prompt for Gallery sends or when explicitly required
  const isGallerySend = context === "media_gallery_send" || requireDetailedAnalysis;
  const analysisPrompt = isGallerySend ? GALLERY_SEND_PROMPT : STANDARD_UPLOAD_PROMPT;

  try {
    console.log(`[ImageAnalysis] Starting vision analysis | context=${context} | detailed=${isGallerySend} | url=${imageUrl.substring(0, 80)}`);

    const analysisResult = await base44.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      file_urls: [imageUrl],
    });

    const rawDescription = (typeof analysisResult === "string" ? analysisResult : "").trim();
    console.log(`[ImageAnalysis] Raw description (${context}): "${rawDescription.substring(0, 150)}"`);

    // ── TRANSPORT METADATA GUARD ────────────────────────────────────────────────
    // LLM should never return routing metadata — but guard against it anyway.
    if (isTransportMetadata(rawDescription)) {
      console.error(`[ImageAnalysis] LLM returned transport metadata instead of visual description: "${rawDescription}"`);
      if (messageId) {
        base44.entities.Message.update(messageId, {
          image_analysis_status: "failed",
          image_analysis_error: "LLM returned transport metadata, not a visual description",
          image_analysis_is_transport_metadata: true,
        }).catch(() => {});
      }
      return {
        imageAnalysisContext: `\n\nIMAGE SHARED — ANALYSIS FAILED:\nAn image was sent but the visual analysis returned a routing label instead of actual image content. You may acknowledge you received an image but cannot make out its contents. Do NOT describe or invent what the image shows.`,
        imageDescription: null,
        analysisStatus: 'failed',
      };
    }

    // ── VALIDATE VISUAL CONTENT QUALITY ─────────────────────────────────────────
    const validation = isValidImageDescription(rawDescription);
    if (!validation.valid) {
      console.warn(`[ImageAnalysis] Description failed validation (${context}): ${validation.reason} | text: "${rawDescription.substring(0, 100)}"`);
      if (messageId) {
        base44.entities.Message.update(messageId, {
          image_analysis_status: "failed",
          image_analysis_error: `Description validation failed: ${validation.reason}`,
        }).catch(() => {});
      }
      return {
        imageAnalysisContext: `\n\nIMAGE SHARED — ANALYSIS INCOMPLETE:\nAn image was sent but the visual analysis did not return a complete scene description. You may acknowledge you received an image but cannot describe its contents clearly. Do NOT invent what the image shows.`,
        imageDescription: null,
        analysisStatus: 'failed',
      };
    }

    const imageDescription = rawDescription;
    console.log(`[ImageAnalysis] ✓ Validated description (${context}): "${imageDescription.substring(0, 150)}"`);

    if (imageDescription && imageDescription.length > 10) {
      // Store durably on message record — non-blocking, never throws
      if (messageId) {
        const updateFields = {
          image_analysis_status: "complete",
          image_analysis_is_transport_metadata: false,
        };
        // For Gallery sends: store as inferred_image_description to distinguish from original prompts
        if (isGallerySend) {
          updateFields.inferred_image_description = imageDescription;
          updateFields.image_analysis_source = 'media_gallery_send_visual_analysis';
          updateFields.image_analysis_is_inferred = true;
        } else {
          updateFields.image_description = imageDescription;
        }
        base44.entities.Message.update(messageId, updateFields)
          .catch(err => console.warn(`[ImageAnalysis] Failed to store description on message ${messageId}: ${err?.message}`));
      }

      const contextLabel = isGallerySend ? 'media_gallery_send_visual_analysis' : context;
      const imageAnalysisContext = `

════════════════════════════════════
IMAGE — VISUAL ANALYSIS (${contextLabel})
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

      return { imageAnalysisContext, imageDescription, analysisStatus: 'complete' };
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
      analysisStatus: 'failed',
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
      analysisStatus: 'failed',
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