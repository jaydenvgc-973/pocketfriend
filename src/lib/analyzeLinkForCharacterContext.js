/**
 * analyzeLinkForCharacterContext.js
 *
 * Frontend utility for the link/video understanding pipeline.
 *
 * Parallel to analyzeImageForCharacterContext — same contract:
 *   - Analyzes links BEFORE character LLM call
 *   - Returns { linkAnalysisContext: string, linkData: object | null }
 *   - FAIL-VISIBLE on error: never returns empty string that allows hallucination
 *   - Stores results durably on Message record (non-blocking)
 *
 * Confidence tiers (matching backend spec):
 *   "full"    — transcript/full text available — character may discuss specifics
 *   "partial" — title/caption/thumbnail only — character discusses theme, acknowledges limits
 *   "minimal" — link only / restricted — character explicitly says they cannot determine contents
 */

import { base44 } from "@/api/base44Client";

// Regex to detect URLs in message text
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

// Platform detection patterns
const PLATFORM_PATTERNS = [
  { platform: 'YouTube',    re: /youtube\.com|youtu\.be/ },
  { platform: 'Instagram',  re: /instagram\.com/ },
  { platform: 'TikTok',     re: /tiktok\.com/ },
  { platform: 'Twitter/X',  re: /twitter\.com|x\.com/ },
  { platform: 'Facebook',   re: /facebook\.com|fb\.watch/ },
  { platform: 'Reddit',     re: /reddit\.com/ },
  { platform: 'Dailymotion',re: /dailymotion\.com/ },
  { platform: 'Twitch',     re: /twitch\.tv/ },
  { platform: 'Vimeo',      re: /vimeo\.com/ },
];

/**
 * Extract URLs from a message string.
 * Returns an array of unique URL strings found.
 */
export function extractUrlsFromText(text) {
  if (!text) return [];
  const matches = text.match(URL_REGEX) || [];
  // Deduplicate
  return [...new Set(matches)];
}

/**
 * Detect which platform a URL belongs to.
 * Returns platform name or 'generic web'.
 */
export function detectPlatform(url) {
  for (const { platform, re } of PLATFORM_PATTERNS) {
    if (re.test(url)) return platform;
  }
  return 'generic web';
}

/**
 * Returns true if the URL looks like a direct image link.
 */
export function isDirectImageUrl(url) {
  return /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(url);
}

/**
 * Build a FAIL-VISIBLE minimal-confidence context block.
 * Used when the backend can't access the link content.
 */
function buildMinimalContext(url, platform, error = null) {
  return `

════════════════════════════════════
LINK SHARED BY USER — LIMITED ACCESS
════════════════════════════════════
URL: ${url}
Platform: ${platform}
Confidence tier: MINIMAL (restricted/inaccessible)

${error ? `Access note: ${error}` : 'The content of this link could not be retrieved (login required, platform restriction, or unavailable).'}

CRITICAL INSTRUCTIONS — MANDATORY:
• Do NOT pretend you watched, read, or viewed this content
• Do NOT invent scenes, dialogue, actions, or descriptions
• Explicitly acknowledge you cannot determine the contents
• You MAY acknowledge the platform and that a link was shared
• You MAY ask the user what the content shows or is about
• Example: "I can see you sent a link but I can't really tell what's in it — want to tell me about it?"
════════════════════════════════════`;
}

/**
 * Build a partial-confidence context block.
 * Used when title/caption/thumbnail available but no transcript.
 */
function buildPartialContext(data) {
  const lines = [];
  if (data.platform) lines.push(`Platform: ${data.platform}`);
  if (data.content_type) lines.push(`Content type: ${data.content_type}`);
  if (data.title) lines.push(`Title: ${data.title}`);
  if (data.author_name) lines.push(`From: ${data.author_name}`);
  if (data.caption) lines.push(`Caption: ${data.caption}`);
  if (data.description) lines.push(`Description: ${data.description.substring(0, 300)}`);
  if (data.duration) lines.push(`Duration: ${data.duration}`);
  if (data.thumbnail_description) lines.push(`Thumbnail shows: ${data.thumbnail_description}`);
  if (data.extracted_visible_text) lines.push(`Visible text: ${data.extracted_visible_text.substring(0, 200)}`);

  return `

════════════════════════════════════
LINK / MEDIA SHARED BY USER — PARTIAL UNDERSTANDING
════════════════════════════════════
${lines.join('\n')}

Confidence tier: PARTIAL (title/caption/metadata available, no full transcript)

CRITICAL INSTRUCTIONS — MANDATORY:
• You MAY discuss the general topic, title, or theme shown above
• You MAY react to the caption, description, or visible text above
• You MUST acknowledge that you have limited visibility into the actual content
• You must NOT claim you watched/read the full content or invent specific scenes
• You must NOT describe actions, dialogue, or events not stated above
• Example behavior: "I saw the title — [title] — that sounds interesting, what's it actually about?"
════════════════════════════════════`;
}

/**
 * Build a full-confidence context block.
 * Used when transcript or full text is available.
 */
