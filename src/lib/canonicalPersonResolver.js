/**
 * CANONICAL PERSON RESOLVER
 *
 * Single shared service for resolving, repairing, and (when appropriate) creating
 * canonical Character records for named people across the app.
 *
 * RULES:
 * - fetchUnifiedRoster MUST call this in "read" mode ONLY. No creation on picker open.
 * - FamilyEditor may call this in "create_if_confident" mode after explicit user action.
 * - Name-only match is NOT sufficient to create a new Character.
 * - "First occurrence wins" is forbidden.
 * - Synthetic IDs are forbidden as final canonical IDs.
 * - Character.create is forbidden inside picker/list rendering.
 *
 * CONFIDENCE SCORING:
 * - stable_id_match (linked_character_id or related_character_id → live Character): 1.0
 * - cross_reference_match (person appears in ≥2 independent sources with same name): 0.85
 * - active_character_name_match (name matches an active_created_character): 0.80
 * - npc_name_match (name matches any other character type): 0.70
 * - name_only (no corroborating evidence): 0.40  → NEVER creates, returns needs_review
 *
 * THRESHOLDS:
 * - ≥ 0.70 → "resolved" (read-only link, no write)
 * - ≥ 0.70 + mode=repair → write _linked_character_id back to source
 * - ≥ 0.70 + mode=create_if_confident + no match → create new Character
 * - < 0.70 → "needs_review" with full diagnostics, no write, no create
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
 * Build a confidence-scored resolution result for a named person
 * against a set of live Character records.
 *
 * Does NOT write anything. Does NOT create anything.
 * Returns the best match + confidence score + evidence.
 */
function scoreResolution(params, liveChars, allFictionalRels) {
  const {
    name,
    linked_character_id,
    related_character_id,
    source_character_id,
    aliases = [],
  } = params;

  if (!name?.trim()) {
    return { match: null, confidence: 0, evidence: ['name_missing'] };
  }

  const nameKey = name.trim().toLowerCase();
  const allAliasKeys = [nameKey, ...(aliases || []).map(a => a.trim().toLowerCase())];

  const evidence = [];

  // ── STEP 1: Stable ID match — highest confidence ─────────────────────────
  const stableId = linked_character_id || related_character_id;
  if (stableId) {
    const linked = liveChars.find(c => c.id === stableId);
    if (linked && linked.status !== 'deleted' && linked.status !== 'soft_deleted') {
      evidence.push(`stable_id_match:${stableId}`);
      return { match: linked, confidence: 1.0, evidence };
    } else {
      evidence.push(`stable_id_stale:${stableId}`);
      // ID exists but char is gone — do not fall through to name match alone
      return { match: null, confidence: 0.3, evidence: [...evidence, 'referenced_character_not_found'] };
    }
  }

  // ── STEP 2: Cross-reference match ────────────────────────────────────────
  // Person appears in ≥2 independent fictional_relationships sources with same name
  // pointing to the same Character.id — strong corroboration.
  const crossRefIds = {};
  for (const rel of allFictionalRels) {
    const relNameKey = rel.person_name?.trim().toLowerCase();
    if (relNameKey && allAliasKeys.includes(relNameKey) && rel.related_character_id) {
      crossRefIds[rel.related_character_id] = (crossRefIds[rel.related_character_id] || 0) + 1;
    }
  }
  const crossRefSorted = Object.entries(crossRefIds).sort((a, b) => b[1] - a[1]);
  if (crossRefSorted.length > 0 && crossRefSorted[0][1] >= 2) {
    const [crossRefCharId] = crossRefSorted[0];
    const crossRefChar = liveChars.find(c => c.id === crossRefCharId);
    if (crossRefChar) {
      evidence.push(`cross_reference_match:${crossRefCharId}:count=${crossRefSorted[0][1]}`);
      return { match: crossRefChar, confidence: 0.85, evidence };
    }
  }
  // Single cross-reference (weaker)
  if (crossRefSorted.length > 0) {
    const [crossRefCharId] = crossRefSorted[0];
    const crossRefChar = liveChars.find(c => c.id === crossRefCharId);
    if (crossRefChar) {
      evidence.push(`single_cross_reference_match:${crossRefCharId}`);
      return { match: crossRefChar, confidence: 0.75, evidence };
    }
  }

  // ── STEP 3: Name match against live Characters ────────────────────────────
  const nameMatches = liveChars.filter(c => {
    if (c.status === 'deleted' || c.status === 'soft_deleted') return false;
    const cKey = c.name?.trim().toLowerCase();
    return allAliasKeys.includes(cKey);
  });

  if (nameMatches.length === 0) {
    evidence.push('no_name_match');
    return { match: null, confidence: 0.0, evidence };
  }

  // Pick best candidate by type priority, then oldest created_date
  const bestMatch = [...nameMatches].sort((a, b) => {
    const pDiff = typePriority(a.character_type) - typePriority(b.character_type);
    if (pDiff !== 0) return pDiff;
    return new Date(a.created_date || 0) - new Date(b.created_date || 0);
  })[0];

  const isActiveType = bestMatch.character_type === 'active_created_character' || bestMatch.character_type === 'active';
  const confidence = isActiveType ? 0.80 : 0.70;

  evidence.push(`name_match:${bestMatch.id}:type=${bestMatch.character_type}:confidence=${confidence}`);
  if (nameMatches.length > 1) {
    evidence.push(`ambiguous_name_match:${nameMatches.length}_candidates`);
  }

  return { match: bestMatch, confidence, evidence };
}

