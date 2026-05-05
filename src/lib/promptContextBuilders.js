/**
 * promptContextBuilders.js
 *
 * Pure functions that build LLM prompt context strings from character/user data.
 * Extracted from pages/Chat sendMessage to reduce page size.
 * No React state or hooks — all inputs are plain data.
 */

import { callLLMWithRetry } from "@/lib/llmUtils";
import { getWeatherMoodModifier } from "@/lib/weatherSystem";

// ── EDUCATION & TRAINING CONTEXT ─────────────────────────────────────────────

/**
 * Builds an education/training context block for LLM injection.
 * @param {object} character - Full character object
 * @returns {string}
 */
export function buildEducationContext(character) {
  let educationContext = "";

  if (character.current_education_activity && character.current_education_activity !== "none") {
    const completionDate = new Date(character.education_expected_completion_date);
    const daysLeft = Math.ceil((completionDate - new Date()) / (1000 * 60 * 60 * 24));
    const courseName = character.education_details?.course_name || character.current_education_activity;
    const institution = character.education_details?.institution;
    educationContext = `\n\nCURRENT EDUCATION ENROLLMENT: You are currently enrolled in "${courseName}"${institution ? ` at ${institution}` : ""}. ${!isNaN(daysLeft) && daysLeft > 0 ? `You'll be done in about ${daysLeft} days.` : ""} You are aware of your coursework, assignments, and what you're learning. Mention it naturally when relevant — e.g. if asked about your schedule, plans, or something related to the subject matter.`;
  }

  if (character.current_job_training_activity && character.current_job_training_activity !== "none") {
    const trainingName = character.job_training_details?.training_name || character.current_job_training_activity;
    const company = character.job_training_details?.company;
    const position = character.job_training_details?.position_title;
    const trainingCompletion = new Date(character.job_training_expected_completion_date);
    const trainingDaysLeft = Math.ceil((trainingCompletion - new Date()) / (1000 * 60 * 60 * 24));
    educationContext += `\n\nCURRENT JOB TRAINING: You are currently undergoing job training: "${trainingName}"${company ? ` at ${company}` : ""}${position ? ` for the role of ${position}` : ""}. ${!isNaN(trainingDaysLeft) && trainingDaysLeft > 0 ? `Training wraps up in about ${trainingDaysLeft} days.` : ""} You are aware of this training, what it involves, and how it relates to your career. Reference it naturally when relevant.`;
  }

  if (character.completed_education && character.completed_education.length > 0) {
    const completedList = character.completed_education.map(edu => `${edu.course_name}${edu.institution ? ` (${edu.institution})` : ""}`).join(", ");
    educationContext += `\n\nCOMPLETED EDUCATION: You have completed: ${completedList}. You have real knowledge and experience from these courses. When relevant, you can discuss what you learned and apply that knowledge naturally to conversations.`;
  }

  if (character.completed_job_training && character.completed_job_training.length > 0) {
    const completedTrainingList = character.completed_job_training.map(t => `${t.training_name}${t.company ? ` (${t.company})` : ""}`).join(", ");
    educationContext += `\n\nCOMPLETED JOB TRAINING: You have completed the following training programs: ${completedTrainingList}. This has shaped your skills and professional background.`;
  }

  return educationContext;
}

// ── SONGS / MEDIA CONTEXT ─────────────────────────────────────────────────────

/**
 * Builds a songs/media context block for LLM injection.
 * @param {object} character - Full character object
 * @returns {string}
 */
export function buildSongsContext(character) {
  if (!character.songs_heard || character.songs_heard.length === 0) return "";

  const songsInfo = character.songs_heard.map(song => {
    let info = `ALBUM/PLAYLIST TITLE: "${song.title}" by ${song.artist}`;
    if (song.tracks && Array.isArray(song.tracks) && song.tracks.length > 0) {
      const trackList = song.tracks.map(t => `${t.name}${t.artist ? ` (${t.artist})` : ''}`).join(' | ');
      info += ` | ACTUAL TRACKS ON IT: ${trackList}`;
    } else {
      info += ` | (track list not available)`;
    }
    if (song._understanding) {
      const u = song._understanding;
      info += `\n  MOOD & FEEL: ${u.overallMood?.join(', ') || 'unanalyzed'} | Energy: ${u.energyProfile}`;
      if (u.themes?.length > 0) info += `\n  THEMES: ${u.themes.join(', ')}`;
      if (u.narrativeSummary) info += `\n  ANALYSIS: ${u.narrativeSummary}`;
    }
    if (song._deepResearch) {
      const d = song._deepResearch;
      if (d.artistContext?.background) info += `\n  ARTIST CONTEXT: ${d.artistContext.background.substring(0, 200)}...`;
      if (d.trackInsights?.length > 0) {
        const topTracks = d.trackInsights.slice(0, 3).map(t => `"${t.trackName}": ${t.analysis?.substring(0, 80) || 'no details'}...`).join(' | ');
        info += `\n  TRACK INSIGHTS: ${topTracks}`;
      }
      if (d.contextualArticles?.length > 0) info += `\n  CONTEXT: ${d.contextualArticles[0].summary?.substring(0, 150)}...`;
    }
    if (song._characterKnowledge) {
      const k = song._characterKnowledge;
      if (k.personalResonance?.likelyInterpretation) info += `\n  YOUR TAKE: ${k.personalResonance.likelyInterpretation}`;
      if (k.conversationHooks?.directReferences?.length > 0) info += `\n  YOU CAN REFERENCE: ${k.conversationHooks.directReferences.map(r => r.theme).join(', ')}`;
    }
    return info;
  }).join('\n\n---\n\n');

  return `\n\nMUSIC SHARED WITH YOU: Multi-layer understanding has been built for these songs/albums:\nCRITICAL RULES:\n1. Use the ACTUAL TRACKS list (not made-up songs)\n2. Reference the MOOD & FEEL, THEMES, and TRACK INSIGHTS provided\n3. Use ARTIST CONTEXT and TRACK INSIGHTS to inform your interpretation\n4. Draw on YOUR TAKE section for how this connects to you emotionally\n5. You can now discuss the music as though you understand it deeply — because you do.\n6. NEVER pretend to know info not listed. If it's there, use it. If not, say you haven't heard those details.\n\n${songsInfo}`;
}

// ── WEATHER / NEWS / CULTURE CONTEXT ─────────────────────────────────────────

const weatherKeywordsRe = /\b(weather|rain|raining|sunny|cold|hot|warm|freezing|snow|snowing|storm|cloudy|outside|outdoors|going out|what's it like|nice out|bad out|degrees|temperature|humid|windy|fog|foggy)\b/i;
const outdoorPlanKeywordsRe = /\b(going out|heading out|outside|outdoor|park|walk|run|hike|beach|drive|trip|picnic|bbq|barbecue)\b/i;
const newsKeywordsRe = /\b(news|heard about|did you see|what's going on|what happened|current events|trending|politics|election|sports|game|match|celebrity|scandal|viral|social media|twitter|tiktok|instagram)\b/i;
const culturalKeywordsRe = /\b(show|shows|watch|watching|netflix|hulu|disney|prime|streaming|movie|film|music|song|artist|singer|actor|actress|celebrity|famous|viral|tiktok|youtube|podcast|album|concert|tour|coachella|grammy|oscar|emmy|celebrity|star|band|rapper|actor|influencer|meme|trend|trending|cardi|taylor|drake|beyonce|kanye|rihanna|dua|weekend|post|malone|billie|ariana|this is us|stranger|breaking bad|game of thrones)\b/i;

/**
 * Fetches weather, news, and cultural context strings if message keywords trigger them.
 * Returns { weatherContext, recentEventsContext, culturalContext }
 * @param {string} text - User message
 * @param {object} character - Full character object
 * @param {object[]} recentMsgs - Recent message array
 * @returns {Promise<{ weatherContext: string, recentEventsContext: string, culturalContext: string }>}
 */
export async function buildDynamicContexts(text, character, recentMsgs) {
  let weatherContext = "";
  let recentEventsContext = "";
  let culturalContext = "";

  const userMentionsWeather = weatherKeywordsRe.test(text) || outdoorPlanKeywordsRe.test(text);

  if (userMentionsWeather && (character.city || character.state)) {
    const recentWeatherMention = recentMsgs.slice(-16).some(m =>
      m.sender_type === "character" && weatherKeywordsRe.test(m.content || "")
    );
    if (!recentWeatherMention) {
      if (character.weather_summary) {
        weatherContext = `\n\nCURRENT WEATHER (for ${[character.city, character.state].filter(Boolean).join(", ")}): ${character.weather_summary}. You are aware of this. ONLY reference it if the user directly asked about weather or is making outdoor plans — do NOT volunteer it into unrelated topics.`;
      } else if (weatherKeywordsRe.test(text)) {
        try {
          const weatherRes = await callLLMWithRetry(`What is the current weather right now in ${[character.city, character.state].filter(Boolean).join(", ")}? Include temperature and conditions briefly.`, 'gemini_3_flash', 3, true);
          weatherContext = `\n\nCURRENT WEATHER: ${weatherRes}. Reference this ONLY because the user asked about it.`;
        } catch { /* silent */ }
      }
    }
  }

  if (newsKeywordsRe.test(text)) {
    try {
      const eventsRes = await callLLMWithRetry(`What are the top 2-3 most relevant recent news events, cultural moments, or trending topics happening right now (current date: ${new Date().toLocaleDateString()})? Focus on general interest stories that a typical person might naturally bring up in casual conversation. Include brief details about each.`, 'gemini_3_flash', 3, true);
      recentEventsContext = `\n\nRECENT EVENTS: Here are current events happening now: ${eventsRes}. You can naturally reference these if they fit the conversation, but don't force it. Only mention them if they genuinely relate to what you're discussing.`;
    } catch { /* silent */ }
  }

  if (culturalKeywordsRe.test(text) || culturalKeywordsRe.test(recentMsgs.slice(-3).map(m => m.content).join(" "))) {
    try {
      const culturalRes = await callLLMWithRetry(`What are currently trending in entertainment and culture right now (current date: ${new Date().toLocaleDateString()})? Include: popular TV shows, streaming content, music releases or artists, celebrities making headlines, viral trends. Keep it to what a socially aware person would naturally know. Be concise.`, 'gemini_3_flash', 3, true);
      culturalContext = `\n\nCULTURAL AWARENESS: Current entertainment & culture trends: ${culturalRes}. You're aware of these topics and can discuss them naturally if they come up. Recognize references to celebrities, shows, and music without confusion.`;
    } catch { /* silent */ }
  }

  return { weatherContext, recentEventsContext, culturalContext };
}

