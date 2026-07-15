/**
 * llmUtils.js
 *
 * Shared LLM utility functions extracted from pages/Chat.
 * Pure functions with no React state dependency.
 */

import { base44 } from "@/api/base44Client";

/**
 * Calls InvokeLLM with exponential-backoff retry on rate limit errors.
 *
 * @param {string} prompt
 * @param {string} model
 * @param {number} maxRetries
 * @param {boolean} needsInternet
 * @returns {Promise<string>}
 */
export const callLLMWithRetry = async (prompt, model = 'gemini_3_flash', maxRetries = 3, needsInternet = false) => {
  let retryCount = 0;
  while (retryCount <= maxRetries) {
    try {
      return await base44.integrations.Core.InvokeLLM({
        prompt,
        ...(needsInternet ? { add_context_from_internet: true } : {}),
        model,
      });
    } catch (err) {
      const msg = err?.message || '';
      const isRateLimit = msg.includes('rate') || msg.includes('429') || msg.includes('Rate limit');
      const isNetwork = msg.includes('Network') || msg.includes('network') || msg.includes('timeout');
      const isRetryable = isRateLimit || isNetwork;
      if (!isRetryable || retryCount === maxRetries) throw err;
      // Rate limits get a longer backoff (10s, 20s, 30s) — network errors use shorter (2s, 4s, 8s)
      const delayMs = isRateLimit
        ? (retryCount + 1) * 10000
        : Math.pow(2, retryCount + 1) * 1000;
      console.warn(`[LLM_RETRY] ${isRateLimit ? 'rate-limit' : 'network'} | attempt ${retryCount + 1}/${maxRetries} | waiting ${delayMs / 1000}s`);
      await new Promise(r => setTimeout(r, delayMs));
      retryCount++;
    }
  }
};

/**
 * callWithRetry — generic 429/network retry wrapper for ANY base44 SDK call.
 *
 * Use for entity/function calls that are NOT already wrapped by callLLMWithRetry.
 * Retries on rate-limit (429) with 10s/20s/30s backoff and on network errors with
 * 2s/4s/8s backoff. Re-throws non-retryable errors or after maxRetries exhausted.
 *
 * @param {() => Promise<any>} fn  factory returning the SDK promise (called per attempt)
 * @param {number} maxRetries
 * @returns {Promise<any>}
 */
export const callWithRetry = async (fn, maxRetries = 2) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message || '';
      const isRateLimit = msg.includes('429') || msg.includes('rate') || msg.includes('Rate');
      const isNetwork = msg.includes('Network') || msg.includes('network') || msg.includes('timeout');
      if ((!isRateLimit && !isNetwork) || attempt === maxRetries) throw err;
      const delayMs = isRateLimit
        ? (attempt + 1) * 10000
        : Math.pow(2, attempt + 1) * 1000;
      console.warn(`[callWithRetry] ${isRateLimit ? 'rate-limit' : 'network'} | attempt ${attempt + 1}/${maxRetries} | waiting ${delayMs / 1000}s`);
      await new Promise(r => setTimeout(r, delayMs));
      attempt++;
    }
  }
};

/**
 * is429Error — true if the error represents a rate-limit / too-many-requests.
 */
export const is429Error = (err) => {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit') || err?.status === 429;
};