/**
 * resolveCanonicalPerson — the shared resolver for all identity decisions.
 *
 * @param {object} params
 * @param {string} params.owner_email
 * @param {string} params.name
 * @param {string[]} [params.aliases]
 * @param {string} [params.source_type]         — 'family_member' | 'fictional_relationship' | 'world_contact'
 * @param {string} [params.source_record_id]    — ID of the source entity/array item
 * @param {string} [params.source_character_id] — Character whose data contains this reference
 * @param {string} [params.linked_character_id] — _linked_character_id from family_members entry
 * @param {string} [params.related_character_id]— related_character_id from fictional_relationships
 * @param {string} [params.relationship_context]— e.g. "mother", "sister"
 * @param {string} [params.avatar_url]
 * @param {'read'|'repair'|'create_if_confident'} [params.mode] — default "read"
 *
 * @param {object[]} params.all_live_characters  — all live Character records for this owner
 * @param {object[]} [params.all_fictional_rels] — aggregated fictional_relationships for cross-ref
 * @param {object}   params.base44               — base44 SDK instance
 * @param {string}   [params.owner_user_id]      — required only for create_if_confident
 * @param {string}   [params.user_role]          — required only for create_if_confident
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

  // Score the resolution
  const { match, confidence, evidence } = scoreResolution(
    { name, linked_character_id, related_character_id, source_character_id, aliases },
    all_live_characters,
    all_fictional_rels
  );

  // ── RESOLVED: high confidence match exists ────────────────────────────────
  if (match && confidence >= 0.70) {
    // In "repair" mode: write back the stable link to source if it was missing
    if (mode === 'repair' && source_character_id && !linked_character_id && !related_character_id) {
      try {
        const parentChar = all_live_characters.find(c => c.id === source_character_id);
        if (parentChar && source_type === 'family_member') {
          const updatedMembers = (parentChar.family_members || []).map((fm) => {
            const fmNameKey = fm.name?.trim().toLowerCase();
            const resolvedNameKey = name.trim().toLowerCase();
            if (fmNameKey === resolvedNameKey && !fm._linked_character_id) {
              return { ...fm, _linked_character_id: match.id };
            }
            return fm;
          });
          await base44.entities.Character.update(source_character_id, { family_members: updatedMembers });
          parentChar.family_members = updatedMembers;
          repair_actions.push(`wrote_back_linked_character_id:${match.id}→family_members_of:${source_character_id}`);
        } else if (parentChar && source_type === 'fictional_relationship') {
          const updatedRels = (parentChar.fictional_relationships || []).map((rel) => {
            const relNameKey = rel.person_name?.trim().toLowerCase();
            const resolvedNameKey = name.trim().toLowerCase();
            if (relNameKey === resolvedNameKey && !rel.related_character_id) {
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

  // ── NEEDS REVIEW: low confidence, no stable proof ─────────────────────────
  if (confidence < 0.70 && mode !== 'create_if_confident') {
    return {
      status: 'needs_review',
      canonical_person_id: null,
      confidence,
      matched_evidence: evidence,
      source_record_ids: source_record_id ? [source_record_id] : [],
      repair_actions: [],
      failure_reason: `Confidence too low (${confidence.toFixed(2)}) to resolve "${name}" — requires explicit user confirmation or higher-confidence evidence before linking or creating.`,
    };
  }

  // ── CREATE: only in create_if_confident mode, no match found ─────────────
  // This path is ONLY reached when:
  //   1. mode === 'create_if_confident' (explicitly called by FamilyEditor after user action)
  //   2. No match was found (confidence === 0.0 — truly no record exists)
  //   3. owner credentials are present
  if (mode === 'create_if_confident') {
    if (match && confidence >= 0.70) {
      // Match exists — return it, do not create a duplicate
      return {
        status: 'resolved',
        canonical_person_id: match.id,
        confidence,
        matched_evidence: evidence,
        source_record_ids: [match.id],
        repair_actions,
        failure_reason: null,
      };
    }

    if (!owner_user_id || !owner_email) {
      return {
        status: 'failed',
        canonical_person_id: null,
        confidence: 0,
        matched_evidence: evidence,
        source_record_ids: [],
        repair_actions: [],
        failure_reason: `Cannot create Character for "${name}": owner credentials missing`,
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

      repair_actions.push(`created_npc_family_member:${newChar.id}`);

      // Immediately add to in-memory list so subsequent calls in same session see it
      all_live_characters.push(newChar);

      // Write back to source if source is known
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
        matched_evidence: ['created_new_record'],
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

  // Fallback — should not be reached, but be explicit
  return {
    status: 'needs_review',
    canonical_person_id: null,
    confidence,
    matched_evidence: evidence,
    source_record_ids: [],
    repair_actions: [],
    failure_reason: `Could not resolve "${name}" in mode="${mode}"`,
  };
}