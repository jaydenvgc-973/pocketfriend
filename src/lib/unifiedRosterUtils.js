/**
 * Unified Roster — Read-Only Canonical Identity Surface
 *
 * ARCHITECTURE CONTRACT:
 * fetchUnifiedRoster is a READ-ONLY operation.
 * It NEVER calls Character.create.
 * It NEVER writes to any entity.
 * It NEVER invents IDs or resolves by name alone.
 *
 * It calls resolveCanonicalPerson in "read" mode only, which:
 *   - returns a resolved canonical_person_id if confidence ≥ 0.70
 *   - returns needs_review diagnostics if confidence < 0.70
 *
 * Entries in the roster have a real Character.id as canonical_person_id.
 * Entries that could not be resolved appear in repairDiagnostics[], NOT in the roster.
 *
 * Character creation is ONLY allowed through resolveCanonicalPerson in
 * "create_if_confident" mode, called explicitly from FamilyEditor after a user action.
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
    avatar_description_text: char.avatar_description_text || null, // vision-analyzed description
    age_range: char.age_range || '',
    gender: char.gender || '',
    ethnicities: char.ethnicities || [],
    appearance_lock: char.appearance_lock || null,
    character_closet: char.character_closet || [],    // needed for outfit resolution in pickers
    current_outfit: char.current_outfit || null,       // needed for current outfit fallback
    resolution_source: 'character_entity',
  };
}

/**
 * MAIN EXPORT: fetchUnifiedRoster
 *
 * READ-ONLY. No Character.create. No entity writes.
 *
 * Returns {
 *   roster: array of resolved roster entries (canonical_person_id = real Character.id),
 *   repairDiagnostics: array of unresolved people with confidence scores and evidence,
 * }
 *
 * repairDiagnostics entries have:
 *   { name, source_type, source_character_id, confidence, matched_evidence, failure_reason }
 *
 * Callers that need to CREATE missing characters must call resolveCanonicalPerson directly
 * with mode="create_if_confident" — never from inside a list/picker render.
 */
export async function fetchUnifiedRoster(base44, userEmail) {
  if (!userEmail) return { roster: [], repairDiagnostics: [] };

  const [user, settingsList, all] = await Promise.all([
    base44.auth.me().catch(() => null),
    base44.entities.UserSettings.filter({ owner_email: userEmail }).catch(() => []),
    base44.entities.Character.filter({ owner_email: userEmail }, '-created_date', 200).catch(() => []),
  ]);

  const settings = Array.isArray(settingsList) ? settingsList[0] : (settingsList || {});

  // Live characters only — never hide legacy characters (no newer-field requirements)
  const liveChars = all.filter(c =>
    c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
  );

  const repairDiagnostics = [];

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
  const canonicalById = new Map();    // Character.id → canonical entry
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

  // ── RELATIONSHIP LINKAGE — ensure linked liveChars are in roster ─────────
  // RULE: The roster is built exclusively from liveChars (real Character DB records
  // scoped to owner_email). Relationship edges (family_members, fictional_relationships)
  // are used ONLY to ensure an already-existing liveChar is not missed.
  // Name-only strings with no related_character_id are NEVER added to the roster.
  // No resolveCanonicalPerson, no name-based injection, no cross-account bleed.

  for (const char of liveChars) {
    // Family members with a linked character ID
    for (const fm of (char.family_members || [])) {
      const linkedId = fm._linked_character_id || fm.character_id;
      if (!linkedId) continue;
      const linkedChar = liveChars.find(c => c.id === linkedId);
      if (linkedChar && !canonicalById.has(linkedChar.id)) {
        const entry = buildCharacterEntry(linkedChar, []);
        canonicalEntries.push(entry);
        canonicalById.set(linkedChar.id, entry);
        resolvedNameKeys.add(linkedChar.name.trim().toLowerCase());
      }
    }
    // Fictional relationships with a linked character ID
    for (const rel of (char.fictional_relationships || [])) {
      if (!rel.related_character_id) continue;
      const linkedChar = liveChars.find(c => c.id === rel.related_character_id);
      if (linkedChar && !canonicalById.has(linkedChar.id)) {
        const entry = buildCharacterEntry(linkedChar, []);
        canonicalEntries.push(entry);
        canonicalById.set(linkedChar.id, entry);
        resolvedNameKeys.add(linkedChar.name.trim().toLowerCase());
      }
    }
  }

  // ── UNIFIED ROSTER — deduplicate by canonical_person_id ──────────────────
  // Using canonical_person_id as the dedup key prevents the same logical "person"
  // from appearing twice even when multiple Character DB records resolve to them.
  const seenCanonicalIds = new Set();
  const deduped = [];
  for (const entry of canonicalEntries) {
    const key = entry.canonical_person_id || entry.id;
    if (!seenCanonicalIds.has(key)) {
      seenCanonicalIds.add(key);
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

  return { roster, repairDiagnostics };
}

/**
 * Convenience wrapper — returns just the roster array (backward compat).
 * Logs repair diagnostics to console so they're visible during development.
 * Note: repairDiagnostics are NOT failures — they are people that need a
 * higher-confidence resolution before they can be linked or created.
 */
export async function fetchUnifiedRosterArray(base44, userEmail) {
  const { roster, repairDiagnostics } = await fetchUnifiedRoster(base44, userEmail);
  if (repairDiagnostics.length > 0) {
    console.warn('[unifiedRoster] Unresolved people (needs_review — no creation performed):', repairDiagnostics);
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