/**
 * resolveUserIdentityForImageGen
 *
 * Backend-safe user identity resolver for image generation pipelines.
 *
 * CONTRACT (mirrors lib/resolveAuthenticatedUser.js):
 *   1. Query User entity by authenticated email — primary authority
 *   2. Query UserSettings by owner_email — secondary authority
 *   3. Build resolved package from those two sources
 *   4. callerBundle (frontend-passed) used ONLY as fallback when DB reload unavailable
 *   5. Character.is_user === true is LAST RESORT — logs [LEGACY_FALLBACK]
 *
 * NEVER attaches autonomy, needs, sleep, hunger, travel, or lifecycle behavior.
 * NEVER creates a new record.
 * NEVER writes any data.
 *
 * Returns:
 * {
 *   worldName: string | null,
 *   visualReferenceImages: string[],   // ordered: uploaded refs > generated avatars
 *   referenceImageUrls: string[],      // raw User.reference_image_urls
 *   generatedAvatarUrls: string[],     // raw User.generated_avatar_urls
 *   appearanceLock: object,            // from UserSettings.appearance_lock
 *   currentOutfit: object | null,      // from UserSettings.user_current_outfit
 *   gender: string | null,
 *   userRefSource: string,             // audit log field — which source provided the refs
 *   worldNameSource: string,           // audit log field — 'user_entity' | 'settings_legacy_mirror' | 'caller_bundle'
 *   _diagnostics: object,              // full audit trail for [IdentityAudit] logs
 * }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

function cdnFilter(urls) {
  return (urls || []).map(toPublicCDN).filter(isAccessible);
}

/**
 * resolveUserIdentityForImageGen
 *
 * @param {object} base44           - Initialized SDK client (with auth context)
 * @param {string} ownerEmail       - Authenticated user's email (from request auth or ownerEmail param)
 * @param {object} [callerBundle]   - Optional frontend-passed bundle (used only as fallback)
 * @returns {Promise<object>}       - Resolved user identity package
 */
