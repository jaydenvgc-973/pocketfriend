/**
 * reconcileContinuityReality
 *
 * Scans active conversations, World Contact threads, recent messages, and
 * automatic narratives for character-to-character claims. Detects one-sided
 * memory entries (A remembers B but B has no matching record) and writes
 * reciprocal memories where evidence is clear. Flags ambiguous cases as
 * diagnostic records rather than inventing facts.
 *
 * PROOF OUTPUT: Returns full diagnostic report showing every scan result,
 * claim detected, character IDs resolved, memory state before/after, and
 * what was repaired vs skipped.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── CLAIM DETECTION PATTERNS ──────────────────────────────────────────────────
// These patterns detect character-to-character claims in message/narrative text.
// Each pattern returns a "mentioned name" fragment that we then try to resolve.

const CLAIM_PATTERNS = [
  // "I went to see [Name]" / "I visited [Name]"
  /\b(?:went to see|visited|stopped by to see)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  // "[Name] stopped by" / "[Name] came over" / "[Name] came by"
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:stopped by|came over|came by|dropped by|visited|showed up)/g,
  // "I talked to [Name]" / "I spoke with [Name]" / "I called [Name]"
  /\b(?:talked to|spoke with|called|texted|reached out to|messaged)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  // "[Name] told me" / "[Name] said" / "[Name] mentioned"
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:told me|said|mentioned|explained|told him|told her|told them)/g,
  // "I ran into [Name]" / "I saw [Name]"
  /\b(?:ran into|bumped into|saw|met with|hung out with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  // "[Name] and I" constructions
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+and I\b/g,
];

// Common words that look like names but aren't
const NON_NAME_WORDS = new Set([
  'The', 'This', 'That', 'They', 'Their', 'There', 'Then', 'When', 'What',
  'Where', 'Which', 'Who', 'Why', 'How', 'But', 'And', 'For', 'Not', 'Just',
  'Its', 'Its', 'My', 'Your', 'His', 'Her', 'Our', 'We', 'He', 'She', 'You',
  'Me', 'Us', 'Him', 'All', 'Some', 'Any', 'No', 'Yes', 'So', 'As', 'At',
  'On', 'In', 'To', 'Up', 'Do', 'Go', 'Be', 'Is', 'It', 'If', 'Or', 'An',
  'Am', 'Are', 'Was', 'Had', 'Has', 'Did', 'Can', 'Will', 'New', 'Old',
  'Good', 'Bad', 'Big', 'God', 'Hey', 'Well', 'Okay', 'Oh', 'Yeah',
]);

function extractMentionedNames(text) {
  if (!text || typeof text !== 'string') return [];
  const names = new Set();
  for (const pattern of CLAIM_PATTERNS) {
    // Reset lastIndex since patterns have /g flag
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1]?.trim();
      if (!candidate) continue;
      if (candidate.length < 2 || candidate.length > 40) continue;
      const firstWord = candidate.split(' ')[0];
      if (NON_NAME_WORDS.has(firstWord)) continue;
      // Must start with capital (already checked by regex), min 2 chars
      names.add(candidate);
    }
  }
  return [...names];
}

// ── NAME-TO-CHARACTER RESOLVER ────────────────────────────────────────────────
// Resolves a name fragment to a canonical character ID using the user's character list.
// Uses exact full name match first, then first-name match, then alias match.
// Returns null if ambiguous (multiple matches) to avoid false identity assignment.

function resolveNameToCharacter(nameFragment, characterMap) {
  const lowerFrag = nameFragment.toLowerCase().trim();
  const candidates = [];

  for (const [charId, char] of Object.entries(characterMap)) {
    const fullName = (char.name || '').toLowerCase();
    const firstName = fullName.split(' ')[0];
    const displayName = (char.display_name || char.primary_name || '').toLowerCase();
    const aliases = (char.aliases || []).map(a => (a.name || a.alias || a || '').toLowerCase());

    if (fullName === lowerFrag || displayName === lowerFrag) {
      // Exact match — highest confidence
      candidates.unshift({ id: charId, confidence: 1.0, matchType: 'exact' });
    } else if (firstName === lowerFrag) {
      candidates.push({ id: charId, confidence: 0.8, matchType: 'first_name' });
    } else if (aliases.some(a => a === lowerFrag)) {
      candidates.push({ id: charId, confidence: 0.85, matchType: 'alias' });
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Multiple candidates — check if one is clearly better
  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
  const second = candidates[1];
  if (best.confidence - second.confidence >= 0.15) return best; // clear winner
  return null; // ambiguous
}

// ── MEMORY EXISTENCE CHECK ────────────────────────────────────────────────────
// Returns true if characterId has any Memory or CharacterMemory record that references
// the other character's ID as related_character_id, or whose text mentions the other's name.

async function hasMemoryOfCharacter(base44, charId, otherCharId, otherCharName) {
  const [directMems, charMems] = await Promise.all([
    base44.asServiceRole.entities.Memory.filter({ character_id: charId }, null, 200).catch(() => []),
    base44.asServiceRole.entities.CharacterMemory.filter({ character_id: charId }, null, 200).catch(() => []),
  ]);

  const lowerName = (otherCharName || '').toLowerCase();

  const hasInMemory = directMems.some(m =>
    m.related_character_id === otherCharId ||
    (lowerName && (m.description || '').toLowerCase().includes(lowerName)) ||
    (lowerName && (m.title || '').toLowerCase().includes(lowerName))
  );

  const hasInCharMemory = charMems.some(m =>
    m.related_character_id === otherCharId ||
    (lowerName && (m.memory_text || '').toLowerCase().includes(lowerName)) ||
    (lowerName && (m.memory_summary || '').toLowerCase().includes(lowerName))
  );

  return {
    exists: hasInMemory || hasInCharMemory,
    memoryCount: directMems.length + charMems.length,
  };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default: dry_run=true (safe preview mode)
    const maxMessages = body.max_messages || 500;

    console.log(`[reconcileContinuity] START | user=${user.email} | dry_run=${dryRun} | max_messages=${maxMessages}`);

    const report = {
      user: user.email,
      dry_run: dryRun,
      scanned: {
        conversations: 0,
        messages: 0,
        narratives: 0,
      },
      claims_detected: [],
      repairs_made: [],
      skipped_ambiguous: [],
      memory_counts_before: {},
      memory_counts_after: {},
      summary: {},
    };

    // ── 1. LOAD ALL USER CHARACTERS → build ID map ────────────────────────────
    // Character entity uses owner_email RLS — user-scoped call is the correct path.
    // service role with owner_email filter also works but try user-scoped first.
    let charactersList = await base44.entities.Character.filter(
      { status: 'active' },
      null,
      200
    ).catch(() => []);

    // Fallback: service role with explicit owner_email filter
    if (charactersList.length === 0) {
      charactersList = await base44.asServiceRole.entities.Character.filter(
        { owner_email: user.email },
        null,
        200
      ).catch(() => []);
    }

    const characterMap = {};
    for (const c of charactersList) {
      characterMap[c.id] = c;
    }

    console.log(`[reconcileContinuity] Loaded ${charactersList.length} characters`);

    // ── 2. RECORD BASELINE MEMORY COUNTS ─────────────────────────────────────
    for (const charId of Object.keys(characterMap)) {
      const [mems, charMems] = await Promise.all([
        base44.asServiceRole.entities.Memory.filter({ character_id: charId }, null, 1000).catch(() => []),
        base44.asServiceRole.entities.CharacterMemory.filter({ character_id: charId }, null, 1000).catch(() => []),
      ]);
      report.memory_counts_before[charId] = {
        name: characterMap[charId].name,
        Memory: mems.length,
        CharacterMemory: charMems.length,
      };
    }

    // ── 3. LOAD RECENT MESSAGES (scoped to user's conversations) ──────────────
    const conversations = await base44.entities.Conversation.filter(
      { owner_email: user.email },
      '-last_message_date',
      100
    ).catch(() => []);
    report.scanned.conversations = conversations.length;

    const convoIds = conversations.map(c => c.id);
    let allMessages = [];

    // Fetch messages in batches per conversation (avoid one giant unscoped query)
    for (const convoId of convoIds.slice(0, 30)) { // cap at 30 conversations for perf
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convoId },
        '-created_date',
        50
      ).catch(() => []);
      allMessages = allMessages.concat(msgs);
      if (allMessages.length >= maxMessages) break;
    }
    report.scanned.messages = allMessages.length;
    console.log(`[reconcileContinuity] Loaded ${allMessages.length} messages from ${Math.min(convoIds.length, 30)} conversations`);

    // ── 4. LOAD RECENT AUTOMATIC NARRATIVES ───────────────────────────────────
    const narratives = await base44.asServiceRole.entities.AutomaticNarrative.filter(
      { owner_email: user.email },
      '-created_date',
      200
    ).catch(() => []);
    report.scanned.narratives = narratives.length;

    // ── 5. EXTRACT CLAIMS FROM MESSAGES AND NARRATIVES ────────────────────────
    const claimSources = [
      ...allMessages.map(m => ({ text: m.content, sourceId: m.id, sourceType: 'message', characterId: m.character_id, conversationId: m.conversation_id })),
      ...narratives.map(n => ({ text: n.narrative_text, sourceId: n.id, sourceType: 'narrative', characterId: n.character_id, conversationId: null })),
    ];

    const claimsMap = new Map(); // key: `${charA}::${charB}` → array of evidence

    for (const source of claimSources) {
      if (!source.text || !source.characterId) continue;
      if (!characterMap[source.characterId]) continue; // not a character we own

      const mentionedNames = extractMentionedNames(source.text);
      for (const name of mentionedNames) {
        const resolved = resolveNameToCharacter(name, characterMap);
        if (!resolved) continue; // ambiguous or unknown — skip
        if (resolved.id === source.characterId) continue; // self-reference — skip

        const key = [source.characterId, resolved.id].sort().join('::');
        if (!claimsMap.has(key)) claimsMap.set(key, []);
        claimsMap.get(key).push({
          mentionedName: name,
          resolvedId: resolved.id,
          resolvedName: characterMap[resolved.id]?.name,
          confidence: resolved.confidence,
          matchType: resolved.matchType,
          sourceId: source.sourceId,
          sourceType: source.sourceType,
          claimingCharacterId: source.characterId,
          claimingCharacterName: characterMap[source.characterId]?.name,
          textExcerpt: source.text.substring(0, 150),
        });
      }
    }

    console.log(`[reconcileContinuity] Detected ${claimsMap.size} unique character-pair claim groups`);

    // ── 6. CHECK BILATERAL MEMORY & REPAIR ───────────────────────────────────
    for (const [key, evidenceList] of claimsMap.entries()) {
      const [charAId, charBId] = key.split('::');
      const charA = characterMap[charAId];
      const charB = characterMap[charBId];
      if (!charA || !charB) continue;

      const [memA, memB] = await Promise.all([
        hasMemoryOfCharacter(base44, charAId, charBId, charB.name),
        hasMemoryOfCharacter(base44, charBId, charAId, charA.name),
      ]);

      const claim = {
        charA: { id: charAId, name: charA.name },
        charB: { id: charBId, name: charB.name },
        evidence_count: evidenceList.length,
        sample_source_ids: evidenceList.slice(0, 3).map(e => e.sourceId),
        sample_source_types: evidenceList.slice(0, 3).map(e => e.sourceType),
        sample_excerpt: evidenceList[0]?.textExcerpt,
        charA_has_memory: memA.exists,
        charA_memory_count: memA.memoryCount,
        charB_has_memory: memB.exists,
        charB_memory_count: memB.memoryCount,
        action: null,
      };
      report.claims_detected.push(claim);

      // Only repair if evidence is high-confidence (at least one exact/alias match)
      const hasHighConfidence = evidenceList.some(e => e.confidence >= 0.8);
      if (!hasHighConfidence) {
        claim.action = 'skipped_low_confidence';
        report.skipped_ambiguous.push({ ...claim, reason: 'No high-confidence name resolution found' });
        continue;
      }

      // Determine what needs repair
      const needsRepairForA = !memA.exists;
      const needsRepairForB = !memB.exists;

      if (!needsRepairForA && !needsRepairForB) {
        claim.action = 'already_bilateral';
        continue;
      }

      // Build memory text from evidence
      const firstEvidence = evidenceList.find(e => e.confidence >= 0.8);
      const memoryTitle = `Interaction with ${charB.name}`;
      const memoryDesc = `Evidence of interaction between ${charA.name} and ${charB.name} found in ${firstEvidence?.sourceType || 'conversation'}. Source excerpt: "${(firstEvidence?.textExcerpt || '').substring(0, 200)}"`;

      if (!dryRun) {
        const writes = [];

        if (needsRepairForA) {
          writes.push(
            base44.asServiceRole.entities.Memory.create({
              character_id: charAId,
              title: memoryTitle,
              description: memoryDesc,
              emotional_impact: 'neutral',
              lesson_learned: 'Bilateral continuity repair — this memory was written by reconcileContinuityReality to restore missing interaction record.',
              timestamp: new Date().toISOString(),
              source_context: `reconciliation:${firstEvidence?.sourceId || 'unknown'}`,
            }).catch(err => { console.error(`[reconcile] Failed to write Memory for ${charAId}:`, err.message); return null; })
          );
        }

        if (needsRepairForB) {
          writes.push(
            base44.asServiceRole.entities.Memory.create({
              character_id: charBId,
              title: `Interaction with ${charA.name}`,
              description: `Evidence of interaction between ${charB.name} and ${charA.name} found in ${firstEvidence?.sourceType || 'conversation'}. Source excerpt: "${(firstEvidence?.textExcerpt || '').substring(0, 200)}"`,
              emotional_impact: 'neutral',
              lesson_learned: 'Bilateral continuity repair — this memory was written by reconcileContinuityReality to restore missing interaction record.',
              timestamp: new Date().toISOString(),
              source_context: `reconciliation:${firstEvidence?.sourceId || 'unknown'}`,
            }).catch(err => { console.error(`[reconcile] Failed to write Memory for ${charBId}:`, err.message); return null; })
          );
        }

        await Promise.all(writes);
      }

      claim.action = dryRun ? 'would_repair' : 'repaired';
      claim.repaired_sides = [];
      if (needsRepairForA) claim.repaired_sides.push(`${charA.name} (missing memory of ${charB.name})`);
      if (needsRepairForB) claim.repaired_sides.push(`${charB.name} (missing memory of ${charA.name})`);

      report.repairs_made.push(claim);
    }

    // ── 7. RECORD AFTER MEMORY COUNTS (only on real run) ─────────────────────
    if (!dryRun) {
      for (const charId of Object.keys(characterMap)) {
        const [mems, charMems] = await Promise.all([
          base44.asServiceRole.entities.Memory.filter({ character_id: charId }, null, 1000).catch(() => []),
          base44.asServiceRole.entities.CharacterMemory.filter({ character_id: charId }, null, 1000).catch(() => []),
        ]);
        report.memory_counts_after[charId] = {
          name: characterMap[charId].name,
          Memory: mems.length,
          CharacterMemory: charMems.length,
        };
      }
    }

    // ── 8. BUILD SUMMARY ──────────────────────────────────────────────────────
    const alreadyBilateral = report.claims_detected.filter(c => c.action === 'already_bilateral').length;
    const repaired = report.repairs_made.length;
    const skipped = report.skipped_ambiguous.length;
    const lowConf = report.claims_detected.filter(c => c.action === 'skipped_low_confidence').length;

    report.summary = {
      characters_scanned: charactersList.length,
      conversations_scanned: report.scanned.conversations,
      messages_scanned: report.scanned.messages,
      narratives_scanned: report.scanned.narratives,
      unique_claim_pairs_found: claimsMap.size,
      already_bilateral: alreadyBilateral,
      repairs_made: repaired,
      skipped_ambiguous: skipped,
      skipped_low_confidence: lowConf,
      dry_run: dryRun,
      note: dryRun
        ? 'DRY RUN — no writes were made. Call with dry_run=false to apply repairs.'
        : `${repaired} bilateral memory pair(s) repaired. ${skipped + lowConf} skipped as ambiguous.`,
    };

    console.log(`[reconcileContinuity] COMPLETE | pairs=${claimsMap.size} | repaired=${repaired} | skipped=${skipped + lowConf} | dry_run=${dryRun}`);

    return Response.json(report);

  } catch (error) {
    console.error('[reconcileContinuity] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});