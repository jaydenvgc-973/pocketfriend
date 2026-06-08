/**
 * vickDiagnosticIntentCheck.js
 *
 * Identifies Vick Servicio characters and detects whether the user is
 * asking a SERVICE question — diagnostics, schema, repair, records,
 * files, logs, character types, duplicate records, broken behavior,
 * location issues, travel, messages, finance, memory, relationships,
 * account state, or any system-level inquiry.
 *
 * Vick must handle ALL of these persistently — not just one-shot diagnostic triggers.
 */

/**
 * Returns true if the user message is asking Vick a service question.
 * This is intentionally broad — Vick should never fall back to NPC
 * guessing on any technical or system question.
 */
export function hasVickServiceIntent(text) {
  // Character-list and identity questions must always route through the service bridge
  // so Vick uses the live Settings-pipeline resolver instead of guessing names.
  const characterListPattern = /list.*characters?|show.*characters?|who.*characters?|characters?.*on.*account|my characters?|which characters?|all characters?|character.*count|how many characters?|character.*names?|show me.*people|list.*people|active.*characters?|npc.*family|npc.*fictitious|character.*type|character.*id|which.*character.*belong|who is.*id|what.*id.*belong|id.*name|name.*id|character.*lookup|acquaintance|relationship.*candidates?|people.*world|who.*exist|characters?.*exist/i;
  if (characterListPattern.test(text)) return true;

  return /\b(diagnos\w*|audit|check my account|what.?s wrong|run a check|run it|inspect|troubleshoot|account status|any issues|any problems|everything ok|schema|character.?type|character type|owner.?email|ownership|location issue|travel issue|travel broken|not traveling|won.?t travel|not going to work|work schedule|missing character|character missing|duplicate|merge blocked|ghost record|repair|financial|money wrong|balance wrong|memory issue|image wrong|broken|not working|isn.?t working|won.?t work|check my|how does|what is|what are|what field|which entity|which function|what entity|data issue|sync|backfill|fix my|something wrong|what happened|why is|why isn.?t|why won.?t|tell me about|explain|how do you|can you check|can you verify|record|field|function|entity|enum|type value|type field|character_type|owner_email|resolved_|presence_status|location_id|is_jailed|house_arrest|stay_lock|autonomous_travel|is_world_service|npc_|active_created|npc_family|npc_fictitious|npc_regular|npc_world_service)\b/i.test(text);
}

/**
 * Backward-compatible alias — used by fast-path checks.
 */
export function hasVickDiagnosticIntent(text) {
  return hasVickServiceIntent(text);
}

/**
 * Returns true if the given character is Vick Servicio.
 * Uses all five reliable identification signals — never a single-field check.
 */
export function isVickServicioCharacter(character) {
  if (!character) return false;
  if (character.character_type === 'npc_world_service') return true;
  if (character.is_world_service === true) return true;
  if (character.diagnostic_only === true) return true;
  const names = [character.name, character.display_name, character.primary_name]
    .filter(Boolean)
    .map(n => n.toLowerCase());
  return names.some(n => n.includes('vick servicio'));
}