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
      const isRetryable = err?.message?.includes('rate') || err?.message?.includes('429') || err?.message?.includes('Rate limit') || err?.message?.includes('Network') || err?.message?.includes('network') || err?.message?.includes('timeout');
      if (!isRetryable || retryCount === maxRetries) throw err;
      const delayMs = Math.pow(2, retryCount + 1) * 1000;
      console.warn(`[RATE_LIMIT] Retry ${retryCount + 1}/${maxRetries} after ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
      retryCount++;
    }
  }
};