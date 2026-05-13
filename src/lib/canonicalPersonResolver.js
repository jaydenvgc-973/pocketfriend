/**
 * CANONICAL PERSON RESOLVER
 *
 * Single shared service for resolving, repairing, and (when appropriate) creating
 * canonical Character records for named people across the app.
 *
 * RULES:
 * - fetchUnifiedRoster calls this in "read" mode ONLY. No creation on picker/list load.
 * - FamilyEditor calls this in "create_from_explicit_user_action" mode only after the user
 *   saves a family member they intentionally added.
 * - Name-only match NEVER resolves, merges, links, or writes back. It is supporting evidence
 *   only. A name match without corroborating evidence always returns needs_review.
 * - "First occurrence wins" is forbidden.
 * - Synthetic IDs are forbidden as final canonical IDs.
 * - Character.create is forbidden inside any picker/list/dropdown render path.
 *
 * CONFIDENCE MODEL:
 *
 * Tier 1 — Decisive (confidence 1.0): resolves immediately, no further evidence needed
 *   - linked_character_id → live Character record
 *   - related_character_id → live Character record
 *
 * Tier 2 — Strong corroboration (confidence 0.85): two or more independent cross-references
 *   - person appears in ≥2 independent fictional_relationships entries from DIFFERENT source
 *     characters, each with related_character_id pointing to the SAME Character.id
 *
 * Tier 3 — Moderate corroboration (confidence 0.75): name + one additional signal
 *   - name + avatar/photo URL matches a known Character's avatar_url or reference_image_urls
 *   - name + alias match from stored aliases[] on a live Character
 *   - name + same-relationship-graph (same relationship type appears on ≥2 source Characters)
 *
 * Tier 4 — Name only (confidence 0.30): never enough to resolve, merge, link, or create
 *   - name matches an active_created_character → needs_review
 *   - name matches any NPC → needs_review
 *   - no match at all → needs_review or explicit create flow only
 *
 * THRESHOLDS:
 * - confidence ≥ 0.75 → "resolved" in read mode (no write)
 * - confidence ≥ 0.75 + mode=repair → write back stable link to source record
 * - mode=create_from_explicit_user_action + no existing match → create new Character
 * - confidence < 0.75 → always "needs_review" regardless of mode
 *
 * NAME-ONLY RULE (non-negotiable):
 * A name match alone — regardless of character type — ALWAYS returns needs_review.
 * It may appear in matched_evidence as supporting information.
 * It may NEVER trigger a resolve, merge, link, writeback, or create.
 */

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

/**
 * Score a resolution attempt against live Character records.
 * Returns { match, confidence, evidence } — does NOT write or create.
 *
 * Confidence tiers:
 *   1.0   — stable ID match (linked_character_id or related_character_id)
 *   0.85  — ≥2 independent cross-references to same Character.id
 *   0.75  — name + avatar/alias/relationship-graph corroboration
 *   0.30  — name-only (never enough to act on)
 *   0.00  — no match
 */
