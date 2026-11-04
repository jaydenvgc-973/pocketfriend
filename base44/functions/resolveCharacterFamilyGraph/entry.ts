import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * resolveCharacterFamilyGraph
 *
 * Derives the COMPLETE family graph for a character by analyzing all characters
 * owned by the same user account. Returns:
 *
 *   - parents     → from this character's family_members[] with parent-type roles
 *   - siblings    → DERIVED: other characters who share the same parent (character_id link)
 *   - children    → DERIVED: characters whose family_members[] lists this character as a parent
 *   - ownAge      → resolved age of this character
 *   - promptBlock → ready-to-inject LLM prompt string with AUTHORITATIVE FAMILY KNOWLEDGE
 *
 * SIBLING DERIVATION RULE:
 *   If Character A and Character B share a parent (same parent character_id),
 *   they are siblings. This is AUTOMATICALLY DERIVED — no manual sibling entry required.
 *
 * This function is called by buildCanonicalCharacterContext on every context build
 * to ensure family awareness is always current and authoritative.
 */

const PARENT_TYPES = new Set([
  'father', 'dad', 'daddy', 'mother', 'mom', 'mommy', 'parent',
  'birth father', 'birth mother', 'biological father', 'biological mother',
  'stepfather', 'stepdad', 'stepmother', 'stepmom',
  'adoptive father', 'adoptive mother', 'paternal father', 'maternal mother',
  'foster father', 'foster mother',
]);

const CHILD_TYPES = new Set([
  'son', 'daughter', 'child', 'kid', 'stepson', 'stepdaughter',
  'foster son', 'foster daughter',
]);

const SIBLING_TYPES = new Set([
  'brother', 'sister', 'sibling',
  'older brother', 'younger brother', 'older sister', 'younger sister',
  'half brother', 'half sister', 'half-brother', 'half-sister',
  'step brother', 'step sister', 'stepbrother', 'stepsister',
]);

const MOTHER_TYPES = new Set([
  'mother', 'mom', 'mommy', 'birth mother', 'biological mother',
  'stepmother', 'stepmom', 'adoptive mother', 'maternal mother', 'foster mother',
]);

// ── AGE / BIRTHDAY (Eastern Time — the application's authoritative timezone) ─
// Age follows from whatever the profile actually records: numeric age, then a
// recorded date of birth, then a recorded birth year. Nothing is invented.
function easternToday() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return { year: et.getFullYear(), month: et.getMonth() + 1, day: et.getDate() };
}

function parseBirthday(value) {
  if (!value) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3], hasMonthDay: true };
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) return { year: +yearOnly[1], month: null, day: null, hasMonthDay: false };
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hasMonthDay: true };
}

function ageFromBirthday(birthday) {
  const b = parseBirthday(birthday);
  if (!b || !b.hasMonthDay) return null;
  const today = easternToday();
  let age = today.year - b.year;
  if (today.month < b.month || (today.month === b.month && today.day < b.day)) age--;
  return age >= 0 && age < 130 ? age : null;
}

function ageFromBirthYear(birthYear) {
  const y = typeof birthYear === 'number' ? birthYear : parseInt(birthYear, 10);
  if (!y || isNaN(y) || y < 1900) return null;
  const age = easternToday().year - y;
  return age >= 0 && age < 130 ? age : null;
}

function resolveAge(c) {
  if (!c) return null;
  if (typeof c.age === 'number' && c.age > 0) return Math.floor(c.age);
  const fromBirthday = ageFromBirthday(c.birthday);
  if (fromBirthday != null) return fromBirthday;
  return ageFromBirthYear(c.birth_year);
}

function birthdayLabel(character) {
  const b = parseBirthday(character?.birthday);
  if (!b || !b.hasMonthDay) return null;
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[b.month - 1];
  if (!monthName) return null;
  const dateLabel = `${monthName} ${b.day}`;
  return {
    date: b.year > 1900 ? `${dateLabel}, ${b.year}` : dateLabel,
    monthDay: dateLabel,
    hasYear: b.year > 1900,
  };
}

// ── KINSHIP HELPERS ──────────────────────────────────────────────────────────
// Stored parent links only. Step links are kept separate from lineage links:
// marriage and co-parenting create step relationships, never biological ones.
const LINEAGE_KINDS = new Set(['lineage', 'adoptive']);

function parentKindFromRel(relLower) {
  if (relLower.startsWith('step')) return 'step';
  if (relLower.startsWith('foster')) return 'foster';
  if (relLower.startsWith('adopt')) return 'adoptive';
  return 'lineage';
}

