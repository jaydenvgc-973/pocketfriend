import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ACCOUNT RELATIONSHIP AWARENESS AUDIT (SCOPED)
 * 
 * Scans explicit relationships only: fictional_relationships and family_members.
 * Routes reciprocals to correct section based on character_type:
 * - active_created_character ↔ active_created_character → Characters They Know
 * - NPC_fictitious → People in Their World
 * - family_member → Family section
 * 
 * NO memory/chat/narrative scans. No creation of new characters.
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

    // Build character maps for fast lookups
    const charById = new Map(allCharacters.map(c => [c.id, c]));
    const charByName = new Map(allCharacters.map(c => [c.name?.toLowerCase(), c]));

    // Determine destination section based on character_type pair
    function getDestinationSection(sourceChar, targetChar, relationshipSource) {
      if (relationshipSource === 'family') {
        return 'family_members';
      }
      if (targetChar.character_type === 'NPC_fictitious') {
        return 'people_in_their_world';
      }
      if (sourceChar.character_type === 'active_created_character' && targetChar.character_type === 'active_created_character') {
        return 'fictional_relationships';
      }
      // All other cases → People in Their World (NPC territory)
      return 'people_in_their_world';
    }

    // STEP 2: Scan explicit relationships and family only (NO memory/chat/narrative)
    for (const charA of allCharacters) {
      const targets = []; // Array of {targetCharId, relationshipSource, destinationSection}

      // Source 1: Explicit fictional_relationships
      (charA.fictional_relationships || []).forEach(rel => {
        if (rel.related_character_id) {
          const targetChar = charById.get(rel.related_character_id);
          if (targetChar && targetChar.owner_email === user.email) {
            const destSection = getDestinationSection(charA, targetChar, 'explicit_relationship');
            targets.push({
              targetCharId: rel.related_character_id,
              relationshipSource: 'explicit_relationship',
              relationshipType: rel.relationship_type,
              destinationSection: destSection,
            });
          }
        }
      });

      // Source 2: Family members
      (charA.family_members || []).forEach(fam => {
        const targetChar = charByName.get(fam.name?.toLowerCase());
        if (targetChar && targetChar.owner_email === user.email && targetChar.id !== charA.id) {
          targets.push({
            targetCharId: targetChar.id,
            relationshipSource: 'family',
            relationshipType: fam.relationship_type || 'family',
            destinationSection: 'family_members',
          });
        }
      });

      // STEP 3: Check for reciprocals and repair in correct section
      for (const target of targets) {
        const charB = charById.get(target.targetCharId);
        if (!charB) continue;

        // Check if reciprocal already exists in fictional_relationships
        const hasReciprocal = (charB.fictional_relationships || []).some(
          r => r.related_character_id === charA.id
        );

        if (!hasReciprocal) {
          report.gaps_found++;

          const detailEntry = {
            source_character: charA.name,
            source_character_type: charA.character_type,
            target_character: charB.name,
            target_character_type: charB.character_type,
            relationship_source: target.relationshipSource,
            destination_section: target.destinationSection,
            missing_reciprocal: true,
            status: 'repaired',
            skip_reason: null,
          };

          try {
            // Only repair if destination is fictional_relationships (not family or people)
            // Family and People entries are managed separately; we only repair mutual awareness
            if (target.destinationSection === 'fictional_relationships') {
              const safeEntry = {
                related_character_id: charA.id,
                person_name: charA.name || '',
                relationship_type: 'known_contact',
                description: `Reciprocal awareness: ${charA.name} and ${charB.name} know each other.`,
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

              report.gaps_repaired++;
            } else {
              // Skip family and people_in_their_world — these are managed by separate UI/logic
              detailEntry.status = 'skipped';
              detailEntry.skip_reason = `destination_section_managed_separately (${target.destinationSection})`;
              report.gaps_skipped++;
            }
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