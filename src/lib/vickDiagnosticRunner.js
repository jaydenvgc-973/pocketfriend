/**
 * vickDiagnosticRunner.js
 *
 * Handles the full Vick Servicio diagnostic routing path from Chat.jsx.
 * Contains all step-by-step instrumentation for page-level proof:
 *
 * Step 1: Identity check — is this character Vick?
 * Step 2: Intent detection — does the user message request a diagnostic?
 * Step 3: Invoke vickRunDiagnostic (real backend call, user-scoped)
 * Step 4: Log raw result (verdict, errorCount, warningCount, functionsExecuted)
 * Step 5: Confirm diagnostic block injection into prompt
 */

import { hasVickDiagnosticIntent, isVickServicioCharacter } from '@/lib/vickDiagnosticIntentCheck';
import { base44 } from '@/api/base44Client';

/**
 * Runs the Vick diagnostic check and returns the diagnostic results object
 * if intent matched and the call succeeded. Returns null otherwise.
 *
 * All steps are logged with [VICK_DIAG_STEP*] prefix so runtime logs
 * provide clear per-step proof that each stage executed.
 *
 * @param {object} character - The current character object
 * @param {string} characterId - The characterId
 * @param {string} text - The user's message text
 * @returns {object|null} - vickDiagnosticResults or null
 */
export async function runVickDiagnosticIfNeeded(character, characterId, text) {
  const _isVick = isVickServicioCharacter(character);
  const _intentMatched = hasVickDiagnosticIntent(text);

  // Step 1 — Identity
  console.log(
    `[VICK_DIAG_STEP1_IDENTITY]` +
    ` char_id=${characterId}` +
    ` char_name="${character.name}"` +
    ` character_type="${character.character_type || 'MISSING'}"` +
    ` is_world_service=${!!character.is_world_service}` +
    ` isVickServicio=${_isVick}`
  );

  // Step 2 — Intent
  console.log(
    `[VICK_DIAG_STEP2_INTENT]` +
    ` user_text="${text}"` +
    ` intent_matched=${_intentMatched}`
  );

  if (!_isVick) {
    console.log(`[VICK_DIAG_SKIP] Not a Vick character — skipping diagnostic routing.`);
    return null;
  }

  if (!_intentMatched) {
    console.log(`[VICK_DIAG_SKIP] Vick character confirmed but intent not matched in: "${text}"`);
    return null;
  }

  // Step 3 — Invoke
  console.log(`[VICK_DIAG_STEP3_INVOKE] Both conditions met. Calling vickRunDiagnostic now...`);
  let _rawResult = null;
  try {
    _rawResult = await base44.functions.invoke('vickRunDiagnostic', { diagnosticType: 'account_overview' });
  } catch (err) {
    console.error(`[VICK_DIAG_STEP3_INVOKE_FAILED] vickRunDiagnostic threw: ${err?.message}`);
    return null;
  }

  const _dr = _rawResult?.data;

  // Step 4 — Result
  console.log(
    `[VICK_DIAG_STEP4_RESULT]` +
    ` success=${_dr?.success}` +
    ` verdict="${_dr?.verdict}"` +
    ` errorCount=${_dr?.errorCount}` +
    ` warningCount=${_dr?.warningCount}` +
    ` hasSummary=${!!_dr?.plainSummary}` +
    ` functionsExecuted=${JSON.stringify(_dr?.functionsExecuted || [])}`
  );

  if (!_dr?.success) {
    console.error(`[VICK_DIAG_STEP4_FAILED] vickRunDiagnostic returned success=false or null. Full data:`, _dr);
    return null;
  }

  // Step 5 — Injection confirmed
  console.log(`[VICK_DIAG_STEP5_INJECTED] Diagnostic results obtained. Block WILL be injected into Vick's LLM prompt.`);
  return _dr;
}