function buildParentMap(allChars) {
  const map = new Map();
  const add = (childId, parentId, kind, rel) => {
    if (!childId || !parentId || childId === parentId) return;
    const arr = map.get(childId) || [];
    if (arr.some(p => p.parentId === parentId && p.kind === kind)) return;
    arr.push({ parentId, kind, rel });
    map.set(childId, arr);
  };
  for (const c of allChars) {
    for (const m of c.family_members || []) {
      const link = m._linked_character_id || m.character_id || null;
      if (!link) continue;
      const rel = (m.relationship_type || '').toLowerCase();
      if (PARENT_TYPES.has(rel)) add(c.id, link, parentKindFromRel(rel), rel);
      else if (CHILD_TYPES.has(rel)) add(link, c.id, parentKindFromRel(rel), rel);
    }
  }
  return map;
}

function kinshipTerm(record, male, female, neutral) {
  const g = (record?.gender || '').toLowerCase();
  if (g === 'male') return male;
  if (g === 'female') return female;
  return neutral;
}

function cousinDegreeLabel(degree, removal) {
  const ord = degree === 1 ? 'first' : degree === 2 ? 'second' : degree === 3 ? 'third' : `${degree}th`;
  const rem = removal <= 0 ? '' : removal === 1 ? ' once removed' : removal === 2 ? ' twice removed' : ` ${removal} times removed`;
  return `${ord} cousin${rem}`;
}

// Ancestor depth map (1 = parent, 2 = grandparent, ...). Biological and adoptive
// links carry lineage; step and foster links do not create blood relationship.
function ancestorDepths(id, parentMap, cache) {
  if (cache.has(id)) return cache.get(id);
  const depths = new Map();
  let frontier = [{ id, depth: 0 }];
  const seen = new Set([id]);
  while (frontier.length > 0) {
    const next = [];
    for (const node of frontier) {
      if (node.depth >= 4) continue;
      for (const p of (parentMap.get(node.id) || [])) {
        if (!LINEAGE_KINDS.has(p.kind)) continue;
        if (seen.has(p.parentId)) continue;
        seen.add(p.parentId);
        const depth = node.depth + 1;
        if (!depths.has(p.parentId) || depths.get(p.parentId) > depth) depths.set(p.parentId, depth);
        next.push({ id: p.parentId, depth });
      }
    }
    frontier = next;
  }
  cache.set(id, depths);
  return depths;
}

function deriveExtendedKin(characterId, allChars, parentMap, excludeIds) {
  const cache = new Map();
  const own = ancestorDepths(characterId, parentMap, cache);
  const out = { grandparents: [], grandchildren: [], auntsUncles: [], niecesNephews: [], cousins: [] };
  const push = (list, rec, label) => {
    if (list.length >= 8) return;
    list.push({ name: rec.display_name || rec.name || 'Unnamed', character_id: rec.id, relationship_type: label });
  };

  for (const other of allChars) {
    if (other.id === characterId || excludeIds.has(other.id)) continue;
    const theirs = ancestorDepths(other.id, parentMap, cache);

    // They are my descendant
    const iAmTheirAncestor = theirs.get(characterId);
    if (iAmTheirAncestor === 2) { push(out.grandchildren, other, kinshipTerm(other, 'grandson', 'granddaughter', 'grandchild')); continue; }
    if (iAmTheirAncestor >= 3) { push(out.grandchildren, other, 'great-' + kinshipTerm(other, 'grandson', 'granddaughter', 'grandchild')); continue; }

    // They are my ancestor
    const theyAreMyAncestor = own.get(other.id);
    if (theyAreMyAncestor === 2) { push(out.grandparents, other, kinshipTerm(other, 'grandfather', 'grandmother', 'grandparent')); continue; }
    if (theyAreMyAncestor >= 3) { push(out.grandparents, other, 'great-' + kinshipTerm(other, 'grandfather', 'grandmother', 'grandparent')); continue; }

    // Closest common ancestor — the basis of cousinship
    let best = null;
    for (const [ancId, dA] of own) {
      const dB = theirs.get(ancId);
      if (!dB) continue;
      if (dA === 1 && dB === 1) continue; // siblings are derived separately
      const score = dA + dB;
      const removal = Math.abs(dA - dB);
      if (!best || score < best.score || (score === best.score && removal < best.removal)) best = { dA, dB, score, removal };
    }
    if (!best) continue;

    if (best.dA === 1 && best.dB === 2) { push(out.niecesNephews, other, kinshipTerm(other, 'nephew', 'niece', "sibling's child")); continue; }
    if (best.dA === 1 && best.dB >= 3) { push(out.niecesNephews, other, 'great-' + kinshipTerm(other, 'nephew', 'niece', "sibling's grandchild")); continue; }
    if (best.dB === 1 && best.dA === 2) { push(out.auntsUncles, other, kinshipTerm(other, 'uncle', 'aunt', "parent's sibling")); continue; }
    if (best.dB === 1 && best.dA >= 3) { push(out.auntsUncles, other, 'great-' + kinshipTerm(other, 'uncle', 'aunt', "grandparent's sibling")); continue; }
    if (best.dA >= 2 && best.dB >= 2) {
      push(out.cousins, other, cousinDegreeLabel(Math.min(best.dA, best.dB) - 1, best.removal));
    }
  }
  return out;
}

