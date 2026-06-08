/**
 * vickContactsResolver.js
 *
 * CANONICAL SOURCE OF TRUTH for Vick Servicio's World Phone / World Contacts list.
 *
 * ARCHITECTURE RULE:
 * Vick's contact list is built EXCLUSIVELY from account-scoped Character records.
 * It is NEVER derived from:
 *   - chat messages
 *   - AI-generated output
 *   - fictional_relationships arrays
 *   - diagnostic summaries
 *   - inferred statements
 *   - anything Vick says in conversation
 *
 * Sources (in priority order):
 *   1. active_created_character records owned by the account (these are the primary world characters)
 *   2. npc_fictitious records owned by the account (World Contacts NPCs)
 *   3. npc_family_member records owned by the account
 *
 * Excluded:
 *   - npc_world_service characters (including Vick himself)
 *   - npc_regular characters (background only)
 *   - Vick's own character ID
 *   - Deleted or moved_away characters
 *   - Characters missing both name and id
 *   - Characters where owner_email does not match the account
 *
 * This list is stable across refresh, navigation, logout/login, and app reload
 * because it reads directly from persisted Character records every time.
 * It does NOT depend on fictional_relationships being populated.
 */

import { base44 } from '@/api/base44Client';

/**
 * Resolve Vick's World Phone contact list for a given account.
 *
 * @param {string} ownerEmail - The authenticated user's email
 * @param {string} vickCharacterId - Vick's own character ID (to exclude self)
 * @returns {Promise<Array>} Sorted array of contact objects compatible with WorldContactsPopup
 */
export async function resolveVickContacts(ownerEmail, vickCharacterId) {
  if (!ownerEmail) return [];

  // Fetch all active account characters scoped to this owner
  const allChars = await base44.entities.Character.filter(
    { owner_email: ownerEmail, status: 'active' },
    null,
    200
  ).catch(() => []);

  const eligibleTypes = new Set([
    'active_created_character',
    'npc_fictitious',
    'npc_family_member',
  ]);

  const contacts = allChars
    .filter(c => {
      // Exclude Vick himself
      if (c.id === vickCharacterId) return false;
      // Exclude world service characters (Vick and any future service NPCs)
      if (c.character_type === 'npc_world_service' || c.is_world_service) return false;
      // Exclude non-eligible types
      // Legacy characters without character_type are treated as active_created_character
      const effectiveType = c.character_type || 'active_created_character';
      if (!eligibleTypes.has(effectiveType)) return false;
      // Must have a name
      if (!c.name?.trim()) return false;
      // Must not be test/diagnostic
      if (c.is_test_character || c.diagnostic_only) return false;
      return true;
    })
    .map(c => {
      const effectiveType = c.character_type || 'active_created_character';
      const relationshipLabel =
        effectiveType === 'active_created_character' ? 'Account Character'
        : effectiveType === 'npc_family_member' ? 'Family Contact'
        : 'World Contact';

      return {
        person_name: c.display_name || c.name,
        relationship_type: relationshipLabel,
        description: c.profile_summary || c.personality_summary || '',
        history_summary: '',
        last_interaction_summary: '',
        emotional_impact: '',
        current_status: c.current_activity || '',
        romantic_level: 0,
        friendship_level: 50,
        related_character_id: c.id,
        avatar_url: c.avatar_url || c.image_avatar_url || null,
        _source: 'vick_account_roster',
        _linkage: 'linked',
        _character_type: effectiveType,
      };
    })
    .sort((a, b) => {
      // active_created_character first, then others alphabetically
      const typeOrder = (type) => type === 'active_created_character' ? 0 : 1;
      const aOrder = typeOrder(a._character_type);
      const bOrder = typeOrder(b._character_type);
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.person_name || '').localeCompare(b.person_name || '');
    });

  console.log(
    `[vickContactsResolver] Resolved ${contacts.length} contacts for Vick (${ownerEmail}) ` +
    `from account roster — active_created: ${contacts.filter(c => c._character_type === 'active_created_character').length}, ` +
    `npc_fictitious: ${contacts.filter(c => c._character_type === 'npc_fictitious').length}, ` +
    `npc_family_member: ${contacts.filter(c => c._character_type === 'npc_family_member').length}`
  );

  return contacts;
}

/**
 * Check if a character is Vick Servicio by character record properties.
 * @param {object} character
 * @returns {boolean}
 */
export function isVickCharacter(character) {
  if (!character) return false;
  return (
    character.character_type === 'npc_world_service' ||
    character.is_world_service === true ||
    character.name?.toLowerCase().includes('vick servicio') ||
    character.display_name?.toLowerCase().includes('vick servicio')
  );
}