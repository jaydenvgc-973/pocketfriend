/**
 * CHAT RECONCILIATION HANDLER
 * 
 * Centralized time continuity + action resolution for chat responses.
 * Called BEFORE LLM generation in sendMessage.
 */

import { enforceTimeReconciliation } from './actionExpirationEngine.js';

/**
 * Reconcile character state before generating a response.
 * Returns updated character object with resolved actions + needs.
 */
export async function reconcileCharacterBeforeResponse(character, messages, base44) {
  if (!character) return character;

  // Find last character message for timestamp
  const lastCharMsg = [...messages].reverse().find(m => m.sender_type === 'character');
  const lastActionTime = lastCharMsg?.timestamp || lastCharMsg?.created_date;

  if (!lastActionTime) {
    console.log('[reconciliation] No prior message timestamp — skipping reconciliation');
    return character;
  }

  // Check for expired actions
  const reconciliation = enforceTimeReconciliation(character, lastActionTime);

  if (!reconciliation.expired || Object.keys(reconciliation.updates).length === 0) {
    console.log(`[reconciliation] No expired actions — elapsed: ${reconciliation.elapsedLabel}`);
    return character;
  }

  // Action expired — apply updates
  console.log(`[reconciliation] ✓ RESOLVED EXPIRED ACTION | Updates:`, reconciliation.updates);

  const updated = { ...character, ...reconciliation.updates };

  // Persist to database
  try {
    await base44.entities.Character.update(character.id, reconciliation.updates);
    console.log(`[reconciliation] Persisted need updates to character ${character.id}`);
  } catch (err) {
    console.error('[reconciliation] Failed to persist:', err.message);
    // Continue anyway — local state updated
  }

  return updated;
}