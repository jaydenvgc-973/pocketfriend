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

    // CRITICAL: Validate appearance_lock and outfit separation before sending
    // Only block if the character HAS an appearance_lock defined — warn otherwise
    if (character?.appearance_lock && Object.keys(character.appearance_lock).length > 0) {
      try {
        enforceValidation(character, imageGenPrompt);
      } catch (validationErr) {
        console.error(`[ChatImageDispatch] Prompt validation failed for ${character.name}:`, validationErr.message);
        // Hard block — do not send invalid prompt. Merge failure into existing generation_context.
        if (isMountedRef.current) {
          base44.entities.Message.filter({ id: targetMsgId }).then(msgs => {
            const existingCtx = msgs?.[0]?.generation_context || {};
            base44.entities.Message.update(targetMsgId, {
              content: '[IMAGE_FAILED]',
              generation_context: {
                ...existingCtx,
                prompt: existingCtx.prompt || imageGenPrompt || "",
                status: "failed",
                error_message: `Appearance lock validation failed: ${validationErr.message}`,
                failed_at: new Date().toISOString(),
              },
            }).catch(() => {});
          }).catch(() => {
            base44.entities.Message.update(targetMsgId, { content: '[IMAGE_FAILED]' }).catch(() => {});
          });
          setMessages(prev => prev.map(m => m.id === targetMsgId ? { ...m, content: '[IMAGE_FAILED]' } : m));
        }
        return;
      }
    } else {
      console.warn(`[ChatImageDispatch] Character ${character?.name} has no appearance_lock — skipping validation`);
    }

    // Convert all ref URLs to public CDN before sending — private/internal URLs are rejected by provider
    const publicCharRefs = (charRefs || []).map(toPublicCDN).filter(isProviderAccessible);
    const publicUserRefs = (userRefImages || []).map(toPublicCDN).filter(isProviderAccessible);

    const res = await base44.functions.invoke('generateImageAsync', {
      messageId: targetMsgId,
      prompt: imageGenPrompt,
      characterReferenceImages: publicCharRefs,
      userReferenceImages: useUserRefs ? publicUserRefs : [],
      characterName: character.name,
      userWorldName: userSettings.fictional_world_name || currentUser.full_name || null,
      subjectType,
      characterId,
      characterEmotionalState: character.emotional_state || 'calm',
      // NO manualLocationId — backend resolves from character file + LocationReference records
      liveLocationContext: buildLiveLocationContext(character, {}, true),
      homeResolutionFailed,
      mayAssignTemporaryHousing,
    });

    const returnedMsgId = res?.data?.messageId;
    if (returnedMsgId && returnedMsgId !== targetMsgId) {
      console.error(`[ChatImageDispatch] ⛔ LINEAGE MISMATCH: sent=${targetMsgId} got=${returnedMsgId}`);
    }

    // Hydrate local state immediately from response — do not rely solely on subscription
    const imageUrl = res?.data?.imageUrl;
    if (imageUrl && imageUrl.startsWith('http') && isMountedRef.current) {
      setMessages(prev => prev.map(m => m.id === targetMsgId ? { ...m, image_url: imageUrl } : m));
      base44.entities.Conversation.update(convoId, {
        last_message_preview: "(photo)",
        last_message_date: new Date().toISOString(),
      }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
    } else if (res?.data?.success === false && isMountedRef.current) {
      // Generation failed — backend already merged generation_context (generateImageAsync handles it).
      // Just update local state for the UI.
      console.error(`[ChatImageDispatch] Generation returned success=false for ${targetMsgId}: ${res?.data?.error}`);
      setMessages(prev => prev.map(m => m.id === targetMsgId ? { ...m, content: '[IMAGE_FAILED]' } : m));
    }
  } catch (err) {
    console.error(`[ChatImageDispatch] Image generation failed for ${targetMsgId}:`, err.message);
    // Merge failure into generation_context so prompt is preserved for Retry/Edit Prompt UI
    if (isMountedRef.current) {
      base44.entities.Message.filter({ id: targetMsgId }).then(msgs => {
        const existingCtx = msgs?.[0]?.generation_context || {};
        base44.entities.Message.update(targetMsgId, {
          content: '[IMAGE_FAILED]',
          generation_context: {
            ...existingCtx,
            prompt: existingCtx.prompt || imageGenPrompt || "",
            status: "failed",
            error_message: err.message,
            failed_at: new Date().toISOString(),
          },
        }).catch(() => {});
      }).catch(() => {
        base44.entities.Message.update(targetMsgId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      });
      setMessages(prev => prev.map(m => m.id === targetMsgId ? { ...m, content: '[IMAGE_FAILED]' } : m));
    }
  }
}