function classifySibling(sibling, characterId, charById, parentMap) {
  const rec = sibling.character_id ? charById.get(sibling.character_id) : null;
  const base = kinshipTerm(rec || { gender: sibling.gender }, 'brother', 'sister', 'sibling');
  const explicit = (sibling.relationship_type || '').toLowerCase();
  const order = explicit.includes('older') ? 'older ' : explicit.includes('younger') ? 'younger ' : '';

  // An explicitly recorded half/step title is established profile information.
  if (explicit.includes('step')) return { label: sibling.relationship_type, kind: 'step' };
  if (explicit.includes('half')) return { label: sibling.relationship_type, kind: 'half' };

  const mine = (parentMap.get(characterId) || []);
  const theirLinks = sibling.character_id ? (parentMap.get(sibling.character_id) || []) : [];
  const myBio = mine.filter(p => LINEAGE_KINDS.has(p.kind)).map(p => p.parentId);
  const theirBio = theirLinks.filter(p => LINEAGE_KINDS.has(p.kind)).map(p => p.parentId);
  const myStep = mine.filter(p => p.kind === 'step').map(p => p.parentId);
  const theirStep = theirLinks.filter(p => p.kind === 'step').map(p => p.parentId);
  const sharedBio = myBio.filter(id => theirBio.includes(id));

  // A step-parent's own child is a step-sibling — not a biological sibling.
  const stepTie = myStep.some(id => theirBio.includes(id)) || theirStep.some(id => myBio.includes(id));
  if (sharedBio.length === 0 && stepTie) {
    return { label: `step${base}`, kind: 'step' };
  }
  if (sharedBio.length >= 2) return { label: `${order}${base}`, kind: 'full' };
  if (sharedBio.length === 1) {
    // One shared parent only counts as half-siblings when another parent is recorded.
    if (myBio.length >= 2 || theirBio.length >= 2) return { label: `half-${base}`, kind: 'half' };
    return { label: `${order}${base}`, kind: 'sibling' };
  }
  return { label: `${order}${base}`, kind: 'sibling' };
}

function deriveSiblingLabel(siblingRecord, ownAge) {
  const sibAge = resolveAge(siblingRecord);
  const gender = siblingRecord?.gender;
  if (gender === 'male') {
    if (ownAge && sibAge) return sibAge > ownAge ? 'older brother' : 'younger brother';
    return 'brother';
  }
  if (gender === 'female') {
    if (ownAge && sibAge) return sibAge > ownAge ? 'older sister' : 'younger sister';
    return 'sister';
  }
  return 'sibling';
}

