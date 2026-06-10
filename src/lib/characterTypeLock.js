/**
 * characterTypeLock — Canonical guard for character_type immutability.
 *
 * PERMANENT ARCHITECTURAL RULE:
 *   character_type is USER-OWNED DATA.
 *   Only the user may change it through an approved app control
 *   (creation flow, Settings > Edit Character Type, or explicit promotion UI).
 *
 * No backend function, repair tool, resolver, cache rebuild, relationship sync,
 * profile hydration, location fix, memory system, or automation may read or
 * infer promotion intent and write character_type to an existing record.
 *
 * The ONLY approved mutation path is:
 *   User → approved UI control → onCharacterTypeChanged({ user_initiated: true })
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS ALLOWED:
 *   - Fixing a literal typo variant of the same class (e.g. npc_fictitious_person
 *     → npc_fictitious) via repairInvalidCharacterTypes with dry_run=false only
 *     after admin review and confirmation. Still must never cross class boundaries.
 *   - Reading character_type for filtering/routing decisions (display eligibility,
 *     billing gates, travel routing, etc.) — read is always safe.
 *
 * WHAT IS FORBIDDEN (auto-promotion):
 *   - Setting character_type based on backstory, bio, memories, relationships,
 *     avatar, finances, location, job, school, schedule, narrative appearance,
 *     dashboard placement, roster position, or reference frequency.
 *   - Any bulk update that touches character_type.
 *   - Any repair function that changes character_type on existing records.
 *   - Any resolver that rewrites character_type instead of filtering by it.
 *   - Promoting npc_* → active_created_character without user_initiated=true.
 *   - Demoting active_created_character → npc_* without user_initiated=true.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE in frontend / lib files:
 *
 *   import { isCharacterTypeWriteAllowed, CHARACTER_TYPE_LOCK_REASON } from '@/lib/characterTypeLock';
 *
 *   if (!isCharacterTypeWriteAllowed(updates, existingRecord, { userInitiated: true })) {
 *     console.error(CHARACTER_TYPE_LOCK_REASON);
 *     delete updates.character_type; // Strip the field before writing
 *   }
 *
 * USAGE in backend functions (inline, no import):
 *   // Copy the guard inline since backend functions cannot import local files.
 *   // See CHARACTER_TYPE_LOCK comment block at top of each backend function.
 */

/**
 * Canonical set of valid character_type values.
 * npc_world_service is reserved for permanent world-service characters (Vick Servicio, etc.)
 * and may only be set at character creation via createNPCCharacter with explicit type param.
 */
export const CANONICAL_CHARACTER_TYPES = new Set([
  'active_created_character',
  'npc_regular',
  'npc_family_member',
  'npc_fictitious',
  'npc_world_service',
]);

/**
 * NPC class — these types may never be auto-promoted to active_created_character.
 */
export const NPC_TYPES = new Set([
  'npc_regular',
  'npc_family_member',
  'npc_fictitious',
  'npc_world_service',
]);

/**
 * Known typo/legacy variants that map to their canonical form within the SAME class.
 * Cross-class corrections (e.g. npc → active) are NOT in this map.
 * This map is used ONLY by repairInvalidCharacterTypes, never by any other function.
 */
export const TYPO_CORRECTIONS = {
  'npc_fictitious_person': 'npc_fictitious',
  'NPC_fictitious':        'npc_fictitious',
  'NPC_fictitious_person': 'npc_fictitious',
  'NPC_fixitious_person':  'npc_fictitious',
  'npc_fixitious_person':  'npc_fictitious',
  'npc_fictious':          'npc_fictitious',
  'npc_ficitious':         'npc_fictitious',
  'npc_fictiuous':         'npc_fictitious',
};

/**
 * Returns true ONLY when writing character_type to an existing record is permitted.
 *
 * @param {object} updates   - The update payload being written to the DB
 * @param {object} existing  - The current DB record (must have character_type)
 * @param {object} [opts]
 * @param {boolean} [opts.userInitiated=false] - Must be true for promotion/demotion
 * @param {boolean} [opts.typoRepairOnly=false] - True only for repairInvalidCharacterTypes
 * @returns {{ allowed: boolean, reason: string }}
 */
export function isCharacterTypeWriteAllowed(updates, existing, opts = {}) {
  // If character_type is not in the update, always allowed (not touching it)
  if (!('character_type' in updates)) {
    return { allowed: true, reason: 'character_type not in update — safe' };
  }

  const newType = updates.character_type;
  const oldType = existing?.character_type;

  // Same value — no-op write, technically safe
  if (newType === oldType) {
    return { allowed: true, reason: 'character_type unchanged — no-op' };
  }

  // Typo repair path: only allowed for same-class typo variants, never cross-class
  if (opts.typoRepairOnly === true) {
    const corrected = TYPO_CORRECTIONS[oldType];
    if (corrected === newType) {
      return { allowed: true, reason: `typo_repair: ${oldType} → ${newType}` };
    }
    return {
      allowed: false,
      reason: `CHARACTER_TYPE_LOCK: typo repair blocked — ${oldType} → ${newType} is cross-class or not a known typo variant`,
    };
  }

  // Any cross-class change (npc ↔ active) requires explicit user action
  if (!opts.userInitiated) {
    return {
      allowed: false,
      reason: `CHARACTER_TYPE_LOCK: Blocked automatic character_type change from "${oldType}" to "${newType}". Only user-initiated changes through approved app controls are permitted.`,
    };
  }

  return { allowed: true, reason: `user_initiated promotion/demotion: ${oldType} → ${newType}` };
}

/**
 * Strips character_type from an update payload unless the write is explicitly allowed.
 * Returns the sanitized payload (never mutates the original).
 *
 * Use this as a safety wrapper before any Character.update() call in a system
 * function where the caller may accidentally include character_type.
 *
 * @param {object} updates   - Update payload
 * @param {object} existing  - Current DB record
 * @param {string} [caller]  - Label for logging
 * @returns {object} Sanitized update payload with character_type removed if locked
 */
export function sanitizeCharacterUpdate(updates, existing, caller = 'unknown') {
  if (!('character_type' in updates)) return updates;

  const check = isCharacterTypeWriteAllowed(updates, existing);
  if (!check.allowed) {
    console.warn(`[characterTypeLock][${caller}] STRIPPED character_type from update. Reason: ${check.reason}`);
    const sanitized = { ...updates };
    delete sanitized.character_type;
    return sanitized;
  }

  return updates;
}

/** Exported constant so callsites can reference the lock message uniformly. */
export const CHARACTER_TYPE_LOCK_REASON =
  'CHARACTER_TYPE_LOCK: character_type is user-owned data. Only user-initiated actions through approved app controls may change it.';