// ── IMAGE RULE BUILDER ────────────────────────────────────────────────────────

/**
 * Builds the image generation rules/instructions string for the LLM prompt.
 * @param {object} params
 * @returns {string}
 */
export function buildImageRule({
  allowImageThisTurn,
  isPhotogenic,
  explicitImageRequest,
  requestedQuantity,
  userNameForPrompts,
  lastImagePromptSnippet,
}) {
  if (!allowImageThisTurn) {
    return explicitImageRequest && !isPhotogenic
      ? `MESSAGE TYPE RULES: The user asked for a photo but you've already sent several recently. Politely acknowledge you're not available to send one right now, and use message_type "text_only".`
      : `MESSAGE TYPE RULES: You MUST use message_type "text_only" this turn. Do NOT include any image fields. Images are rate-limited and you have sent enough recently.`;
  }

  const imageCountInstruction = requestedQuantity > 1
    ? `The user asked for ${requestedQuantity} images. Provide exactly ${requestedQuantity} entries in "image_generation_prompts" array.`
    : "";

  return `MESSAGE TYPE RULES — read carefully:
You MUST choose exactly ONE of these message_type values:
- "text_only" → send only a text message. No image. DEFAULT when no image is needed.
- "image_only" → send ONLY an image, no visible text. Use when the user explicitly asked for a photo and no text reply is needed.
- "text_then_image" → send text first, then a separate image. Use when both are appropriate.
- "image_then_text" → send image first, then a separate text reply.

${isPhotogenic && explicitImageRequest
  ? `PHOTOGENIC TRAIT — EXPLICIT REQUEST: The user has asked for a photo. You LOVE being photographed and you ALWAYS say yes immediately — no hesitation, no excuses, no deflecting. You are always ready. Pick image_only or text_then_image (your choice), but you MUST include an image. Never refuse or delay.`
  : isPhotogenic
  ? `PHOTOGENIC TRAIT: You love sharing photos of yourself and your life spontaneously. Sending images feels natural and easy for you — text_then_image or image_only are your go-to formats. You're always camera-ready.`
  : `IMPORTANT: text_only is the DEFAULT. Only send an image if it truly fits the moment.`}
