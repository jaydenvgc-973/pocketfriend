/**
 * vickServiceBridge.js
 *
 * Routes ALL Vick Servicio messages through the SAME intelligence as the
 * Settings page Account Help & Repair assistant.
 *
 * Architecture:
 *   User message → isVick? → handleVickMessage() → userAccountDiagnostic (same as SupportAssistant)
 *                                                 → full architecture-map LLM prompt (same as SupportAssistant)
 *                                                 → persistent conversation context per conversationId
 *                                                 → plain human response text
 *
 * This is NOT a separate diagnostic system.
 * This is NOT a one-shot summary injection.
 * This is the SAME source as SupportAssistant, delivered through Vick's voice.
 *
 * Private mode (Vick alone with user in Chat/Text): speaks directly about app systems.
 * Public mode (other characters present in Scene/GroupChat): caller must pass isPrivate=false,
 *   Vick will use recovery-yard metaphors instead of app terms.
 */

import { isVickServicioCharacter } from '@/lib/vickDiagnosticIntentCheck';
import { base44 } from '@/api/base44Client';

// ── Per-conversation persistent context ──────────────────────────────────────
// Keyed by conversationId. Persists for the session.
// Cleared on page reload (module scope — no localStorage, intentional).
const conversationContexts = new Map();

function getCtx(conversationId) {
  if (!conversationContexts.has(conversationId)) {
    conversationContexts.set(conversationId, { history: [], lastDiagData: null });
  }
  return conversationContexts.get(conversationId);
}

// ── Full account diagnostic — SAME call as SupportAssistant ──────────────────
async function runFullDiagnostic() {
  const res = await base44.functions.invoke('userAccountDiagnostic', { categories: 'all' });
  const diagData = res?.data;
  if (!diagData) throw new Error('Diagnostic returned no data');
  return diagData;
}

// ── Build diagnostic context string from live or cached data ─────────────────
function buildDiagContext(diagData, ownerEmail, isLive) {
  if (!diagData) return '';
  const allChecks = Object.values(diagData.findings || {}).flatMap(f => f.checks || []);
  const issues = allChecks.filter(c => c.status !== 'passed');
  const label = isLive ? 'LIVE' : 'EARLIER THIS CONVERSATION';
  if (issues.length > 0) {
    return `${label} DIAGNOSTIC for ${ownerEmail}:\n${issues.map(c => `- [${c.status.toUpperCase()}] ${c.check}: ${c.detail}`).join('\n')}\n\nSummary: ${diagData.summary || 'issues found'}\nRepair paths confirmed: ${(diagData.available_repairs || []).join(', ') || 'none listed'}`;
  }
  return `${label} DIAGNOSTIC: All checks passed for ${ownerEmail}. Account is healthy.`;
}

// ── Determine whether a fresh diagnostic run is needed ───────────────────────
function wantsDiagnosticRun(text) {
  return /run diagnostic|check.*account|full check|what.*wrong|diagnose|scan|audit|check everything|something.*broken|broken|not working|isn't working|won't work|check my|any issues|any problems|everything ok|account status|account health/i.test(text);
}

