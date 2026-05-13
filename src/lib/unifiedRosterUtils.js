/**
 * Unified Roster — Global Canonical Identity System
 *
 * ARCHITECTURE CONTRACT:
 * Every entry in the roster has:
 *   - canonical_person_id: a real Character.id (or '__user__') — NEVER a synthetic string
 *   - source_record_ids: all duplicate Character records collapsed into this entry
 *   - entity_type: 'user' | 'character' | 'unresolved_family'
 *   - image_generation_target_id: the Character.id to pass to image gen (null if unresolved)
 *   - memory_target_id: same as canonical_person_id
 *   - relationship_target_id: same as canonical_person_id
 *   - image_generation_blocked: true if this entry has no stable Character.id (unresolved)
 *
 * DEDUP RULE:
 * When multiple Character records share a name, pick the canonical using the priority chain:
 *   1. _linked_character_id reference from a family_members[] entry (most explicit)
 *   2. related_character_id reference from fictional_relationships[]
 *   3. active_created_character type
 *   4. npc_fictitious type
 *   5. npc_family_member type
 *   6. npc_regular type
 *   7. oldest created_date (most established record)
 * All non-canonical same-name records are collected into source_record_ids.
 *
 * FAMILY MEMBER RULE:
 * - If fm._linked_character_id points to a live Character → use that Character as the entry
 * - If fm._linked_character_id is missing but a Character with matching name exists → use that Character
 * - If no Character exists for this name → entry is unresolved, image_generation_blocked: true
 *
 * SYNTHETIC ID RULE:
 * NO entry may have canonical_person_id = `family_${...}` or `world_${...}`.
 * Those are display-only placeholders and are explicitly blocked from image generation.
 */

export function getPlaceholderColor() { return 'bg-purple-500'; }
export function getInitial(name) { return name?.[0]?.toUpperCase() || '?'; }

/**
 * Priority score for character_type — lower = higher priority canonical choice
 */
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

/**
 * Build a canonical roster entry from a resolved Character record.
 * source_record_ids: all duplicate Character.ids collapsed into this canonical entry.
 */
function buildCharacterEntry(char, sourceRecordIds = []) {
  return {
    // ── CANONICAL IDENTITY ────────────────────────────────────────────────
    id: char.id,                        // picker key (always canonical Character.id)
    canonical_person_id: char.id,       // explicit canonical ID
    source_record_ids: [char.id, ...sourceRecordIds.filter(id => id !== char.id)],

    // ── ROUTING TARGETS (all point to same canonical record) ──────────────
    image_generation_target_id: char.id,
    memory_target_id: char.id,
    relationship_target_id: char.id,
    avatar_source_id: char.id,

    // ── DISPLAY DATA ──────────────────────────────────────────────────────
    name: char.name || 'Unknown',
    avatar_url: char.avatar_url || null,
    entity_type: 'character',
    character_type: char.character_type || null,
    is_user: false,
    is_active_character: char.is_active_character || false,
    status: char.status || null,
    created_date: char.created_date || null,

    // ── GENERATION REFS ───────────────────────────────────────────────────
    reference_image_urls: char.reference_image_urls || [],
    appearance_notes: char.appearance_notes || '',
    age_range: char.age_range || '',
    gender: char.gender || '',
    ethnicities: char.ethnicities || [],
    appearance_lock: char.appearance_lock || null,

    // ── RESOLUTION STATE ──────────────────────────────────────────────────
    image_generation_blocked: false,
    resolution_source: 'character_entity',
  };
}

/**
 * Build an UNRESOLVED family member entry.
 * These entries are display-only. image_generation_blocked = true.
 * They MUST NOT be passed to image generation as a subject ID.
 */
