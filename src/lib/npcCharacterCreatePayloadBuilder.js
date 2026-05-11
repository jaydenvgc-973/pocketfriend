/**
 * Shared NPC Character Creation Payload Builder
 *
 * Ensures consistent, ownership-safe NPC creation across all routes:
 * - Settings → Edit Character Type
 * - Character Profile → Add People In Their World
 *
 * CRITICAL RULES:
 * - No created_by field (reserved system field)
 * - owner_email is mandatory and derived from currentUser only
 * - owner_user_id is mandatory
 * - All NPC types must set exclude_from_homepage: true
 * - Validation catches missing user context before Character.create
 *
 * @param {Object} config
 * @param {Object} config.currentUser - authenticated user object (email, id, role required)
 * @param {string} config.name - NPC name
 * @param {string} config.characterType - one of: npc_fictitious, npc_family_member, npc_regular
 * @param {string} [config.linkedActiveCharacterId] - ID of the active character this NPC is linked to (for relationship context)
 * @param {string} [config.relationshipType] - relationship type (friend, family, coworker, etc.)
 * @param {string} [config.familyTitle] - family role (parent, sibling, etc.) for npc_family_member
 * @param {string} [config.source] - origin route for diagnostics (EditCharacterType, AddPeopleInTheirWorld, etc.)
 *
 * @returns {Object} - Character.create payload
 * @throws {Error} - if currentUser or required fields are missing
 */
export function buildNpcCharacterCreatePayload(config) {
  const {
    currentUser,
    name,
    characterType,
    linkedActiveCharacterId,
    relationshipType,
    familyTitle,
    source,
  } = config;

  // ── VALIDATION: Owner context is mandatory ──────────────────────────────────
  if (!currentUser?.email) {
    throw new Error(
      '[buildNpcCharacterCreatePayload] currentUser.email is missing. Cannot create NPC without authenticated owner.'
    );
  }
  if (!currentUser?.id) {
    throw new Error(
      '[buildNpcCharacterCreatePayload] currentUser.id is missing. Cannot create NPC without user ID.'
    );
  }

  // ── VALIDATION: NPC type is required ───────────────────────────────────────
  const validNPCTypes = ['npc_fictitious', 'npc_family_member', 'npc_regular'];
  if (!characterType || !validNPCTypes.includes(characterType)) {
    throw new Error(
      `[buildNpcCharacterCreatePayload] characterType must be one of: ${validNPCTypes.join(', ')}. Got: ${characterType}`
    );
  }

  // ── VALIDATION: Name is required ───────────────────────────────────────────
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('[buildNpcCharacterCreatePayload] name is required and must be non-empty.');
  }

  // ── DIAGNOSTIC LOG ─────────────────────────────────────────────────────────
  console.log('[buildNpcCharacterCreatePayload] Building safe NPC payload:', JSON.stringify({
    source: source || 'unknown',
    characterType,
    characterName: name,
    linkedActiveCharacterId: linkedActiveCharacterId || null,
    relationshipType: relationshipType || null,
    familyTitle: familyTitle || null,
    ownerEmail: currentUser.email,
    ownerUserId: currentUser.id,
    createdByRoleWillBe: currentUser.role || 'user',
    validationPassed: true,
  }));

  // ── BUILD SAFE PAYLOAD ─────────────────────────────────────────────────────
  // NO created_by field — reserved system field.
  // owner_email is sole ownership source of truth.
  const payload = {
    name: name.trim(),
    character_type: characterType,
    owner_email: currentUser.email,
    owner_user_id: currentUser.id,
    created_by_role: currentUser.role || 'user',
    status: 'active',
    exclude_from_homepage: true,
  };

  return payload;
}