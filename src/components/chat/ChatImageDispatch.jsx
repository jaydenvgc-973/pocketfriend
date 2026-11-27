/**
 * ChatImageDispatch
 * 
 * Handles async image generation dispatch from the Chat page.
 * Extracted to allow Chat page to stay within line limits while
 * applying the critical fix: stop passing manualLocationId so that
 * generateImageAsync resolves location from character file + LocationReference records.
 */
import { base44 } from "@/api/base44Client";
import { buildCharacterInScene } from "@/lib/chatSceneCharacter";
import { getLocations } from "@/lib/locationSessionCache";
import { buildLiveLocationContext } from "@/lib/locationResolutionEngine";
import { enforceValidation } from "@/lib/appearanceLockValidator";
import { resolveHousingLocationForCharacter } from "@/lib/resolveHousingLocationForCharacter";
import { pregnancyPromptLine } from "@/lib/pregnancyState";

function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isProviderAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

/**
 * Dispatch image generation for a chat message.
 * 
 * CRITICAL: Do NOT pass manualLocationId here.
 * generateImageAsync must resolve location from:
 * 1. character.resolved_current_location_id (PRIMARY)
 * 2. character.current_home_location_id (SECONDARY)
 * 3. character.home_location_id (TERTIARY)
 * 4. LocationReference resident scan (FALLBACK)
 * 
 * Passing manualLocationId bypassed this logic and forced first-zone selection
 * regardless of what room the prompt described, causing provider conflicts (e.g.
 * prompt says "kitchen" but first zone was "living room" → 400 error from provider).
 */
