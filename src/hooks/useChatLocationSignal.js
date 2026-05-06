import { base44 } from "@/api/base44Client";

export function useChatLocationSignal({
  characterId,
  character,
  queryClient,
  setPendingAliasResolution,
}) {
  const handleLocationSignal = async (locationIdOrContent, charId) => {
    if (!charId && !characterId) return;
    const targetCharId = charId || characterId;

    try {
      if (locationIdOrContent?.length > 20 && locationIdOrContent.includes('-')) {
        const res = await base44.functions.invoke('updateCharacterLocation', {
          characterId: targetCharId,
          locationId: locationIdOrContent,
          presenceStatus: 'visiting',
          locationType: 'visit',
          sourceReason: 'chat_signal',
        });
        if (res?.data?.success) {
          queryClient.invalidateQueries({ queryKey: ["character", targetCharId] });
          queryClient.invalidateQueries({ queryKey: ["characters"] });
        }
        return;
      }

      const res = await base44.functions.invoke('updateCharacterLocationFromMessage', {
        characterId: targetCharId,
        messageContent: locationIdOrContent,
      });
      if (res?.data?.updated || res?.data?.unresolved) {
        queryClient.invalidateQueries({ queryKey: ["character", targetCharId] });
        queryClient.invalidateQueries({ queryKey: ["characters"] });
        queryClient.invalidateQueries({ queryKey: ["locationReferences"] });
      }
      if (res?.data?.unresolved && res.data.phrase) {
        setPendingAliasResolution({
          phrase: res.data.phrase,
          sourceSentence: res.data.source_sentence || null,
          characterId: targetCharId,
          characterName: character?.name,
        });
      }
    } catch (err) {
      const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit');
      if (is429) {
        console.warn('[LocationSignal] 429 — rate limit hit');
        window.__chatRateLimited = true;
        setTimeout(() => { window.__chatRateLimited = false; }, 60000);
      } else {
        console.warn('[LocationSignal] handleLocationSignal failed:', err?.message);
      }
    }
  };

  return { handleLocationSignal };
}