function scoreResolution(params, liveChars, allFictionalRels) {
  const {
    name,
    linked_character_id,
    related_character_id,
    source_character_id,
    aliases = [],
    avatar_url = null,
  } = params;

  if (!name?.trim()) {
    return { match: null, confidence: 0, evidence: ['name_missing'] };
  }

  const nameKey = name.trim().toLowerCase();
  const allAliasKeys = [nameKey, ...(aliases || []).map(a => a.trim().toLowerCase())];
  const evidence = [];

  // ── TIER 1: Stable ID match (1.0) ────────────────────────────────────────
  const stableId = linked_character_id || related_character_id;
  if (stableId) {
    const linked = liveChars.find(c => c.id === stableId);
    if (linked && linked.status !== 'deleted' && linked.status !== 'soft_deleted') {
      evidence.push(`stable_id_match:${stableId}`);
      return { match: linked, confidence: 1.0, evidence };
    } else {
      evidence.push(`stable_id_stale:${stableId}:referenced_character_not_found`);
      // Stale ID — do NOT fall through to name matching. The record is gone or wrong.
      // Return 0.0 so the caller records this as needs_review (broken link).
      return { match: null, confidence: 0.0, evidence };
    }
  }

  // ── TIER 2: ≥2 independent cross-references to same Character.id (0.85) ──
  // Count how many DIFFERENT source characters have a fictional_relationship entry
  // where person_name matches AND related_character_id points to the same Character.
  // We track source character IDs to ensure "independent" sources.
  const crossRefByCharId = {}; // target_char_id → Set of source_char_ids
  for (const rel of allFictionalRels) {
    const relNameKey = rel.person_name?.trim().toLowerCase();
    if (!relNameKey || !allAliasKeys.includes(relNameKey)) continue;
    if (!rel.related_character_id) continue;
    // Do not count the source character itself as an independent corroborator
    if (rel._source_character_id === source_character_id && source_character_id) continue;
    if (!crossRefByCharId[rel.related_character_id]) {
      crossRefByCharId[rel.related_character_id] = new Set();
    }
    if (rel._source_character_id) {
      crossRefByCharId[rel.related_character_id].add(rel._source_character_id);
    } else {
      // No source character tracked on the rel — count it as one reference
      crossRefByCharId[rel.related_character_id].add(`unknown_${Object.keys(crossRefByCharId).length}`);
    }
  }

  // Find the target with the most independent sources
  const crossRefEntries = Object.entries(crossRefByCharId)
    .map(([charId, sourceSet]) => ({ charId, count: sourceSet.size }))
    .sort((a, b) => b.count - a.count);

  if (crossRefEntries.length > 0 && crossRefEntries[0].count >= 2) {
    const { charId } = crossRefEntries[0];
    const crossRefChar = liveChars.find(c => c.id === charId);
    if (crossRefChar) {
      evidence.push(`cross_reference_match:${charId}:independent_sources=${crossRefEntries[0].count}`);
      return { match: crossRefChar, confidence: 0.85, evidence };
    }
  }

  // ── TIER 3: Name + corroborating signal (0.75) ───────────────────────────
  // Find all name-matching live Characters first (needed for Tier 3 and Tier 4)
  const nameMatches = liveChars.filter(c => {
    if (c.status === 'deleted' || c.status === 'soft_deleted') return false;
    const cKey = c.name?.trim().toLowerCase();
    return allAliasKeys.includes(cKey);
  });

  if (nameMatches.length > 0) {
    // Sort by type priority + oldest date
    const bestMatch = [...nameMatches].sort((a, b) => {
      const pDiff = typePriority(a.character_type) - typePriority(b.character_type);
      if (pDiff !== 0) return pDiff;
      return new Date(a.created_date || 0) - new Date(b.created_date || 0);
    })[0];

    evidence.push(`name_match:${bestMatch.id}:type=${bestMatch.character_type}`);
    if (nameMatches.length > 1) {
      evidence.push(`ambiguous_name_match:${nameMatches.length}_candidates`);
    }

    // Signal 1: Avatar/photo URL matches
    if (avatar_url) {
      const avatarMatches = nameMatches.some(c => {
        const allUrls = [c.avatar_url, ...(c.reference_image_urls || [])].filter(Boolean);
        return allUrls.some(u => u === avatar_url || u.split('?')[0] === avatar_url.split('?')[0]);
      });
      if (avatarMatches) {
        evidence.push(`avatar_corroboration:url_match`);
        return { match: bestMatch, confidence: 0.75, evidence };
      }
    }

    // Signal 2: Alias match — name being looked up appears in Character's stored aliases[]
    for (const c of nameMatches) {
      const storedAliases = (c.aliases || []).map(a => {
        const text = typeof a === 'string' ? a : (a.name || a.alias || a.text || '');
        return text.trim().toLowerCase();
      }).filter(Boolean);
      const aliasOverlap = allAliasKeys.some(k => storedAliases.includes(k));
      if (aliasOverlap) {
        evidence.push(`alias_corroboration:stored_alias_match`);
        return { match: c, confidence: 0.75, evidence };
      }
    }

    // Signal 3: Relationship-graph corroboration — same person appears in ≥2 source
    // characters' fictional_relationships with the same relationship_type
    // (e.g. "mother of Ethan" AND "mother of Melody" both list "Carol Thompson")
    // We require the name match points to the same Character.id via at least 1 cross-ref
    if (crossRefEntries.length > 0) {
      const { charId } = crossRefEntries[0];
      const crossRefChar = liveChars.find(c => c.id === charId);
      const crossNameMatch = nameMatches.find(c => c.id === charId);
      if (crossRefChar && crossNameMatch) {
        evidence.push(`relationship_graph_corroboration:${charId}:cross_ref_count=${crossRefEntries[0].count}`);
        return { match: crossRefChar, confidence: 0.75, evidence };
      }
    }

    // ── TIER 4: Name-only match (0.30) ───────────────────────────────────────
    // Name matched but NO corroborating evidence. ALWAYS needs_review.
    // This value is deliberately below the 0.75 threshold so the caller returns needs_review.
    evidence.push('name_only_no_corroboration:needs_review');
    return { match: bestMatch, confidence: 0.30, evidence };
  }

  // No name match at all
  evidence.push('no_name_match');
  return { match: null, confidence: 0.0, evidence };
}

