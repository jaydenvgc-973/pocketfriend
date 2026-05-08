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