export async function resolveUserIdentityForImageGen(base44, ownerEmail, callerBundle = null) {
  const diagnostics = {
    owner_email: ownerEmail,
    user_entity_found: false,
    user_entity_ref_count: 0,
    user_entity_avatar_count: 0,
    settings_found: false,
    settings_ref_count: 0,
    settings_avatar_count: 0,
    legacy_is_user_char_found: false,
    legacy_is_user_char_used: false,
    caller_bundle_used: false,
    world_name_source: null,
    user_ref_source: null,
    final_ref_count: 0,
  };

  if (!ownerEmail) {
    console.warn('[resolveUserIdentityForImageGen] No ownerEmail — cannot resolve user identity');
    return _buildEmpty(callerBundle, diagnostics);
  }

  // ── STEP 1: User entity — PRIMARY authority for visual reference images ────
  // User.reference_image_urls and User.generated_avatar_urls are the authoritative
  // source for user visual identity. These are set by the user uploading their own photos.
  let userRecord = null;
  let userRefUrls = [];
  let userGeneratedAvatarUrls = [];

  try {
    // The User entity is built-in — filter by email field
    const userList = await base44.asServiceRole.entities.User.filter({ email: ownerEmail }, null, 1).catch(() => []);
    userRecord = userList?.[0] || null;

    if (userRecord) {
      diagnostics.user_entity_found = true;
      userRefUrls = cdnFilter(userRecord.reference_image_urls || []);
      userGeneratedAvatarUrls = cdnFilter(userRecord.generated_avatar_urls || []);
      diagnostics.user_entity_ref_count = userRefUrls.length;
      diagnostics.user_entity_avatar_count = userGeneratedAvatarUrls.length;
      console.log(
        `[resolveUserIdentityForImageGen] User entity found | email=${ownerEmail}` +
        ` | reference_image_urls=${userRefUrls.length}` +
        ` | generated_avatar_urls=${userGeneratedAvatarUrls.length}`
      );
    } else {
      console.warn(`[resolveUserIdentityForImageGen] User entity not found for email=${ownerEmail}`);
    }
  } catch (userErr) {
    console.warn(`[resolveUserIdentityForImageGen] User entity lookup failed (non-blocking): ${userErr?.message}`);
  }

  // ── STEP 2: UserSettings — appearance lock, outfit, world name ─────────────
  let settingsRecord = null;
  let appearanceLock = {};
  let currentOutfit = null;
  let worldName = null;
  let worldNameSource = null;
  let gender = userRecord?.gender || null;

  try {
    const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: ownerEmail }, null, 1).catch(() => []);
    settingsRecord = settingsList?.[0] || null;

    if (settingsRecord) {
      diagnostics.settings_found = true;
      // reference_image_urls and generated_avatar_urls on UserSettings are NOT the authority —
      // those fields belong to the User entity. UserSettings fields of the same name were an
      // early design mistake and must not take precedence.
      diagnostics.settings_ref_count = (settingsRecord.reference_image_urls || []).length;
      diagnostics.settings_avatar_count = (settingsRecord.generated_avatar_urls || []).length;

      appearanceLock = settingsRecord.appearance_lock || {};
      currentOutfit = settingsRecord.user_current_outfit || null;

      // World name: prefer User entity field, fall back to UserSettings mirror
      if (userRecord?.world_name) {
        worldName = userRecord.world_name;
        worldNameSource = 'user_entity';
      } else if (settingsRecord.fictional_world_name) {
        worldName = settingsRecord.fictional_world_name;
        worldNameSource = 'settings_legacy_mirror';
        console.log(`[resolveUserIdentityForImageGen] worldName from settings legacy mirror: "${worldName}"`);
      }

      // Gender: prefer User entity, fall back to UserSettings
      if (!gender && settingsRecord.user_gender) {
        gender = settingsRecord.user_gender;
      }
    } else {
      console.warn(`[resolveUserIdentityForImageGen] UserSettings not found for email=${ownerEmail}`);
    }
  } catch (settErr) {
    console.warn(`[resolveUserIdentityForImageGen] UserSettings lookup failed (non-blocking): ${settErr?.message}`);
  }

  // ── STEP 3: Build ordered visual_reference_images ─────────────────────────
  // Priority: uploaded reference photos > generated avatars
  // Both sourced from User entity only (Steps 1 above).
  let visualReferenceImages = [
    ...userRefUrls.slice(0, 3),
    ...userGeneratedAvatarUrls.slice(0, 2),
  ].filter(Boolean);

  let userRefSource = null;
  if (userRefUrls.length > 0) {
    userRefSource = 'user_entity_reference_images';
  } else if (userGeneratedAvatarUrls.length > 0) {
    userRefSource = 'user_entity_generated_avatars';
  }

  // ── STEP 4: Caller bundle fallback (convenience — not primary authority) ───
  // Used ONLY when User entity and UserSettings both returned no refs.
  // Caller bundle is frontend-assembled — it may be stale or incomplete.
  // We log when it is used so the audit trail shows the downgrade.
  if (visualReferenceImages.length === 0 && callerBundle?.visual_reference_images?.length > 0) {
    const callerRefs = cdnFilter(callerBundle.visual_reference_images);
    if (callerRefs.length > 0) {
      visualReferenceImages = callerRefs.slice(0, 3);
      userRefSource = 'caller_bundle_fallback';
      diagnostics.caller_bundle_used = true;
      console.warn(
        `[resolveUserIdentityForImageGen] ⚠️ [CALLER_BUNDLE_FALLBACK] ` +
        `User entity + UserSettings returned no refs — using caller bundle (${callerRefs.length} refs). ` +
        `This is a fallback path, not authoritative.`
      );
    }
  }

  // ── STEP 5: Legacy is_user Character fallback — absolute last resort ───────
  // Character.is_user === true records predate the User entity visual identity fields.
  // They may contain stale avatars. Use ONLY when all other sources are exhausted.
  // Always log [LEGACY_FALLBACK] when this path is taken.
  if (visualReferenceImages.length === 0) {
    try {
      const legacyList = await base44.asServiceRole.entities.Character.filter(
        { owner_email: ownerEmail, is_user: true },
        null,
        1
      ).catch(() => []);
      const legacyChar = legacyList?.[0] || null;

      if (legacyChar) {
        diagnostics.legacy_is_user_char_found = true;
        const avatarPublic = legacyChar.avatar_url ? toPublicCDN(legacyChar.avatar_url) : null;
        if (avatarPublic && isAccessible(avatarPublic) && !avatarPublic.includes('generated_image')) {
          visualReferenceImages = [avatarPublic];
          userRefSource = 'legacy_is_user_character';
          diagnostics.legacy_is_user_char_used = true;
          console.warn(
            `[resolveUserIdentityForImageGen] ⚠️ [LEGACY_FALLBACK] ` +
            `is_user Character avatar used as last resort for email=${ownerEmail}. ` +
            `This Character record predates User entity visual identity fields. ` +
            `The user should upload reference photos to User Profile for a stronger identity lock.`
          );
        }
      }
    } catch (legacyErr) {
      console.warn(`[resolveUserIdentityForImageGen] Legacy is_user lookup failed (non-blocking): ${legacyErr?.message}`);
    }
  }

  // World name fallback chain: user_entity > settings_legacy_mirror > caller_bundle > full_name
  if (!worldName && callerBundle?.world_name) {
    worldName = callerBundle.world_name;
    worldNameSource = 'caller_bundle';
    diagnostics.caller_bundle_used = true;
  }
  if (!worldName && userRecord?.full_name) {
    worldName = userRecord.full_name;
    worldNameSource = 'user_full_name_fallback';
  }

  diagnostics.world_name_source = worldNameSource;
  diagnostics.user_ref_source = userRefSource;
  diagnostics.final_ref_count = visualReferenceImages.length;

  console.log(
    `[resolveUserIdentityForImageGen] RESOLVED | email=${ownerEmail}` +
    ` | final_refs=${visualReferenceImages.length}` +
    ` | user_ref_source=${userRefSource || 'none'}` +
    ` | world_name="${worldName || 'none'}" (source: ${worldNameSource || 'none'})` +
    ` | appearance_lock_fields=${Object.keys(appearanceLock).join(',') || 'none'}`
  );

  return {
    worldName: worldName || null,
    visualReferenceImages,
    referenceImageUrls: userRefUrls,
    generatedAvatarUrls: userGeneratedAvatarUrls,
    appearanceLock,
    currentOutfit,
    gender: gender || null,
    userRefSource: userRefSource || 'none',
    worldNameSource: worldNameSource || 'none',
    _diagnostics: diagnostics,
  };
}

