/**
 * imageGenHelpers — shared image generation utilities called by other backend functions.
 *
 * Provides:
 *   - isContentPolicyBlock(errorMessage, statusCode) — unified content policy detection across all providers
 *   - resolveCharacterOutfitText(charRecord, promptLower) — unified outfit resolver with sleep/wake priority
 *   - buildCharacterAppearanceDesc(charRecord) — unified text description builder
 *   - resolveZoneImagesFromLocation(location, promptLower) — unified zone resolver
 *
 * SYNC CONTRACT: Any change to outfit/appearance/zone resolution here must be reflected in
 * generateImageAsync, regenerateImageWithReason, and recoverSingleImage.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { operation, ...params } = await req.json();

  // ── isContentPolicyBlock ────────────────────────────────────────────────────
  if (operation === 'isContentPolicyBlock') {
    const msg = (params.errorMessage || '').toLowerCase();
    const statusCode = params.statusCode || null;

    const isBlock = (
      msg.includes('content policy') ||
      msg.includes('safety system') ||
      msg.includes('violates our content') ||
      msg.includes('violates our usage') ||
      msg.includes('against our usage policies') ||
      msg.includes('policy violation') ||
      msg.includes('moderation') ||
      msg.includes('safety filter') ||
      msg.includes('flagged by our safety') ||
      (msg.includes('cannot generate') && msg.includes('explicit')) ||
      // Vertex AI / Google specific phrases
      msg.includes('violated vertex') ||
      msg.includes('violated google') ||
      msg.includes('vertex ai') ||
      msg.includes('unable to show') ||
      msg.includes('filtered out') ||
      msg.includes('imagen') ||
      msg.includes('responsible ai') ||
      // HTTP 400 with safety signals (not generic 400s)
      (statusCode === 400 && (
        msg.includes('safety') || msg.includes('policy') ||
        msg.includes('blocked_by_safety') || msg.includes('blocked') || msg.includes('filter')
      ))
    );

    return Response.json({ isBlock });
  }

  return Response.json({ error: `Unknown operation: ${operation}` }, { status: 400 });
});