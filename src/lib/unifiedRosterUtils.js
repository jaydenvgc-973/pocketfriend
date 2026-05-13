/**
 * Unified Roster — Global Canonical Identity System
 *
 * ARCHITECTURE CONTRACT:
 * Every person entry in the roster has a real Character.id (or '__user__') as
 * canonical_person_id. Synthetic IDs are NEVER valid roster entries.
 *
 * RESOLVE-BEFORE-BUILD RULE:
 * Any family member, fictional relationship person, or world contact that lacks a
 * stable Character.id is resolved (or created) BEFORE the roster is returned.
 * The roster is always the final clean surface — no synthetic IDs ever reach it.
 *
 * REPAIR TRANSPARENCY:
 * If resolution fails (RLS, missing data, SDK error), the failure is recorded in
 * repairFailures[] and returned alongside the roster so callers can surface it.
 *
 * DEDUP RULE (for Character entities that already exist):
 * When multiple Character records share a name, pick canonical using:
 *   1. active_created_character type  (priority 0)
 *   2. npc_fictitious type            (priority 1)
 *   3. npc_family_member type         (priority 2)
 *   4. npc_regular type               (priority 3)
 *   5. oldest created_date (tiebreak)
 * All non-canonical same-name records are listed in source_record_ids.
 */

export function getPlaceholderColor() { return 'bg-purple-500'; }
export function getInitial(name) { return name?.[0]?.toUpperCase() || '?'; }

/** Priority score for character_type — lower = higher priority canonical choice */
function typePriority(characterType) {
  const map = {
    'active_created_character': 0,
    'active': 0,
    'npc_fictitious': 1,
    'npc_family_member': 2,
    'family_npc': 2,
    'npc_regular': 3,
    'npc': 3,
  };
  return map[characterType] ?? 99;
}

/** Build a fully resolved roster entry from a canonical Character record. */
function buildCharacterEntry(char, sourceRecordIds = []) {
  return {
    id: char.id,
    canonical_person_id: char.id,
    source_record_ids: [char.id, ...sourceRecordIds.filter(id => id !== char.id)],
    image_generation_target_id: char.id,
    memory_target_id: char.id,
    relationship_target_id: char.id,
    avatar_source_id: char.id,
    name: char.name || 'Unknown',
    avatar_url: char.avatar_url || null,
    entity_type: 'character',
    character_type: char.character_type || null,
    is_user: false,
    is_active_character: char.is_active_character || false,
    status: char.status || null,
    created_date: char.created_date || null,
    reference_image_urls: char.reference_image_urls || [],
    appearance_notes: char.appearance_notes || '',
    age_range: char.age_range || '',
    gender: char.gender || '',
    ethnicities: char.ethnicities || [],
    appearance_lock: char.appearance_lock || null,
    resolution_source: 'character_entity',
  };
}

/**
 * Resolve a person name to an existing Character record from liveChars.
 * Resolution chain (read-only, no writes):
 *   1. explicit linkedCharId → look up live Character by ID
 *   2. fictional_relationships[].related_character_id where person_name matches
 *   3. Name match against all live Characters (type priority tiebreak)
 * Returns the Character record or null.
 */
function resolveExistingCharacter(name, linkedCharId, allLiveChars, allFictionalRels) {
  if (!name?.trim()) return null;
  const nameKey = name.trim().toLowerCase();

  // Step 1: Trust explicit linked_character_id
  if (linkedCharId) {
    const linked = allLiveChars.find(c => c.id === linkedCharId);
    if (linked && linked.status !== 'deleted' && linked.status !== 'soft_deleted') return linked;
  }

  // Step 2: Check fictional_relationships cross-references
  for (const rel of allFictionalRels) {
    if (rel.person_name?.trim().toLowerCase() === nameKey && rel.related_character_id) {
      const relChar = allLiveChars.find(c => c.id === rel.related_character_id);
      if (relChar) return relChar;
    }
  }

  // Step 3: Name match with type-priority tiebreak
  const matches = allLiveChars.filter(c => c.name?.trim().toLowerCase() === nameKey);
  if (matches.length === 0) return null;
  return matches.sort((a, b) => {
    const pDiff = typePriority(a.character_type) - typePriority(b.character_type);
    if (pDiff !== 0) return pDiff;
    return new Date(a.created_date || 0) - new Date(b.created_date || 0);
  })[0];
}

/**
 * Resolve or create a canonical Character record for a named person.
 * - Tries resolution chain first (no write if already exists).
 * - If no match: creates a new npc_family_member Character record.
 * - Writes _linked_character_id back to the source family member entry on the parent Character.
 *
 * Returns { character, created, error } where character is the resolved/created record.
 */
