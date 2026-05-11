/**
 * characterContactsResolver.js
 *
 * SINGLE SOURCE OF TRUTH for building a character's known contact list.
 *
 * Used by:
 *   - WorldContactsPopup
 *   - Character Profile known contacts
 *   - People in Their World
 *   - Family list display
 *   - World Phone contact picker
 *
 * Contact sources (in order, deduped by stable characterId then name):
 *   1. character.fictional_relationships
 *   2. character.family_members
 *   3. character.people_in_world / known_people (if present)
 *   4. existing conversation-linked Character IDs
 *
 * Rules:
 *   - Only people attached to THIS character are included.
 *   - npc_family_member Character records are NEVER used to create contacts.
 *   - They are only used for avatar hydration on contacts already listed.
 *   - If related_character_id exists, hydrate avatar from that Character record.
 *   - If no ID, do an exact name match within owner_email scope — for hydration only.
 *   - Unresolved/name-only contacts remain visible with initials.
 *   - Result is sorted alphabetically by person_name.
 *
 * Avatar priority per contact:
 *   1. linked Character record avatar_url
 *   2. linked Character record image_avatar_url
 *   3. inline family_members entry avatar_url / image_url / image_avatar_url
 *   4. name-match Character record avatar_url / image_avatar_url
 *   5. initials (no avatar_url on returned object)
 */

import { base44 } from '@/api/base44Client';

function bestAvatar(rec) {
  return rec?.avatar_url || rec?.image_avatar_url || null;
}

/**
 * Resolve the contact list for a character.
 *
 * @param {object} character - The full Character record (must have .id)
 * @param {string} ownerEmail - The authenticated user's email (for scoped Character fetch)
 * @returns {Promise<Array>} Sorted array of contact objects
 */