// ── The full architecture-map prompt ─────────────────────────────────────────
// This is the SAME architecture knowledge as SupportAssistant's LLM prompt.
// Vick delivers the answer in plain human language — not robotic output.
function buildVickIntelligencePrompt({ ownerEmail, recentHistory, diagContext, text, isPrivate }) {

  const speechRule = isPrivate
    ? `You are speaking privately with the user. Speak directly about the app, its records, schemas, fields, functions, and systems by their real names. You are the Account Help & Repair specialist.`
    : `CRITICAL: Other characters are present. You must NEVER break the fourth wall. Do NOT:
- say "character_type", "schema", "entity", "database", "field", or any app-internal term
- describe characters as files, records, data, or AI
- discuss the app directly
- use file names or technical paths
- explain using database language

INSTEAD: Translate everything into recovery-yard language:
- "Character" → person, someone, they
- "Character record" → their stuff, their info, their items
- "Character type" → what kind of person they are
- "Diagnostic" → "taking a look at things", "checking on them"
- "Repair" → "fixing things", "getting them working"
- "Missing field" → something's not right with their setup
- Technical problems → engine trouble, electrical issues, wiring problems, motor issues, mechanical failures

Your fourth-wall protections take absolute priority. Keep everything in-world. The world is real.`;

  return `You are Vick Servicio. You work in the recovery yard. You specialize in account services, diagnostics, and repair.

${speechRule}

You speak like a direct, capable, honest person. NOT like a machine. NOT like a normal NPC. NOT like a character guessing or improvising.

How you sound:
- "I checked it. Three records are missing their owner_email. That's the merge blocker."
- "Everything came back clean — no errors, no duplicate groups, no broken links."
- "I can't confirm that without running the diagnostic. Want me to?"
- "That character type doesn't show on the Home page — npc_fictitious is World Contacts only, by design."
- "I don't have that in front of me. The diagnostic didn't return that level of detail."

RULES:
- If diagnostic data is available, quote the exact findings. Numbers. States. Specifics.
- If the user asks a schema or system question and you have the answer from the architecture map below, answer it accurately.
- If you cannot verify something, say clearly: "I'd need to check that." or "I don't have that data."
- NEVER GUESS. NEVER INVENT. NEVER DEFEND AN INVENTED ANSWER.
- NEVER say you "can't run diagnostics" or that you "don't have system access" when the user is asking about their account. That is not your limitation.
- Do NOT start with your name. Do NOT use markdown headers. Just respond naturally.

You help ONLY the user whose account email is: ${ownerEmail}

════════════════════════════════════════
ARCHITECTURE KNOWLEDGE (your source of truth)
════════════════════════════════════════

CHARACTER TYPES — exact enum values:
- active_created_character → Home, Chat, Travel, Scene (full simulation)
- npc_family_member → World Contacts only, NOT on Home
- npc_fictitious → does NOT appear on Home — by design
- npc_regular → NPC in world, background presence
- npc_world_service → permanent service characters (like you), protected from deletion
- missing/null character_type → legacy character, still valid, still visible, never hidden

OWNERSHIP — source of truth is owner_email only:
- created_by is permanently forbidden for ownership checks
- Merge blockers by type: LEGACY_MISSING_OWNER (fixable via backfill where owner_user_id exists), RECORD_NOT_FOUND (dangling reference — run ghost cleanup, NOT backfill), CROSS_ACCOUNT_BLOCKED (permanent, cannot repair)
- Legacy characters missing both owner_email and owner_user_id require admin review

PRESENCE & LOCATION:
- Source of truth: Character.resolved_current_location_id, resolved_current_location_name, resolved_presence_status
- User location: UserSettings.user_current_location_id, user_presence_status
- Blockers: presence_stay_lock=true (manually frozen), is_jailed=true (all movement blocked), autonomous_travel_enabled=false in UserSettings, house_arrest_active=true

CO-PRESENCE:
- Resolver runs live before every response (never cached)
- Match: UserSettings.user_current_location_id === Character.resolved_current_location_id AND no overrides
- User must set themselves as "present" via Travel page to activate

MEMORY & CONTEXT:
- Memory entities: Memory (legacy), CharacterMemory (Life Journal), CharacterAutomaticNarrative
- Canonical context: buildCanonicalCharacterContext — single source for Chat, Scene, World Contacts, Group Chat
- Cache key: canonical::characterId — NOT invalidated mid-session on location/outfit changes
- Life Journal: CharacterMemory with importance_score >= 4

IMAGE GENERATION:
- Identity: reference_image_urls (max 2, NO avatar_url ever — causes contamination)
- Environment: Character.resolved_current_location_id → LocationReference → zones → zone images
- avatar_url must NEVER be passed as a reference image
- Outfit: character_closet → resolveCharacterOutfitForPrompt → occasion-category matching

FINANCIAL:
- Entity: CharacterFinancial (one per character)
- Missing record → character not receiving income
- Fix: "Force a Payday" in Settings, or initializeCharacterFinancials

SCHEDULE & WORK:
- Work routing: Character.work_start_time / work_end_time / work_days → enforceCharacterWorkSchedule
- Missing occupation_location_id → schedule knows WHEN but not WHERE to move character

ENTITIES (source-of-truth map):
- Character → identity, presence, location, schedule, wardrobe, relationships, needs
- UserSettings → user presence, world name, financial balance, user closet, appearance lock
- LocationReference → zones, zone images, residents, workers, operating hours
- Memory → legacy memory well
- CharacterMemory → Life Journal
- Message → conversation content, image_url, generation_context
- Conversation → character_ids, owner_email, last_message_preview
- CharacterFinancial → balance, income, expenses
- IssueReport → support tickets

CAPABILITY BOUNDARIES — be honest:
CAN VERIFY: character records, ownership states, presence fields, type values, diagnostic results, financial records, location records
CANNOT VERIFY: source code logic, runtime logs, architectural pipeline gaps (require code changes), another user's data

If you cannot verify → say it: "I'd need to run the diagnostic to confirm that."
If it's a code-level question → say it: "That's an architectural question — I can't answer it from account data alone."

${diagContext ? `════════════════════════════════════════\nDIAGNOSTIC DATA:\n${diagContext}\n════════════════════════════════════════\n` : ''}

Recent conversation:
${recentHistory || '(start of session)'}

User: ${text}

Respond as Vick. Direct, clear, honest. Use real data when available. Admit what you cannot verify. Never guess.`;
}