async function resolveOrCreate({
  name,
  linkedCharId,
  photoUrl,
  relationshipType,
  ownerEmail,
  ownerUserId,
  userRole,
  parentCharId,       // Character whose family_members[] contains this entry
  memberIndex,        // Index in family_members[] for writeback
  allLiveChars,
  allFictionalRels,
  base44,
}) {
  // First: try to find an existing record without any writes
  const existing = resolveExistingCharacter(name, linkedCharId, allLiveChars, allFictionalRels);
  if (existing) {
    // Write back _linked_character_id if the parent family member entry is missing it
    if (parentCharId && memberIndex !== null && memberIndex !== undefined && !linkedCharId) {
      try {
        const parentChar = allLiveChars.find(c => c.id === parentCharId);
        if (parentChar?.family_members) {
          const updatedMembers = parentChar.family_members.map((fm, i) =>
            i === memberIndex ? { ...fm, _linked_character_id: existing.id } : fm
          );
          await base44.entities.Character.update(parentCharId, { family_members: updatedMembers });
          // Patch in-memory so subsequent uses in this roster build see the link
          parentChar.family_members = updatedMembers;
        }
      } catch (writebackErr) {
        // Non-fatal: writeback failed but resolution succeeded — log and continue
        console.warn('[unifiedRoster] _linked_character_id writeback failed:', writebackErr.message);
      }
    }
    return { character: existing, created: false, error: null };
  }

  // No existing record found — create a new npc_family_member
  try {
    if (!ownerEmail || !ownerUserId) {
      return {
        character: null,
        created: false,
        error: `Cannot create Character for "${name}": ownerEmail or ownerUserId missing`,
      };
    }
    const newChar = await base44.entities.Character.create({
      name: name.trim(),
      character_type: 'npc_family_member',
      owner_email: ownerEmail,
      owner_user_id: ownerUserId,
      created_by_role: userRole || 'user',
      status: 'active',
      is_active_character: false,
      visibility_scope: 'account_private',
      data_scope: 'private_user',
      exclude_from_homepage: true,
      exclude_from_roster: true,
      avatar_url: photoUrl || null,
    });

    // Add to liveChars in-memory so later iterations in this build see it
    allLiveChars.push(newChar);

    // Write back _linked_character_id to parent family member entry
    if (parentCharId && memberIndex !== null && memberIndex !== undefined) {
      try {
        const parentChar = allLiveChars.find(c => c.id === parentCharId);
        if (parentChar?.family_members) {
          const updatedMembers = parentChar.family_members.map((fm, i) =>
            i === memberIndex ? { ...fm, _linked_character_id: newChar.id } : fm
          );
          await base44.entities.Character.update(parentCharId, { family_members: updatedMembers });
          parentChar.family_members = updatedMembers;
        }
      } catch (writebackErr) {
        console.warn('[unifiedRoster] _linked_character_id writeback after create failed:', writebackErr.message);
      }
    }

    return { character: newChar, created: true, error: null };
  } catch (createErr) {
    return {
      character: null,
      created: false,
      error: `Failed to create Character for "${name}": ${createErr.message}`,
    };
  }
}

/**
 * MAIN EXPORT: fetchUnifiedRoster
 *
 * Returns { roster, repairFailures }.
 *
 * roster: array of fully resolved entries — every entry has a real canonical_person_id.
 * repairFailures: array of { name, source, reason } for any person that could not be resolved/created.
 *
 * The roster is always the final clean surface.
 * No synthetic IDs. No blocked entries. No unresolved entries.
 * If a person cannot be resolved, they appear in repairFailures instead.
 */
