/**
 * reelProviders.js
 *
 * PROVIDER INTERFACE FOR MEMORY REEL ANIMATION
 *
 * Architecture:
 *   Provider 1 (DEFAULT): Base44 GenerateVideo — cloud-based, no identity guarantee.
 *   Provider 2 (EXPERIMENTAL): ComfyUI External Server — requires user-hosted GPU server.
 *
 * Feature flag: useExperimentalIdentityAnimation
 *   - false (default): always uses Provider 1 (Base44 GenerateVideo)
 *   - true: attempts Provider 2 (ComfyUI). If ComfyUI server is not configured,
 *     fails visibly with a clear diagnostic. NEVER silently falls back to Provider 1
 *     and pretends identity was preserved — that would be a false success claim.
 *
 * HOW TO ADD A REAL COMFYUI SERVER:
 *   1. Set secret: COMFYUI_SERVER_URL = https://your-server.example.com
 *   2. Set secret: COMFYUI_API_KEY = your_api_key (if your server requires auth)
 *   3. Set useExperimentalIdentityAnimation = true in the job payload or UserSettings
 *   4. The bridge function will call your server's /prompt endpoint with the
 *      AnimateDiff + IP-Adapter FaceID workflow JSON
 *
 * RUNTIME REQUIREMENTS FOR COMFYUI PROVIDER (external server only):
 *   - Python 3.10+
 *   - ComfyUI server running and accessible via HTTP
 *   - GPU: minimum 8GB VRAM (16GB+ recommended for Wan 2.2)
 *   - Models loaded: AnimateDiff, IP-Adapter FaceID, ControlNet OpenPose
 *   - Wan 2.2 requires 80GB+ VRAM or quantized version for consumer GPUs
 *   - ComfyUI API mode enabled (--listen flag)
 *   Base44 has NO local GPU runtime. This provider requires an external server.
 */

export const PROVIDER_IDS = {
  BASE44_GENERATE_VIDEO: 'base44_generate_video',
  COMFYUI_EXTERNAL: 'comfyui_external',
};

/**
 * Resolve which provider to use for this clip.
 * Returns a provider descriptor — never throws.
 *
 * @param {object} opts
 * @param {boolean} opts.useExperimentalIdentityAnimation - feature flag from job settings
 * @param {string|null} opts.comfyuiServerUrl - from Deno.env (secret)
 * @returns {{ id: string, ready: boolean, reason: string }}
 */
export function resolveAnimationProvider({ useExperimentalIdentityAnimation, comfyuiServerUrl }) {
  if (!useExperimentalIdentityAnimation) {
    return {
      id: PROVIDER_IDS.BASE44_GENERATE_VIDEO,
      ready: true,
      reason: 'Using default Base44 GenerateVideo provider. useExperimentalIdentityAnimation=false.',
    };
  }

  // Experimental path selected — check if external server is configured
  if (!comfyuiServerUrl) {
    return {
      id: PROVIDER_IDS.COMFYUI_EXTERNAL,
      ready: false,
      reason: 'COMFYUI_NOT_CONFIGURED: useExperimentalIdentityAnimation=true but no COMFYUI_SERVER_URL secret is set. ' +
        'ComfyUI is an external GPU server that must be hosted by you. ' +
        'Base44 has no local GPU runtime and cannot run ComfyUI internally. ' +
        'To enable: set COMFYUI_SERVER_URL and optionally COMFYUI_API_KEY in dashboard secrets, ' +
        'then point them at your self-hosted or cloud-hosted ComfyUI instance (e.g. RunPod, Vast.ai, local GPU machine).',
    };
  }

  return {
    id: PROVIDER_IDS.COMFYUI_EXTERNAL,
    ready: true,
    reason: `ComfyUI external provider configured at ${comfyuiServerUrl.replace(/\/\/.*@/, '//[redacted]@')}`,
  };
}

/**
 * Diagnostic summary for a provider resolution result.
 * Used in validation_notes and UI error display.
 */
export function buildProviderDiagnostic(provider, clipIndex) {
  const prefix = `Clip ${clipIndex + 1} [${provider.id}]`;
  if (provider.ready) {
    return `${prefix}: Provider ready. ${provider.reason}`;
  }
  return `${prefix}: Provider NOT READY — ${provider.reason}`;
}