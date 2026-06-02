/**
 * ChatImageDispatch
 * 
 * Handles async image generation dispatch from the Chat page.
 * Extracted to allow Chat page to stay within line limits while
 * applying the critical fix: stop passing manualLocationId so that
 * generateImageAsync resolves location from character file + LocationReference records.
 */
import { base44 } from "@/api/base44Client";
import { buildLiveLocationContext } from "@/lib/locationResolutionEngine";
import { enforceValidation } from "@/lib/appearanceLockValidator";
import { resolveHousingLocationForCharacter } from "@/lib/resolveHousingLocationForCharacter";

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
  characterId,
  isMountedRef,
  setMessages,
  convoId,
  queryClient,
  locationMap = {},
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
    // IDENTITY RESOLUTION — matches the regenerate path authority order exactly:
    // 1. character.reference_image_urls (from the character object the frontend already loaded)
    // 2. charRefs passed from the caller (may be the same, or pre-resolved)
    // 3. character.avatar_url as last-resort identity anchor — ONLY if CDN-hosted (media.base44.com)
    //    CDN-hosted avatars ARE the character's canonical face portrait and are safe to use.
    //    Non-CDN avatars (generated_image, internal API URLs) are excluded to prevent scene contamination.
    //
    // NOTE: generateImageAsync does its own DB fetch and will use reference_image_urls from the
    // fresh charRecord. These publicCharRefs are passed as characterReferenceImages which serve as
    // a fallback when the DB fetch returns no refs — ensuring the frontend's already-loaded data
    // is available to the pipeline even if the DB query misses.
    const characterDbRefs = (character.reference_image_urls || []).filter(Boolean);
    const callerRefs = (charRefs || []).filter(Boolean);
    // Prefer DB refs from the character object; fall back to caller-passed refs
    const candidateRefs = characterDbRefs.length > 0 ? characterDbRefs : callerRefs;

    // Avatar fallback: only use CDN-hosted avatars (media.base44.com) — these are canonical portraits.
    // Never use generated_image URLs or internal base44.app API URLs as identity references.
    const avatarPublic = character.avatar_url ? toPublicCDN(character.avatar_url) : null;
    const avatarIsCanonicalCDN = avatarPublic &&
      avatarPublic.startsWith('https://media.base44.com/') &&
      isProviderAccessible(avatarPublic);

    const rawCharRefs = candidateRefs.length > 0
      ? candidateRefs
      : (avatarIsCanonicalCDN ? [avatarPublic] : []);

    const publicCharRefs = rawCharRefs.map(toPublicCDN).filter(isProviderAccessible);
    const publicUserRefs = (userRefImages || []).map(toPublicCDN).filter(isProviderAccessible);

    const res = await base44.functions.invoke('generateImageAsync', {
      messageId: targetMsgId,
      prompt: imageGenPrompt,
      characterReferenceImages: publicCharRefs,
      userReferenceImages: useUserRefs ? publicUserRefs : [],
      characterName: character.name,
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