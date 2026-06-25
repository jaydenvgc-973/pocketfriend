/**
 * resolveAuthenticatedUser.js
 *
 * UNIFIED USER IDENTITY RESOLVER
 *
 * PURPOSE:
 * One function that any system calls to get the authenticated user as a
 * consistent identity package. Reads from the two authoritative sources
 * (User entity + UserSettings entity) and returns a single normalized bundle.
 *
 * This is NOT a new profile. It is a thin resolver layer that assembles the
 * user's existing scattered fields into one coherent object so callers do not
 * each have to invent their own lookup logic.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * FIELD AUTHORITY MAP (documented here, not moved)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * IDENTITY / PROFILE
 *   full_name             → User entity (built-in, read-only)
 *   email                 → User entity (built-in, read-only)
 *   world_name            → User entity (world_name field) — primary
 *                           UserSettings (fictional_world_name) — legacy mirror
 *   display_name          → User entity (display_name)
 *   gender                → User entity (gender)
 *   role                  → User entity (role: 'admin' | 'user')
 *
 * VISUAL IDENTITY
 *   reference_image_urls  → User entity (primary face reference photos)
 *   generated_avatar_urls → User entity (AI-generated avatars)
 *   appearance_lock       → UserSettings (appearance_lock object)
 *   user_closet           → UserSettings (user_closet array)
 *   user_current_outfit   → UserSettings (user_current_outfit object)
 *   user_gender           → UserSettings (legacy field, overridden by User.gender)
 *   user_birthday         → UserSettings
 *   user_aliases          → UserSettings
 *
 * FINANCIAL
 *   account_balance       → User entity (account_balance) — primary
 *   user_balance          → UserSettings (user_balance) — legacy mirror
 *   vgc_mobile_revenue    → User entity and UserSettings (both track this)
 *
 * LOCATION / PRESENCE
 *   user_current_location_id    → UserSettings
 *   user_current_location_name  → UserSettings
 *   user_presence_status        → UserSettings
 *   home (living space)         → LocationReference records (user's owned locations)
 *
 * RELATIONSHIPS
 *   user_relatives              → UserSettings (map of characterId → relationship label)
 *   home_key_holders            → UserSettings
 *
 * SYSTEM FLAGS
 *   has_completed_onboarding    → UserSettings
 *   default_character_id        → UserSettings
 *   home_anchor_character_ids   → UserSettings
 *   autonomous_travel_enabled   → UserSettings
 *   response_length             → UserSettings
 *   emotional_intensity         → UserSettings
 *   voice_enabled               → UserSettings
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * STALE COPY RISKS (existing issues documented, not introduced here)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 1. UserSettings.fictional_world_name mirrors User.world_name — callers must
 *    prefer User.world_name when both are present.
 *
 * 2. UserSettings.user_balance mirrors User.account_balance — callers must
 *    prefer User.account_balance as the financial source of truth.
 *
 * 3. Character records with is_user=true were created early on some accounts
 *    as "world-self" characters. These are NOT authoritative and may be stale.
 *    resolveUserVisualRefs in mediaGridIdentityLock.js falls back to them.
 *    This resolver does NOT create or read those records.
 *
 * 4. generateImageAsync's buildUserAppearanceLockFallback reads
 *    UserSettings.appearance_lock and UserSettings.fictional_world_name directly.
 *    It matches the resolver output — no conflict.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS RESOLVER DOES NOT DO
 * ══════════════════════════════════════════════════════════════════════════════
 * - Does NOT create any new entity record
 * - Does NOT write any data
 * - Does NOT give the user autonomy, sleep, hunger, needs, or lifecycle behavior
 * - Does NOT copy avatar/name into a second record
 * - Does NOT replace the User or UserSettings entity as authoritative sources
 * - Does NOT add financial, housing, or ownership logic — it exposes references only
 */

/**
 * resolveAuthenticatedUser
 *
 * Assembles the authenticated user identity package from User entity + UserSettings.
 *
 * @param {object} user         - Result of base44.auth.me() or ['user'] React Query cache
 * @param {object} userSettings - UserSettings record (from useUserSettings hook or DB fetch)
 * @returns {object} Normalized user identity package
 *
 * All fields are read-through references to the authoritative source — nothing is copied
 * into a new record. Callers should not persist this object; call again for fresh data.
 */
