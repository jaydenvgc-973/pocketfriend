import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * validatePresenceForAction
 *
 * Checks if a character's intended action is allowed given their current presence state.
 *
 * Input:
 *  - characterId: character ID
 *  - actionType: 'physical_to_user' | 'physical_with_user' | 'remote' (default allowed)
 *  - actionDescription: text describing the intended action
 *  - conversationId: current conversation ID
 *
 * Returns:
 *  - allowed: boolean
 *  - reason: string (why allowed/denied)
 *  - requiredPresence: string (what presence state is needed)
 *  - currentPresence: string (actual presence state)
 *  - suggestion: string (how to fix if denied)
 */

const PHYSICAL_ACTION_KEYWORDS = [
  'touch', 'grab', 'hold', 'hug', 'kiss', 'grab your', 'take your hand', 'puts arm',
  'wraps', 'pulls', 'pushes', 'leans', 'sits next to', 'sits on', 'stands over',
  'reaches for', 'takes your', 'gives you a', 'hand you', 'pass you',
];

const SHARED_ACTION_KEYWORDS = [
  'we ', 'together', 'both ', 'each other', 'you and I', 'we sit', 'we walk', 'we talk',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, actionType = 'remote', actionDescription, conversationId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Fetch presence state
    const existing = await base44.asServiceRole.entities.PresenceState.filter({ character_id: characterId });
    const presenceState = existing[0] || { state: 'remote', character_id: characterId };

    let allowed = true;
    let requiredPresence = 'any';
    let reason = '';
    let suggestion = '';

    // Determine action type from description if not explicitly provided
    let detectedActionType = actionType;
    if (actionDescription) {
      const descLower = actionDescription.toLowerCase();
      const isPhysical = PHYSICAL_ACTION_KEYWORDS.some(k => descLower.includes(k));
      const isShared = SHARED_ACTION_KEYWORDS.some(k => descLower.includes(k));
      
      if (isPhysical || isShared) {
        detectedActionType = 'physical_with_user';
      }
    }

    // VALIDATION RULES
    if (detectedActionType === 'physical_to_user' || detectedActionType === 'physical_with_user') {
      requiredPresence = 'same_space';
      
      if (presenceState.state !== 'same_space') {
        allowed = false;
        reason = `Cannot perform physical action. Character is in "${presenceState.state}" state, not "same_space".`;
        suggestion = `First establish that you've arrived and are together. Use narrative like "I walk up to you" or "I sit down across from you" to confirm presence.`;
      } else {
        reason = 'Physical action allowed — confirmed in same space.';
      }
    } else {
      // Remote actions (texting, calling, thinking about user) always allowed
      requiredPresence = 'any';
      reason = 'Remote action allowed in any presence state.';
    }

    return Response.json({
      allowed,
      reason,
      requiredPresence,
      currentPresence: presenceState.state,
      actionType: detectedActionType,
      suggestion: !allowed ? suggestion : '',
      presenceConfirmedAt: presenceState.narrative_confirmed_at || null,
    });
  } catch (error) {
    console.error('[validatePresenceForAction]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});