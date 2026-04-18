import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to automatically extract and persist memories for the character being played as
 */
export function usePlayAsMemory(activeCharacter, character, conversationId, responseText, userText) {
  useEffect(() => {
    if (!activeCharacter || !character || !conversationId || !responseText) return;

    const extractMemory = async () => {
      try {
        await base44.functions.invoke("extractMemoriesFromTurn", {
          characterId: activeCharacter.id,
          conversationId: convoId,
          userMessage: userText || "(played as action)",
          characterReply: responseText,
          context: `As ${activeCharacter.name}, I was talking with ${character.name}. I said/did something that led to them saying: "${responseText.substring(0, 100)}"`,
        });
      } catch (err) {
        console.error('[usePlayAsMemory] Failed to extract memory:', err.message);
      }
    };

    extractMemory();
  }, [activeCharacter?.id, character?.id, conversationId, responseText, userText]);
}