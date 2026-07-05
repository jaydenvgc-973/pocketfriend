/**
 * videoEmbedSanitizer
 *
 * Parses and validates user-provided video URLs / iframe embed code.
 * Extracts ONLY a safe embed src — never renders arbitrary HTML.
 *
 * Allowed providers: YouTube, Vimeo, Dailymotion, direct MP4/WebM.
 * Blocked: javascript:, data:, script tags, unknown embeds.
 *
 * Returns a normalized descriptor used by WatchVideoPanel.
 * No URL is ever persisted to a database/entity — this is a pure function.
 */

const ALLOWED_PROVIDERS = [
  {
    name: "youtube",
    patterns: [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
    ],
    buildEmbed: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  },
  {
    name: "vimeo",
    patterns: [
      /vimeo\.com\/(\d+)/,
      /player\.vimeo\.com\/video\/(\d+)/,
    ],
    buildEmbed: (id) => `https://player.vimeo.com/video/${id}`,
  },
  {
    name: "dailymotion",
    patterns: [
      /dailymotion\.com\/video\/([A-Za-z0-9]+)/,
      /dai\.ly\/([A-Za-z0-9]+)/,
    ],
    buildEmbed: (id) => `https://www.dailymotion.com/embed/video/${id}`,
  },
  {
    name: "x",
    patterns: [
      /(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/,
    ],
    buildEmbed: (id) => `https://platform.twitter.com/embed/Tweet.html?id=${id}`,
  },
  {
    name: "instagram",
    patterns: [
      /instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/,
    ],
    buildEmbed: (id) => `https://www.instagram.com/p/${id}/embed/`,
  },
  {
    name: "facebook",
    patterns: [
      /facebook\.com\/[^/]+\/videos\/(\d+)/,
      /facebook\.com\/watch\/?\?.*v=(\d+)/,
      /fb\.watch\/([A-Za-z0-9_-]+)/,
    ],
    buildEmbed: (id, originalUrl) => {
      // Facebook embeds require the full permalink encoded as the href param
      const href = originalUrl || `https://www.facebook.com/watch?v=${id}`;
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&width=560&t=0`;
    },
  },
];

const ALLOWED_DIRECT_EXTENSIONS = [".mp4", ".webm", ".ogv"];

function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function extractIframeSrc(html) {
  // Extract the src attribute from the first <iframe> without rendering HTML.
  const match = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function hasDangerousContent(input) {
  return /<script/i.test(input) || /\bon\w+\s*=/i.test(input);
}

/**
 * Sanitize a raw user input (URL or iframe embed code).
 * Returns { valid, provider, embedUrl, type, error }.
 * Never persists the URL — caller holds it in ephemeral state only.
 */
export function sanitizeVideoInput(rawInput) {
  if (!rawInput || typeof rawInput !== "string") {
    return { valid: false, error: "No input provided." };
  }

  const input = rawInput.trim();
  if (!input) return { valid: false, error: "No input provided." };

  if (hasDangerousContent(input)) {
    return { valid: false, error: "Blocked: script tags and inline event handlers are not allowed." };
  }

  let urlToProcess = input;

  // If the user pasted iframe HTML, extract only the src — discard everything else.
  if (/<iframe/i.test(input)) {
    const src = extractIframeSrc(input);
    if (!src) return { valid: false, error: "Could not find a valid src in the iframe embed." };
    urlToProcess = src;
  }

  // Reject dangerous protocols at every stage.
  if (/^javascript:/i.test(urlToProcess) || /^data:/i.test(urlToProcess)) {
    return { valid: false, error: "Blocked: unsafe protocol." };
  }

  if (!isSafeHttpUrl(urlToProcess)) {
    return { valid: false, error: "Invalid URL — must start with http:// or https://." };
  }

  // Check allowed providers
  for (const provider of ALLOWED_PROVIDERS) {
    for (const pattern of provider.patterns) {
      const match = urlToProcess.match(pattern);
      if (match) {
        return {
          valid: true,
          provider: provider.name,
          embedUrl: provider.buildEmbed(match[1]),
          originalUrl: urlToProcess,
          type: "iframe",
        };
      }
    }
  }

  // Direct media file (MP4/WebM/OGV) — require HTTPS for safety
  const lowerUrl = urlToProcess.toLowerCase();
  if (ALLOWED_DIRECT_EXTENSIONS.some((ext) => lowerUrl.includes(ext))) {
    try {
      const parsed = new URL(urlToProcess);
      if (parsed.protocol !== "https:") {
        return { valid: false, error: "Direct media links must use HTTPS." };
      }
      return {
        valid: true,
        provider: "direct",
        embedUrl: urlToProcess,
        originalUrl: urlToProcess,
        type: "video",
      };
    } catch {
      return { valid: false, error: "Invalid direct media URL." };
    }
  }

  // Already a player embed URL from an allowed host
  try {
    const parsed = new URL(urlToProcess);
    const allowedEmbedHosts = [
      "www.youtube.com", "youtube.com",
      "www.youtube-nocookie.com", "youtube-nocookie.com",
      "player.vimeo.com", "vimeo.com",
      "www.dailymotion.com", "dailymotion.com",
      "platform.twitter.com", "www.instagram.com", "instagram.com",
      "www.facebook.com", "facebook.com",
    ];
    const isEmbedPath = parsed.pathname.includes("/embed/") ||
                       parsed.hostname === "platform.twitter.com" ||
                       parsed.pathname.includes("/plugins/video.php");
    if (allowedEmbedHosts.includes(parsed.hostname) && isEmbedPath) {
      return {
        valid: true,
        provider: "embed",
        embedUrl: urlToProcess,
        originalUrl: urlToProcess,
        type: "iframe",
      };
    }
  } catch {
    // fall through to reject
  }

  return {
    valid: false,
    error: "Unsupported source. Use a YouTube, Vimeo, Dailymotion, X, Instagram, or Facebook video link, or a direct HTTPS MP4/WebM link.",
  };
}

/**
 * Build a safe, human-readable context label for character awareness.
 * Characters receive ONLY this metadata — never the playable URL.
 */
export function buildWatchContextLabel({ provider, title, videoType }) {
  const parts = [];
  if (title) parts.push(`Title/label: "${title}"`);
  if (provider && provider !== "direct") parts.push(`Source: ${provider}`);
  if (videoType) parts.push(`Type: ${videoType}`);
  return parts.join(" · ");
}