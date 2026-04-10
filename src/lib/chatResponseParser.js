/**
 * chatResponseParser.js
 *
 * Parses the raw LLM JSON response for chat messages into a structured object.
 * Extracted from Chat.jsx to reduce file size and improve maintainability.
 */

/**
 * Parses raw LLM output into a structured response object.
 * Handles JSON, markdown code fences, embedded JSON, and plain text fallbacks.
 *
 * @param {string} raw - Raw string from LLM
 * @returns {{ message_type: string, text_content: string, image_generation_prompt: string|null, image_generation_prompts: string[], scheduled_events: object[] }}
 */
export function parseCharacterResponse(raw) {
  if (!raw) return { message_type: "text_only", text_content: "" };

  let obj = null;

  // 1. Try direct JSON parse
  try { obj = JSON.parse(raw); } catch {}

  // 2. Try markdown code fence
  if (!obj) {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) try { obj = JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // 3. Try to find a JSON object anywhere in the string
  if (!obj) {
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) try { obj = JSON.parse(braceMatch[0]); } catch {}
  }

  if (obj && typeof obj === "object") {
    const messageType = obj.message_type || (obj.image_prompt || obj.image_prompts?.length > 0 ? "text_then_image" : "text_only");
    const textContent = obj.text_content || obj.text || "";
    const imgPrompt = obj.image_generation_prompt || obj.image_prompt || null;
    const imgPrompts = obj.image_generation_prompts || obj.image_prompts || (imgPrompt ? [imgPrompt] : []);
    return {
      message_type: messageType,
      text_content: textContent,
      image_generation_prompt: imgPrompt,
      image_generation_prompts: imgPrompts,
      scheduled_events: obj.scheduled_events || [],
    };
  }

  // 4. Fallback: try to extract text_content or text field
  const textMatch = raw.match(/"(?:text_content|text)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (textMatch) {
    try { return { message_type: "text_only", text_content: JSON.parse(`"${textMatch[1]}"`), image_generation_prompts: [] }; }
    catch { return { message_type: "text_only", text_content: textMatch[1], image_generation_prompts: [] }; }
  }

  // 5. Last resort: plain text
  const stripped = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").replace(/[{}\[\]]/g, "").replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
  if (stripped.length > 10 && /[a-zA-Z]/.test(stripped)) {
    return { message_type: "text_only", text_content: stripped, image_generation_prompts: [] };
  }

  return { message_type: "text_only", text_content: "", image_generation_prompts: [] };
}

/**
 * Filters third-person narration prose from a dialogue string.
 * Removes lines that start with a character name or He/She/They + action verb,
 * which indicates narrative bleed from the LLM into a chat message.
 *
 * @param {string} text - The raw text_content from LLM
 * @param {string} characterFirstName - First name of the character (for pattern matching)
 * @returns {string} Cleaned dialogue with narration lines removed
 */
export function filterNarrationBleed(text, characterFirstName) {
  if (!text) return text;

  const narrationPattern = new RegExp(
    `^(?:${characterFirstName}|He|She|They|His|Her|Their)\\s+(?:pulls|settles|leans|moves|looks|reaches|sits|stands|shifts|sighs|turns|walks|steps|grabs|holds|wraps|places|rests|draws|closes|opens|breathes|exhales|drops|lifts|slides|presses|curls|stretches|rolls|nods|shakes|smiles|frowns|watches|stares|gazes|feels|notices|allows|lets|keeps|stays|remains|becomes|seems|appears)`,
    'i'
  );

  const lines = text.split('\n');
  const cleanLines = lines.filter(line => {
    const t = line.trim();
    if (t && narrationPattern.test(t)) {
      console.warn(`[NARRATION_BLEED] Filtered prose from message: "${t.substring(0, 80)}"`);
      return false;
    }
    return true;
  });

  const result = cleanLines.join('\n').trim();
  return result || text; // Never return empty — fall back to original if everything was filtered
}