export function resolveAuthenticatedUser(user, userSettings) {
  if (!user) return null;

  const sett = userSettings || {};

  // ── IDENTITY ──────────────────────────────────────────────────────────────
  // User entity is authoritative. UserSettings fields are legacy mirrors.
  const worldName = user.world_name || sett.fictional_world_name || user.full_name || null;
  const displayName = user.display_name || worldName || user.full_name || null;
  const gender = user.gender || sett.user_gender || null;

  // ── VISUAL IDENTITY ───────────────────────────────────────────────────────
  // Reference images come from User entity. Appearance lock comes from UserSettings.
  // Priority: uploaded reference photos > generated avatars (strongest → weakest identity lock).
  const referenceImageUrls = (user.reference_image_urls || []).filter(Boolean);
  const generatedAvatarUrls = (user.generated_avatar_urls || []).filter(Boolean);

  // Ordered image refs for visual generation — highest identity fidelity first
  const visualReferenceImages = [
    ...referenceImageUrls.slice(0, 3),
    ...generatedAvatarUrls.slice(0, 2),
  ].filter(Boolean);

  const appearanceLock = sett.appearance_lock || {};

  // ── OUTFIT ────────────────────────────────────────────────────────────────
  const currentOutfit = sett.user_current_outfit || null;
  const closet = sett.user_closet || [];

  // ── FINANCIAL (reference only — do not use for writes) ───────────────────
  // User entity is authoritative. UserSettings.user_balance is a legacy mirror.
  const accountBalance = typeof user.account_balance === 'number'
    ? user.account_balance
    : (typeof sett.user_balance === 'number' ? sett.user_balance : 0);

  // ── LOCATION / PRESENCE ───────────────────────────────────────────────────
  const presenceStatus = sett.user_presence_status || 'away';
  const currentLocationId = sett.user_current_location_id || null;
  const currentLocationName = sett.user_current_location_name || null;

  // ── SYSTEM FLAGS ──────────────────────────────────────────────────────────
  const defaultCharacterId = sett.default_character_id || null;
  const homeAnchorCharacterIds = sett.home_anchor_character_ids || [];

  // ── RELATIONSHIP REFERENCES ───────────────────────────────────────────────
  const relatives = sett.user_relatives || {};
  const homeKeyHolders = sett.home_key_holders || [];
  const aliases = sett.user_aliases || [];

  return {
    // ── Core identity (from User entity) ────────────────────────────────────
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    world_name: worldName,
    display_name: displayName,
    gender,
    role: user.role || 'user',
    user_birthday: sett.user_birthday || null,

    // ── Visual identity ──────────────────────────────────────────────────────
    // These are the ONLY images callers should use for visual generation.
    // Do not read reference_image_urls or generated_avatar_urls separately.
    visual_reference_images: visualReferenceImages,   // ordered list, highest fidelity first
    reference_image_urls: referenceImageUrls,          // raw User entity field
    generated_avatar_urls: generatedAvatarUrls,        // raw User entity field
    appearance_lock: appearanceLock,                   // from UserSettings
    current_outfit: currentOutfit,                     // from UserSettings
    closet,                                            // from UserSettings

    // ── Presence / location ──────────────────────────────────────────────────
    presence_status: presenceStatus,
    current_location_id: currentLocationId,
    current_location_name: currentLocationName,

    // ── Financial (read reference only) ──────────────────────────────────────
    account_balance: accountBalance,

    // ── Relationships ────────────────────────────────────────────────────────
    relatives,
    home_key_holders: homeKeyHolders,
    aliases,

    // ── System ───────────────────────────────────────────────────────────────
    default_character_id: defaultCharacterId,
    home_anchor_character_ids: homeAnchorCharacterIds,
    has_completed_onboarding: sett.has_completed_onboarding || false,
    autonomous_travel_enabled: sett.autonomous_travel_enabled !== false,

    // ── Raw source references (for callers that need to pass to other systems) ──
    // These are the original records — callers must NOT write to these directly.
    _source_user: user,
    _source_settings: sett,
  };
}

/**
 * buildUserVisualBundle
 *
 * Returns the minimal visual identity bundle needed by image generation systems.
 * This is what generateImageAsync, mediaGridGenerate, and regenerateImageWithReason
 * should use when resolving the user as a visual subject.
 *
 * Reads from resolvedUser (output of resolveAuthenticatedUser) — no extra API calls.
 *
 * @param {object} resolvedUser - Output of resolveAuthenticatedUser()
 * @returns {object} Visual bundle ready for image generation pipelines
 */
export function buildUserVisualBundle(resolvedUser) {
  if (!resolvedUser) return null;

  const lock = resolvedUser.appearance_lock || {};
  const outfit = resolvedUser.current_outfit;

  // Build appearance text for prompt injection (text fallback when no image refs)
  const appearanceParts = [
    lock.skin_tone ? `${lock.skin_tone} skin tone` : null,
    lock.hair_type ? `${lock.hair_type} hair` : null,
    lock.hairstyle ? `${lock.hairstyle} hairstyle` : null,
    lock.facial_hair || null,
    lock.overall_aesthetic || lock.body_type || null,
    resolvedUser.gender || null,
    (lock.custom_keywords || []).length > 0 ? lock.custom_keywords.join(', ') : null,
  ].filter(Boolean);

  // Build outfit text for prompt injection
  let outfitText = null;
  if (outfit) {
    const outfitParts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
      .map(v => {
        if (!v) return null;
        const t = v.trim();
        if (/^(n\/?a|none|-)$/i.test(t)) return null;
        return t || null;
      })
      .filter(Boolean);
    outfitText = outfitParts.length > 0
      ? outfitParts.join(', ')
      : (outfit.full_description?.trim() || null);
  }

  return {
    // Who this is
    user_id: resolvedUser.id,
    user_email: resolvedUser.email,
    world_name: resolvedUser.world_name,

    // Visual reference images (ordered, highest fidelity first)
    reference_images: resolvedUser.visual_reference_images,

    // Text-based identity for prompt injection
    appearance_text: appearanceParts.length > 0 ? appearanceParts.join(', ') : null,
    outfit_text: outfitText,

    // Raw appearance lock for systems that need individual fields
    appearance_lock: resolvedUser.appearance_lock,
  };
}