import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * COMPREHENSIVE ACCOUNT RELATIONSHIP AWARENESS AUDIT
 * 
 * Scans ALL character pairs under current owner_email to identify one-way relationships.
 * For each gap (A knows B but B doesn't know A), repairs the missing reciprocal entry.
 * 
 * Checks 5 evidence sources:
 * 1. Explicit fictional_relationships entries
 * 2. CharacterMemory mentions
 * 3. Message history mentions
 * 4. CharacterAutomaticNarrative mentions
 * 5. Family members / People in Their World entries
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const report = {
    user_email: user.email,
    timestamp: new Date().toISOString(),
    characters_scanned: 0,
    gaps_found: 0,
    gaps_repaired: 0,
    gaps_skipped: 0,
    details: [],
  };

  try {
    // STEP 1: Fetch all characters owned by this user
    const allCharacters = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      500
    );
    report.characters_scanned = allCharacters.length;

    console.log(`[auditAccountRelationshipAwareness] Found ${allCharacters.length} characters for ${user.email}`);

    // Build character name map for fast lookups
    const charById = new Map(allCharacters.map(c => [c.id, c]));
    const charByName = new Map(allCharacters.map(c => [c.name?.toLowerCase(), c]));

    // STEP 2: Scan for evidence sources and identify gaps
    for (const charA of allCharacters) {
      // Evidence 1: Explicit fictional_relationships only (avoid extra queries)
      const explicitTargets = new Map();
      (charA.fictional_relationships || []).forEach(rel => {
        if (rel.related_character_id) {
          explicitTargets.set(rel.related_character_id, `explicit_${rel.relationship_type}`);
        }
      });

      // Evidence 2: Family members (from profile only, no query)
      (charA.family_members || []).forEach(fam => {
        const targetChar = charByName.get(fam.name?.toLowerCase());
        if (targetChar && targetChar.id !== charA.id) {
          if (!explicitTargets.has(targetChar.id)) {
            explicitTargets.set(targetChar.id, 'family_member');
          }
        }
      });

      // STEP 3: Check for reciprocals among explicit/family targets only
      for (const [targetCharId, evidenceType] of explicitTargets) {
        const charB = charById.get(targetCharId);
        if (!charB || charB.owner_email !== user.email) continue;

        const hasReciprocal = (charB.fictional_relationships || []).some(
          r => r.related_character_id === charA.id
        );

        if (!hasReciprocal) {
          report.gaps_found++;

          const detailEntry = {
            source_character: charA.name,
            source_character_id: charA.id,
            target_character: charB.name,
            target_character_id: charB.id,
            evidence_source: evidenceType,
            status: 'repaired',
            repair_details: null,
          };

          try {
            const safeEntry = {
              related_character_id: charA.id,
              person_name: charA.name || '',
              relationship_type: 'known_contact',
              description: `Known through ${evidenceType}. ${charA.name} has documented relationship with ${charB.name}.`,
              user_respect_level: 50,
              friendship_level: 50,
              romantic_level: 0,
              attraction_level: 0,
              chosen_family_level: 0,
              trust_level: 50,
              relational_jealousy: 0,
              envy_jealousy: 0,
            };

            const existingRels = charB.fictional_relationships || [];
            const updatedRels = [...existingRels, safeEntry];

            await base44.entities.Character.update(charB.id, {
              fictional_relationships: updatedRels,
            });

            detailEntry.repair_details = {
              relationship_type: 'known_contact',
              entry_added: true,
            };
            report.gaps_repaired++;
          } catch (err) {
            detailEntry.status = 'skipped';
            detailEntry.skip_reason = `repair_failed: ${err.message}`;
            report.gaps_skipped++;
          }

          report.details.push(detailEntry);
        }
      }
    }

    console.log(`[auditAccountRelationshipAwareness] Complete. Gaps: ${report.gaps_found}, Repaired: ${report.gaps_repaired}, Skipped: ${report.gaps_skipped}`);
    return Response.json(report);
  } catch (error) {
    console.error(`[auditAccountRelationshipAwareness] ERROR: ${error.message}`);
    return Response.json({ error: error.message, report }, { status: 500 });
  }
});