function deriveChildLabel(childRecord, parentEntryRel) {
  const gender = childRecord?.gender;
  const base = gender === 'male' ? 'son' : gender === 'female' ? 'daughter' : 'child';
  const rel = (parentEntryRel || '').toLowerCase();
  if (rel.startsWith('step')) return `step${base}`;
  if (rel.startsWith('adopt')) return `adopted ${base}`;
  return base;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    // ── Fetch the target character ───────────────────────────────────────────
    let targetChar = null;
    const charRes = await base44.entities.Character.filter({ id: characterId }).catch(() => []);
    targetChar = charRes[0] || null;

    if (!targetChar) {
      const srRes = await base44.asServiceRole.entities.Character.filter({ id: characterId }).catch(() => []);
      targetChar = srRes[0] || null;
    }

    if (!targetChar) {
      return Response.json({ success: false, error: 'Character not found', promptBlock: '' }, { status: 404 });
    }

    // ── Fetch ALL characters owned by this user ──────────────────────────────
    // Needed to derive siblings (other chars sharing the same parent) and children
    const ownedChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      300
    ).catch(() => []);

    // Fetch NPCs via service role (family members can be NPCs)
    const npcRes = await base44.functions.invoke('fetchNPCsForUser', {}).catch(() => null);
    const npcs = npcRes?.data?.npcs || [];

    // Deduplicated full roster
    const ownedIds = new Set(ownedChars.map(c => c.id));
    const allChars = [...ownedChars, ...npcs.filter(n => !ownedIds.has(n.id))];
    const charById = new Map(allChars.map(c => [c.id, c]));

    const ownAge = resolveAge(targetChar); // from character's own record (pre-step-2 value, used initially)
    const familyMembers = targetChar.family_members || [];
    // Note: nonUserFamilyMembers is derived below after userParticipantMembers is separated out.

    // ── USER-PARTICIPANT ENTRIES ──────────────────────────────────────────────
    // Family member entries with participant_type:"user" or _is_user:true represent the
    // authenticated user. They are resolved from User Profile + UserSettings, not from
    // Character records. Collect them separately for the prompt block.
    const userParticipantMembers = familyMembers.filter(m =>
      m._is_user === true || m.participant_type === 'user'
    );

    // Non-user entries only for the normal resolution chain
    const nonUserFamilyMembers = familyMembers.filter(m =>
      m._is_user !== true && m.participant_type !== 'user'
    );

    // Established parent links across the roster, read once from the records
    // themselves (child-side entries and parent-side child lists). Kinship
    // implications follow from these links — they are never entered twice.
    const parentMap = buildParentMap(allChars);

    // ── STEP 1: Identify explicit family members by type ─────────────────────
    const explicitParents = nonUserFamilyMembers.filter(m =>
      PARENT_TYPES.has((m.relationship_type || '').toLowerCase())
    );
    const explicitSiblings = nonUserFamilyMembers.filter(m =>
      SIBLING_TYPES.has((m.relationship_type || '').toLowerCase())
    );
    const explicitChildren = nonUserFamilyMembers.filter(m =>
      CHILD_TYPES.has((m.relationship_type || '').toLowerCase())
    );

    // ── STEP 1b: REVERSE PARENT LOOKUP ───────────────────────────────────────
    // If this character has no parents listed in their OWN family_members[],
    // scan ALL other characters to find any that list THIS character as their child
    // via _linked_character_id. Those characters are this character's parents.
    // This handles the common case where parents store the relationship, not children.
    const reverseParents = [];
    if (explicitParents.length === 0) {
      for (const otherChar of allChars) {
        if (otherChar.id === characterId) continue;
        const otherFamily = otherChar.family_members || [];
        const childEntry = otherFamily.find(m => {
          const mLinkId = m._linked_character_id || m.character_id || null;
          return mLinkId === characterId &&
            CHILD_TYPES.has((m.relationship_type || '').toLowerCase());
        });
        if (childEntry) {
          // otherChar is a parent of this character.
          // Determine mother/father: prefer explicit gender, fall back to name heuristic,
          // then default to 'parent' if indeterminate.
          const genderLower = (otherChar.gender || '').toLowerCase();
          const nameLower = (otherChar.display_name || otherChar.name || '').toLowerCase();
          // Female name heuristics for common cases where gender field is null
          const looksLikeFemaleName = /\b(lila|melody|maria|vanessa|linda|marisol|nancy|ava|sarah|jessica|jennifer|ashley|amanda|brittany|tiffany|michelle|stephanie|rachel|diana|patricia|barbara|lisa|donna|karen|sandra|margaret|helen|betty|dorothy|gloria|anna|grace|lily|rose|violet|ivy|ruby|pearl|claire|emma|olivia|sophia|isabella|mia|charlotte|amelia|evelyn|abigail|emily|elizabeth|jennifer|helen|dorothy|mia|natalie|zoe|hannah|addison|aubrey|brooklyn|leah)\b/.test(nameLower);
          const isMother = genderLower === 'female' || (genderLower !== 'male' && looksLikeFemaleName);
          const relType = genderLower === 'female' ? 'mother' : genderLower === 'male' ? 'father' : looksLikeFemaleName ? 'mother' : 'parent';
          reverseParents.push({
            name: otherChar.display_name || otherChar.name,
            relationship_type: relType,
            character_id: otherChar.id,
            age: resolveAge(otherChar),
            is_mother: isMother,
            source: 'reverse_lookup',
          });
        }
      }
    }

    // ── STEP 2: Resolve parent character records ──────────────────────────────
    // FIELD NOTE: family_members use _linked_character_id (not character_id).
    // Also fall back to name-based lookup for entries without a link.
    const resolvedParents = explicitParents.map(p => {
      // Try _linked_character_id first (actual schema field), then character_id (legacy)
      const linkId = p._linked_character_id || p.character_id || null;
      const linked = linkId ? charById.get(linkId) : null;
      const byName = !linked && p.name
        ? allChars.find(c =>
            c.id !== characterId &&
            (c.name?.toLowerCase() === p.name?.toLowerCase() ||
             c.display_name?.toLowerCase() === p.name?.toLowerCase())
          )
        : null;
      const record = linked || byName || null;
      return {
        name: p.name || record?.name || 'Unknown',
        relationship_type: p.relationship_type || 'parent',
        character_id: linkId || record?.id || null,
        age: p.age || p.age_at_creation || resolveAge(record) || null,
        is_mother: MOTHER_TYPES.has((p.relationship_type || '').toLowerCase()),
      };
    });

    // Merge reverse-looked-up parents into resolvedParents (deduplicated by character_id)
    const resolvedParentIds = new Set(resolvedParents.map(p => p.character_id).filter(Boolean));
    for (const rp of reverseParents) {
      if (!resolvedParentIds.has(rp.character_id)) {
        resolvedParents.push(rp);
        resolvedParentIds.add(rp.character_id);
      }
    }

    // ── STEP 2b: Resolve ownAge from parent's family_members entry ───────────
    // Many family NPC characters have age: null on their own record.
    // The parent's family_members[] entry is the authoritative age source.
    // Check each resolved parent's family_members for an entry that links to characterId.
    let ownAgeFromParent = null;
    let ownGenderFromParent = null;
    if (!resolveAge(targetChar)) {
      for (const parent of resolvedParents) {
        const parentChar = parent.character_id ? charById.get(parent.character_id) : null;
        if (!parentChar) continue;
        const entry = (parentChar.family_members || []).find(m => {
          const mLinkId = m._linked_character_id || m.character_id || null;
          return mLinkId === characterId;
        });
        if (entry) {
          if (entry.age != null) ownAgeFromParent = entry.age;
          // Infer gender from relationship_type (son/daughter) if character's own gender is missing/wrong
          const relLower = (entry.relationship_type || '').toLowerCase();
          if (relLower === 'daughter' || relLower === 'stepdaughter' || relLower === 'foster daughter') ownGenderFromParent = 'female';
          else if (relLower === 'son' || relLower === 'stepson' || relLower === 'foster son') ownGenderFromParent = 'male';
          break;
        }
      }
    }

    // Effective age and gender — prefer own record, fall back to parent-derived values
    const effectiveAge = resolveAge(targetChar) || ownAgeFromParent;
    const effectiveGender = (targetChar.gender && targetChar.gender !== 'other') ? targetChar.gender : (ownGenderFromParent || targetChar.gender);

    // ── STEP 3: DERIVE siblings from shared parents ───────────────────────────
    // Two derivation paths — both must be tried:
    //
    // PATH A (child-side): Other characters whose family_members[] lists the same parent.
    //   Works when children store their own parent references.
    //
    // PATH B (parent-side): Look up each resolved parent's own family_members[].
    //   Works when ONLY the parent stores the child list (common pattern).
    //   E.g. Ethan lists Sarah, Larry, Thomas, Stephanie as children — the kids list nothing.
    //   Stephanie's siblings = Ethan's other children from his family_members[].

    const linkedParentIds = new Set(
      resolvedParents.filter(p => p.character_id).map(p => p.character_id)
    );

    const derivedSiblings = [];
    const seenSiblingIds = new Set([characterId]);
    // Pre-seed with explicitly listed siblings so we don't duplicate
    explicitSiblings.forEach(s => {
      const sid = s._linked_character_id || s.character_id;
      if (sid) seenSiblingIds.add(sid);
    });

    if (linkedParentIds.size > 0) {
      // PATH A: Scan all chars whose family_members[] reference a shared parent
      for (const otherChar of allChars) {
        if (seenSiblingIds.has(otherChar.id)) continue;
        const otherFamily = otherChar.family_members || [];
        const sharedParentEntry = otherFamily.find(m => {
          const mLinkId = m._linked_character_id || m.character_id || null;
          return mLinkId &&
            linkedParentIds.has(mLinkId) &&
            PARENT_TYPES.has((m.relationship_type || '').toLowerCase());
        });
        if (sharedParentEntry) {
          seenSiblingIds.add(otherChar.id);
          const sharedId = sharedParentEntry._linked_character_id || sharedParentEntry.character_id;
          const parentRecord = charById.get(sharedId);
          derivedSiblings.push({
            name: otherChar.display_name || otherChar.name,
            character_id: otherChar.id,
            age: resolveAge(otherChar),
            gender: otherChar.gender,
            relationship_type: deriveSiblingLabel(otherChar, ownAge),
            shared_parent_name: parentRecord?.name || 'shared parent',
            shared_parent_id: sharedId,
            derivation_path: 'child_side',
          });
        }
      }

      // PATH B: For each resolved parent, read their family_members[] to find other children.
      // This handles the pattern where the parent is the ONLY one who stores child relationships.
      for (const parentId of linkedParentIds) {
        const parentChar = charById.get(parentId);
        if (!parentChar) continue;
        const parentFamily = parentChar.family_members || [];
        for (const m of parentFamily) {
          const childLinkId = m._linked_character_id || m.character_id || null;
          if (!childLinkId) continue;
          if (childLinkId === characterId) continue; // skip self
          if (!CHILD_TYPES.has((m.relationship_type || '').toLowerCase())) continue;
          if (seenSiblingIds.has(childLinkId)) continue;
          // Resolve the child character record for accurate name/gender/age
          const sibChar = charById.get(childLinkId);
          const sibName = sibChar?.display_name || sibChar?.name || m.name || 'Unknown';
          const sibAge = sibChar ? (resolveAge(sibChar) || m.age || null) : (m.age || null);
          // Prefer character's stored gender; fall back to relationship_type in parent's entry (son→male, daughter→female)
          let sibGender = (sibChar?.gender && sibChar.gender !== 'other') ? sibChar.gender : null;
          if (!sibGender) {
            const mRel = (m.relationship_type || '').toLowerCase();
            if (mRel === 'son' || mRel === 'stepson' || mRel === 'foster son') sibGender = 'male';
            else if (mRel === 'daughter' || mRel === 'stepdaughter' || mRel === 'foster daughter') sibGender = 'female';
          }
          seenSiblingIds.add(childLinkId);
          // Use effectiveAge for the current character (may not be set yet — use ownAge fallback here)
          derivedSiblings.push({
            name: sibName,
            character_id: childLinkId,
            age: sibAge,
            gender: sibGender,
            relationship_type: deriveSiblingLabel({ age: sibAge, gender: sibGender }, ownAge),
            shared_parent_name: parentChar.name || 'shared parent',
            shared_parent_id: parentId,
            derivation_path: 'parent_side',
          });
        }
      }
    }

    // ── STEP 4: DERIVE children ───────────────────────────────────────────────
    // Any character whose family_members[] lists characterId as a parent is a child.
    const derivedChildren = [];
    const seenChildIds = new Set(
      explicitChildren.map(c => c._linked_character_id || c.character_id).filter(Boolean)
    );

    for (const otherChar of allChars) {
      if (otherChar.id === characterId) continue;

      const otherFamily = otherChar.family_members || [];
      // The linking entry also states HOW this character is that child's parent
      // (step, adopted, or biological), so the child's title is never overstated.
      const parentEntry = otherFamily.find(m => {
        const mLinkId = m._linked_character_id || m.character_id || null;
        return mLinkId === characterId &&
          PARENT_TYPES.has((m.relationship_type || '').toLowerCase());
      });

      if (parentEntry && !seenChildIds.has(otherChar.id)) {
        seenChildIds.add(otherChar.id);
        derivedChildren.push({
          name: otherChar.display_name || otherChar.name,
          character_id: otherChar.id,
          age: resolveAge(otherChar),
          gender: otherChar.gender,
          relationship_type: deriveChildLabel(otherChar, parentEntry.relationship_type),
        });
      }
    }

    // ── STEP 5: Merge explicit + derived ──────────────────────────────────────
    const allSiblings = [
      ...explicitSiblings.map(s => ({
        name: s.name,
        relationship_type: s.relationship_type || 'sibling',
        character_id: s._linked_character_id || s.character_id || null,
        age: s.age || s.age_at_creation || null,
        source: 'explicit',
      })),
      ...derivedSiblings.map(s => ({ ...s, source: 'derived' })),
    ];

    const allChildren = [
      ...explicitChildren.map(c => ({
        name: c.name,
        relationship_type: c.relationship_type || 'child',
        character_id: c._linked_character_id || c.character_id || null,
        age: c.age || c.age_at_creation || null,
        source: 'explicit',
      })),
      ...derivedChildren.map(c => ({ ...c, source: 'derived' })),
    ];

    // ── STEP 5b: SIBLING CLASSIFICATION + EXTENDED KIN ────────────────────────
    // Sibling titles follow from recorded parentage: both parents shared = full,
    // one shared (with another parent recorded) = half, a step-parent's other
    // children = step-sibling. Never asserted where the data does not support it.
    allSiblings.forEach(s => {
      const classified = classifySibling(s, characterId, charById, parentMap);
      s.relationship_type = classified.label;
      s.sibling_kind = classified.kind;
    });

    const directKinIds = new Set([
      characterId,
      ...resolvedParents.map(p => p.character_id).filter(Boolean),
      ...allChildren.map(c => c.character_id).filter(Boolean),
      ...allSiblings.map(s => s.character_id).filter(Boolean),
    ]);
    const kin = deriveExtendedKin(characterId, allChars, parentMap, directKinIds);

    // ── STEP 6: Build the authoritative prompt block ──────────────────────────
    const hasExtendedKin = kin.grandparents.length > 0 || kin.grandchildren.length > 0 ||
      kin.auntsUncles.length > 0 || kin.niecesNephews.length > 0 || kin.cousins.length > 0;
    const hasAnyFamily = resolvedParents.length > 0 || allSiblings.length > 0 || allChildren.length > 0 || hasExtendedKin;
    // Use effectiveAge (parent-derived if own record missing), effectiveGender similarly
    const finalAge = effectiveAge;
    const finalGender = effectiveGender;
    const dob = birthdayLabel(targetChar);

    let promptBlock = '';

    // Include user participants in "hasAnyFamily" check
    const hasUserParticipants = userParticipantMembers.length > 0;

    if (hasAnyFamily || finalAge || dob || hasUserParticipants) {
      const lines = [];
      lines.push('════════════════════════════════════');
      lines.push('AUTHORITATIVE FAMILY KNOWLEDGE — DERIVED FROM FAMILY GRAPH');
      lines.push('These are VERIFIED FACTS. You KNOW these people exist. You cannot contradict them.');
      lines.push('════════════════════════════════════');

      // ── User participants (the authenticated user as family member) ──────────
      if (hasUserParticipants) {
        lines.push('\nUSER (AUTHENTICATED — not a character):');
        for (const up of userParticipantMembers) {
          lines.push(`- ${up.name} — your ${up.relationship_type || 'family member'}. [participant_type: user — identity resolved from User Profile + UserSettings]`);
        }
        lines.push('NOTE: The above person(s) are the real authenticated user, not simulated NPCs. Treat them as the person you are talking to.');
      }

      // Age + birthday — profile facts, not narrative decoration
      if (finalAge || dob) {
        const ageGroup = finalAge <= 3 ? 'toddler' : finalAge <= 12 ? 'child' : finalAge <= 17 ? 'teenager' : finalAge <= 25 ? 'young adult' : 'adult';
        lines.push('\nYOUR AGE AND BIRTHDAY:');
        if (dob) lines.push(`- Date of birth: ${dob.date}.`);
        if (finalAge) lines.push(`- You are ${finalAge} years old${dob && dob.hasYear ? ` (${ageGroup})` : ''}.`);
        lines.push('RULES: Your age follows from your recorded date of birth — once your birthday passes in a given year, your age has advanced. Never give an age that contradicts this, never invent a different birthday, and never claim you do not know your own age. Do NOT volunteer this unprompted; it is knowledge, not small talk.');
        if (!dob && finalAge) {
          lines.push('NOTE: Only your age is established. Your birthday date is not recorded, so do not invent a month or day.');
        }
        if (dob && !dob.hasYear) {
          lines.push('NOTE: Your birth year is not established. Do not invent one.');
        }
      }

      // Parents
      if (resolvedParents.length > 0) {
        lines.push('\nYOUR PARENTS:');
        for (const p of resolvedParents) {
          const relLower = (p.relationship_type || '').toLowerCase();
          const gendered = relLower.includes('mother') ? 'Mom' : relLower.includes('father') ? 'Dad' : null;
          let line = `- ${p.name} — your ${p.relationship_type}.`;
          if (gendered) line += ` Call them "${gendered}" naturally in conversation (not by first name).`;
          else line += ` Use "my parent" or their name. Do NOT assign a gendered title that is not established.`;
          if (p.age) line += ` Age: ${p.age}.`;
          lines.push(line);
        }
        lines.push(`RULE: Do NOT address your parent by their first name as if they were a stranger. Use the established title: a mother is "Mom", a father is "Dad", otherwise "my parent".`);
      }

      // Siblings
      if (allSiblings.length > 0) {
        lines.push('\nYOUR SIBLINGS:');
        for (const s of allSiblings) {
          let line = `- ${s.name} — your ${s.relationship_type}.`;
          if (s.age) line += ` Age: ${s.age}.`;
          if (s.source === 'derived') line += ` [shares parent: ${s.shared_parent_name || 'same parent'}]`;
          lines.push(line);
        }
        lines.push(`SIBLING COUNT: You have ${allSiblings.length} sibling${allSiblings.length !== 1 ? 's' : ''}.`);
        const sibNames = allSiblings.map(s => s.name).join(', ');
        lines.push(`PROHIBITED: Do NOT say "I'm an only child", "I have no siblings", "I'm alone in the world", or "I have no family." Your siblings are: ${sibNames}`);
      }

      // Children
      if (allChildren.length > 0) {
        lines.push('\nYOUR CHILDREN:');
        for (const c of allChildren) {
          let line = `- ${c.name} — your ${c.relationship_type}.`;
          if (c.age) line += ` Age: ${c.age}.`;
          lines.push(line);
        }
        lines.push(`CHILDREN COUNT: You have ${allChildren.length} child${allChildren.length !== 1 ? 'ren' : ''}.`);
        lines.push(`PROHIBITED: Do NOT claim you have no children.`);
      }

      // ── Extended kin — derived from the same recorded parent links ──────────
      const kinSection = (title, list, rule) => {
        if (list.length === 0) return;
        lines.push(`\n${title}`);
        for (const k of list) lines.push(`- ${k.name} — your ${k.relationship_type}.`);
        if (rule) lines.push(rule);
      };
      kinSection('YOUR GRANDPARENTS:', kin.grandparents, 'These are your parents\' parents. Use the correct generational title.');
      kinSection('YOUR GRANDCHILDREN:', kin.grandchildren, 'These are your children\'s children.');
      kinSection('YOUR AUNTS AND UNCLES:', kin.auntsUncles, 'These are your parents\' siblings. Do NOT call them cousins or siblings.');
      kinSection('YOUR NIECES AND NEPHEWS:', kin.niecesNephews, 'These are your siblings\' children. Do NOT call them your children or your cousins.');
      kinSection('YOUR COUSINS:', kin.cousins, 'The degree and any "removed" wording is the correct title for each person. A first cousin once removed is NOT a second cousin. Relate to them as cousins.');

      // ── Kinship rules — relationship facts vs. family dynamics ──────────────
      lines.push('\nKINSHIP RULES:');
      lines.push('- Family titles describe how people are related. They do NOT describe how close you are, how you feel about each other, or how you treat each other. That comes from your history, memories, and relationships.');
      lines.push('- One shared biological parent makes half-siblings. Both shared makes full siblings. A step-parent\'s other children are step-siblings, not biological siblings.');
      lines.push('- Marriage creates step and in-law relationships. It never rewrites who someone\'s biological parents are.');
      lines.push('- Adoption is a real family relationship. It is never a biological one.');
      lines.push('- Do not invent family connections that are not listed here. Having a child with someone does not make you the parent of their other children, and does not make those children your stepchildren.');
      lines.push('- If you learn something new that establishes a relationship (for example, that someone shares your biological parent), reason from it: one shared biological parent makes them your half-sibling. Do not require it to be explained to you again.');

      // Dialogue requirements
      lines.push('\n════════════════════════════════════');
      lines.push('FAMILY DIALOGUE REQUIREMENTS:');
      lines.push('You must be able to accurately answer:');
      lines.push('  - "Do you have brothers or sisters?" → use ACTUAL sibling data above');
      lines.push('  - "Who is your mom/dad?" → use ACTUAL parent data above');
      if (allChildren.length > 0) {
        lines.push('  - "Do you have children?" → YES, list them accurately');
      }
      lines.push('  - "Tell me about your family" → describe using real family graph above');
      lines.push('NEVER CLAIM family members above do not exist.');
      lines.push('Family knowledge is AUTHORITATIVE — it overrides any invented or assumed state.');
      lines.push('════════════════════════════════════');

      promptBlock = lines.join('\n');
    }

    console.log(
      `[resolveCharacterFamilyGraph] char=${targetChar.name} (${characterId})` +
      ` | ownAge=${finalAge} (effective)` +
      ` | gender=${finalGender}` +
      ` | parents=${resolvedParents.length}` +
      ` | explicitSiblings=${explicitSiblings.length}` +
      ` | derivedSiblings=${derivedSiblings.length}` +
      ` | totalSiblings=${allSiblings.length}` +
      ` | children=${allChildren.length}` +
      ` | hasPromptBlock=${promptBlock.length > 0}`
    );

    return Response.json({
      success: true,
      characterId,
      ownAge: finalAge,
      ownGender: finalGender,
      ownBirthday: dob ? dob.date : null,
      birthdayMonthDay: dob ? dob.monthDay : null,
      parents: resolvedParents,
      siblings: allSiblings,
      children: allChildren,
      grandparents: kin.grandparents,
      grandchildren: kin.grandchildren,
      auntsUncles: kin.auntsUncles,
      niecesNephews: kin.niecesNephews,
      cousins: kin.cousins,
      derivedSiblingsCount: derivedSiblings.length,
      explicitSiblingsCount: explicitSiblings.length,
      promptBlock,
    });

  } catch (error) {
    console.error('[resolveCharacterFamilyGraph]', error);
    // Non-blocking — return empty promptBlock on failure
    return Response.json({
      success: false,
      error: error.message,
      promptBlock: '',
      parents: [],
      siblings: [],
      children: [],
      derivedSiblingsCount: 0,
      explicitSiblingsCount: 0,
    }, { status: 500 });
  }
});