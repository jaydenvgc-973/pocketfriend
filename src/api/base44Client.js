import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

// Retry wrapper with exponential backoff for rate limit errors
const createRetryableClient = (baseClient) => {
  return new Proxy(baseClient, {
    get(target, prop) {
      const original = target[prop];
      if (typeof original !== 'object' || original === null) return original;

      const isAuthNamespace = prop === 'auth';

      return new Proxy(original, {
        get(t, p) {
          const fn = t[p];
          if (typeof fn !== 'function') return fn;

          return async function(...args) {
            let attempt = 0;
            const maxRetries = 5;
            while (attempt < maxRetries) {
              try {
                return await fn.apply(t, args);
              } catch (err) {
                const status = err?.status || err?.response?.status;
                if (!isAuthNamespace && status === 401) {
                  baseClient.auth.redirectToLogin(window.location.href);
                  throw err;
                }
                const isRateLimit = err?.message?.includes('Rate limit') || err?.code === 429 || status === 429;
                if (!isRateLimit) throw err;
                attempt++;
                if (attempt >= maxRetries) throw err;
                const delay = Math.pow(2, attempt + 1) * 1000 + Math.random() * 1000;
                await new Promise(r => setTimeout(r, delay));
              }
            }
          };
        }
      });
    }
  });
};

//Create a client with authentication required
const baseClient = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

export const base44 = createRetryableClient(baseClient);