export async function resolveCharacterContacts(character, ownerEmail) {
  if (!character?.id) return [];

  const seen = new Map(); // key: related_character_id or `name:${person_name}`

  // ── SOURCE 1: fictional_relationships ───────────────────────────────────────
  for (const rel of (character.fictional_relationships || [])) {
    const name = rel.person_name;
    if (!name) continue;
    const key = rel.related_character_id || `name:${name}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      person_name: name,
      relationship_type: rel.relationship_type || null,
      description: rel.description || '',
      history_summary: rel.history_summary || '',
      last_interaction_summary: rel.last_interaction_summary || '',
      emotional_impact: rel.emotional_impact || '',
      current_status: rel.current_status || '',
      romantic_level: rel.romantic_level || 0,
      friendship_level: rel.friendship_level || 0,
      related_character_id: rel.related_character_id || null,
      avatar_url: null,
      _source: 'fictional_relationships',
      _linkage: rel.related_character_id ? 'linked' : 'name_only',
      _matched_character_id: null,
      _avatar_source: null,
    });
  }

  // ── SOURCE 2: family_members ─────────────────────────────────────────────────
  // Add to contact list if not already present from fictional_relationships.
  // Also capture any inline image fields for avatar hydration.
  const familyInlineAvatars = new Map(); // name.toLowerCase() → inline avatar url
  for (const fm of (character.family_members || [])) {
    const name = fm.name || fm.person_name;
    if (!name) continue;
    const inlineAvatar = fm.avatar_url || fm.image_url || fm.image_avatar_url || null;
    if (inlineAvatar) familyInlineAvatars.set(name.trim().toLowerCase(), inlineAvatar);

    const key = fm.related_character_id || `name:${name}`;
    if (seen.has(key)) continue; // already in from fictional_relationships

    seen.set(key, {
      person_name: name,
      relationship_type: fm.relationship_type || fm.relationship || 'Family',
      description: fm.description || '',
      history_summary: '',
      last_interaction_summary: '',
      emotional_impact: '',
      current_status: '',
      romantic_level: 0,
      friendship_level: fm.friendship_level || 50,
      related_character_id: fm.related_character_id || null,
      avatar_url: inlineAvatar || null,
      _source: 'family_members',
      _linkage: fm.related_character_id ? 'linked' : 'name_only',
      _matched_character_id: null,
      _avatar_source: inlineAvatar ? 'family_members_inline' : null,
    });
  }

  // ── SOURCE 3: people_in_world / known_people ─────────────────────────────────
  const peopleInWorld = character.people_in_world || character.known_people || [];
  for (const p of peopleInWorld) {
    const name = p.name || p.person_name;
    if (!name) continue;
    const key = p.related_character_id || p.character_id || `name:${name}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      person_name: name,
      relationship_type: p.relationship_type || 'Known',
      description: p.description || '',
      history_summary: '',
      last_interaction_summary: '',
      emotional_impact: '',
      current_status: p.current_status || '',
      romantic_level: 0,
      friendship_level: p.friendship_level || 30,
      related_character_id: p.related_character_id || p.character_id || null,
      avatar_url: null,
      _source: 'people_in_world',
      _linkage: (p.related_character_id || p.character_id) ? 'linked' : 'name_only',
      _matched_character_id: null,
      _avatar_source: null,
    });
  }

  // Early return without DB queries if no ownerEmail
  if (!ownerEmail) {
    return _sortAndApplyFamilyAvatars(seen, familyInlineAvatars);
  }

  // ── SINGLE FETCH: all owner Characters in one call ───────────────────────────
  // Used for: avatar hydration, conversation-linked additions, name-match hydration.
  // Never used to create new contacts.
  const allOwnerChars = await base44.entities.Character.filter(
    { owner_email: ownerEmail, status: 'active' },
    null, 200
  ).catch(() => []);

  const charById = new Map(allOwnerChars.map(c => [c.id, c]));
  const charByName = new Map(allOwnerChars.map(c => [c.name?.trim().toLowerCase(), c]));

  // ── AVATAR HYDRATION: by related_character_id ────────────────────────────────
  for (const entry of seen.values()) {
    if (entry.related_character_id && !entry.avatar_url) {
      const rec = charById.get(entry.related_character_id);
      if (rec) {
        const av = bestAvatar(rec);
        if (av) {
          entry.avatar_url = av;
          entry._matched_character_id = rec.id;
          entry._avatar_source = 'linked_character_record';
          entry._linkage = 'linked';
        }
      }
    }
  }

  // ── SOURCE 4: conversation-linked characters ─────────────────────────────────
  // Only add if not already in list. Hydrate avatar if already present.
  const existingConvos = await base44.entities.Conversation.filter(
    { character_ids: [character.id], owner_email: ownerEmail },
    '-updated_date', 30
  ).catch(() => []);

  const convoLinkedIds = new Set(
    existingConvos.flatMap(c => c.character_ids || []).filter(id => id !== character.id)
  );

  for (const id of convoLinkedIds) {
    const lc = charById.get(id);
    if (!lc) continue;
    const av = bestAvatar(lc);

    if (seen.has(lc.id)) {
      // Hydrate only
      const entry = seen.get(lc.id);
      if (!entry.avatar_url && av) {
        entry.avatar_url = av;
        entry._matched_character_id = lc.id;
        entry._avatar_source = 'conversation_linked_record';
      }
    } else {
      // Try to link to an existing name-only entry
      const nameEntry = [...seen.values()].find(c =>
        c.person_name?.trim().toLowerCase() === lc.name?.trim().toLowerCase() &&
        !c.related_character_id
      );
      if (nameEntry) {
        nameEntry.related_character_id = lc.id;
        if (!nameEntry.avatar_url && av) nameEntry.avatar_url = av;
        nameEntry._matched_character_id = lc.id;
        nameEntry._avatar_source = nameEntry._avatar_source || 'conversation_name_match';
        nameEntry._linkage = 'linked_from_conversation';
      } else {
        // New contact from conversation — only for characters this character has spoken with
        seen.set(lc.id, {
          person_name: lc.name,
          relationship_type: lc.character_type === 'npc_fictitious' ? 'Known Contact' : 'Character',
          description: lc.profile_summary || lc.backstory || '',
          history_summary: '',
          last_interaction_summary: '',
          emotional_impact: '',
          current_status: lc.current_activity || '',
          romantic_level: 0,
          friendship_level: 30,
          related_character_id: lc.id,
          avatar_url: av || null,
          _source: 'conversation',
          _linkage: 'linked_from_conversation',
          _matched_character_id: lc.id,
          _avatar_source: av ? 'conversation_linked_record' : null,
        });
      }
    }
  }

  // ── AVATAR HYDRATION: exact name match for still-unhydrated entries ──────────
  // Only for avatar/link hydration — never creates new contacts.
  // Does NOT match npc_family_member records that are not in this character's family_members list.
  for (const entry of seen.values()) {
    if (!entry.avatar_url && !entry.related_character_id) {
      const match = charByName.get(entry.person_name?.trim().toLowerCase());
      if (match) {
        const av = bestAvatar(match);
        if (av) {
          entry.avatar_url = av;
          entry._matched_character_id = match.id;
          entry._avatar_source = 'name_match_hydration';
          entry.related_character_id = match.id;
          entry._linkage = 'linked_from_name_match';
        }
      }
    }
  }

  // ── FAMILY INLINE AVATAR FALLBACK ────────────────────────────────────────────
  // Apply inline family avatar to still-unhydrated entries (last resort before initials)
  for (const entry of seen.values()) {
    if (!entry.avatar_url) {
      const inlineAv = familyInlineAvatars.get(entry.person_name?.trim().toLowerCase());
      if (inlineAv) {
        entry.avatar_url = inlineAv;
        entry._avatar_source = 'family_members_inline_fallback';
      }
    }
  }

  const result = [...seen.values()].sort((a, b) =>
    (a.person_name || '').localeCompare(b.person_name || '')
  );

  // Diagnostic log
  result.forEach(c => {
    console.log(
      `[ContactsResolver] name="${c.person_name}" | source=${c._source} | ` +
      `id=${c.related_character_id || 'none'} | avatar=${c.avatar_url ? 'YES' : 'NO'} | ` +
      `avatar_src=${c._avatar_source || 'initials'} | linkage=${c._linkage}`
    );
  });

  return result;
}

function _sortAndApplyFamilyAvatars(seen, familyInlineAvatars) {
  for (const entry of seen.values()) {
    if (!entry.avatar_url) {
      const inlineAv = familyInlineAvatars.get(entry.person_name?.trim().toLowerCase());
      if (inlineAv) {
        entry.avatar_url = inlineAv;
        entry._avatar_source = 'family_members_inline_fallback';
      }
    }
  }
  return [...seen.values()].sort((a, b) =>
    (a.person_name || '').localeCompare(b.person_name || '')
  );
}