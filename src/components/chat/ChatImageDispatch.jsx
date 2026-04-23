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
}) {
  try {
    const res = await base44.functions.invoke('generateImageAsync', {
      messageId: targetMsgId,
      prompt: imageGenPrompt,
      characterReferenceImages: charRefs,
      userReferenceImages: useUserRefs ? userRefImages : [],
      characterName: character.name,
      userWorldName: userSettings.fictional_world_name || currentUser.full_name || null,
      subjectType,
      characterId,
      characterEmotionalState: character.emotional_state || 'calm',
      // NO manualLocationId — backend resolves from character file + LocationReference records
      liveLocationContext: buildLiveLocationContext(character, {}, true),
    });

    const returnedMsgId = res?.data?.messageId;
    if (returnedMsgId && returnedMsgId !== targetMsgId) {
      console.error(`[ChatImageDispatch] ⛔ LINEAGE MISMATCH: sent=${targetMsgId} got=${returnedMsgId}`);
    }

    // Hydrate local state immediately from response — do not rely solely on subscription
    const imageUrl = res?.data?.imageUrl;
    if (imageUrl && imageUrl.startsWith('http') && isMountedRef.current) {
      setMessages(prev => prev.map(m => m.id === targetMsgId ? { ...m, image_url: imageUrl } : m));
    }

    base44.entities.Conversation.update(convoId, {
      last_message_preview: "(photo)",
      last_message_date: new Date().toISOString(),
    }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['conversations', characterId] });
  } catch (err) {
    console.error(`[ChatImageDispatch] Image generation failed for ${targetMsgId}:`, err.message);
  }
}