${imageCountInstruction}

IMAGE SUBJECT RULES (for image_generation_prompt / image_generation_prompts):
- "Send me a pic of me / myself" → subject is the USER. Start prompt with "[USER]".
- "Send me a pic of you / yourself" → subject is YOU. Start prompt with "[CHARACTER]".
- "Send me a pic of us / together" → subject is BOTH. Start prompt with "[JOINT]".
- Default (no explicit subject): "[CHARACTER]".
- image_generation_prompt is INTERNAL ONLY — it is never shown to the user.
${userNameForPrompts ? `- WORLD NAME RULE: When referencing the person you're talking to in an image prompt (e.g. for [USER] or [JOINT] shots), always use their name "${userNameForPrompts}" — NEVER write "the user" or "user" in any image prompt.\n- CRITICAL: If the user's name "${userNameForPrompts}" appears in the prompt as a subject of the photo, start the image prompt with "[USER]" — NOT "[CHARACTER]".` : `- WORLD NAME RULE: You don't know their name yet. For [USER] or [JOINT] shots, describe them by appearance only — NEVER write "the user" or "user".`}

3D ROOM SPATIAL RULE — MANDATORY:
The room is a 3D space. Treat it as one. Every image prompt must include: (1) character action/pose, (2) explicit camera position inside the room, (3) camera distance. Use the room reference images to understand the space — do NOT copy their angle. Move the camera: doorway looking in | corner wide shot | beside furniture | across the room | low angle | overhead | over-the-shoulder | near window looking toward character.
BEDROOM RULE: bedroom is NOT always "lying in bed close-up". Sleeping: wide doorway view, character under covers from across the room, side view at distance. Awake: sitting on bed edge | by the window | standing near dresser | on the floor | folding clothes.
${lastImagePromptSnippet ? `ANTI-REPETITION — last image used: "${lastImagePromptSnippet.substring(0, 120)}..." — use a DIFFERENT camera position, distance, and pose.` : `ANTI-REPETITION: vary camera, distance, and pose every time.`}
FORMAT: [CHARACTER] [action]. Camera [position]. [Wide/Medium/Close]. [Time-of-day lighting]. [Zone — 1-2 furniture anchors]."`;
}

