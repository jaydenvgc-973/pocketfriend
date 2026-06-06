/**
 * Checks if a user message contains diagnostic intent for Vick Servicio.
 *
 * The original regex used \bdiagnos\b which requires "diagnos" as a COMPLETE word.
 * The word "diagnostic" has no word boundary after "diagnos" — it failed silently.
 *
 * Fixed: \bdiagnos\w* matches "diagnos", "diagnostic", "diagnostics", "diagnose", etc.
 */
export function hasVickDiagnosticIntent(text) {
  return /\b(diagnos\w*|audit|check my account|what.?s wrong|run a check|run it|inspect|troubleshoot|account status|any issues|any problems|everything ok)\b/i.test(text);
}

/**
 * Returns true if the given character is Vick Servicio.
 */
export function isVickServicioCharacter(character) {
  return (
    character?.character_type === 'npc_world_service' ||
    (character?.name || '').toLowerCase().includes('vick servicio')
  );
}