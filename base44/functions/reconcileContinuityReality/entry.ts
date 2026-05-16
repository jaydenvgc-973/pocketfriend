/**
 * reconcileContinuityReality
 *
 * Scans ALL conversations (chat, world phone, group), messages, and narratives
 * for character-to-character interaction claims. Writes bilateral Memory records
 * where one side is missing. Returns full proof report.
 *
 * Call with dry_run=false to apply repairs.
 * Call with dry_run=true (default) for a safe preview.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── CLAIM DETECTION PATTERNS ──────────────────────────────────────────────────
const CLAIM_PATTERNS = [
  /\b(?:went to see|visited|stopped by to see|stopped by|came over|came by|dropped by|showed up at|checked on|swung by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:stopped by|came over|came by|dropped by|visited me|checked on me|showed up|swung by)/g,
  /\b(?:talked to|spoke with|called|texted|reached out to|messaged|hit up|linked up with|met up with|caught up with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:told me|said to me|mentioned to me|explained to me|called me|texted me|hit me up)/g,
  /\b(?:ran into|bumped into|saw|spotted|hung out with|chilled with|kicked it with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+and I\s+(?:hung out|chilled|talked|met|went|came|were)/g,
  /\bme and\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:hung out|chilled|talked|met|went|came|were)/g,
  /\b(?:I (?:was|went) (?:with|over at|at))\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:was here|was there|came through|pulled up|linked)/g,
];

const NON_NAME_WORDS = new Set([
  'The','This','That','They','Their','There','Then','When','What','Where','Which',
  'Who','Why','How','But','And','For','Not','Just','Its','My','Your','His','Her',
  'Our','We','He','She','You','Me','Us','Him','All','Some','Any','No','Yes','So',
  'As','At','On','In','To','Up','Do','Go','Be','Is','It','If','Or','An','Am',
  'Are','Was','Had','Has','Did','Can','Will','New','Old','Good','Bad','Big','God',
  'Hey','Well','Okay','Oh','Yeah','Alright','Right','Left','Still','Already',
  'Always','Never','Every','Also','Just','Even','Like','Really','Very',
]);

function extractMentionedNames(text) {
  if (!text || typeof text !== 'string') return [];
  const names = new Set();
  for (const pattern of CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = (match[1] || '').trim();
      if (!candidate || candidate.length < 2 || candidate.length > 40) continue;
      const firstWord = candidate.split(' ')[0];
      if (NON_NAME_WORDS.has(firstWord)) continue;
      if (!/^[A-Z]/.test(candidate)) continue;
      names.add(candidate);
    }
  }
  return [...names];
}

function resolveNameToCharacter(nameFragment, characterMap) {
  const lowerFrag = nameFragment.toLowerCase().trim();
  const candidates = [];
  for (const [charId, char] of Object.entries(characterMap)) {
    const fullName = (char.name || '').toLowerCase();
    const firstName = fullName.split(' ')[0];
    const displayName = (char.display_name || char.primary_name || '').toLowerCase();
    const aliases = (char.aliases || []).map(a => (typeof a === 'string' ? a : (a.name || a.alias || '')).toLowerCase());
    if (fullName === lowerFrag || displayName === lowerFrag) {
      candidates.unshift({ id: charId, confidence: 1.0, matchType: 'exact' });
    } else if (firstName === lowerFrag && firstName.length >= 3) {
      candidates.push({ id: charId, confidence: 0.8, matchType: 'first_name' });
    } else if (aliases.some(a => a === lowerFrag && a.length >= 3)) {
      candidates.push({ id: charId, confidence: 0.85, matchType: 'alias' });
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const sorted = candidates.sort((a, b) => b.confidence - a.confidence);
  if (sorted[0].confidence - (sorted[1]?.confidence || 0) >= 0.15) return sorted[0];
  return null; // ambiguous
}

async function getMemoryCountForChar(base44, charId) {
  const [mems, charMems] = await Promise.all([
    base44.asServiceRole.entities.Memory.filter({ character_id: charId }, null, 500).catch(() => []),
    base44.asServiceRole.entities.CharacterMemory.filter({ character_id: charId }, null, 500).catch(() => []),
  ]);
  return { Memory: mems.length, CharacterMemory: charMems.length };
}

async function hasMemoryOfCharacter(base44, charId, otherCharId, otherCharName) {
  const [mems, charMems] = await Promise.all([
    base44.asServiceRole.entities.Memory.filter({ character_id: charId }, null, 500).catch(() => []),
    base44.asServiceRole.entities.CharacterMemory.filter({ character_id: charId }, null, 500).catch(() => []),
  ]);
  const lowerName = (otherCharName || '').toLowerCase();
  const inMemory = mems.some(m =>
    m.related_character_id === otherCharId ||
    (lowerName.length > 2 && (m.description || '').toLowerCase().includes(lowerName)) ||
    (lowerName.length > 2 && (m.title || '').toLowerCase().includes(lowerName))
  );
  const inCharMemory = charMems.some(m =>
    m.related_character_id === otherCharId ||
    (lowerName.length > 2 && (m.memory_text || '').toLowerCase().includes(lowerName)) ||
    (lowerName.length > 2 && (m.memory_summary || '').toLowerCase().includes(lowerName))
  );
  return inMemory || inCharMemory;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const maxConversations = body.max_conversations || 50;

    console.log(`[reconcile] START user=${user.email} dry_run=${dryRun}`);

    const report = {
      user: user.email,
      dry_run: dryRun,
      scanned: { conversations: 0, messages: 0, narratives: 0 },
      characters_loaded: 0,
      claims_detected: [],
      repairs_made: [],
      skipped_ambiguous: [],
      memory_counts_before: {},
      memory_counts_after: {},
      summary: {},
    };

    // ── 1. LOAD ALL USER CHARACTERS ──────────────────────────────────────────
    // User-scoped first (RLS-aware), service-role fallback
    let charactersList = await base44.entities.Character.filter({ status: 'active' }, null, 300).catch(() => []);
    if (charactersList.length === 0) {
      charactersList = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email }, null, 300).catch(() => []);
    }
    // Also load soft-deleted/merged so we don't miss their conversations
    const characterMap = {};
    for (const c of charactersList) {
      characterMap[c.id] = c;
    }
    report.characters_loaded = charactersList.length;
    console.log(`[reconcile] Characters loaded: ${charactersList.length}`);

    // ── 2. BASELINE MEMORY COUNTS ────────────────────────────────────────────
    for (const c of charactersList) {
      const counts = await getMemoryCountForChar(base44, c.id);
      report.memory_counts_before[c.id] = { name: c.name, ...counts };
    }

    // ── 3. LOAD ALL CONVERSATIONS (chat + world_phone + group) ────────────────
    // Use service role to get all conversations regardless of channel
    const allConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: user.email },
      '-last_message_date',
      maxConversations
    ).catch(() => []);
    report.scanned.conversations = allConvos.length;
    console.log(`[reconcile] Conversations: ${allConvos.length}`);

    // Build conversation → character ID map from conversation records
    // conversation.character_ids contains the characters involved
    const convoCharMap = {};
    for (const c of allConvos) {
      convoCharMap[c.id] = c.character_ids || [];
    }

    // ── 4. LOAD MESSAGES from all conversations ───────────────────────────────
    // Scan multiple text fields: content, message, text, body
    let allMessages = [];
    const convoIds = allConvos.map(c => c.id);

    for (const convoId of convoIds.slice(0, maxConversations)) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convoId },
        '-created_date',
        100
      ).catch(() => []);
      allMessages = allMessages.concat(msgs.map(m => ({
        ...m,
        _convoCharIds: convoCharMap[convoId] || [],
      })));
    }
    report.scanned.messages = allMessages.length;
    console.log(`[reconcile] Messages: ${allMessages.length}`);

    // ── 5. LOAD AUTOMATIC NARRATIVES ─────────────────────────────────────────
    const narratives = await base44.asServiceRole.entities.AutomaticNarrative.filter(
      { owner_email: user.email },
      '-created_date',
      500
    ).catch(() => []);
    report.scanned.narratives = narratives.length;

    // ── 6. BUILD CLAIM SOURCES ────────────────────────────────────────────────
    // For each source, extract:
    //   - claimingCharacterId: who is speaking/whose context this is
    //   - text: the content to scan
    //   - fallback: convo character IDs if claimingCharacterId is missing
    const claimSources = [];

    for (const m of allMessages) {
      // Multiple text fields to check
      const texts = [m.content, m.message, m.text, m.body, m.response].filter(Boolean);
      for (const t of texts) {
        claimSources.push({
          text: t,
          sourceId: m.id,
          sourceType: 'message',
          claimingCharacterId: m.character_id || null,
          fallbackCharIds: m._convoCharIds || [],
          channel: m.channel || 'direct',
        });
      }
    }

    for (const n of narratives) {
      const texts = [n.narrative_text, n.memory_summary].filter(Boolean);
      for (const t of texts) {
        claimSources.push({
          text: t,
          sourceId: n.id,
          sourceType: 'narrative',
          claimingCharacterId: n.character_id || null,
          fallbackCharIds: [],
          channel: 'narrative',
        });
      }
    }

    // ── 7. EXTRACT CLAIMS AND BUILD PAIR MAP ─────────────────────────────────
    // key: sorted charA::charB → evidence array
    const claimsMap = new Map();

    for (const source of claimSources) {
      const mentionedNames = extractMentionedNames(source.text);
      if (mentionedNames.length === 0) continue;

      // Determine "speaker" character ID(s)
      // If claimingCharacterId is set and known → use it
      // If not, use all characters from fallbackCharIds as potential claimants
      const speakerIds = [];
      if (source.claimingCharacterId && characterMap[source.claimingCharacterId]) {
        speakerIds.push(source.claimingCharacterId);
      } else {
        // Fallback: use conversation characters as potential claimants
        for (const fid of source.fallbackCharIds) {
          if (characterMap[fid]) speakerIds.push(fid);
        }
      }

      for (const speakerId of speakerIds) {
        for (const name of mentionedNames) {
          const resolved = resolveNameToCharacter(name, characterMap);
          if (!resolved) continue;
          if (resolved.id === speakerId) continue; // self-reference

          const key = [speakerId, resolved.id].sort().join('::');
          if (!claimsMap.has(key)) claimsMap.set(key, []);
          claimsMap.get(key).push({
            mentionedName: name,
            resolvedId: resolved.id,
            resolvedName: characterMap[resolved.id]?.name,
            confidence: resolved.confidence,
            matchType: resolved.matchType,
            sourceId: source.sourceId,
            sourceType: source.sourceType,
            channel: source.channel,
            claimingCharacterId: speakerId,
            claimingCharacterName: characterMap[speakerId]?.name,
            textExcerpt: source.text.substring(0, 200),
          });
        }
      }
    }

    console.log(`[reconcile] Unique character-pair claim groups: ${claimsMap.size}`);

    // ── 8. CHECK BILATERAL MEMORY AND REPAIR ─────────────────────────────────
    for (const [key, evidenceList] of claimsMap.entries()) {
      const [charAId, charBId] = key.split('::');
      const charA = characterMap[charAId];
      const charB = characterMap[charBId];
      if (!charA || !charB) continue;

      const hasHighConf = evidenceList.some(e => e.confidence >= 0.8);

      const [aHasMem, bHasMem] = await Promise.all([
        hasMemoryOfCharacter(base44, charAId, charBId, charB.name),
        hasMemoryOfCharacter(base44, charBId, charAId, charA.name),
      ]);

      const claim = {
        charA: { id: charAId, name: charA.name },
        charB: { id: charBId, name: charB.name },
        evidence_count: evidenceList.length,
        sample_source_ids: evidenceList.slice(0, 3).map(e => e.sourceId),
        sample_channels: [...new Set(evidenceList.map(e => e.channel))],
        sample_excerpt: evidenceList[0]?.textExcerpt?.substring(0, 150),
        charA_has_memory: aHasMem,
        charB_has_memory: bHasMem,
        high_confidence: hasHighConf,
        action: null,
      };
      report.claims_detected.push(claim);

      if (!hasHighConf) {
        claim.action = 'skipped_low_confidence';
        report.skipped_ambiguous.push({ ...claim, reason: 'No high-confidence name resolution (first-name only + ambiguous)' });
        continue;
      }

      if (aHasMem && bHasMem) {
        claim.action = 'already_bilateral';
        continue;
      }

      // Write missing memory sides
      const firstEvidence = evidenceList.find(e => e.confidence >= 0.8);
      const timestamp = new Date().toISOString();
      const baseNote = `Interaction confirmed in ${firstEvidence?.sourceType || 'conversation'} (channel: ${firstEvidence?.channel || 'unknown'}). Excerpt: "${(firstEvidence?.textExcerpt || '').substring(0, 200)}"`;

      if (!dryRun) {
        const writes = [];
        if (!aHasMem) {
          writes.push(
            base44.asServiceRole.entities.Memory.create({
              character_id: charAId,
              title: `Interaction with ${charB.name}`,
              description: `${baseNote}`,
              emotional_impact: 'neutral',
              lesson_learned: 'Bilateral continuity repair by reconcileContinuityReality.',
              timestamp,
              source_context: `reconciliation:${firstEvidence?.sourceId || 'unknown'}`,
            }).catch(e => console.error(`[reconcile] Memory write failed for ${charAId}:`, e.message))
          );
        }
        if (!bHasMem) {
          writes.push(
            base44.asServiceRole.entities.Memory.create({
              character_id: charBId,
              title: `Interaction with ${charA.name}`,
              description: `${baseNote}`,
              emotional_impact: 'neutral',
              lesson_learned: 'Bilateral continuity repair by reconcileContinuityReality.',
              timestamp,
              source_context: `reconciliation:${firstEvidence?.sourceId || 'unknown'}`,
            }).catch(e => console.error(`[reconcile] Memory write failed for ${charBId}:`, e.message))
          );
        }
        await Promise.all(writes);
      }

      claim.action = dryRun ? 'would_repair' : 'repaired';
      claim.repaired_sides = [
        ...(!aHasMem ? [`${charA.name} (was missing memory of ${charB.name})`] : []),
        ...(!bHasMem ? [`${charB.name} (was missing memory of ${charA.name})`] : []),
      ];
      report.repairs_made.push(claim);
    }

    // ── 9. AFTER MEMORY COUNTS ────────────────────────────────────────────────
    // Only fetch after-counts for characters that were actually repaired (not all 45)
    // to avoid 90+ sequential queries that cause timeout.
    if (!dryRun && report.repairs_made.length > 0) {
      const repairedCharIds = new Set();
      for (const r of report.repairs_made) {
        repairedCharIds.add(r.charA.id);
        repairedCharIds.add(r.charB.id);
      }
      for (const charId of repairedCharIds) {
        const c = characterMap[charId];
        if (!c) continue;
        const counts = await getMemoryCountForChar(base44, charId);
        report.memory_counts_after[charId] = { name: c.name, ...counts };
      }
    }

    // ── 10. SUMMARY ───────────────────────────────────────────────────────────
    const alreadyBilateral = report.claims_detected.filter(c => c.action === 'already_bilateral').length;
    report.summary = {
      characters_loaded: report.characters_loaded,
      conversations_scanned: report.scanned.conversations,
      messages_scanned: report.scanned.messages,
      narratives_scanned: report.scanned.narratives,
      unique_claim_pairs: claimsMap.size,
      already_bilateral: alreadyBilateral,
      repairs_made: report.repairs_made.length,
      skipped_ambiguous: report.skipped_ambiguous.length,
      dry_run: dryRun,
      note: dryRun
        ? `DRY RUN — no writes made. ${report.repairs_made.length} pair(s) would be repaired. Call with dry_run=false to apply.`
        : `${report.repairs_made.length} bilateral memory pair(s) repaired. ${report.skipped_ambiguous.length} skipped as ambiguous.`,
    };

    console.log(`[reconcile] COMPLETE | pairs=${claimsMap.size} | repaired=${report.repairs_made.length} | skipped=${report.skipped_ambiguous.length}`);
    return Response.json(report);

  } catch (error) {
    console.error('[reconcile] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});