// ── WEATHER MOOD CONTEXT ──────────────────────────────────────────────────────

/**
 * Build a persistent weather mood context string injected into every character prompt.
 * Source of truth: UserSettings.daily_weather_cache
 *
 * This is separate from buildDynamicContexts (which is keyword-triggered).
 * This always injects mood influence when severe/notable weather exists.
 *
 * @param {Object|null} weatherCache - UserSettings.daily_weather_cache
 * @param {Object} character - Character record
 * @returns {string} — empty string if no notable weather
 */
export function buildWeatherMoodContext(weatherCache, character) {
  const modifier = getWeatherMoodModifier(weatherCache, character);
  return modifier ? `\n\n${modifier}` : '';
}

// ── LOCATION RESPONSE VALIDATOR ───────────────────────────────────────────────

/**
 * Validates character reply text against current presence state.
 * Corrects location drift where AI claims arrival while still in transit.
 * @param {string} text
 * @param {{ status: string, label: string }} presence
 * @returns {string}
 */
export function validateLocationInResponse(text, presence) {
  if (!text || !presence) return text;
  const lower = text.toLowerCase();
  if (presence.status === 'in_transit') {
    const dest = (presence.label || '').replace('Traveling to ', '').toLowerCase();
    if (dest && lower.includes(`i'm at ${dest}`) || lower.includes(`im at ${dest}`)) {
      console.warn('[LOCATION_DRIFT] AI said arrived but still in transit — correcting');
      return `I'm on my way to ${presence.label.replace('Traveling to ', '')} right now.`;
    }
  }
  return text;
}