function buildUnresolvedFamilyEntry(fm, sourceCharId, sourceCharName) {
  return {
    // ── IDENTITY — explicitly unresolved ─────────────────────────────────
    id: `unresolved_family_${fm.name.trim().toLowerCase().replace(/\s+/g, '_')}`,
    canonical_person_id: null,          // NO stable ID — unresolved
    source_record_ids: [],

    // ── ROUTING TARGETS — all null/blocked ────────────────────────────────
    image_generation_target_id: null,
    memory_target_id: null,
    relationship_target_id: null,
    avatar_source_id: null,

    // ── DISPLAY DATA ──────────────────────────────────────────────────────
    name: fm.name,
    avatar_url: fm.photo_url || null,
    entity_type: 'unresolved_family',
    character_type: null,
    is_user: false,
    is_active_character: false,
    status: null,
    created_date: null,

    // ── GENERATION REFS ───────────────────────────────────────────────────
    reference_image_urls: fm.photo_url ? [fm.photo_url] : [],
    appearance_notes: fm.relationship_type || '',
    age_range: '',
    gender: '',
    ethnicities: [],
    appearance_lock: null,

    // ── RESOLUTION STATE — HARD BLOCK ────────────────────────────────────
    image_generation_blocked: true,     // MUST NOT be passed to image gen
    resolution_source: 'unresolved_family_member',
    unresolved_source_character_id: sourceCharId,
    unresolved_source_character_name: sourceCharName,
  };
}

/**
 * GLOBAL CANONICAL RESOLVER
 *
 * Resolves a family member name to a canonical Character.id using the resolution chain:
 *   1. fm._linked_character_id → look up live Character by ID
 *   2. fictional_relationships[].related_character_id where person_name matches
 *   3. Name match against all live Character records (type priority tiebreak)
 *
 * Returns the canonical Character record or null if unresolvable.
 */
function resolveCanonicalCharacterForName(name, linkedCharId, allLiveChars, allFictionalRels) {
  if (!name?.trim()) return null;
  const nameKey = name.trim().toLowerCase();

  // Step 1: Trust explicit linked_character_id
  if (linkedCharId) {
    const linked = allLiveChars.find(c => c.id === linkedCharId);
    if (linked) return linked;
  }

  // Step 2: Check fictional_relationships for a related_character_id match on this name
  for (const rel of allFictionalRels) {
    if (
      rel.person_name?.trim().toLowerCase() === nameKey &&
      rel.related_character_id
    ) {
      const relChar = allLiveChars.find(c => c.id === rel.related_character_id);
      if (relChar) return relChar;
    }
  }

  // Step 3: Name match with type-priority tiebreak
  const matches = allLiveChars.filter(c => c.name?.trim().toLowerCase() === nameKey);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Multiple matches — pick canonical by type priority, then oldest created_date
  return matches.sort((a, b) => {
    const pDiff = typePriority(a.character_type) - typePriority(b.character_type);
    if (pDiff !== 0) return pDiff;
    return new Date(a.created_date || 0) - new Date(b.created_date || 0);
  })[0];
}

/**
 * MAIN EXPORT: fetchUnifiedRoster
 *
 * Returns a roster of canonical person entries. Every entry with a real Character.id
 * is fully routable for image generation, memory, and relationships.
 * Unresolved entries are explicitly marked and blocked from generation.
 */
