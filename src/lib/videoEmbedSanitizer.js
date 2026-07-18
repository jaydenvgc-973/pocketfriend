/**
 * videoEmbedSanitizer
 *
 * Provider-based video embed system.
 * Each provider is a single registry entry — adding a new provider is a one-line append.
 *
 * Architecture:
 *   PROVIDERS: array of { name, match(url), buildEmbed(url, match) }
 *   sanitizeVideoInput(): single pipeline that runs every URL through the registry.
 *
 * Security:
 *   - Never renders arbitrary HTML from the user.
 *   - Iframe embed code is parsed, src extracted, rest discarded.
 *   - javascript:, data: protocols are rejected at every stage.
 *   - Only HTTPS for direct media files.
 *   - Only officially embeddable player URLs are accepted.
 *
 * Storage:
 *   Pure function — no persistence. Caller holds the result in ephemeral state only.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER REGISTRY
// To add a provider: append one entry with { name, match, buildEmbed }.
// match() receives a URL string and returns a truthy capture (string or array)
// if the URL belongs to this provider, or null otherwise.
// buildEmbed() receives the original URL and the match result, returns the
// safe embeddable player URL.
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    name: "youtube",
    match: (url) => {
      const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://www.youtube-nocookie.com/embed/${id}`,
  },
  {
    name: "vimeo",
    match: (url) => {
      const m = url.match(/vimeo\.com\/(\d+)/) || url.match(/player\.vimeo\.com\/video\/(\d+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://player.vimeo.com/video/${id}`,
  },
  {
    name: "dailymotion",
    match: (url) => {
      const m = url.match(/dailymotion\.com\/video\/([A-Za-z0-9]+)/) || url.match(/dai\.ly\/([A-Za-z0-9]+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://www.dailymotion.com/embed/video/${id}`,
  },
  {
    name: "internet_archive",
    match: (url) => {
      const m = url.match(/archive\.org\/details\/([A-Za-z0-9_.-]+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://archive.org/embed/${id}`,
  },
  {
    name: "x",
    match: (url) => {
      const m = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://platform.twitter.com/embed/Tweet.html?id=${id}`,
  },
  {
    name: "instagram",
    match: (url) => {
      const m = url.match(/instagram\.com\/(?:p|reel|reels)\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://www.instagram.com/p/${id}/embed/`,
  },
  {
    name: "facebook",
    match: (url) => {
      const m = url.match(/facebook\.com\/[^/]+\/videos\/(\d+)/)
        || url.match(/facebook\.com\/watch\/?\?.*v=(\d+)/)
        || url.match(/fb\.watch\/([A-Za-z0-9_-]+)/);
      return m ? { id: m[1], originalUrl: url } : null;
    },
    // Facebook embeds require the full permalink encoded as the href param
    buildEmbed: (_url, { id, originalUrl }) => {
      const href = originalUrl || `https://www.facebook.com/watch?v=${id}`;
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&width=560&t=0`;
    },
  },
  {
    name: "tiktok",
    match: (url) => {
      const m = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/) || url.match(/vm\.tiktok\.com\/([A-Za-z0-9]+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (url, _id) => `https://www.tiktok.com/embed/v2/${url.match(/(\d{5,})/)?.[1] || ""}`,
  },
  {
    name: "twitch",
    match: (url) => {
      // Twitch video (VOD) or clip
      const vod = url.match(/twitch\.tv\/videos\/(\d+)/);
      if (vod) return { kind: "video", id: vod[1] };
      const clip = url.match(/clips\.twitch\.tv\/([A-Za-z0-9_-]+)/) || url.match(/twitch\.tv\/[^/]+\/clip\/([A-Za-z0-9_-]+)/);
      if (clip) return { kind: "clip", id: clip[1] };
      return null;
    },
    buildEmbed: (_url, { kind, id }) =>
      kind === "clip"
        ? `https://clips.twitch.tv/embed?clip=${id}&parent=${location.hostname}`
        : `https://player.twitch.tv/?video=${id}&parent=${location.hostname}`,
  },
  {
    name: "wistia",
    match: (url) => {
      const m = url.match(/wistia\.com\/medias\/([A-Za-z0-9]+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://fast.wistia.net/embed/iframe/${id}`,
  },
  {
    name: "brightcove",
    match: (url) => {
      // Brightcove embed URLs include account and video IDs in query params
      const parsed = safeParseUrl(url);
      if (!parsed) return null;
      if (!parsed.hostname.includes("players.brightcove.net")) return null;
      const accountId = parsed.pathname.split("/")[1];
      const videoId = parsed.searchParams.get("videoId");
      return accountId && videoId ? { accountId, videoId } : null;
    },
    buildEmbed: (url) => url,
  },
  {
    name: "loom",
    match: (url) => {
      const m = url.match(/loom\.com\/share\/([A-Za-z0-9]+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://www.loom.com/embed/${id}`,
  },
  {
    name: "vidyard",
    match: (url) => {
      const m = url.match(/vidyard\.com\/watch\/([A-Za-z0-9]+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://play.vidyard.com/${id}`,
  },
  {
    name: "kaltura",
    match: (url) => {
      // Kaltura embed URLs carry partner_id and entry_id as query params
      const parsed = safeParseUrl(url);
      if (!parsed) return null;
      if (!parsed.hostname.includes("kaltura.com")) return null;
      const partnerId = parsed.searchParams.get("partner_id") || parsed.pathname.match(/\/p\/(\d+)/)?.[1];
      const entryId = parsed.searchParams.get("uiconf_id") ? parsed.searchParams.get("entry_id") : parsed.pathname.match(/\/entryId\/([A-Za-z0-9_]+)/)?.[1];
      return partnerId && entryId ? { partnerId, entryId, full: url } : null;
    },
    buildEmbed: (_url, { partnerId, entryId }) =>
      `https://cdnapisec.kaltura.com/p/${partnerId}/embedPlayserJs/uiconf_id/0/entry_id/${entryId}`,
  },
  {
    name: "cloudflare_stream",
    match: (url) => {
      const m = url.match(/cloudflarestream\.com\/([A-Za-z0-9]+)/);
      return m ? m[1] : null;
    },
    buildEmbed: (_url, id) => `https://iframe.cloudflarestream.com/${id}`,
  },
  {
    name: "bunny_stream",
    match: (url) => {
      // Bunny Stream: video ID in path, library ID in query
      const parsed = safeParseUrl(url);
      if (!parsed) return null;
      if (!parsed.hostname.includes("video.bunnycdn.com")) return null;
      const videoId = parsed.pathname.split("/").filter(Boolean).pop();
      const libraryId = parsed.searchParams.get("library_id");
      return videoId && libraryId ? { videoId, libraryId } : null;
    },
    buildEmbed: (_url, { videoId, libraryId }) =>
      `https://video.bunnycdn.com/play/${libraryId}/${videoId}`,
  },
  {
    name: "spotify",
    match: (url) => {
      // Spotify episode / show / track embeds
      const m = url.match(/open\.spotify\.com\/(episode|show|track)\/([A-Za-z0-9]+)/);
      return m ? { kind: m[1], id: m[2] } : null;
    },
    buildEmbed: (_url, { kind, id }) => `https://open.spotify.com/embed/${kind}/${id}`,
  },
  {
    name: "soundcloud",
    match: (url) => {
      // SoundCloud widget API URL is the official embed mechanism
      if (!/soundcloud\.com\//.test(url)) return null;
      return url;
    },
    buildEmbed: (url) => `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false`,
  },
  {
    name: "mixcloud",
    match: (url) => {
      const m = url.match(/mixcloud\.com\/([^/]+)\/([^/]+)/);
      return m ? { user: m[1], slug: m[2] } : null;
    },
    buildEmbed: (_url, { user, slug }) =>
      `https://player.mixcloud.com/widget/iframe/?hide_cover=1&feed=%2F${user}%2F${slug}%2F`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DIRECT MEDIA FILES (MP4 / WebM / OGV)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_DIRECT_EXTENSIONS = [".mp4", ".webm", ".ogv", ".m3u8", ".mpd"];

// ─────────────────────────────────────────────────────────────────────────────
// EMBED-HOST ALLOWLIST (for already-embeddable player URLs pasted directly)
// To add a new provider's embed host, append one entry.
// ─────────────────────────────────────────────────────────────────────────────

const EMBED_HOST_ALLOWLIST = [
  "www.youtube.com", "youtube.com",
  "www.youtube-nocookie.com", "youtube-nocookie.com",
  "player.vimeo.com", "vimeo.com",
  "www.dailymotion.com", "dailymotion.com",
  "archive.org",
  "platform.twitter.com",
  "www.instagram.com", "instagram.com",
  "www.facebook.com", "facebook.com",
  "www.tiktok.com",
  "player.twitch.tv", "clips.twitch.tv",
  "fast.wistia.net", "wistia.com",
  "players.brightcove.net",
  "www.loom.com",
  "play.vidyard.com",
  "cdnapisec.kaltura.com",
  "iframe.cloudflarestream.com",
  "video.bunnycdn.com",
  "open.spotify.com",
  "w.soundcloud.com",
  "player.mixcloud.com",
];

const EMBED_PATH_INDICATORS = ["/embed/", "/plugins/video.php", "/watch/", "/play/", "/widget/"];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function safeParseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isSafeHttpUrl(url) {
  const parsed = safeParseUrl(url);
  return parsed ? parsed.protocol === "https:" || parsed.protocol === "http:" : false;
}

function extractIframeSrc(html) {
  const match = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function hasDangerousContent(input) {
  return /<script/i.test(input) || /\bon\w+\s*=/i.test(input);
}

/**
 * Sanitize a raw user input (URL or iframe embed code).
 * Returns { valid, provider, embedUrl, originalUrl, type, error }.
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

  // Run through the provider registry.
  for (const provider of PROVIDERS) {
    const matchResult = provider.match(urlToProcess);
    if (matchResult) {
      try {
        const embedUrl = provider.buildEmbed(urlToProcess, matchResult);
        if (!embedUrl || !isSafeHttpUrl(embedUrl)) {
          continue;
        }
        return {
          valid: true,
          provider: provider.name,
          embedUrl,
          originalUrl: urlToProcess,
          type: "iframe",
        };
      } catch {
        continue;
      }
    }
  }

  // Direct media file (MP4/WebM/OGV) — require HTTPS for safety.
  const lowerUrl = urlToProcess.toLowerCase();
  if (ALLOWED_DIRECT_EXTENSIONS.some((ext) => lowerUrl.includes(ext))) {
    const parsed = safeParseUrl(urlToProcess);
    if (parsed && parsed.protocol === "https:") {
      return {
        valid: true,
        provider: "direct",
        embedUrl: urlToProcess,
        originalUrl: urlToProcess,
        type: "video",
      };
    }
    return { valid: false, error: "Direct media links must use HTTPS." };
  }

  // Already a player embed URL from an allowed host.
  const parsed = safeParseUrl(urlToProcess);
  if (parsed && EMBED_HOST_ALLOWLIST.includes(parsed.hostname)) {
    const isEmbedPath = EMBED_PATH_INDICATORS.some((ind) => parsed.pathname.includes(ind))
      || parsed.hostname === "platform.twitter.com";
    if (isEmbedPath) {
      return {
        valid: true,
        provider: "embed",
        embedUrl: urlToProcess,
        originalUrl: urlToProcess,
        type: "iframe",
      };
    }
  }

  // ── GENERIC PUBLIC URL ACCEPTANCE ──────────────────────────────────────────
  // Any publicly accessible HTTPS URL is accepted. The backend link analysis
  // pipeline (analyzeSharedLink) fetches the page, follows embedded players to
  // their underlying source, and determines whether a playable video exists.
  // We do NOT reject based on domain — we accept and let the analysis determine
  // the content. The page is rendered in an iframe so the user can watch it
  // while characters receive understanding through the analysis pipeline.
  if (parsed && parsed.protocol === "https:") {
    return {
      valid: true,
      provider: "generic",
      embedUrl: urlToProcess,
      originalUrl: urlToProcess,
      type: "iframe",
    };
  }

  return {
    valid: false,
    error: "Could not access the video. The link may require authentication, be blocked by the host, or no playable video exists on the page.",
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