function buildFullContext(data) {
  const lines = [];
  if (data.platform) lines.push(`Platform: ${data.platform}`);
  if (data.content_type) lines.push(`Content type: ${data.content_type}`);
  if (data.title) lines.push(`Title: ${data.title}`);
  if (data.author_name) lines.push(`From: ${data.author_name}`);
  if (data.description) lines.push(`Description: ${data.description.substring(0, 400)}`);
  if (data.caption) lines.push(`Caption: ${data.caption}`);
  if (data.transcript) lines.push(`\nTranscript / Full content:\n${data.transcript.substring(0, 1500)}`);
  if (data.extracted_visible_text && !data.transcript) lines.push(`Extracted text:\n${data.extracted_visible_text.substring(0, 800)}`);
  if (data.duration) lines.push(`Duration: ${data.duration}`);
  if (data.thumbnail_description) lines.push(`Visual context: ${data.thumbnail_description}`);
  if (data.analysis_notes) lines.push(`\nAnalysis notes: ${data.analysis_notes}`);

  return `

════════════════════════════════════
LINK / MEDIA SHARED BY USER — FULL UNDERSTANDING
════════════════════════════════════
${lines.join('\n')}

Confidence tier: FULL (transcript/full content available)

INSTRUCTIONS:
• You may discuss specific content, quotes, events, or themes from the transcript above
• React based ONLY on what is written above — do not invent additional details
• You have real context — respond naturally and specifically to what you've seen
════════════════════════════════════`;
}

/**
 * Main entry point.
 *
 * Analyzes a URL found in a user message by calling the backend analyzeSharedLink function.
 * Returns a context block ready for LLM prompt injection.
 *
 * @param {object} params
 * @param {string} params.url - URL to analyze
 * @param {string|null} [params.messageId] - Message ID to store result on
 * @param {string} [params.conversationId]
 * @param {string} [params.characterId]
 * @returns {Promise<{ linkAnalysisContext: string, linkData: object | null }>}
 */
export async function analyzeSharedLinkForCharacter({ url, messageId = null, conversationId = null, characterId = null }) {
  if (!url) return { linkAnalysisContext: '', linkData: null };

  const platform = detectPlatform(url);
  console.log(`[LinkAnalysis] Starting analysis | platform=${platform} | url=${url.substring(0, 80)}`);

  try {
    const res = await base44.functions.invoke('analyzeSharedLink', {
      url,
      message_id: messageId,
      conversation_id: conversationId,
      character_id: characterId,
    });

    const data = res?.data;
    if (!data?.success) {
      console.warn(`[LinkAnalysis] Backend returned failure: ${data?.error}`);
      return {
        linkAnalysisContext: buildMinimalContext(url, platform, data?.error),
        linkData: null,
      };
    }

    const confidence = data.analysis_confidence || 'minimal';
    console.log(`[LinkAnalysis] ✓ confidence=${confidence} platform=${data.platform} type=${data.content_type}`);

    let linkAnalysisContext = '';
    if (confidence === 'full') {
      linkAnalysisContext = buildFullContext(data);
    } else if (confidence === 'partial') {
      linkAnalysisContext = buildPartialContext(data);
    } else {
      linkAnalysisContext = buildMinimalContext(url, data.platform || platform, data.analysis_notes);
    }

    // Store analysis durably on the message record — non-blocking
    if (messageId) {
      base44.entities.Message.update(messageId, {
        link_analysis_status: 'complete',
        video_platform: data.platform,
        video_caption: data.caption,
        video_description: data.description,
        video_transcript: data.transcript ? data.transcript.substring(0, 2000) : null,
        video_thumbnail_url: data.thumbnail_url,
        analysis_confidence: data.analysis_confidence,
        analyzed_at: new Date().toISOString(),
      }).catch(err => console.warn(`[LinkAnalysis] Failed to store on message: ${err?.message}`));
    }

    return { linkAnalysisContext, linkData: data };

  } catch (err) {
    console.warn(`[LinkAnalysis] Analysis failed: ${err?.message}`);
    if (messageId) {
      base44.entities.Message.update(messageId, {
        link_analysis_status: 'failed',
      }).catch(() => {});
    }
    return {
      linkAnalysisContext: buildMinimalContext(url, platform, err?.message),
      linkData: null,
    };
  }
}

/**
 * Quick synchronous check: does a message text contain any URLs?
 * Use this to decide whether to trigger the async pipeline.
 */
export function messageContainsLink(text) {
  if (!text) return false;
  return URL_REGEX.test(text);
}

// Reset regex lastIndex after global test
URL_REGEX.lastIndex = 0;

/**
 * Build context from a previously stored link analysis on a Message record.
 * Used when the message already has stored analysis (e.g. recalled in context window).
 */
export function buildLinkContextFromStoredMessage(message) {
  if (!message?.analysis_confidence) return '';
  const confidence = message.analysis_confidence;

  if (confidence === 'full' || confidence === 'partial') {
    const lines = [];
    if (message.video_platform) lines.push(`Platform: ${message.video_platform}`);
    if (message.video_caption) lines.push(`Caption: ${message.video_caption}`);
    if (message.video_description) lines.push(`Description: ${message.video_description?.substring(0, 300)}`);
    if (message.video_transcript) lines.push(`Transcript: ${message.video_transcript?.substring(0, 800)}`);

    return `\n\n[Previously shared link — ${confidence} understanding]\n${lines.join('\n')}`;
  }

  return '';
}