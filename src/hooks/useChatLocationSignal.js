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
    } catch { /* silent */ }
  };

  return { handleLocationSignal };
}