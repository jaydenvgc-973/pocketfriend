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
 * Contact sources (priority order, deduped by stable characterId then name):
 *   1. character.family_members  — ALWAYS included, no conversation required
 *   2. character.fictional_relationships
 *   3. character.people_in_world / known_people (if present)
 *   4. existing green-channel conversation-linked Character IDs
 *
 * Deduplication priority (highest wins):
 *   1. Linked active Character record / known character ID
 *   2. family_member entry (preserves pair-specific family relationship label)
 *   3. fictional_relationship entry
 *   4. people_in_world entry
 *   5. conversation-linked contact
 *   6. name-only fallback
 *
 * FAMILY LABEL RULE:
 *   Family relationship labels (mother, son, daughter, etc.) come ONLY from the
 *   viewed character's own family_members array or fictional_relationships.
 *   "npc_family_member" character_type does NOT create or imply a family relationship
 *   to any other character. It is a category of that character, not a relationship
 *   descriptor for every person they speak to.
 *
 * Avatar priority per contact:
 *   1. linked Character record avatar_url / image_avatar_url
 *   2. inline family_members entry avatar_url / image_url / image_avatar_url
 *   3. name-match Character record avatar_url / image_avatar_url
 *   4. initials (no avatar_url on returned object)
 */

import { base44 } from '@/api/base44Client';
import { normalizeRelationshipType } from '@/lib/relationshipTypeDefinitions';

function bestAvatar(rec) {
  return rec?.avatar_url || rec?.image_avatar_url || null;
}

/**
 * Resolve the contact list for a character.
 *
 * @param {object} character - The full Character record (must have .id)
 * @param {string} ownerEmail - The authenticated user's email (for scoped Character fetch)
 * @param {object} [currentUser] - Optional: the authenticated user object (id, email, full_name).
 *   When provided, any entry that resolves to the user themselves is excluded from World Contacts.
 * @returns {Promise<Array>} Sorted array of contact objects
 */