export async function fetchUnifiedRoster(base44, userEmail) {
  if (!userEmail) return { roster: [], repairFailures: [] };

  const ADMIN_EMAIL = 'murqart@gmail.com';
  const isAdmin = userEmail === ADMIN_EMAIL;

  const [user, settingsList, all] = await Promise.all([
    base44.auth.me().catch(() => null),
    base44.entities.UserSettings.filter({ owner_email: userEmail }).catch(() => []),
    isAdmin
      ? base44.entities.Character.list('-created_date', 200).catch(() => [])
      : base44.entities.Character.filter({ owner_email: userEmail }, '-created_date', 200).catch(() => []),
  ]);

  const settings = Array.isArray(settingsList) ? settingsList[0] : (settingsList || {});
  const ownerUserId = user?.id || null;
  const userRole = user?.role || 'user';

  // Live characters only — never hide legacy characters (no newer-field requirements)
  const liveChars = all.filter(c =>
    c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
  );

  // Collect ALL fictional_relationships from all live chars for cross-reference resolution
  const allFictionalRels = liveChars.flatMap(c => c.fictional_relationships || []);

  const repairFailures = [];

  // ── USER ENTRY ───────────────────────────────────────────────────────────
  const userWorldName = settings?.fictional_world_name || user?.full_name || 'You';
  const userDisplayAvatar =
    user?.generated_avatar_urls?.[0] ||
    settings?.generated_avatar_urls?.[0] ||
    user?.reference_image_urls?.[0] ||
    settings?.reference_image_urls?.[0] ||
    null;
  const userReferenceImages = [
    ...(user?.generated_avatar_urls || []),
    ...(settings?.generated_avatar_urls || []),
    ...(user?.reference_image_urls || []),
    ...(settings?.reference_image_urls || []),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const userEntry = user ? {
    id: '__user__',
    canonical_person_id: '__user__',
    source_record_ids: ['__user__'],
    image_generation_target_id: '__user__',
    memory_target_id: '__user__',
    relationship_target_id: '__user__',
    avatar_source_id: '__user__',
    name: userWorldName,
    world_name: userWorldName,
    avatar_url: userDisplayAvatar,
    entity_type: 'user',
    character_type: null,
    is_user: true,
    is_active_character: false,
    status: null,
    created_date: null,
    reference_image_urls: userReferenceImages,
    all_reference_images: userReferenceImages,
    appearance_notes: user?.appearance_notes || settings?.appearance_notes || '',
    age_range: user?.age_range || settings?.user_age_range || '',
    gender: user?.gender || settings?.user_gender || '',
    ethnicities: user?.ethnicities || [],
    appearance_lock: null,
    resolution_source: 'user_settings',
  } : null;

  // ── CANONICAL CHARACTER DEDUP ────────────────────────────────────────────
  // Group live Character records by normalized name.
  // For each group, pick canonical by type priority + oldest date.
  const charsByName = new Map();
  liveChars.forEach(c => {
    if (!c.name?.trim()) return;
    const key = c.name.trim().toLowerCase();
    if (!charsByName.has(key)) charsByName.set(key, []);
    charsByName.get(key).push(c);
  });

  const canonicalEntries = [];
  const canonicalById = new Map();   // Character.id → canonical entry
  const resolvedNameKeys = new Set(); // normalized names already in canonical roster

  charsByName.forEach((records, nameKey) => {
    const sorted = [...records].sort((a, b) => {
      const pDiff = typePriority(a.character_type) - typePriority(b.character_type);
      if (pDiff !== 0) return pDiff;
      return new Date(a.created_date || 0) - new Date(b.created_date || 0);
    });
    const canonical = sorted[0];
    const duplicateIds = sorted.slice(1).map(c => c.id);
    const entry = buildCharacterEntry(canonical, duplicateIds);
    canonicalEntries.push(entry);
    canonicalById.set(canonical.id, entry);
    duplicateIds.forEach(id => canonicalById.set(id, entry));
    resolvedNameKeys.add(nameKey);
  });

  const activeEntries = canonicalEntries
    .filter(e => e.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  const inactiveEntries = canonicalEntries
    .filter(e => !e.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  // ── FAMILY MEMBERS — resolve-or-create before adding to roster ───────────
  // For each unique family member name not already in the canonical roster:
  //   1. Try to resolve to an existing Character (read-only)
  //   2. If not found: create a new npc_family_member Character record
  //   3. Write _linked_character_id back to the source family_members[] entry
  //   4. Build a real roster entry from the resolved/created Character
  //   5. On failure: record in repairFailures, skip this person from roster

  const processedFamilyNames = new Set(); // normalized names we've already resolved in this pass

  for (const char of liveChars) {
    const members = char.family_members || [];
    for (let idx = 0; idx < members.length; idx++) {
      const fm = members[idx];
      if (!fm.name?.trim()) continue;
      if (fm._is_user) continue;
      if (fm.name.toLowerCase().includes('unnamed')) continue;

      const nameKey = fm.name.trim().toLowerCase();

      // Already in canonical roster (a Character entity exists with this name)
      if (resolvedNameKeys.has(nameKey)) continue;
      // Already resolved in this roster build pass
      if (processedFamilyNames.has(nameKey)) continue;

      processedFamilyNames.add(nameKey);

      const { character, created, error } = await resolveOrCreate({
        name: fm.name,
        linkedCharId: fm._linked_character_id || null,
        photoUrl: fm.photo_url || null,
        relationshipType: fm.relationship_type || null,
        ownerEmail: userEmail,
        ownerUserId,
        userRole,
        parentCharId: char.id,
        memberIndex: idx,
        allLiveChars: liveChars,
        allFictionalRels,
        base44,
      });

      if (error || !character) {
        repairFailures.push({
          name: fm.name,
          source: `family_members[] on Character "${char.name}" (id: ${char.id})`,
          source_object: fm,
          reason: error || 'Unknown resolution failure',
        });
        continue;
      }

      // Add to canonical roster if not already there (creation adds to liveChars in-memory)
      if (!canonicalById.has(character.id)) {
        const entry = buildCharacterEntry(character, []);
        canonicalEntries.push(entry);
        canonicalById.set(character.id, entry);
        resolvedNameKeys.add(character.name.trim().toLowerCase());
        inactiveEntries.push(entry); // npc_family_member is never is_active_character
      }
    }
  }

  // ── FICTIONAL RELATIONSHIPS — resolve related_character_id where missing ──
  // For each fictional_relationship entry with person_name but no related_character_id:
  //   - Run the same resolve-or-create logic
  //   - Write related_character_id back to the source array
  //   - Ensure the Character is in the roster

  for (const char of liveChars) {
    const rels = char.fictional_relationships || [];
    let relsChanged = false;
    const updatedRels = [...rels];

    for (let idx = 0; idx < updatedRels.length; idx++) {
      const rel = updatedRels[idx];
      if (!rel.person_name?.trim()) continue;
      if (rel.related_character_id) {
        // Already has an ID — ensure it's in the roster
        const existing = liveChars.find(c => c.id === rel.related_character_id);
        if (existing && !canonicalById.has(existing.id)) {
          const entry = buildCharacterEntry(existing, []);
          canonicalEntries.push(entry);
          canonicalById.set(existing.id, entry);
          resolvedNameKeys.add(existing.name.trim().toLowerCase());
        }
        continue;
      }

      const nameKey = rel.person_name.trim().toLowerCase();
      // If already resolved in canonical roster, just write back the ID
      const existingEntry = [...canonicalById.values()].find(
        e => e.name?.trim().toLowerCase() === nameKey
      );
      if (existingEntry) {
        updatedRels[idx] = { ...rel, related_character_id: existingEntry.canonical_person_id };
        relsChanged = true;
        continue;
      }

      // Need to resolve or create
      const { character, error } = await resolveOrCreate({
        name: rel.person_name,
        linkedCharId: null,
        photoUrl: rel.photo_url || rel.avatar_url || null,
        relationshipType: rel.relationship_type || null,
        ownerEmail: userEmail,
        ownerUserId,
        userRole,
        parentCharId: null, // writeback handled manually below
        memberIndex: null,
        allLiveChars: liveChars,
        allFictionalRels,
        base44,
      });

      if (error || !character) {
        repairFailures.push({
          name: rel.person_name,
          source: `fictional_relationships[] on Character "${char.name}" (id: ${char.id})`,
          source_object: rel,
          reason: error || 'Unknown resolution failure',
        });
        continue;
      }

      updatedRels[idx] = { ...rel, related_character_id: character.id };
      relsChanged = true;

      if (!canonicalById.has(character.id)) {
        const entry = buildCharacterEntry(character, []);
        canonicalEntries.push(entry);
        canonicalById.set(character.id, entry);
        resolvedNameKeys.add(character.name.trim().toLowerCase());
      }
    }

    // Write back updated fictional_relationships if anything changed
    if (relsChanged) {
      try {
        await base44.entities.Character.update(char.id, { fictional_relationships: updatedRels });
        char.fictional_relationships = updatedRels;
      } catch (writeErr) {
        console.warn('[unifiedRoster] fictional_relationships writeback failed:', writeErr.message);
      }
    }
  }

  // ── UNIFIED ROSTER ───────────────────────────────────────────────────────
  // Deduplicate the final canonicalEntries (in case resolve/create added duplicates)
  const seenIds = new Set();
  const deduped = [];
  for (const entry of canonicalEntries) {
    if (!seenIds.has(entry.id)) {
      seenIds.add(entry.id);
      deduped.push(entry);
    }
  }

  const activeDeduped = deduped
    .filter(e => e.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  const inactiveDeduped = deduped
    .filter(e => !e.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  const roster = [
    ...(userEntry ? [userEntry] : []),
    ...activeDeduped,
    ...inactiveDeduped,
  ];

  return { roster, repairFailures };
}

/**
 * Convenience wrapper — returns just the roster array (backward compat).
 * Logs repair failures to console so they're visible in diagnostics.
 */
export async function fetchUnifiedRosterArray(base44, userEmail) {
  const { roster, repairFailures } = await fetchUnifiedRoster(base44, userEmail);
  if (repairFailures.length > 0) {
    console.warn('[unifiedRoster] Repair failures during roster build:', repairFailures);
  }
  return roster;
}

/**
 * For backward compatibility — returns user + character entries.
 */
export async function fetchCharacterListForPicker(base44, userEmail) {
  const roster = await fetchUnifiedRosterArray(base44, userEmail);
  return roster.filter(e => e.entity_type === 'user' || e.entity_type === 'character');
}