export async function fetchUnifiedRoster(base44, userEmail) {
  if (!userEmail) return [];

  const ADMIN_EMAIL = 'murqart@gmail.com';
  const isAdmin = userEmail === ADMIN_EMAIL;

  const [user, settingsList, all] = await Promise.all([
    base44.auth.me().catch(() => null),
    base44.entities.UserSettings.filter({ owner_email: userEmail }).catch(() => []),
    isAdmin
      ? base44.entities.Character.list('-created_date', 200).catch(() => [])
      : base44.entities.Character.filter({ owner_email: userEmail }, '-created_date', 200).catch(() => []),
  ]);

  const settings = Array.isArray(settingsList) ? settingsList[0] : settingsList || {};

  // Live characters only (no deleted/merged)
  const liveChars = all.filter(c =>
    c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
  );

  // Collect ALL fictional_relationships from all live chars for cross-reference resolution
  const allFictionalRels = liveChars.flatMap(c => c.fictional_relationships || []);

  // ── USER ENTITY ──────────────────────────────────────────────────────────
  const userWorldName = settings?.fictional_world_name || user?.full_name || 'You';
  const userDisplayAvatar = user?.generated_avatar_urls?.[0]
    || settings?.generated_avatar_urls?.[0]
    || user?.reference_image_urls?.[0]
    || settings?.reference_image_urls?.[0]
    || null;
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
    image_generation_blocked: false,
    resolution_source: 'user_settings',
  } : null;

  // ── CANONICAL CHARACTER DEDUP ────────────────────────────────────────────
  // Group all live Character records by normalized name.
  // For each group, pick canonical using type priority + oldest date.
  // Collect all other record IDs as source_record_ids on the canonical entry.
  const charsByName = new Map(); // normalized name → [Character, ...]

  liveChars.forEach(c => {
    if (!c.name?.trim()) return;
    const key = c.name.trim().toLowerCase();
    if (!charsByName.has(key)) charsByName.set(key, []);
    charsByName.get(key).push(c);
  });

  const canonicalEntries = []; // final deduplicated character entries
  const canonicalById = new Map(); // Character.id → canonical entry (for quick lookup)
  const resolvedNames = new Set(); // normalized names that have a canonical Character entry

  charsByName.forEach((records, nameKey) => {
    // Pick canonical: type priority, then oldest created_date
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
    // Also map duplicate IDs → same entry (so they resolve to the same canonical)
    duplicateIds.forEach(id => canonicalById.set(id, entry));
    resolvedNames.add(nameKey);
  });

  // Sort: active characters first (by created_date desc), then inactive
  const activeEntries = canonicalEntries
    .filter(e => e.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
  const inactiveEntries = canonicalEntries
    .filter(e => !e.is_active_character)
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));

  // ── FAMILY MEMBERS — resolve to canonical or flag as unresolved ──────────
  // Collect all family_members[] entries across all live chars.
  // For each unique name not already in resolvedNames:
  //   - Try to resolve to a canonical Character via the resolution chain
  //   - If resolved: add the canonical Character entry (if not already in roster)
  //   - If unresolved: add an explicit unresolved entry (image_generation_blocked: true)
  const familyResolved = new Map(); // nameKey → canonical entry or unresolved entry (one per name)

  liveChars.forEach(char => {
    (char.family_members || []).forEach(fm => {
      if (!fm.name?.trim()) return;
      if (fm.name.toLowerCase().includes('unnamed')) return;
      if (fm._is_user) return; // user self-entry, skip

      const nameKey = fm.name.trim().toLowerCase();
      if (familyResolved.has(nameKey)) return; // already processed

      if (resolvedNames.has(nameKey)) {
        // Already in the canonical character roster — no separate entry needed
        familyResolved.set(nameKey, 'already_in_roster');
        return;
      }

      // Try to resolve via resolution chain
      const resolved = resolveCanonicalCharacterForName(
        fm.name,
        fm._linked_character_id || null,
        liveChars,
        allFictionalRels
      );

      if (resolved) {
        // Found a Character — add it to canonical roster if not already there
        const existingEntry = canonicalById.get(resolved.id);
        if (existingEntry) {
          // Already in roster under a different name key — mark as resolved
          familyResolved.set(nameKey, 'already_in_roster');
        } else {
          // This Character exists but wasn't in resolvedNames (edge case: different name stored)
          const entry = buildCharacterEntry(resolved, []);
          familyResolved.set(nameKey, entry);
          canonicalById.set(resolved.id, entry);
          resolvedNames.add(nameKey);
        }
      } else {
        // Unresolved — no Character record exists, create display-only blocked entry
        const entry = buildUnresolvedFamilyEntry(fm, char.id, char.name);
        familyResolved.set(nameKey, entry);
      }
    });
  });

  // Collect extra resolved + unresolved entries (those not already in canonical character lists)
  const extraEntries = [];
  familyResolved.forEach((entry, nameKey) => {
    if (entry === 'already_in_roster') return;
    // Avoid adding if canonical_person_id is already in canonicalById
    if (entry.canonical_person_id && canonicalById.has(entry.canonical_person_id)) return;
    extraEntries.push(entry);
  });

  // ── UNIFIED ROSTER ───────────────────────────────────────────────────────
  const roster = [
    ...(userEntry ? [userEntry] : []),
    ...activeEntries,
    ...inactiveEntries,
    ...extraEntries,
  ];

  return roster;
}

/**
 * For backward compatibility — returns user + character entries only (no unresolved family)
 */
export async function fetchCharacterListForPicker(base44, userEmail) {
  const roster = await fetchUnifiedRoster(base44, userEmail);
  return roster.filter(e => e.entity_type === 'user' || e.entity_type === 'character');
}