export async function dispatchImageGeneration({
  targetMsgId,
  imageGenPrompt,
  charRefs,
  userRefImages,
  useUserRefs,
  character,
  userSettings,
  currentUser,
  subjectType,
  characterId,       // Primary SUBJECT character ID — may differ from character.id (the sender)
  characterName,     // Primary SUBJECT character name — may differ from character.name (the sender)
  isMountedRef,
  setMessages,
  convoId,
  queryClient,
  locationMap = {},
  additionalCharacterIds = [], // Co-subject character IDs resolved from prompt
  userIsVisualSubject = false, // true when user's world name detected in prompt — triggers user identity resolution even when subjectType isn't 'user'/'joint'
}) {
  try {
    // CRITICAL: Resolve housing FIRST — route flag downstream
    const housing = resolveHousingLocationForCharacter(character, locationMap);
    const homeResolutionFailed = housing.home_resolution_failed || false;
    const mayAssignTemporaryHousing = housing.may_assign_temporary_housing || false;

    // Appearance lock: warn only — backend generateImageAsync enforces via reference images
    if (character?.appearance_lock && Object.keys(character.appearance_lock).length > 0) {
      try {
        enforceValidation(character, imageGenPrompt);
      } catch (validationErr) {
        // Log but do NOT block — backend will enforce appearance via reference photos
        console.warn(`[ChatImageDispatch] Appearance lock warning for ${character.name} (continuing):`, validationErr.message);
      }
    }

    // Convert all ref URLs to public CDN before sending — private/internal URLs are rejected by provider
    //
    // IDENTITY RESOLUTION — subject-aware:
    // charRefs is the PRE-RESOLVED subject's current profile avatar, passed from Chat.jsx
    // after subject resolution (the subject may be the sender or a named third party).
    // Original avatar reference photos are never passed or sent.
    const callerRefs = (charRefs || []).filter(Boolean);

    const senderIsSubject = !characterId || characterId === character.id;

    // AVATAR AUTHORITY — the character's CURRENT PROFILE AVATAR is the only identity
    // reference sent for a character. Original avatar reference photos are never sent:
    // they exist to create the avatar, and the clothing they depict is not the
    // character's clothing. Caller-supplied subject refs are only honoured when they
    // are that same current avatar.
    const avatarPublic = (senderIsSubject && (character.avatar_url || character.image_avatar_url))
      ? toPublicCDN(character.avatar_url || character.image_avatar_url)
      : null;
    const avatarIsCanonicalCDN = avatarPublic &&
      avatarPublic.startsWith('https://media.base44.com/') &&
      isProviderAccessible(avatarPublic);

    const rawCharRefs = callerRefs.length > 0
      ? callerRefs
      : (avatarIsCanonicalCDN ? [avatarPublic] : []);

    const publicCharRefs = rawCharRefs.map(toPublicCDN).filter(isProviderAccessible);
    const publicUserRefs = (userRefImages || []).map(toPublicCDN).filter(isProviderAccessible);

    // ── PERSISTENT APPEARANCE STATE ────────────────────────────────────────────
    // Pregnancy is carried on the character's own record, not restated per prompt,
    // so it is appended to every generated image until birth is recorded.
    const _pregnancyState = senderIsSubject ? pregnancyPromptLine(character) : '';
    const _promptWithState = _pregnancyState
      ? `${imageGenPrompt}\n\n${_pregnancyState}`
      : imageGenPrompt;

    // ── AUTHORITATIVE LOCATION SNAPSHOT ────────────────────────────────────────
    // The same shared resolver the homepage card, the Chat geotag and Right Now use.
    // The stored resolved_* fields can lag the schedule or a user-typed off-screen
    // destination, so the live answer travels with the request instead of letting the
    // image fall back to the saved residence. Only for the sender as subject.
    let authoritativeState;
    if (senderIsSubject) {
      const locations = await getLocations(async () => {
        const r = await base44.functions.invoke('fetchAllLocationsForUser', {});
        return r?.data?.locations || [];
      }).catch(() => []);
      const locMap = (locations || []).length
        ? Object.fromEntries(locations.map(l => [l.id, l]))
        : (locationMap || {});
      const scene = buildCharacterInScene(character, locMap) || {};
      authoritativeState = {
        location_id: scene.resolved_current_location_id ?? null,
        location_name: scene.resolved_current_location_name ?? null,
        location_type: scene.resolved_location_type ?? null,
        presence_status: scene.resolved_presence_status ?? null,
        source: 'buildCharacterInScene',
      };
    }

    const res = await base44.functions.invoke('generateImageAsync', {
      authoritativeState,
      messageId: targetMsgId,
      prompt: _promptWithState,
      characterReferenceImages: publicCharRefs,
      userReferenceImages: useUserRefs ? publicUserRefs : [],
      // characterName: use the SUBJECT's name when different from sender
      characterName: characterName || character.name,
      userWorldName: userSettings.fictional_world_name || currentUser.full_name || null,
      subjectType,
      // senderCharacterId is ALWAYS the character who sent the message — separate from the subject
      senderCharacterId: character.id,
      // characterId is the SUBJECT character — may differ from sender for third-party photos
      characterId,
      characterEmotionalState: character.emotional_state || 'calm',
      // NO manualLocationId — backend resolves from character file + LocationReference records
      liveLocationContext: buildLiveLocationContext(character, {}, true),
      homeResolutionFailed,
      mayAssignTemporaryHousing,
      // Pass ownerEmail for service-role callers (scheduled/autonomous) to authenticate and scope correctly
      ownerEmail: currentUser.email,
      // Additional secondary character IDs resolved from prompt name scan (multi-subject images)
      additionalCharacterIds: additionalCharacterIds.length > 0 ? additionalCharacterIds : undefined,
      // USER-PARTICIPANT FLAG: when true, generateImageAsync resolves user identity even if subjectType
      // isn't 'user'/'joint'. Sourced from resolveImageSubjects() detecting the user's world name in the prompt.
      // CRITICAL: backend must read from User entity + UserSettings — never from rel.photo_url or rel.avatar_url.
      userIsVisualSubject: userIsVisualSubject || false,
    });

    const returnedMsgId = res?.data?.messageId;
    if (returnedMsgId && returnedMsgId !== targetMsgId) {
      console.error(`[ChatImageDispatch] ⛔ LINEAGE MISMATCH: sent=${targetMsgId} got=${returnedMsgId}`);
    }

    // Hydrate local state immediately from response — do not rely solely on subscription
    // Normalize URL to public CDN to prevent browser load failures on internal URLs
    const rawImageUrl = res?.data?.imageUrl;
    const imageUrl = rawImageUrl ? toPublicCDN(rawImageUrl) : null;
    if (imageUrl && imageUrl.startsWith('http') && isMountedRef.current) {
      setMessages(prev => prev.map(m => m.id === targetMsgId ? { ...m, image_url: imageUrl } : m));
      // Use ISO string for platform metadata only — this is a DB timestamp field, not app reasoning
      base44.entities.Conversation.update(convoId, {
        last_message_preview: "(photo)",
        last_message_date: new Date().toISOString(),
      }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
    } else if (res?.data?.success === false && isMountedRef.current) {
      // Generation failed — classify the failure reason returned by generateImageAsync
      // so the frontend can surface the correct "Why Regenerate" option automatically.
      // reason values from generateImageAsync: 'content_policy' | 'provider_error' | 'no_image_url'
      const failureReason = res?.data?.reason || 'provider_error';
      const failureError = res?.data?.error || 'Image generation failed.';
      const isContentPolicy = res?.data?.filtered || failureReason === 'content_policy';
      console.error(`[ChatImageDispatch] Generation returned success=false for ${targetMsgId}: reason=${failureReason} | ${failureError}`);
      // Mark with the classified failure so MessageBubble can route to the correct regen option
      base44.entities.Message.update(targetMsgId, {
        content: '[IMAGE_FAILED]',
        generation_context: {
          ...(res?.data?.generation_context || {}),
          failure_reason: failureReason,
          failure_error: failureError,
          is_content_policy_block: isContentPolicy,
        },
      }).catch(() => {});
      setMessages(prev => prev.map(m => m.id === targetMsgId
        ? { ...m, content: '[IMAGE_FAILED]', generation_context: { ...(m.generation_context || {}), failure_reason: failureReason, is_content_policy_block: isContentPolicy } }
        : m
      ));
    }
  } catch (err) {
    console.error(`[ChatImageDispatch] Image generation failed for ${targetMsgId}:`, err.message);
    // Mark as failed so user sees retry UI rather than a permanently spinning placeholder
    if (isMountedRef.current) {
      base44.entities.Message.update(targetMsgId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      setMessages(prev => prev.map(m => m.id === targetMsgId ? { ...m, content: '[IMAGE_FAILED]' } : m));
    }
  }
}