/**
 * resolveRelationshipTension
 *
 * Computes or retrieves the relationship tension between two characters.
 * Uses a cache (RelationshipTension entity) — recomputes only when stale (>2h) or forced.
 *
 * INPUT: { characterAId, characterBId, forceRefresh? }
 * OUTPUT: RelationshipTension record
 *
 * RULES:
 * - All reads scoped to owner_email — never created_by
 * - Does not overwrite relationship labels or scores
 * - Does not invent drama without evidence
 * - Cache prevents profile page slowdown
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterAId, characterBId, forceRefresh = false } = await req.json();

    if (!characterAId || !characterBId) {
      return Response.json({ error: 'characterAId and characterBId are required' }, { status: 400 });
    }

    const ownerEmail = user.email;
    const pairKey = [characterAId, characterBId].sort().join('_');

    // ── 1. CHECK CACHE ────────────────────────────────────────────────────────
    if (!forceRefresh) {
      const existing = await base44.entities.RelationshipTension.filter(
        { owner_email: ownerEmail, pair_key: pairKey },
        null, 1
      ).catch(() => []);

      const cached = existing?.[0];
      if (cached) {
        const age = cached.last_computed_at
          ? (Date.now() - new Date(cached.last_computed_at).getTime()) / 1000 / 60
          : 999;
        if (age < 120) {
          console.log(`[resolveRelationshipTension] Cache HIT for pair ${pairKey} (${Math.round(age)}m old)`);
          return Response.json({ success: true, tension: cached, source: 'cache' });
        }
      }
    }

    // ── 2. LOAD BOTH CHARACTER RECORDS ────────────────────────────────────────
    const [charAList, charBList] = await Promise.all([
      base44.entities.Character.filter({ id: characterAId }, null, 1).catch(() => []),
      base44.entities.Character.filter({ id: characterBId }, null, 1).catch(() => []),
    ]);

    const charA = charAList?.[0];
    const charB = charBList?.[0];

    if (!charA || !charB) {
      return Response.json({ error: 'One or both characters not found' }, { status: 404 });
    }

    // Ownership check — both must belong to this user
    if (charA.owner_email && charA.owner_email !== ownerEmail) {
      return Response.json({ error: 'Character A does not belong to your account' }, { status: 403 });
    }
    if (charB.owner_email && charB.owner_email !== ownerEmail) {
      return Response.json({ error: 'Character B does not belong to your account' }, { status: 403 });
    }

    // ── 3. LOAD RELATIONSHIP CONTEXT ─────────────────────────────────────────
    // Find the CharacterRelationship record that connects A→B (or B→A)
    const [relAB, relBA] = await Promise.all([
      base44.entities.CharacterRelationship.filter(
        { character_id: characterAId, related_character_id: characterBId },
        null, 1
      ).catch(() => []),
      base44.entities.CharacterRelationship.filter(
        { character_id: characterBId, related_character_id: characterAId },
        null, 1
      ).catch(() => []),
    ]);

    const relAtoB = relAB?.[0] || null;
    const relBtoA = relBA?.[0] || null;

    // ── 4. LOAD RECENT MEMORIES (negative/conflict type) ─────────────────────
    const [memoriesA, memoriesB] = await Promise.all([
      base44.entities.CharacterMemory.filter(
        { character_id: characterAId, related_character_id: characterBId },
        '-created_date', 10
      ).catch(() => []),
      base44.entities.CharacterMemory.filter(
        { character_id: characterBId, related_character_id: characterAId },
        '-created_date', 10
      ).catch(() => []),
    ]);

    const allMemories = [...(memoriesA || []), ...(memoriesB || [])];
    const negativeMemories = allMemories.filter(m => {
      const text = (m.memory_text || m.memory_summary || '').toLowerCase();
      return /conflict|argument|fight|hurt|betray|tension|upset|angry|disappoint|distant|cold|avoid|ignore|jealous|possessive|controlling|lied|lie|secret|hid|trust|broke/i.test(text);
    });

    // ── 5. TENSION ANALYSIS ───────────────────────────────────────────────────
    const result = analyzeTension(charA, charB, relAtoB, relBtoA, negativeMemories);

    if (!result.has_tension) {
      // Store negative result to prevent re-analysis for 2h
      await upsertTensionRecord(base44, ownerEmail, characterAId, characterBId, pairKey, {
        has_tension: false,
        severity: 'low',
        pattern_type: null,
        evidence: [],
        summary: null,
        last_computed_at: new Date().toISOString(),
        trigger_context: 'computed',
      });
      return Response.json({
        success: true,
        tension: { has_tension: false, pair_key: pairKey },
        source: 'computed',
      });
    }

    // ── 6. GENERATE AI SUMMARY ────────────────────────────────────────────────
    const summaryPrompt = buildSummaryPrompt(charA, charB, result);
    let summary = result.summary || '';

    try {
      const aiSummary = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: summaryPrompt,
      });
      if (aiSummary && typeof aiSummary === 'string' && aiSummary.trim().length > 20) {
        summary = aiSummary.trim();
      }
    } catch (llmErr) {
      console.warn(`[resolveRelationshipTension] LLM summary failed: ${llmErr?.message} — using fallback`);
    }

    // ── 7. STORE AND RETURN ───────────────────────────────────────────────────
    const tensionRecord = await upsertTensionRecord(base44, ownerEmail, characterAId, characterBId, pairKey, {
      has_tension: true,
      severity: result.severity,
      pattern_type: result.pattern_type,
      evidence: result.evidence,
      summary,
      last_computed_at: new Date().toISOString(),
      trigger_context: 'computed',
    });

    console.log(`[resolveRelationshipTension] ✓ Tension computed for pair ${pairKey}: severity=${result.severity} pattern=${result.pattern_type}`);

    return Response.json({ success: true, tension: tensionRecord, source: 'computed' });

  } catch (error) {
    const msg = error?.message || 'Unknown error';
    console.error('[resolveRelationshipTension] Fatal:', msg);
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
});

// ── TENSION ANALYSIS ENGINE ───────────────────────────────────────────────────
function analyzeTension(charA, charB, relAtoB, relBtoA, negativeMemories) {
  const evidence = [];
  const patterns = [];

  // Helper to get numeric value safely
  const num = (v, def = 0) => typeof v === 'number' ? v : def;

  // Relationship scores
  const trustA = num(charA.trust_level, 50);
  const trustB = num(charB.trust_level, 50);
  const jealousyA = num(charA.relational_jealousy, 0);
  const jealousyB = num(charB.relational_jealousy, 0);
  const romanticA = num(charA.romantic_level, 0);
  const friendshipA = num(charA.friendship_level, 75);
  const attractionA = num(charA.attraction_level, 0);

  // Traits
  const getTraits = (c) => {
    const t = [];
    if (c.trait_possessive || c.trait_controlling) t.push('controlling');
    if (c.trait_volatile) t.push('volatile');
    if (c.trait_hard_to_read) t.push('hard_to_read');
    if (c.trait_two_faced) t.push('two_faced');
    if (c.trait_blunt) t.push('blunt');
    if (c.trait_stubborn) t.push('stubborn');
    if (c.trait_toxic) t.push('toxic');
    if (c.trait_cynical) t.push('cynical');
    if (c.trait_jealous) t.push('jealous');
    if (c.trait_insatiable) t.push('insatiable');
    if (c.trait_philanderer) t.push('philanderer');
    return t;
  };

  const traitsA = getTraits(charA);
  const traitsB = getTraits(charB);
  const allTraits = [...traitsA, ...traitsB];

  // ── PATTERN 1: Trust + Jealousy conflict ─────────────────────────────────
  if ((jealousyA > 20 || jealousyB > 20) && (trustA < 45 || trustB < 45)) {
    evidence.push(`Jealousy elevated (A:${jealousyA}, B:${jealousyB}) while trust is low (A:${trustA}, B:${trustB})`);
    patterns.push({ type: 'trust_jealousy_conflict', weight: 3 });
  }

  // ── PATTERN 2: Romantic high but trust low ────────────────────────────────
  if (romanticA > 40 && (trustA < 45 || trustB < 45)) {
    evidence.push(`Romantic feelings strong (${romanticA}) but trust is low — creates emotional vulnerability`);
    patterns.push({ type: 'romantic_trust_imbalance', weight: 3 });
  }

  // ── PATTERN 3: Volatile + Stubborn combo ─────────────────────────────────
  if (allTraits.includes('volatile') && (allTraits.includes('stubborn') || allTraits.includes('blunt'))) {
    evidence.push(`Volatile + Stubborn/Blunt traits — arguments may escalate quickly`);
    patterns.push({ type: 'escalation_conflict', weight: 2 });
  }

  // ── PATTERN 4: Controlling trait present ─────────────────────────────────
  if (allTraits.includes('controlling') && (allTraits.includes('hard_to_read') || trustA < 50 || trustB < 50)) {
    evidence.push(`Controlling behavior with guarded communication or low trust — power imbalance detected`);
    patterns.push({ type: 'attachment_independence_conflict', weight: 3 });
  }

  // ── PATTERN 5: Toxic + high closeness ────────────────────────────────────
  if (allTraits.includes('toxic') && (friendshipA > 60 || romanticA > 30)) {
    evidence.push(`Toxic traits paired with emotional closeness — may create recurring hurt patterns`);
    patterns.push({ type: 'toxic_closeness_conflict', weight: 4 });
  }

  // ── PATTERN 6: Negative memory count ─────────────────────────────────────
  if (negativeMemories.length >= 2) {
    evidence.push(`${negativeMemories.length} negative shared memories (conflict, hurt, or trust issues)`);
    patterns.push({ type: 'resentment_conflict', weight: negativeMemories.length >= 4 ? 3 : 2 });
  }

  // ── PATTERN 7: Hard to read + high attachment ────────────────────────────
  if (allTraits.includes('hard_to_read') && (romanticA > 30 || attractionA > 30)) {
    evidence.push(`One party is hard to read while the other has strong attachment — creates insecurity`);
    patterns.push({ type: 'communication_conflict', weight: 2 });
  }

  // ── PATTERN 8: Philanderer or two-faced + romantic closeness ─────────────
  if ((allTraits.includes('philanderer') || allTraits.includes('two_faced')) && romanticA > 20) {
    evidence.push(`Loyalty concerns (philanderer or two-faced trait) in an emotionally close relationship`);
    patterns.push({ type: 'loyalty_trust_conflict', weight: 3 });
  }

  // ── Relationship record signals ───────────────────────────────────────────
  const relData = relAtoB || relBtoA;
  if (relData) {
    const relText = (relData.relationship_notes || relData.context || '').toLowerCase();
    if (/conflict|tension|complicated|on.off|difficult|strained|estranged|rocky/i.test(relText)) {
      evidence.push(`Relationship notes indicate: "${relText.slice(0, 80)}"`);
      patterns.push({ type: 'resentment_conflict', weight: 2 });
    }
  }

  if (patterns.length === 0) {
    return { has_tension: false, severity: 'low', pattern_type: null, evidence: [], summary: null };
  }

  // Score: need at least 3 total weight to surface tension
  const totalWeight = patterns.reduce((s, p) => s + p.weight, 0);
  if (totalWeight < 3) {
    return { has_tension: false, severity: 'low', pattern_type: null, evidence: [], summary: null };
  }

  const severity = totalWeight >= 8 ? 'high' : totalWeight >= 5 ? 'medium' : 'low';
  const dominantPattern = patterns.sort((a, b) => b.weight - a.weight)[0].type;

  return {
    has_tension: true,
    severity,
    pattern_type: dominantPattern,
    evidence,
    summary: null, // will be filled by LLM
  };
}

// ── SUMMARY PROMPT BUILDER ────────────────────────────────────────────────────
function buildSummaryPrompt(charA, charB, result) {
  const evidence = result.evidence.join('; ');
  const traitsA = Object.entries(charA)
    .filter(([k, v]) => k.startsWith('trait_') && v === true)
    .map(([k]) => k.replace('trait_', '').replace(/_/g, ' '))
    .slice(0, 5).join(', ') || 'none noted';
  const traitsB = Object.entries(charB)
    .filter(([k, v]) => k.startsWith('trait_') && v === true)
    .map(([k]) => k.replace('trait_', '').replace(/_/g, ' '))
    .slice(0, 5).join(', ') || 'none noted';

  return `You are analyzing a relationship between two fictional characters.

Character A: ${charA.name}
  Traits: ${traitsA}
  Trust level: ${charA.trust_level ?? 'unknown'}
  Romantic level: ${charA.romantic_level ?? 0}
  Jealousy: ${charA.relational_jealousy ?? 0}

Character B: ${charB.name}
  Traits: ${traitsB}
  Trust level: ${charB.trust_level ?? 'unknown'}
  Romantic level: ${charB.romantic_level ?? 0}

Detected tension evidence: ${evidence}
Tension pattern: ${result.pattern_type}

Write a 2-3 sentence human summary explaining WHY there is tension between these two specific characters based ONLY on the evidence above. Be specific, not generic. Do NOT invent facts. Do NOT say "these characters" — use their actual names. Write in a calm, observational tone like a thoughtful narrator. Output ONLY the summary text, nothing else.`;
}

// ── UPSERT HELPER ─────────────────────────────────────────────────────────────
async function upsertTensionRecord(base44, ownerEmail, characterAId, characterBId, pairKey, data) {
  // Check if record already exists
  const existing = await base44.entities.RelationshipTension.filter(
    { owner_email: ownerEmail, pair_key: pairKey },
    null, 1
  ).catch(() => []);

  const record = existing?.[0];

  if (record) {
    return await base44.entities.RelationshipTension.update(record.id, data);
  } else {
    return await base44.entities.RelationshipTension.create({
      owner_email: ownerEmail,
      character_a_id: characterAId,
      character_b_id: characterBId,
      pair_key: pairKey,
      ...data,
    });
  }
}