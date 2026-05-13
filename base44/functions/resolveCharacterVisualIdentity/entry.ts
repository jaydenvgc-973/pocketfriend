/**
 * resolveCharacterVisualIdentity
 *
 * Global character visual identity resolver.
 * Used by all characters (Ethan, others) to determine:
 * - avatar/reference images
 * - appearance lock
 * - visual identity source (avatar, reference_image_urls, appearance_lock)
 *
 * This consolidates what was previously Ethan-only logic into one reusable handler.
 * No character-specific branches — all characters use the same pipeline.
 *
 * Returns:
 * {
 *   avatar_url: string | null,
 *   reference_image_urls: string[],
 *   appearance_lock: object | null,
 *   identity_sources: string[],    // what was actually used
 *   is_locked: boolean,             // appearance_lock present
 *   has_references: boolean,        // reference_image_urls length > 0
 *   has_avatar: boolean,            // avatar_url present
 * }
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// URL normalization utilities
function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

function cdnFilterAccessible(urls) {
  return (urls || [])
    .map(toPublicCDN)
    .filter(isAccessible)
    .filter(url => !url.includes('generated_image'));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // ── FETCH CHARACTER ───────────────────────────────────────────────────────
    // User-scoped fetch (RLS enforces ownership)
    const charList = await base44.entities.Character.filter(
      { id: characterId },
      null,
      1
    ).catch(() => []);
    
    const charRecord = charList?.[0] || null;

    if (!charRecord) {
      return Response.json({ error: 'Character not found.' }, { status: 404 });
    }

    // ── RESOLVE IDENTITY ──────────────────────────────────────────────────────
    // GLOBAL PIPELINE (applies to ALL characters, no special cases):
    //
    // 1. Reference images (user-uploaded photos) — HIGHEST PRIORITY
    // 2. Avatar URL (fallback for display)
    // 3. Appearance lock (readonly fields)
    //
    // All sources are optional. Missing fields do NOT invalidate identity.

    const identitySources = [];

    // Source 1: reference_image_urls (real uploaded photos)
    const referenceImages = cdnFilterAccessible(charRecord.reference_image_urls || []);
    if (referenceImages.length > 0) {
      identitySources.push('reference_image_urls');
    }

    // Source 2: avatar_url (computed or system-generated)
    let avatarUrl = null;
    if (charRecord.avatar_url) {
      const avatarPublic = toPublicCDN(charRecord.avatar_url);
      if (isAccessible(avatarPublic) && !avatarPublic.includes('generated_image')) {
        avatarUrl = avatarPublic;
        if (referenceImages.length === 0) {
          identitySources.push('avatar_url');
        }
      }
    }

    // Source 3: appearance_lock (readonly enforcement)
    const appearanceLock = charRecord.appearance_lock || null;
    if (appearanceLock && Object.keys(appearanceLock).length > 0) {
      identitySources.push('appearance_lock');
    }

    const result = {
      character_id: charRecord.id,
      character_name: charRecord.name,
      avatar_url: avatarUrl,
      reference_image_urls: referenceImages,
      appearance_lock: appearanceLock,
      identity_sources: identitySources,
      is_locked: !!appearanceLock && Object.keys(appearanceLock).length > 0,
      has_references: referenceImages.length > 0,
      has_avatar: !!avatarUrl,
      resolved_at: new Date().toISOString(),
    };

    console.log(
      `[resolveCharacterVisualIdentity] ${charRecord.name} (${characterId})` +
      ` | sources=${identitySources.join(',')}` +
      ` | refs=${referenceImages.length}` +
      ` | avatar=${!!avatarUrl}` +
      ` | locked=${result.is_locked}`
    );

    return Response.json(result);

  } catch (error) {
    console.error('[resolveCharacterVisualIdentity] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});