function _buildEmpty(callerBundle, diagnostics) {
  return {
    worldName: callerBundle?.world_name || null,
    visualReferenceImages: callerBundle?.visual_reference_images ? cdnFilter(callerBundle.visual_reference_images) : [],
    referenceImageUrls: [],
    generatedAvatarUrls: [],
    appearanceLock: callerBundle?.appearance_lock || {},
    currentOutfit: callerBundle?.current_outfit || null,
    gender: callerBundle?.gender || null,
    userRefSource: callerBundle?.visual_reference_images?.length > 0 ? 'caller_bundle_fallback' : 'none',
    worldNameSource: callerBundle?.world_name ? 'caller_bundle' : 'none',
    _diagnostics: { ...diagnostics, caller_bundle_used: true },
  };
}

// ── HTTP HANDLER — diagnostic endpoint ────────────────────────────────────────
// Callable directly to audit user identity resolution for a given account.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { ownerEmail, includeCallerBundle } = await req.json().catch(() => ({}));
    const targetEmail = ownerEmail || user.email;

    const result = await resolveUserIdentityForImageGen(base44, targetEmail, null);

    return Response.json({
      success: true,
      owner_email: targetEmail,
      world_name: result.worldName,
      world_name_source: result.worldNameSource,
      visual_reference_image_count: result.visualReferenceImages.length,
      user_ref_source: result.userRefSource,
      appearance_lock_fields: Object.keys(result.appearanceLock),
      current_outfit_present: !!result.currentOutfit,
      gender: result.gender,
      diagnostics: result._diagnostics,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});