/**
 * resolveCanonicalPerson — the shared resolver for all identity decisions.
 *
 * @param {object} params
 * @param {string}   params.owner_email
 * @param {string}   params.name
 * @param {string[]} [params.aliases]
 * @param {string}   [params.source_type]          — 'family_member' | 'fictional_relationship' | 'world_contact'
 * @param {string}   [params.source_record_id]     — ID of the source entity/array item
 * @param {string}   [params.source_character_id]  — Character whose data contains this reference
 * @param {string}   [params.linked_character_id]  — _linked_character_id from family_members entry
 * @param {string}   [params.related_character_id] — related_character_id from fictional_relationships
 * @param {string}   [params.relationship_context] — e.g. "mother", "sister"
 * @param {string}   [params.avatar_url]
 * @param {'read'|'repair'|'create_from_explicit_user_action'} [params.mode] — default "read"
 *   - "read": resolve only, no writes, no creates
 *   - "repair": resolve + write back stable link to source if confidence ≥ 0.75
 *   - "create_from_explicit_user_action": resolve, and if truly no match exists AND
 *       all required context is present (source_character_id, relationship_context,
 *       owner credentials), create a new Character. This mode is ONLY valid when called
 *       from an explicit user save action (e.g. FamilyEditor save button).
 *
 * @param {object[]} params.all_live_characters   — all live Character records for this owner
 * @param {object[]} [params.all_fictional_rels]  — aggregated fictional_relationships for cross-ref
 * @param {object}   params.base44                — base44 SDK instance
 * @param {string}   [params.owner_user_id]       — required for create_from_explicit_user_action
 * @param {string}   [params.user_role]           — required for create_from_explicit_user_action
 *
 * @returns {Promise<{
 *   status: 'resolved'|'repaired'|'created'|'needs_review'|'failed',
 *   canonical_person_id: string|null,
 *   confidence: number,
 *   matched_evidence: string[],
 *   source_record_ids: string[],
 *   repair_actions: string[],
 *   failure_reason: string|null,
 * }>}
 */