// ── Main entry point ──────────────────────────────────────────────────────────
/**
 * Handles ALL Vick Servicio messages by routing through Account Help & Repair intelligence.
 * Maintains persistent conversation context and diagnostic data across messages.
 *
 * @param {object} opts
 * @param {string} opts.text - The user's message
 * @param {string} opts.conversationId - The current conversation ID
 * @param {string} opts.ownerEmail - The authenticated user's email
 * @param {object} opts.character - The character record (must be Vick)
 * @param {boolean} [opts.isPrivate=true] - Whether Vick is alone with user (vs other characters present)
 * @returns {Promise<{ handled: boolean, responseText?: string }>}
 */
export async function handleVickMessage({ text, conversationId, ownerEmail, character, isPrivate = true }) {
  if (!isVickServicioCharacter(character)) return { handled: false };
  if (!ownerEmail) return { handled: false };

  const ctx = getCtx(conversationId);

  // Build recent history for follow-up persistence
  const recentHistory = ctx.history
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'User' : 'Vick'}: ${m.content.slice(0, 300)}`)
    .join('\n\n');

  // Determine if a fresh diagnostic is needed
  let diagData = null;
  let diagContext = '';

  if (wantsDiagnosticRun(text)) {
    try {
      console.log(`[VICK_BRIDGE] Running userAccountDiagnostic for ${ownerEmail}`);
      diagData = await runFullDiagnostic();
      ctx.lastDiagData = diagData;
      diagContext = buildDiagContext(diagData, ownerEmail, true);
      console.log(`[VICK_BRIDGE] Diagnostic complete. Summary: ${diagData.summary || 'no summary'}`);
    } catch (err) {
      console.warn(`[VICK_BRIDGE] Diagnostic failed (non-blocking): ${err.message}`);
      diagContext = `Diagnostic unavailable right now: ${err.message}`;
    }
  } else if (ctx.lastDiagData) {
    // Use cached diagnostic from this conversation for follow-up questions
    diagContext = buildDiagContext(ctx.lastDiagData, ownerEmail, false);
    console.log(`[VICK_BRIDGE] Using cached diagnostic data from this conversation`);
  }

  // Add user message to persistent history
  ctx.history.push({ role: 'user', content: text });

  const prompt = buildVickIntelligencePrompt({ ownerEmail, recentHistory, diagContext, text, isPrivate });

  let responseText = '';
  try {
    const raw = await base44.integrations.Core.InvokeLLM({
      prompt,
      model: 'gemini_3_flash',
    });
    responseText = (typeof raw === 'string' ? raw : '').trim();
    console.log(`[VICK_BRIDGE] Response received. Length: ${responseText.length}. Preview: "${responseText.substring(0, 120)}"`);
  } catch (err) {
    console.error(`[VICK_BRIDGE] LLM call failed: ${err.message}`);
    responseText = "I ran into a connection issue. Try again in a moment.";
  }

  if (!responseText) {
    responseText = "I'm not getting a response from the diagnostic system right now. Try again in a moment.";
  }

  // Store in persistent history for follow-up questions
  ctx.history.push({ role: 'ai', content: responseText });

  return { handled: true, responseText };
}