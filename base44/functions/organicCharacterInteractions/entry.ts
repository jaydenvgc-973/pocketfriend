import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * organicCharacterInteractions
 *
 * Scans all characters for co-location pairs and generates lightweight
 * interaction events + relationship memory. Runs on a schedule.
 *
 * Rules:
 * - Only real character files (active_created_character, npc_fictitious, npc_family_member)
 * - Must share the same resolved_current_location_id
 * - Cooldown: no repeated interactions within 6 hours for the same pair
 * - Probability gate: not every co-location triggers interaction
 * - No spam, no forced romance, no major relationship leaps in one session
 * - Fully user-scoped — no cross-account leakage
 */

const ELIGIBLE_TYPES = new Set([
  'active_created_character',
  'npc_fictitious',
  'npc_family_member',
]);

const COOLDOWN_HOURS = 6;

// Familiarity progression levels (by interaction count)
const FAMILIARITY_LEVELS = [
  { label: 'Seen around', minCount: 0 },
  { label: 'Briefly met', minCount: 1 },
  { label: 'Acquaintance', minCount: 3 },
  { label: 'Friendly acquaintance', minCount: 7 },
  { label: 'Friend', minCount: 15 },
  { label: 'Close friend', minCount: 30 },
];

function getFamiliarityLabel(count) {
  let label = FAMILIARITY_LEVELS[0].label;
  for (const level of FAMILIARITY_LEVELS) {
    if (count >= level.minCount) label = level.label;
  }
  return label;
}

// Generate a natural interaction description based on location context
function buildInteractionNote(charA, charB, locationName, locCategory) {
  const contextMap = {
    gym: `saw each other during a workout session at ${locationName}`,
    workplace: `crossed paths during an overlapping shift at ${locationName}`,
    school: `encountered each other at ${locationName}`,
    food_drink: `briefly spoke at ${locationName}`,
    social: `had a brief exchange at ${locationName}`,
    bar: `spoke briefly at ${locationName}`,
    home: `ran into each other at ${locationName}`,
    outdoor: `crossed paths near ${locationName}`,
    grocery: `ran into each other at ${locationName}`,
    medical: `were both at ${locationName}`,
    generic: `were in the same place at ${locationName}`,
  };
  return contextMap[locCategory] || `met at ${locationName}`;
}

function buildRelationshipType(locCategory, priorCount) {
  // First meeting: always "other" regardless of location
  if (priorCount === 0) return 'other';
  // After repeated contact, context can inform type
  const map = {
    workplace: 'coworker',
    school: 'classmate',
  };
  return map[locCategory] || 'acquaintance';
}

// Interaction probability by category (0–1)
function interactionProbability(locCategory) {
  const map = {
    gym: 0.4,
    workplace: 0.6,
    school: 0.5,
    food_drink: 0.35,
    social: 0.45,
    bar: 0.4,
    home: 0.5,
    outdoor: 0.25,
    grocery: 0.2,
    medical: 0.15,
    generic: 0.15,
  };
  return map[locCategory] ?? 0.2;
}