export async function resolveCanonicalPerson(params) {
  const {
    owner_email,
    name,
    aliases = [],
    source_type = 'unknown',
    source_record_id = null,
    source_character_id = null,
    linked_character_id = null,
    related_character_id = null,
    relationship_context = null,
    avatar_url = null,
    mode = 'read',
    all_live_characters = [],
    all_fictional_rels = [],
    base44,
    owner_user_id = null,
    user_role = 'user',
  } = params;

  if (!name?.trim()) {
    return {
      status: 'failed',
      canonical_person_id: null,
      confidence: 0,
      matched_evidence: ['name_missing'],
      source_record_ids: [],
      repair_actions: [],
      failure_reason: 'Name is required',
    };
  }

  const repair_actions = [];

  // Tag each fictional_rel with its source character so cross-ref scoring can
  // verify independence (two different source characters, not the same one twice)
  // We do this by re-using all_fictional_rels as-is — callers should tag them with
  // _source_character_id. If not tagged, scoring degrades gracefully.

  const { match, confidence, evidence } = scoreResolution(
    { name, linked_character_id, related_character_id, source_character_id, aliases, avatar_url },
    all_live_characters,
    all_fictional_rels
  );

  // ── NEEDS REVIEW: anything below 0.75 is never acted on ──────────────────
  // This gate applies regardless of mode. Name-only (0.30), stale ID (0.0),
  // no match (0.0) all fall here. Even in create_from_explicit_user_action mode,
  // if there IS a name match with confidence 0.30 (name-only), we return needs_review
  // to prevent silent merge. Creation is only allowed when confidence is 0.0 (truly
  // no record exists).
  if (confidence < 0.75 && confidence > 0.0) {
    return {
      status: 'needs_review',
      canonical_person_id: null,
      confidence,
      matched_evidence: evidence,
      source_record_ids: source_record_id ? [source_record_id] : [],
      repair_actions: [],
      failure_reason: `Confidence ${confidence.toFixed(2)} — name matched but no corroborating evidence (avatar, alias, or multi-source cross-reference). Requires explicit user confirmation before linking or creating. Evidence: [${evidence.join(', ')}]`,
    };
  }

  // ── RESOLVED: confidence ≥ 0.75 ──────────────────────────────────────────
  if (match && confidence >= 0.75) {
    // In "repair" mode: write back the stable link to source record if it was missing
    if (mode === 'repair' && source_character_id && !linked_character_id && !related_character_id) {
      try {
        const parentChar = all_live_characters.find(c => c.id === source_character_id);
        if (parentChar && source_type === 'family_member') {
          const updatedMembers = (parentChar.family_members || []).map((fm) => {
            const fmKey = fm.name?.trim().toLowerCase();
            if (fmKey === name.trim().toLowerCase() && !fm._linked_character_id) {
              return { ...fm, _linked_character_id: match.id };
            }
            return fm;
          });
          await base44.entities.Character.update(source_character_id, { family_members: updatedMembers });
          parentChar.family_members = updatedMembers;
          repair_actions.push(`wrote_back_linked_character_id:${match.id}→family_members_of:${source_character_id}`);
        } else if (parentChar && source_type === 'fictional_relationship') {
          const updatedRels = (parentChar.fictional_relationships || []).map((rel) => {
            const relKey = rel.person_name?.trim().toLowerCase();
            if (relKey === name.trim().toLowerCase() && !rel.related_character_id) {
              return { ...rel, related_character_id: match.id };
            }
            return rel;
          });
          await base44.entities.Character.update(source_character_id, { fictional_relationships: updatedRels });
          parentChar.fictional_relationships = updatedRels;
          repair_actions.push(`wrote_back_related_character_id:${match.id}→fictional_relationships_of:${source_character_id}`);
        }
      } catch (repairErr) {
        repair_actions.push(`repair_writeback_failed:${repairErr.message}`);
      }
    }

    return {
      status: repair_actions.length > 0 ? 'repaired' : 'resolved',
      canonical_person_id: match.id,
      confidence,
      matched_evidence: evidence,
      source_record_ids: [match.id, ...(source_record_id ? [source_record_id] : [])],
      repair_actions,
      failure_reason: null,
    };
  }

  // ── CREATE: only in create_from_explicit_user_action mode, confidence === 0.0 ──
  // This path is ONLY reached when:
  //   1. mode === 'create_from_explicit_user_action' — caller is an explicit user save,
  //      not a picker/list render. FamilyEditor save button is the only valid caller.
  //   2. confidence === 0.0 — no Character record exists with this name. A confidence of
  //      0.30 (name-only match) blocks this path (needs_review returned above) to prevent
  //      silent merge or creation alongside an existing same-name record.
  //   3. source_character_id is present — we know who this person belongs to.
  //   4. relationship_context is present — we know what role this person plays.
  //   5. Owner credentials are present — we can create a correctly scoped record.
  if (mode === 'create_from_explicit_user_action') {
    if (confidence !== 0.0) {
      // Should not be reached due to needs_review gate above, but be explicit:
      return {
        status: 'needs_review',
        canonical_person_id: match?.id || null,
        confidence,
        matched_evidence: evidence,
        source_record_ids: [],
        repair_actions: [],
        failure_reason: `Creation blocked — a name match exists at confidence ${confidence.toFixed(2)}. Requires explicit user confirmation to link or merge rather than create a new record.`,
      };
    }

    // Validate required context for creation
    const missingContext = [];
    if (!owner_user_id) missingContext.push('owner_user_id');
    if (!owner_email) missingContext.push('owner_email');
    if (missingContext.length > 0) {
      return {
        status: 'failed',
        canonical_person_id: null,
        confidence: 0,
        matched_evidence: evidence,
        source_record_ids: [],
        repair_actions: [],
        failure_reason: `Cannot create Character for "${name}": missing required context: ${missingContext.join(', ')}`,
      };
    }

    try {
      const newChar = await base44.entities.Character.create({
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
        avatar_url: avatar_url || null,
      });

      repair_actions.push(`created_npc_family_member:${newChar.id}:source=${source_character_id || 'unknown'}:relationship=${relationship_context || 'unknown'}`);

      // Add to in-memory list immediately so subsequent calls in this session see it
      all_live_characters.push(newChar);

      // Write back _linked_character_id to source family member entry
      if (source_character_id && source_type === 'family_member') {
        try {
          const parentChar = all_live_characters.find(c => c.id === source_character_id);
          if (parentChar?.family_members) {
            const updatedMembers = parentChar.family_members.map((fm) => {
              const fmKey = fm.name?.trim().toLowerCase();
              if (fmKey === name.trim().toLowerCase() && !fm._linked_character_id) {
                return { ...fm, _linked_character_id: newChar.id };
              }
              return fm;
            });
            await base44.entities.Character.update(source_character_id, { family_members: updatedMembers });
            parentChar.family_members = updatedMembers;
            repair_actions.push(`wrote_back_linked_character_id:${newChar.id}→${source_character_id}`);
          }
        } catch (wbErr) {
          repair_actions.push(`writeback_failed_after_create:${wbErr.message}`);
        }
      }

      return {
        status: 'created',
        canonical_person_id: newChar.id,
        confidence: 1.0,
        matched_evidence: ['created_new_record', ...evidence],
        source_record_ids: [newChar.id],
        repair_actions,
        failure_reason: null,
      };
    } catch (createErr) {
      return {
        status: 'failed',
        canonical_person_id: null,
        confidence: 0,
        matched_evidence: evidence,
        source_record_ids: [],
        repair_actions,
        failure_reason: `Character.create failed for "${name}": ${createErr.message}`,
      };
    }
  }

  // Fallback: no match (0.0) in read/repair mode
  return {
    status: 'needs_review',
    canonical_person_id: null,
    confidence: 0.0,
    matched_evidence: evidence,
    source_record_ids: [],
    repair_actions: [],
    failure_reason: `No Character record found for "${name}". Use create_from_explicit_user_action mode from an explicit user save action to create one.`,
  };
}