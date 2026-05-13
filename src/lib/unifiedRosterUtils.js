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

import { resolveCanonicalPerson } from './canonicalPersonResolver.js';

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

  // Live characters only — never hide legacy characters (no newer-field requirements)
  const liveChars = all.filter(c =>
    c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
  );

  // Aggregate all fictional_relationships for cross-reference scoring.
  // Tag each entry with _source_character_id so the scorer can verify independence
  // (two refs are "independent" only if they come from different source characters).
  const allFictionalRels = liveChars.flatMap(c =>
    (c.fictional_relationships || []).map(rel => ({ ...rel, _source_character_id: c.id }))
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

  // ── FAMILY MEMBERS — read-only resolution pass ───────────────────────────
  // For each family member not already in the canonical roster:
  //   Call resolveCanonicalPerson in "read" mode.
  //   If resolved (confidence ≥ 0.70): add to roster.
  //   If needs_review (confidence < 0.70): add to repairDiagnostics. Do NOT create.
  //
  // NO Character.create here. NO writes here.

  const processedFamilyNames = new Set();

  for (const char of liveChars) {
    const members = char.family_members || [];
    for (const fm of members) {
      if (!fm.name?.trim()) continue;
      if (fm._is_user) continue;
      if (fm.name.toLowerCase().includes('unnamed')) continue;

      const nameKey = fm.name.trim().toLowerCase();
      if (resolvedNameKeys.has(nameKey)) continue;
      if (processedFamilyNames.has(nameKey)) continue;
      processedFamilyNames.add(nameKey);

      const result = await resolveCanonicalPerson({
        owner_email: userEmail,
        name: fm.name,
        linked_character_id: fm._linked_character_id || null,
        source_type: 'family_member',
        source_record_id: fm._member_id || null,
        source_character_id: char.id,
        relationship_context: fm.relationship_type || null,
        avatar_url: fm.photo_url || null,
        mode: 'read',  // READ ONLY — no creates, no writes
        all_live_characters: liveChars,
        all_fictional_rels: allFictionalRels,
        base44,
      });

      if (result.status === 'resolved' || result.status === 'repaired') {
        const resolvedChar = liveChars.find(c => c.id === result.canonical_person_id);
        if (resolvedChar && !canonicalById.has(resolvedChar.id)) {
          const entry = buildCharacterEntry(resolvedChar, result.source_record_ids);
          canonicalEntries.push(entry);
          canonicalById.set(resolvedChar.id, entry);
          resolvedNameKeys.add(resolvedChar.name.trim().toLowerCase());
        }
      } else {
        // needs_review — log diagnostic, do not add to roster, do not create
        repairDiagnostics.push({
          name: fm.name,
          source_type: 'family_member',
          source_character_id: char.id,
          source_character_name: char.name,
          confidence: result.confidence,
          matched_evidence: result.matched_evidence,
          failure_reason: result.failure_reason,
        });
      }
    }
  }

  // ── FICTIONAL RELATIONSHIPS — read-only resolution pass ──────────────────
  // For each fictional_relationship with a person_name but no related_character_id:
  //   Call resolveCanonicalPerson in "read" mode.
  //   If resolved: ensure the character is in the roster.
  //   If needs_review: add to repairDiagnostics. Do NOT create.
  //   A fictional relationship edge is NOT automatically a new person record.
  //
  // For entries that already have related_character_id: ensure that Character is in roster.

  for (const char of liveChars) {
    const rels = char.fictional_relationships || [];

    for (const rel of rels) {
      // Already linked — ensure target is in roster
      if (rel.related_character_id) {
        const linkedChar = liveChars.find(c => c.id === rel.related_character_id);
        if (linkedChar && !canonicalById.has(linkedChar.id)) {
          const entry = buildCharacterEntry(linkedChar, []);
          canonicalEntries.push(entry);
          canonicalById.set(linkedChar.id, entry);
          resolvedNameKeys.add(linkedChar.name.trim().toLowerCase());
        }
        continue;
      }

      if (!rel.person_name?.trim()) continue;

      const nameKey = rel.person_name.trim().toLowerCase();
      if (resolvedNameKeys.has(nameKey)) continue;

      const result = await resolveCanonicalPerson({
        owner_email: userEmail,
        name: rel.person_name,
        related_character_id: rel.related_character_id || null,
        source_type: 'fictional_relationship',
        source_character_id: char.id,
        relationship_context: rel.relationship_type || null,
        avatar_url: rel.photo_url || rel.avatar_url || null,
        mode: 'read',  // READ ONLY — no creates, no writes
        all_live_characters: liveChars,
        all_fictional_rels: allFictionalRels,
        base44,
      });

      if (result.status === 'resolved' || result.status === 'repaired') {
        const resolvedChar = liveChars.find(c => c.id === result.canonical_person_id);
        if (resolvedChar && !canonicalById.has(resolvedChar.id)) {
          const entry = buildCharacterEntry(resolvedChar, result.source_record_ids);
          canonicalEntries.push(entry);
          canonicalById.set(resolvedChar.id, entry);
          resolvedNameKeys.add(resolvedChar.name.trim().toLowerCase());
        }
      } else {
        // Fictional relationship person with no confident match — log diagnostic, skip
        // This is correct: a relationship edge is NOT automatically a new person record.
        repairDiagnostics.push({
          name: rel.person_name,
          source_type: 'fictional_relationship',
          source_character_id: char.id,
          source_character_name: char.name,
          confidence: result.confidence,
          matched_evidence: result.matched_evidence,
          failure_reason: result.failure_reason,
        });
      }
    }
  }

  // ── UNIFIED ROSTER ───────────────────────────────────────────────────────
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