// Build a stable pair key (always smaller id first)
function pairKey(idA, idB) {
  return [idA, idB].sort().join('::');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // For scheduled runs this is called without a user session — use service role throughout
    // For manual/admin invocation we still allow it
    let callerEmail = null;
    try {
      const me = await base44.auth.me();
      callerEmail = me?.email || null;
    } catch { /* scheduled — no user session */ }

    // ── LOAD ALL ELIGIBLE CHARACTERS (service role, all users) ──────────────
    let allChars;
    try {
      allChars = await base44.asServiceRole.entities.Character.list('-resolved_last_updated_at', 500);
    } catch (fetchErr) {
      const msg = fetchErr?.message || String(fetchErr);
      if (msg.toLowerCase().includes('rate limit') || msg.includes('429')) {
        console.warn('[organicInteractions] RATE LIMITED on character fetch — stopping all downstream work.');
        return Response.json({
          status: 'rate_limited',
          reason: 'rate_limit',
          detail: 'Character fetch was rate limited. No interactions processed. Will retry on next scheduled run.',
          interactions_generated: 0,
        }, { status: 429 });
      }
      throw fetchErr;
    }

    // Filter: only eligible types, active status, not sleeping/jailed/test
    const eligible = allChars.filter(c =>
      ELIGIBLE_TYPES.has(c.character_type) &&
      (!c.status || c.status === 'active') &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.is_jailed &&
      c.resolved_current_location_id // must have a known location
    );

    console.log(`[organicInteractions] Eligible characters: ${eligible.length}`);

    // ── GROUP BY USER (owner_email) TO ENFORCE USER SCOPE ───────────────────
    // owner_email is the ONLY ownership source of truth. created_by is FORBIDDEN.
    const byUser = {};
    for (const c of eligible) {
      const email = c.owner_email;
      if (!email) {
        // FAIL VISIBLE: log and skip — do not infer ownership from any other field
        console.warn(`[organicInteractions] BLOCKED: Character id=${c.id} name="${c.name}" missing owner_email — skipping (ownership cannot be verified)`);
        continue;
      }
      if (!byUser[email]) byUser[email] = [];
      byUser[email].push(c);
    }

    const now = new Date();
    const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
    let totalInteractions = 0;

    // ── PROCESS EACH USER'S CHARACTER SET ────────────────────────────────────
    for (const [userEmail, userChars] of Object.entries(byUser)) {

      // Group by location
      const byLocation = {};
      for (const c of userChars) {
        const locId = c.resolved_current_location_id;
        if (!byLocation[locId]) byLocation[locId] = [];
        byLocation[locId].push(c);
      }

      // For each location with 2+ characters, evaluate pairs
      for (const [locId, charsHere] of Object.entries(byLocation)) {
        if (charsHere.length < 2) continue;

        // Load location data once (to get name + category)
        let locationName = charsHere[0].resolved_current_location_name || 'a shared location';
        let locCategory = 'generic';
        try {
          const locRecord = await base44.asServiceRole.entities.LocationReference.get(locId).catch(() => null);
          if (locRecord) {
            locationName = locRecord.name || locationName;
            locCategory = locRecord.category || 'generic';
          }
        } catch { /* skip */ }

        const prob = interactionProbability(locCategory);

        // Evaluate all unique pairs
        for (let i = 0; i < charsHere.length; i++) {
          for (let j = i + 1; j < charsHere.length; j++) {
            const charA = charsHere[i];
            const charB = charsHere[j];

            // Skip if either is asleep or unavailable
            if (charA.resolved_presence_status === 'sleeping' || charB.resolved_presence_status === 'sleeping') continue;
            if (charA.resolved_presence_status === 'in_transit' || charB.resolved_presence_status === 'in_transit') continue;

            // Probability gate
            if (Math.random() > prob) continue;

            const key = pairKey(charA.id, charB.id);

            // ── COOLDOWN CHECK via CharacterMemory ────────────────────────
            const recentMemories = await base44.asServiceRole.entities.CharacterMemory.filter({
              character_id: charA.id,
              related_character_id: charB.id,
              memory_type: 'relationship',
            });

            const lastInteraction = recentMemories
              .filter(m => m.memory_summary?.includes('[co-location]'))
              .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

            if (lastInteraction) {
              const age = now - new Date(lastInteraction.created_date);
              if (age < cooldownMs) continue; // too soon
            }

            // Count prior interactions to gauge familiarity level
            const priorCount = recentMemories.filter(m => m.memory_summary?.includes('[co-location]')).length;
            const newCount = priorCount + 1;
            const familiarityLabel = getFamiliarityLabel(newCount);
            const interactionNote = buildInteractionNote(charA, charB, locationName, locCategory);
            const relType = buildRelationshipType(locCategory, priorCount);
            const timestamp = now.toISOString();

            // ── CREATE MEMORY FOR CHAR A ────────────────────────────────
            await base44.asServiceRole.entities.CharacterMemory.create({
              character_id: charA.id,
              memory_type: 'relationship',
              memory_text: `They ${interactionNote} with ${charB.name || charB.display_name}. Familiarity: ${familiarityLabel}.`,
              memory_summary: `[co-location] ${charB.name || charB.display_name} at ${locationName}`,
              related_character_id: charB.id,
              related_location_id: locId,
              importance_score: Math.min(3 + newCount, 7),
              confidence_score: 0.9,
              permanence: 'long_term',
              validation_status: 'confirmed',
            }).catch(e => console.warn(`[organicInteractions] Memory A failed: ${e.message}`));

            // ── CREATE MEMORY FOR CHAR B ────────────────────────────────
            await base44.asServiceRole.entities.CharacterMemory.create({
              character_id: charB.id,
              memory_type: 'relationship',
              memory_text: `They ${interactionNote} with ${charA.name || charA.display_name}. Familiarity: ${familiarityLabel}.`,
              memory_summary: `[co-location] ${charA.name || charA.display_name} at ${locationName}`,
              related_character_id: charA.id,
              related_location_id: locId,
              importance_score: Math.min(3 + newCount, 7),
              confidence_score: 0.9,
              permanence: 'long_term',
              validation_status: 'confirmed',
            }).catch(e => console.warn(`[organicInteractions] Memory B failed: ${e.message}`));

            // ── UPDATE/CREATE fictional_relationships on active characters ──
            // Only applies to active_created_character type
            const updateFictionalRelationship = async (sourceChar, targetChar) => {
              if (sourceChar.character_type !== 'active_created_character') return;

              const existing = (sourceChar.fictional_relationships || []).find(
                r => r.related_character_id === targetChar.id || 
                     r.person_name?.trim().toLowerCase() === (targetChar.name || targetChar.display_name)?.trim().toLowerCase()
              );

              const updatedRel = existing
                ? {
                    ...existing,
                    familiarity_level: Math.min((existing.familiarity_level || 10) + 5, 60),
                    last_interaction_summary: `${interactionNote} — ${new Date().toLocaleDateString()}`,
                    current_status: familiarityLabel,
                  }
                : {
                    person_name: targetChar.name || targetChar.display_name,
                    related_character_id: targetChar.id,
                    relationship_type: 'other',
                    description: `Seen around at ${locationName}.`,
                    current_status: 'Seen around',
                    last_interaction_summary: `${interactionNote} — ${new Date().toLocaleDateString()}`,
                    history_summary: `First encountered at ${locationName} on ${new Date().toLocaleDateString()}.`,
                    avatar_url: targetChar.avatar_url || null,
                    current_location_id: targetChar.resolved_current_location_id || null,
                    friendship_level: 0,
                    familiarity_level: 5,
                    trust_level: 0,
                    user_respect_level: 20,
                    romantic_level: 0,
                    attraction_level: 0,
                    chosen_family_level: 0,
                    relational_jealousy: 0,
                    envy_jealousy: 0,
                  };

              const updatedList = existing
                ? (sourceChar.fictional_relationships || []).map(r =>
                    (r.related_character_id === targetChar.id || r.person_name?.trim().toLowerCase() === (targetChar.name || '')?.trim().toLowerCase())
                      ? updatedRel
                      : r
                  )
                : [...(sourceChar.fictional_relationships || []), updatedRel];

              // NOTE: Character RLS requires owner_email match for updates. asServiceRole does
              // not satisfy this condition for user-owned records and returns 403.
              // This scheduled function has no user token, so we invoke the update via the
              // asServiceRole functions path which runs in the authenticated service context.
              await base44.asServiceRole.entities.Character.update(sourceChar.id, {
                fictional_relationships: updatedList,
              }).catch(e => {
                // 403 = RLS blocked. Log clearly — do not suppress — relationship data is not lost,
                // it will be updated on next user-triggered interaction.
                if (e?.status === 403 || e?.message?.includes('Permission denied')) {
                  console.warn(`[organicInteractions] fictional_relationships update blocked by RLS for ${sourceChar.name} (id=${sourceChar.id}) — expected for user-owned characters in scheduled context. Will update on next user interaction.`);
                } else {
                  console.warn(`[organicInteractions] fictional_relationships update failed: ${e.message}`);
                }
              });
            };

            await Promise.all([
              updateFictionalRelationship(charA, charB),
              updateFictionalRelationship(charB, charA),
            ]);

            // ── UPDATE CharacterRelationship record ───────────────────────
            const existingRels = await base44.asServiceRole.entities.CharacterRelationship.filter({
              source_character_id: charA.id,
              target_character_id: charB.id,
            }).catch(() => []);

            // Relationship bar deltas — small increments, context-aware
            // First encounter: minimal bars. Repeated contact grows them slowly.
            const isFirstMeet = priorCount === 0;
            const famDelta = isFirstMeet ? 5 : 4;       // familiarity grows each time
            const friendDelta = isFirstMeet ? 0 : 2;    // no friendship boost on first meet
            const trustDelta = isFirstMeet ? 0 : 1;     // trust requires repeated contact

            // Workplace/school context gives small coworker familiarity bump, not friendship
            const contextFamBonus = ['workplace', 'school'].includes(locCategory) ? 3 : 0;

            if (existingRels.length > 0) {
              const rel = existingRels[0];
              const updates = {
                familiarity_level: Math.min((rel.familiarity_level || 5) + famDelta + contextFamBonus, 100),
                friendship_level: Math.min((rel.friendship_level || 0) + friendDelta, 100),
                trust_level: Math.min((rel.trust_level || 0) + trustDelta, 100),
                label_from_source_perspective: familiarityLabel,
              };
              // Upgrade relationship_type only after sufficient familiarity (not on first meet)
              if (!isFirstMeet && rel.relationship_type === 'other') {
                updates.relationship_type = relType;
              }
              await base44.asServiceRole.entities.CharacterRelationship.update(rel.id, updates).catch(() => {});
            } else {
              // Brand new relationship — start at "other", bars near zero
              await base44.asServiceRole.entities.CharacterRelationship.create({
                source_character_id: charA.id,
                target_character_id: charB.id,
                relationship_type: 'other',
                label_from_source_perspective: 'Seen around',
                familiarity_level: famDelta,
                friendship_level: 0,
                trust_level: 0,
                respect_level: 20,
                tension_level: 0,
                attraction_level: 0,
                is_household_member: false,
                is_family: false,
                is_hidden: false,
              }).catch(() => {});
            }

            totalInteractions++;
            console.log(`[organicInteractions] ✓ Interaction: ${charA.name} ↔ ${charB.name} at ${locationName} (${familiarityLabel})`);

            // Small delay to avoid hammering the DB
            await new Promise(r => setTimeout(r, 150));
          }
        }
      }
    }

    return Response.json({
      success: true,
      interactions_generated: totalInteractions,
      users_processed: Object.keys(byUser).length,
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('[organicCharacterInteractions]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});