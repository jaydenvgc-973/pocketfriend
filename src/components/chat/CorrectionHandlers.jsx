import { base44 } from "@/api/base44Client";

export const createCorrectionHandlers = (setMessages, characterId, character, conversationId) => {
  // "This is nonsense" — logic failure correction flag
  const handleDeleteNonsense = async (msg) => {
    console.log(`[CORRECTION] messageId=${msg.id} | correctionType=nonsense | characterId=${characterId} | content="${msg.content?.substring(0, 100) || '(image)'}"`);

    // Remove from visible thread
    setMessages(prev => prev.filter(m => m.id !== msg.id));

    // Log correction flag to backend for learning
    base44.functions.invoke('logNarrativeCorrectionFlag', {
      messageId: msg.id,
      characterId,
      conversationId,
      correctionType: 'nonsense',
      narrativeContent: msg.content || '(image)',
      characterState: {
        emotional_state: character?.emotional_state,
        location: character?.resolved_current_location_name,
        activity: character?.current_activity,
      },
    }).catch(err => console.error('[CORRECTION] Failed to log nonsense flag:', err.message));
  };

  // "This violates sleep state" — state violation correction flag
  const handleDeleteSleepViolation = async (msg) => {
    console.log(`[CORRECTION] messageId=${msg.id} | correctionType=sleep_violation | characterId=${characterId} | content="${msg.content?.substring(0, 100) || '(image)'}"`);

    // Remove from visible thread
    setMessages(prev => prev.filter(m => m.id !== msg.id));

    // Log correction flag to backend for enforcement escalation
    base44.functions.invoke('logNarrativeCorrectionFlag', {
      messageId: msg.id,
      characterId,
      conversationId,
      correctionType: 'sleep_violation',
      narrativeContent: msg.content || '(image)',
      characterState: {
        sleep_start_time: character?.sleep_start_time,
        wake_up_time: character?.wake_up_time,
        trait_night_owl: character?.trait_night_owl,
        emotional_state: character?.emotional_state,
      },
    }).catch(err => console.error('[CORRECTION] Failed to log sleep violation flag:', err.message));
  };

  return { handleDeleteNonsense, handleDeleteSleepViolation };
};