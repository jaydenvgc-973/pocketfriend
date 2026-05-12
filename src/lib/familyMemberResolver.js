/**
 * GLOBAL FAMILY MEMBER RESOLVER
 * 
 * Single source of truth for resolving or creating npc_family_member records.
 * 
 * RULE: Before creating ANY npc_family_member, resolve existing Character by this order:
 * 1. linked_character_id on family row (stable ID — highest priority)
 * 2. active_created_character by owner_email + normalized name
 * 3. existing npc_family_member by owner_email + normalized name
 * 4. npc_fictitious / npc_regular by owner_email + normalized name
 * 5. ONLY if no match: create new npc_family_member
 * 
 * This prevents duplicate npc_family_member creation across parents and ensures
 * shared children (like Leo Parker) remain one record shared bilaterally.
 */

/**
 * Resolve or create a family member character record.
 * 
 * @param {Object} params
 * @param {string} params.name - Family member name (required, will be trimmed)
 * @param {string} params.owner_email - Account owner email (required for RLS scope)
 * @param {string} params.owner_user_id - Account owner user ID (required)
 * @param {string} params.user_role - User role ('admin' or 'user')
 * @param {string} params.photo_url - Avatar URL (optional)
 * @param {string} params.linked_character_id - Pre-existing link ID (optional)
 * @param {Array} params.all_live_characters - All live characters for this owner (required for resolution)
 * @param {Object} params.base44 - Base44 SDK instance (required for creation)
 * 
 * @returns {Promise<{id: string, name: string, character_type: string, created: boolean}>}
 *   - id: Character.id
 *   - name: resolved name
 *   - character_type: the resolved character's type
 *   - created: true if this call created a new record, false if resolved existing
 */
export async function resolveOrCreateFamilyMemberCharacter({
  name,
  owner_email,
  owner_user_id,
  user_role,
  photo_url,
  linked_character_id,
  all_live_characters,
  base44
}) {
  if (!name?.trim()) {
    throw new Error('Family member name is required');
  }
  if (!owner_email) {
    throw new Error('owner_email is required');
  }
  if (!all_live_characters || !Array.isArray(all_live_characters)) {
    throw new Error('all_live_characters array is required');
  }
  if (!base44) {
    throw new Error('base44 SDK instance is required');
  }

  const nameKey = name.trim().toLowerCase();
  
  // Build lookup maps by normalized name and ID
  const charMapByName = new Map();
  const charMapById = new Map();

  for (const char of all_live_characters) {
    const charNameKey = char.name?.trim().toLowerCase();
    if (charNameKey) {
      if (!charMapByName.has(charNameKey)) {
        charMapByName.set(charNameKey, char);
      }
    }
    charMapById.set(char.id, char);
  }

  // ──────────────────────────────────────────────────────────────
  // RESOLUTION CHAIN
  // ──────────────────────────────────────────────────────────────

  // Step 1: Trust stable linked_character_id if it exists and is live
  if (linked_character_id && charMapById.has(linked_character_id)) {
    const existingChar = charMapById.get(linked_character_id);
    if (existingChar.status !== 'deleted' && existingChar.status !== 'soft_deleted') {
      return {
        id: existingChar.id,
        name: existingChar.name,
        character_type: existingChar.character_type,
        created: false
      };
    }
  }

  // Step 2-4: Look up by name (returns first match, which respects type priority)
  if (charMapByName.has(nameKey)) {
    const resolvedChar = charMapByName.get(nameKey);
    return {
      id: resolvedChar.id,
      name: resolvedChar.name,
      character_type: resolvedChar.character_type,
      created: false
    };
  }

  // Step 5: No match found — create new npc_family_member
  const newFamilyNPC = await base44.entities.Character.create({
    name: name.trim(),
    character_type: 'npc_family_member',
    owner_email,
    owner_user_id,
    created_by_role: user_role || 'user',
    status: 'active',
    is_active_character: false,
    visibility_scope: 'account_private',
    data_scope: 'private_user',
    exclude_from_homepage: true,
    exclude_from_roster: true,
    avatar_url: photo_url || null
  });

  return {
    id: newFamilyNPC.id,
    name: newFamilyNPC.name,
    character_type: newFamilyNPC.character_type,
    created: true
  };
}