export async function resolveCharacterContacts(character, ownerEmail, currentUser = null) {
  if (!character?.id) return [];

  // ── USER-SELF EXCLUSION HELPER ───────────────────────────────────────────────
  function isUserSelf(entry) {
    if (!currentUser) return false;
    if (entry.is_user === true) return true;
    if (currentUser.id && entry.related_user_id && entry.related_user_id === currentUser.id) return true;
    if (currentUser.id && entry.owner_user_id && entry.owner_user_id === currentUser.id) return true;
    if (currentUser.email && entry.email && entry.email.toLowerCase() === currentUser.email.toLowerCase()) return true;
    return false;
  }

  // ── SEEN MAP ─────────────────────────────────────────────────────────────────
  // Key: related_character_id (stable ID) OR `name:${normalized_name}` (fallback)
  // Value is never replaced by a lower-priority source — only upgraded (ID linkage / avatar)
  const seen = new Map();

  // Helper to generate the stable key for a person
  function makeKey(charId, name) {
    return charId || (name ? `name:${name.trim().toLowerCase()}` : null);
  }

  // Helper to find an existing entry by character ID or by normalized name
  function findExistingEntry(charId, name) {
    if (charId && seen.has(charId)) return seen.get(charId);
    if (name) {
      const nameKey = `name:${name.trim().toLowerCase()}`;
      if (seen.has(nameKey)) return seen.get(nameKey);
      // Also scan for an entry whose person_name matches (in case it was keyed by ID already)
      for (const entry of seen.values()) {
        if (entry.person_name?.trim().toLowerCase() === name.trim().toLowerCase()) return entry;
      }
    }
    return null;
  }

  // ── SOURCE 1: family_members ─────────────────────────────────────────────────
  // ALWAYS included — a family member appears in World Contacts even if they have
  // never had a World Phone conversation. The family_members array on the viewed
  // character's profile is the authoritative source for pair-specific family labels.
  const familyInlineAvatars = new Map(); // name.toLowerCase() → inline avatar url (for hydration)

  for (const fm of (character.family_members || [])) {
    const name = fm.name || fm.person_name;
    if (!name) continue;

    // Capture inline avatar for hydration regardless of contact creation
    const inlineAvatar = fm.avatar_url || fm.image_url || fm.image_avatar_url || null;
    if (inlineAvatar) familyInlineAvatars.set(name.trim().toLowerCase(), inlineAvatar);

    if (isUserSelf(fm)) {
      console.log(`[ContactsResolver] EXCLUDED (user-self) family_members entry: "${name}"`);
      continue;
    }

    const charId = fm.character_id || fm.related_character_id || null;
    const key = makeKey(charId, name);
    if (!key) continue;

    // Family relationship label — PAIR-SPECIFIC from this character's own data
    const relLabel = fm.relationship_type || fm.role || 'Family';

    if (!seen.has(key)) {
      seen.set(key, {
        person_name: name,
        relationship_type: relLabel,
        relationship_family: normalizeRelationshipType(relLabel),
        description: fm.description || '',
        history_summary: '',
        last_interaction_summary: '',
        emotional_impact: '',
        current_status: fm.current_status || '',
        romantic_level: 0,
        friendship_level: fm.friendship_level || 50,
        related_character_id: charId,
        avatar_url: inlineAvatar || null,
        _source: 'family_members',
        _linkage: charId ? 'linked' : 'name_only',
        _matched_character_id: null,
        _avatar_source: inlineAvatar ? 'family_members_inline' : null,
      });
    }
    // If already exists from a prior pass (shouldn't happen for SOURCE 1 which runs first),
    // upgrade the avatar if missing
    else {
      const existing = seen.get(key);
      if (!existing.avatar_url && inlineAvatar) {
        existing.avatar_url = inlineAvatar;
        existing._avatar_source = 'family_members_inline';
      }
    }
  }

  // ── SOURCE 2: fictional_relationships ───────────────────────────────────────
  for (const rel of (character.fictional_relationships || [])) {
    const name = rel.person_name;
    if (!name) continue;
    if (isUserSelf(rel)) {
      console.log(`[ContactsResolver] EXCLUDED (user-self) fictional_relationships entry: "${name}"`);
      continue;
    }

    const charId = rel.related_character_id || null;
    const key = makeKey(charId, name);
    if (!key) continue;

    const existing = findExistingEntry(charId, name);
    if (existing) {
      // Already listed from family_members — upgrade ID linkage if we now have one
      if (charId && !existing.related_character_id) {
        // Promote the key from name-based to ID-based
        const oldKey = `name:${name.trim().toLowerCase()}`;
        if (seen.has(oldKey)) {
          seen.delete(oldKey);
          existing.related_character_id = charId;
          existing._linkage = 'linked';
          seen.set(charId, existing);
        }
      }
      // Do NOT overwrite the family relationship label with the fictional_relationships label
      continue;
    }

    seen.set(key, {
      person_name: name,
      relationship_type: rel.relationship_type || null,
      relationship_family: normalizeRelationshipType(rel.relationship_type),
      description: rel.description || '',
      history_summary: rel.history_summary || '',
      last_interaction_summary: rel.last_interaction_summary || '',
      emotional_impact: rel.emotional_impact || '',
      current_status: rel.current_status || '',
      romantic_level: rel.romantic_level || 0,
      friendship_level: rel.friendship_level || 0,
      related_character_id: charId,
      avatar_url: null,
      _source: 'fictional_relationships',
      _linkage: charId ? 'linked' : 'name_only',
      _matched_character_id: null,
      _avatar_source: null,
    });
  }

  // ── SOURCE 3: people_in_world / known_people ─────────────────────────────────
  const peopleInWorld = character.people_in_world || character.known_people || [];
  for (const p of peopleInWorld) {
    const name = p.name || p.person_name;
    if (!name) continue;
    if (isUserSelf(p)) {
      console.log(`[ContactsResolver] EXCLUDED (user-self) people_in_world entry: "${name}"`);
      continue;
    }

    const charId = p.related_character_id || p.character_id || null;
    const existing = findExistingEntry(charId, name);
    if (existing) {
      // Upgrade ID linkage only
      if (charId && !existing.related_character_id) {
        existing.related_character_id = charId;
        existing._linkage = 'linked';
      }
      continue;
    }

    const key = makeKey(charId, name);
    if (!key) continue;
    seen.set(key, {
      person_name: name,
      relationship_type: p.relationship_type || 'Known',
      relationship_family: normalizeRelationshipType(p.relationship_type),
      description: p.description || '',
      history_summary: '',
      last_interaction_summary: '',
      emotional_impact: '',
      current_status: p.current_status || '',
      romantic_level: 0,
      friendship_level: p.friendship_level || 30,
      related_character_id: charId,
      avatar_url: null,
      _source: 'people_in_world',
      _linkage: charId ? 'linked' : 'name_only',
      _matched_character_id: null,
      _avatar_source: null,
    });
  }

  // Early return without DB queries if no ownerEmail
  if (!ownerEmail) {
    return _finalizeAndSort(seen, familyInlineAvatars);
  }

  // ── SINGLE FETCH: all owner Characters in one call ───────────────────────────
  const allOwnerChars = await base44.entities.Character.filter(
    { owner_email: ownerEmail, status: 'active' },
    null, 200
  ).catch(() => []);

  const charById = new Map(allOwnerChars.map(c => [c.id, c]));
  const charByName = new Map(allOwnerChars.map(c => [c.name?.trim().toLowerCase(), c]));

  // ── AVATAR HYDRATION: by related_character_id (for all sources so far) ───────
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
  // Adds characters from green-channel conversations not already in the contact list.
  // Also fetches shared/system NPCs not in the owner-scoped character list.
  // CRITICAL: relationship label here is NOT based on npc_family_member character type.
  //   It uses actual pair-specific relationship data only. npc_family_member type simply
  //   means that character IS a family member type — it does NOT mean they are family to
  //   the viewed character unless the viewed character's own relationship data says so.
  const existingConvos = await base44.entities.Conversation.filter(
    { owner_email: ownerEmail, character_ids: [character.id] },
    '-updated_date', 150
  ).catch(() => []);

  const allConvoLinkedIds = new Set(
    existingConvos.flatMap(c => [
      ...(c.character_ids || []),
      ...(c.participant_character_ids || []),
    ]).filter(id => id !== character.id)
  );

  // Fetch any participant characters NOT found in the owner-scoped allOwnerChars
  const missingIds = [...allConvoLinkedIds].filter(id => !charById.has(id));
  if (missingIds.length > 0) {
    const missingResults = await Promise.all(
      missingIds.map(id => base44.entities.Character.filter({ id }).catch(() => []))
    );
    missingResults.forEach(records => {
      if (records[0]) charById.set(records[0].id, records[0]);
    });
  }

  for (const id of allConvoLinkedIds) {
    const lc = charById.get(id);
    if (!lc) continue;
    const av = bestAvatar(lc);

    const existing = findExistingEntry(lc.id, lc.name);
    if (existing) {
      // Already in list — hydrate avatar only, never overwrite relationship label
      if (!existing.avatar_url && av) {
        existing.avatar_url = av;
        existing._matched_character_id = lc.id;
        existing._avatar_source = 'conversation_linked_record';
      }
      // Upgrade ID linkage if the existing entry was name-only
      if (!existing.related_character_id) {
        existing.related_character_id = lc.id;
        existing._linkage = 'linked_from_conversation';
        // Re-key the map entry from name-based to ID-based
        const oldKey = `name:${lc.name?.trim().toLowerCase()}`;
        if (seen.has(oldKey)) {
          seen.delete(oldKey);
          seen.set(lc.id, existing);
        }
      }
      continue;
    }

    // New contact from conversation — only green-channel
    if (isUserSelf({ owner_user_id: lc.owner_user_id, email: lc.owner_email, is_user: lc.is_user })) {
      console.log(`[ContactsResolver] EXCLUDED (user-self) conversation-linked entry: "${lc.name}"`);
      continue;
    }

    const hasGreenConvo = existingConvos.some(c => {
      const isGreen = c.channel === 'world_phone' || c.type === 'npc' || c.type === 'bilateral';
      if (!isGreen) return false;
      return (c.character_ids || []).includes(lc.id) ||
             (c.participant_character_ids || []).includes(lc.id);
    });
    if (!hasGreenConvo) continue;

    // RELATIONSHIP LABEL: determined from pair-specific data ONLY.
    // npc_family_member character type = that character's own category, NOT their
    // relationship to the viewed character. Use 'Contact' as neutral default.
    // The only exception: if this character appears in the viewed character's
    // family_members list (handled in SOURCE 1 above) — but that already added them
    // with the correct label, so we would have found them in findExistingEntry above.
    const relLabel = lc.character_type === 'npc_fictitious' ? 'Known Contact'
      : lc.character_type === 'npc_regular' ? 'Contact'
      : lc.character_type === 'npc_family_member' ? 'Contact'  // NOT 'Family' — pair-specific only
      : 'Contact';

    seen.set(lc.id, {
      person_name: lc.name,
      relationship_type: relLabel,
      relationship_family: normalizeRelationshipType(relLabel),
      description: lc.profile_summary || lc.backstory || '',
      history_summary: '',
      last_interaction_summary: '',
      emotional_impact: '',
      current_status: lc.current_activity || '',
      romantic_level: 0,
      friendship_level: 30,
      related_character_id: lc.id,
      avatar_url: av || null,
      _source: 'conversation_linked',
      _linkage: 'linked_from_conversation',
      _matched_character_id: lc.id,
      _avatar_source: av ? 'conversation_linked_record' : null,
    });
  }

  // ── AVATAR HYDRATION: exact name match for still-unhydrated entries ──────────
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
      `[ContactsResolver] name="${c.person_name}" | rel="${c.relationship_type}" | source=${c._source} | ` +
      `id=${c.related_character_id || 'none'} | avatar=${c.avatar_url ? 'YES' : 'NO'} | ` +
      `linkage=${c._linkage}`
    );
  });

  return result;
}

function _finalizeAndSort(seen, familyInlineAvatars) {
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