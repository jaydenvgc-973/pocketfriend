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

function resolveAge(c) {
  if (c?.age && typeof c.age === 'number' && c.age > 0) return c.age;
  return null;
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

function deriveChildLabel(childRecord) {
  const gender = childRecord?.gender;
  if (gender === 'male') return 'son';
  if (gender === 'female') return 'daughter';
  return 'child';
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

    const ownAge = resolveAge(targetChar);
    const familyMembers = targetChar.family_members || [];

    // ── STEP 1: Identify explicit family members by type ─────────────────────
    const explicitParents = familyMembers.filter(m =>
      PARENT_TYPES.has((m.relationship_type || '').toLowerCase())
    );
    const explicitSiblings = familyMembers.filter(m =>
      SIBLING_TYPES.has((m.relationship_type || '').toLowerCase())
    );
    const explicitChildren = familyMembers.filter(m =>
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
          const sibAge = sibChar ? resolveAge(sibChar) : (m.age || null);
          const sibGender = sibChar?.gender || null;
          seenSiblingIds.add(childLinkId);
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
      const listsAsParent = otherFamily.some(m => {
        // Check both field names
        const mLinkId = m._linked_character_id || m.character_id || null;
        return mLinkId === characterId &&
          PARENT_TYPES.has((m.relationship_type || '').toLowerCase());
      });

      if (listsAsParent && !seenChildIds.has(otherChar.id)) {
        seenChildIds.add(otherChar.id);
        derivedChildren.push({
          name: otherChar.display_name || otherChar.name,
          character_id: otherChar.id,
          age: resolveAge(otherChar),
          gender: otherChar.gender,
          relationship_type: deriveChildLabel(otherChar),
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

    // ── STEP 6: Build the authoritative prompt block ──────────────────────────
    const hasAnyFamily = resolvedParents.length > 0 || allSiblings.length > 0 || allChildren.length > 0;

    let promptBlock = '';

    if (hasAnyFamily || ownAge) {
      const lines = [];
      lines.push('════════════════════════════════════');
      lines.push('AUTHORITATIVE FAMILY KNOWLEDGE — DERIVED FROM FAMILY GRAPH');
      lines.push('These are VERIFIED FACTS. You KNOW these people exist. You cannot contradict them.');
      lines.push('════════════════════════════════════');

      // Age
      if (ownAge) {
        const ageGroup = ownAge <= 3 ? 'toddler' : ownAge <= 12 ? 'child' : ownAge <= 17 ? 'teenager' : ownAge <= 25 ? 'young adult' : 'adult';
        lines.push(`YOUR AGE: You are ${ownAge} years old (${ageGroup}). This is a fact — never express uncertainty about your own age.`);
      }

      // Parents
      if (resolvedParents.length > 0) {
        lines.push('\nYOUR PARENTS:');
        for (const p of resolvedParents) {
          const naturalTerm = p.is_mother ? 'Mom' : 'Dad';
          let line = `- ${p.name} — your ${p.relationship_type}. Call them "${naturalTerm}" naturally in conversation (not by first name).`;
          if (p.age) line += ` Age: ${p.age}.`;
          lines.push(line);
        }
        lines.push(`RULE: Do NOT address your parent by their first name as if they were a stranger. Use "${resolvedParents[0]?.is_mother ? 'Mom' : 'Dad'}" etc.`);
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
      ` | ownAge=${ownAge}` +
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
      ownAge,
      parents: resolvedParents,
      siblings: allSiblings,
      children: allChildren,
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