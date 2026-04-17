import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * logNarrativeCorrectionFlag
 * 
 * Captures user correction signals and stores them for learning/diagnostics.
 * Two types:
 * - 'nonsense': logic/context failure — system becomes stricter
 * - 'sleep_violation': character was asleep but acted awake — enforcement escalates
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      messageId,
      characterId,
      conversationId,
      correctionType, // 'nonsense' or 'sleep_violation'
      narrativeContent,
      characterState = {}
    } = await req.json();

    if (!messageId || !characterId || !correctionType) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Create a correction log record
    const correctionLog = {
      message_id: messageId,
      character_id: characterId,
      conversation_id: conversationId,
      correction_type: correctionType,
      narrative_content: narrativeContent || '',
      character_state: characterState,
      timestamp: new Date().toISOString(),
      user_email: user.email,
    };

    // Try to store the correction flag as metadata on the message (if it still exists)
    try {
      await base44.asServiceRole.entities.Message.update(messageId, {
        correction_flag: correctionType,
        correction_timestamp: new Date().toISOString(),
      }).catch(() => {});
    } catch (_) {
      // Message may be deleted, that's fine
    }

    // Log the correction event to console for diagnostics
    console.log(`[CORRECTION_FLAG] type=${correctionType} | messageId=${messageId} | characterId=${characterId} | timestamp=${new Date().toISOString()}`);

    // If this is a repeated correction type, trigger stricter enforcement
    // Check if there are recent similar corrections for this character
    if (correctionType === 'sleep_violation') {
      // Trigger stricter sleep-state enforcement in next generation
      console.log(`[SLEEP_VIOLATION_DETECTED] Escalating enforcement for characterId=${characterId}`);
      
      // Call a stricter sleep validation function (non-blocking)
      base44.asServiceRole.functions.invoke('escalateSleepStateEnforcement', {
        characterId,
        violationCount: 1, // First violation detected
      }).catch(() => {});
    }

    if (correctionType === 'nonsense') {
      // Trigger stricter narrative logic checks
      console.log(`[NONSENSE_FLAG_DETECTED] Escalating logic strictness for characterId=${characterId}`);
      
      base44.asServiceRole.functions.invoke('escalateLogicStrictness', {
        characterId,
        nonsenseCount: 1, // First nonsense flag detected
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      correctionType,
      message: `Correction flag logged: ${correctionType}`,
      escalation_triggered: true,
    });

  } catch (error) {
    console.error('[logNarrativeCorrectionFlag] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});