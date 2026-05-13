/**
 * Foreground Priority System
 *
 * Global controller for prioritizing active user actions over background systems.
 * Tracks foreground state, suppresses background work during active operations,
 * and manages resource allocation.
 */

class ForegroundPriority {
  constructor() {
    this.state = {
      active_page: null,           // current page (Chat, Profile, MediaGrid, etc.)
      active_action: null,         // current action (response_generation, image_generation, profile_load, etc.)
      foreground_request_id: null, // unique ID for tracking active request
      priority: 'background',      // 'background' | 'user_initiated'
      suppress_background_until: null, // timestamp: background systems pause until this time
      active_feature_lock: false,  // true = user action in progress, no competing work
      start_time: null,
      request_cache: new Map(),    // in-memory cache for deduped requests
      cache_ttl: {
        character: 5 * 60 * 1000,        // 5 min
        location: 5 * 60 * 1000,
        relationships: 3 * 60 * 1000,
        media: 10 * 60 * 1000,
        roster: 5 * 60 * 1000,
      },
    };
  }

  /**
   * Mark the start of a foreground user action.
   * Background systems must suppress until this completes.
   */
  startForegroundAction(page, action, request_id) {
    this.state.active_page = page;
    this.state.active_action = action;
    this.state.foreground_request_id = request_id;
    this.state.priority = 'user_initiated';
    this.state.active_feature_lock = true;
    this.state.start_time = Date.now();
    // Suppress background work for 60 seconds (active action + recovery time)
    this.state.suppress_background_until = Date.now() + 60000;
    console.log(`[ForegroundPriority] START: ${action} on ${page} (request_id=${request_id})`);
  }

  /**
   * Mark the end of a foreground user action.
   */
  endForegroundAction(request_id) {
    if (this.state.foreground_request_id !== request_id) {
      console.warn(`[ForegroundPriority] endForegroundAction: request_id mismatch (expected=${this.state.foreground_request_id}, got=${request_id})`);
      return;
    }
    const duration = Date.now() - this.state.start_time;
    console.log(`[ForegroundPriority] END: ${this.state.active_action} (duration=${duration}ms)`);
    this.state.active_feature_lock = false;
    this.state.priority = 'background';
    this.state.active_page = null;
    this.state.active_action = null;
    this.state.foreground_request_id = null;
  }

  /**
   * Check if a background system should suppress itself right now.
   * Returns true if user action is active and this is not critical to it.
   */
  shouldSuppressBackground(system_name, is_critical_to_current_action = false) {
    if (!this.state.active_feature_lock) return false;
    if (is_critical_to_current_action) return false;
    if (Date.now() > this.state.suppress_background_until) return false;
    console.log(`[ForegroundPriority] SUPPRESS: ${system_name} (active=${this.state.active_action})`);
    return true;
  }

  /**
   * Dedupe and cache a request.
   * If identical request is in-flight or cached, return shared result.
   */
  async dedupeRequest(cache_key, resource_type, fetcher) {
    const now = Date.now();

    // Check cache first
    const cached = this.state.request_cache.get(cache_key);
    if (cached && cached.expires > now) {
      console.log(`[ForegroundPriority] CACHE_HIT: ${cache_key} (${resource_type})`);
      return cached.data;
    }

    // In-flight deduplication: if this request is already pending, return the promise
    const inFlight = this.state.request_cache.get(`${cache_key}__inflight`);
    if (inFlight) {
      console.log(`[ForegroundPriority] DEDUP: ${cache_key} (reusing in-flight promise)`);
      return inFlight;
    }

    // Start the request and store the promise
    const promise = fetcher();
    this.state.request_cache.set(`${cache_key}__inflight`, promise);

    try {
      const data = await promise;
      // Cache the result
      const ttl = this.state.cache_ttl[resource_type] || 5 * 60 * 1000;
      this.state.request_cache.set(cache_key, {
        data,
        expires: now + ttl,
      });
      console.log(`[ForegroundPriority] CACHED: ${cache_key} (${resource_type}, ttl=${ttl}ms)`);
      return data;
    } finally {
      // Clean up in-flight marker
      this.state.request_cache.delete(`${cache_key}__inflight`);
    }
  }

  /**
   * Clear cache for a resource type (e.g., after data change).
   */
  clearCache(resource_type, filter_key = null) {
    if (!filter_key) {
      // Clear all of type
      for (const [key] of this.state.request_cache) {
        if (key.startsWith(resource_type)) {
          this.state.request_cache.delete(key);
        }
      }
      console.log(`[ForegroundPriority] CLEAR_CACHE: ${resource_type} (all)`);
    } else {
      this.state.request_cache.delete(filter_key);
      console.log(`[ForegroundPriority] CLEAR_CACHE: ${filter_key}`);
    }
  }

  /**
   * Get current foreground state (for logging/diagnostics).
   */
  getState() {
    return {
      ...this.state,
      is_active: this.state.active_feature_lock,
      suppress_ends_in_ms: Math.max(0, this.state.suppress_background_until - Date.now()),
    };
  }
}

export const foregroundPriority = new ForegroundPriority();

export const isForegroundActive = () => foregroundPriority.state.active_feature_lock;