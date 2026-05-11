/**
 * analyzeSharedLink
 *
 * Backend link/video understanding function.
 *
 * Returns a structured analysis object with confidence tier:
 *   "full"    — transcript or full content available
 *   "partial" — title/caption/metadata only, no transcript
 *   "minimal" — restricted/inaccessible (login wall, blocked, etc.)
 *
 * NEVER hallucinate content. If content is unavailable, confidence = "minimal".
 * Characters must ONLY discuss what is verifiably in the returned fields.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── PLATFORM DETECTION ────────────────────────────────────────────────────────

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return 'YouTube';
  if (/instagram\.com/.test(url)) return 'Instagram';
  if (/tiktok\.com/.test(url)) return 'TikTok';
  if (/twitter\.com|x\.com/.test(url)) return 'Twitter/X';
  if (/facebook\.com|fb\.watch/.test(url)) return 'Facebook';
  if (/reddit\.com/.test(url)) return 'Reddit';
  if (/dailymotion\.com/.test(url)) return 'Dailymotion';
  if (/twitch\.tv/.test(url)) return 'Twitch';
  if (/vimeo\.com/.test(url)) return 'Vimeo';
  return 'generic web';
}

function detectContentType(url, platform) {
  const lower = url.toLowerCase();
  // Direct image
  if (/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?.*)?$/.test(lower)) return 'image';
  // Audio
  if (/\.(mp3|wav|ogg|flac|m4a)(\?.*)?$/.test(lower)) return 'audio';
  // Short-form video patterns
  if (/\/reels?\//.test(lower) || /\/shorts?\//.test(lower) || /tiktok\.com/.test(lower)) return 'short video';
  // Video platforms
  if (['YouTube', 'Dailymotion', 'Vimeo', 'Twitch'].includes(platform)) return 'video';
  // Social posts
  if (['Instagram', 'Twitter/X', 'Facebook', 'Reddit'].includes(platform)) return 'social media post';
  return 'webpage';
}

// Platforms that commonly block server-side access (require login/cookie)
const RESTRICTED_PLATFORMS = new Set(['Instagram', 'TikTok', 'Facebook', 'Twitter/X']);

// ── YOUTUBE ID EXTRACTION ─────────────────────────────────────────────────────

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ── PAGE FETCH (public pages only) ───────────────────────────────────────────

async function tryFetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { html: null, status: res.status };
    const text = await res.text();
    return { html: text, status: res.status };
  } catch (e) {
    return { html: null, status: 0, error: e.message };
  }
}

// Extract meta tags from raw HTML
function extractMetaTags(html) {
  if (!html) return {};
  const get = (pattern) => {
    const m = html.match(pattern);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : null;
  };
  return {
    title: get(/<title[^>]*>([^<]+)<\/title>/i) ||
           get(/og:title[^>]+content="([^"]+)"/i) ||
           get(/twitter:title[^>]+content="([^"]+)"/i),
    description: get(/og:description[^>]+content="([^"]+)"/i) ||
                 get(/name="description"[^>]+content="([^"]+)"/i) ||
                 get(/twitter:description[^>]+content="([^"]+)"/i),
    thumbnail: get(/og:image[^>]+content="([^"]+)"/i) ||
               get(/twitter:image[^>]+content="([^"]+)"/i),
    author: get(/(?:og:site_name|twitter:site)[^>]+content="([^"]+)"/i),
    video_duration: get(/og:video:duration[^>]+content="([^"]+)"/i) ||
                    get(/itemprop="duration"[^>]+content="([^"]+)"/i),
    // YouTube-specific
    yt_description: get(/(?:ytInitialData|videoDetails)[\s\S]{0,500}?"description":\s*\{"simpleText":"([^"]{10,500})"/),
  };
}

// ── LLM ANALYSIS ─────────────────────────────────────────────────────────────

async function runLLMAnalysis(base44, url, platform, contentType, htmlContent, meta, videoId) {
  const htmlSnippet = htmlContent ? htmlContent.substring(0, 6000) : '';

  const prompt = `You are a link/media analysis assistant. Analyze the following shared URL and extract all available information.

URL: ${url}
Platform: ${platform}
Content type: ${contentType}
${videoId ? `Video ID: ${videoId}` : ''}

${meta.title ? `Page title: ${meta.title}` : ''}
${meta.description ? `Page description: ${meta.description}` : ''}
${meta.author ? `Author/site: ${meta.author}` : ''}
${meta.thumbnail ? `Thumbnail URL: ${meta.thumbnail}` : ''}
${meta.video_duration ? `Duration: ${meta.video_duration}` : ''}

${htmlSnippet ? `Raw page content (first 6000 chars):\n${htmlSnippet}` : 'No page content could be retrieved (platform restriction or login required).'}

TASK:
1. Extract all factual information about this content from what is available above.
2. Do NOT invent, assume, or hallucinate any content that is not explicitly present.
3. Assign a confidence tier:
   - "full": transcript, subtitles, or complete text body is available and extracted
   - "partial": title, description, or caption available but no transcript/full text
   - "minimal": essentially nothing available (blocked, login-required, no content retrieved)

4. For YouTube videos specifically:
   - Extract any video description visible in the page source
   - Note that transcripts require separate API access — only claim "full" if you see actual spoken content

5. For social media posts (Instagram/TikTok/Facebook):
   - These platforms heavily restrict server-side access
   - Only claim "partial" if real caption/title data was retrieved
   - If htmlContent is empty or a login redirect, use "minimal"

Return ONLY valid JSON with this exact structure:
{
  "platform": string,
  "content_type": string,
  "access_status": "accessible" | "restricted" | "partial_access" | "not_found",
  "analysis_confidence": "full" | "partial" | "minimal",
  "title": string | null,
  "description": string | null,
  "caption": string | null,
  "transcript": string | null,
  "thumbnail_url": string | null,
  "thumbnail_description": string | null,
  "author_name": string | null,
  "duration": string | null,
  "extracted_visible_text": string | null,
  "safe_character_context": string,
  "analysis_notes": string | null
}

safe_character_context should be a 1-3 sentence summary of what a character MAY say about this link, based strictly on available data. If confidence is minimal, it must state the character cannot determine the contents.`;

  try {
    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string' },
          content_type: { type: 'string' },
          access_status: { type: 'string' },
          analysis_confidence: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          caption: { type: 'string' },
          transcript: { type: 'string' },
          thumbnail_url: { type: 'string' },
          thumbnail_description: { type: 'string' },
          author_name: { type: 'string' },
          duration: { type: 'string' },
          extracted_visible_text: { type: 'string' },
          safe_character_context: { type: 'string' },
          analysis_notes: { type: 'string' },
        },
      },
    });
    return result;
  } catch (err) {
    console.error(`[analyzeSharedLink] LLM analysis failed: ${err.message}`);
    return null;
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { url, message_id, conversation_id, character_id } = body;

    if (!url) {
      return Response.json({ success: false, error: 'url is required' }, { status: 400 });
    }

    console.log(`[analyzeSharedLink] ▶ url=${url.substring(0, 80)} user=${user.email}`);

    const platform = detectPlatform(url);
    const contentType = detectContentType(url, platform);
    const videoId = platform === 'YouTube' ? extractYouTubeId(url) : null;

    // Check if this is a direct image URL — use vision analysis instead
    if (contentType === 'image') {
      console.log(`[analyzeSharedLink] Direct image URL detected — using vision analysis`);
      // For direct images, attempt a basic LLM vision description
      try {
        const imgDesc = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: 'Describe this image in 2-3 sentences. What do you see? Be factual and specific.',
          file_urls: [url],
        });
        return Response.json({
          success: true,
          url,
          platform: 'Direct image',
          content_type: 'image',
          access_status: 'accessible',
          analysis_confidence: 'full',
          title: null,
          description: typeof imgDesc === 'string' ? imgDesc : null,
          caption: null,
          transcript: null,
          thumbnail_url: url,
          thumbnail_description: typeof imgDesc === 'string' ? imgDesc : null,
          author_name: null,
          duration: null,
          extracted_visible_text: null,
          safe_character_context: `The user shared an image. Visual content: ${typeof imgDesc === 'string' ? imgDesc.substring(0, 200) : 'could not be analyzed'}.`,
          analysis_notes: 'Direct image URL — vision analysis used',
        });
      } catch (imgErr) {
        return Response.json({
          success: true,
          url,
          platform: 'Direct image',
          content_type: 'image',
          access_status: 'partial_access',
          analysis_confidence: 'minimal',
          safe_character_context: 'The user shared an image link, but it could not be analyzed.',
          analysis_notes: imgErr.message,
        });
      }
    }

    // For restricted platforms, note expected limitation but still try page fetch
    const isRestrictedPlatform = RESTRICTED_PLATFORMS.has(platform);
    if (isRestrictedPlatform) {
      console.log(`[analyzeSharedLink] Platform "${platform}" typically restricts server-side access`);
    }

    // Try to fetch the page
    const { html, status, error: fetchError } = await tryFetchPageText(url);
    const meta = extractMetaTags(html);

    console.log(`[analyzeSharedLink] Page fetch: status=${status} | html_length=${html?.length || 0} | title="${meta.title || 'none'}"`);

    // Check for login redirect (usually returns 200 but with login page content)
    const isLoginWall = html && (
      /login|sign.?in|log.?in|create.?account|join.?now/i.test(html.substring(0, 2000)) &&
      !meta.title
    );

    if (isLoginWall) {
      console.warn(`[analyzeSharedLink] Login wall detected for ${platform}`);
      return Response.json({
        success: true,
        url,
        platform,
        content_type: contentType,
        access_status: 'restricted',
        analysis_confidence: 'minimal',
        title: null,
        description: null,
        caption: null,
        transcript: null,
        thumbnail_url: null,
        thumbnail_description: null,
        author_name: null,
        duration: null,
        extracted_visible_text: null,
        safe_character_context: `The user shared a ${platform} link, but the content requires login to view. The character cannot determine what it contains.`,
        analysis_notes: `${platform} requires authentication — content inaccessible server-side`,
        error: null,
      });
    }

    // Run LLM analysis with whatever we have
    const analysis = await runLLMAnalysis(base44, url, platform, contentType, html, meta, videoId);

    if (!analysis) {
      // LLM failed — build a fallback from meta tags
      const hasPartialData = !!(meta.title || meta.description);
      return Response.json({
        success: true,
        url,
        platform,
        content_type: contentType,
        access_status: status >= 200 && status < 400 ? 'accessible' : 'partial_access',
        analysis_confidence: hasPartialData ? 'partial' : 'minimal',
        title: meta.title || null,
        description: meta.description || null,
        caption: null,
        transcript: null,
        thumbnail_url: meta.thumbnail || null,
        thumbnail_description: null,
        author_name: meta.author || null,
        duration: meta.video_duration || null,
        extracted_visible_text: null,
        safe_character_context: hasPartialData
          ? `The user shared a link titled "${meta.title || 'untitled'}". The character may discuss the title/topic but cannot describe specific content.`
          : `The user shared a link but its contents could not be analyzed. The character should ask what it's about.`,
        analysis_notes: 'LLM analysis failed — using meta tag fallback',
        error: null,
      });
    }

    // Apply safety override: if the platform is known-restricted and analysis claims "full"
    // without a real transcript, downgrade to "partial"
    let finalConfidence = analysis.analysis_confidence || 'minimal';
    if (isRestrictedPlatform && finalConfidence === 'full' && !analysis.transcript) {
      finalConfidence = 'partial';
      console.log(`[analyzeSharedLink] Downgrading ${platform} from "full" to "partial" — no transcript available`);
    }

    // Coerce: if no title, description, or caption — force minimal
    const hasSubstance = !!(analysis.title || analysis.description || analysis.caption || analysis.transcript);
    if (!hasSubstance) {
      finalConfidence = 'minimal';
    }

    console.log(`[analyzeSharedLink] ✓ Final: confidence=${finalConfidence} platform=${analysis.platform || platform} type=${analysis.content_type || contentType}`);

    return Response.json({
      success: true,
      url,
      platform: analysis.platform || platform,
      content_type: analysis.content_type || contentType,
      access_status: analysis.access_status || (html ? 'accessible' : 'restricted'),
      analysis_confidence: finalConfidence,
      title: analysis.title || meta.title || null,
      description: analysis.description || meta.description || null,
      caption: analysis.caption || null,
      transcript: analysis.transcript || null,
      thumbnail_url: analysis.thumbnail_url || meta.thumbnail || null,
      thumbnail_description: analysis.thumbnail_description || null,
      author_name: analysis.author_name || meta.author || null,
      duration: analysis.duration || meta.video_duration || null,
      extracted_visible_text: analysis.extracted_visible_text || null,
      safe_character_context: analysis.safe_character_context || null,
      analysis_notes: analysis.analysis_notes || null,
      error: null,
    });

  } catch (error) {
    console.error('[analyzeSharedLink] Fatal:', error.message);
    return Response.json({
      success: false,
      error: error.message,
      analysis_confidence: 'minimal',
    }, { status: 500 });
  }
});