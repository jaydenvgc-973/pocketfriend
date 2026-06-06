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
 * Returns a hardcoded Vick Servicio system prompt with diagnostic results injected.
 * Used when the Vick fast-path skips all optional context fetches.
 */
export function buildVickFastPathPrompt(diagnosticResults) {
  const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'America/New_York' });
  const diagBlock = diagnosticResults
    ? `\n\n════════════════════════════════════\nLIVE DIAGNOSTIC RESULTS — REAL DATA (ran ${now} Eastern)\n════════════════════════════════════\n${diagnosticResults.plainSummary}\n\nFunctions executed: ${(diagnosticResults.functionsExecuted || []).join(', ') || 'none'}\nVerdict: ${diagnosticResults.verdict || 'unknown'}\nErrors found: ${diagnosticResults.errorCount ?? 'unknown'}\nWarnings found: ${diagnosticResults.warningCount ?? 'unknown'}\n\nYou MUST report these exact findings. Do NOT invent anything beyond what is listed above. Do NOT claim you ran checks that are not listed.\n════════════════════════════════════`
    : '\n\nThe diagnostic failed to return results. Tell the user plainly: "I ran the diagnostic but it returned no data. There may be a backend issue. Try again in a moment."';

  return `You are Vick Servicio. You are not a regular character. You are the app's dedicated account services representative and diagnostic specialist. Your job is to investigate, report, and explain what is happening in the user's account.

You have system access. You run real diagnostics. You report real findings. You do not roleplay as a person who lacks system access. You do not say you are unable to check things. You do not make up findings.

You just ran a diagnostic. Here are the results:
${diagBlock}

RESPONSE RULES:
- Report the exact findings from above. Quote specific numbers (error count, warning count, verdict).
- Explain what the findings mean in plain language.
- If errors were found, describe them and what they affect.
- If the account is healthy, confirm it clearly.
- Keep it direct and useful. You are a specialist, not a friend.
- Do NOT start with your name. Do NOT use markdown headers. Just talk.

Respond ONLY with valid JSON: {"message_type":"text_only","text_content":"your response here"}`;
}

/**
 * Returns true if this message should use the Vick fast path (skip ALL optional context).
 * Called BEFORE any other fetch in sendMessage so rate limit budget is preserved.
 */
export function shouldUseVickFastPath(character, text) {
  return isVickServicioCharacter(character) && hasVickDiagnosticIntent(text);
}

/**
 * Full Vick diagnostic fast-path execution.
 * Runs the diagnostic, builds the prompt, calls the LLM, saves the message.
 * Returns { handled: true, responseText } on success, { handled: false } on any failure.
 *
 * This function owns the ENTIRE execution so Chat.jsx adds zero extra lines.
 */
export async function executeVickDiagnosticFastPath({
  character, characterId, text, convoId, userMsg,
  callLLMWithRetry, parseCharacterResponse, filterDashes, stripCharacterNamePrefix,
  base44, setMessages, setIsTyping, releaseFgTask, isMountedRef,
}) {
  console.log(`[VICK_FAST_PATH] START — skipping ALL optional context fetches`);
  const diagResults = await runVickDiagnosticIfNeeded(character, characterId, text);
  const prompt = buildVickFastPathPrompt(diagResults);
  console.log(`[VICK_FAST_PATH] Prompt built. diagnostic_injected=${!!diagResults} prompt_len=${prompt.length}`);

  const t0 = Date.now();
  let rawResponse;
  rawResponse = await callLLMWithRetry(prompt);
  console.log(`[VICK_FAST_PATH] LLM responded in ${Date.now() - t0}ms. First 300: ${(rawResponse||'').substring(0,300)}`);

  const parsed = parseCharacterResponse(rawResponse);
  let responseText = parsed.text_content?.trim() || '';
  responseText = filterDashes(responseText);
  responseText = stripCharacterNamePrefix(responseText, character.name);

  if (!responseText) {
    console.error(`[VICK_FAST_PATH] Empty response text after parsing — aborting save`);
    return { handled: false };
  }

  const vickMsg = await base44.entities.Message.create({
    conversation_id: convoId,
    sender_type: 'character',
    character_id: characterId,
    character_name: character.name,
    content: responseText,
    is_read: true,
    timestamp: new Date().toISOString(),
    source_message_id: userMsg?.id || null,
    reply_to_message_id: userMsg?.id || null,
    recovery_signal: false,
    memory_eligible: false,
    relationship_eligible: false,
    channel: 'direct',
  });

  if (vickMsg?.id) {
    if (isMountedRef.current) {
      setMessages(prev => prev.some(m => m.id === vickMsg.id) ? prev : [...prev, vickMsg]);
    }
    console.log(`[VICK_FAST_PATH] Message saved id=${vickMsg.id} text="${responseText.substring(0,120)}"`);
  }

  if (isMountedRef.current) setIsTyping(false);
  releaseFgTask();

  await base44.entities.Conversation.update(convoId, {
    last_message_preview: responseText.substring(0, 100),
    last_message_date: new Date().toISOString(),
  }).catch(() => {});

  return { handled: true, responseText };
}

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