import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ensureBilateralCharacterAwareness
 *
 * SAFE BOOTSTRAP ONLY. Called when a contact is opened in World Contacts.
 *
 * PURPOSE:
 *   Ensures both characters have each other in their fictional_relationships list
 *   so they are mutually visible in World Contacts and the resolver.
 *
 * STRICT RULES:
 *   - Does NOT write Memory records.
 *   - Does NOT update last_interaction_summary.
 *   - Does NOT advance friendship/romantic/attraction scores.
 *   - Does NOT create any emotional progression.
 *   - Does NOT mark any interaction as having occurred.
 *   - ONLY creates a neutral awareness entry if one does not already exist.
 *   - If the entry already exists, it is left completely unchanged.
 *
 * Proof fields written to new entries:
 *   source: 'relationship_awareness_bootstrap'
 *   awareness_only: true
 *   (never: last_interaction_summary, memory, score changes)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterAId, characterBId } = await req.json();

    if (!characterAId || !characterBId) {
      return Response.json({ error: 'Missing required fields: characterAId, characterBId' }, { status: 400 });
    }

    if (characterAId === characterBId) {
      return Response.json({ error: 'characterAId and characterBId must be different' }, { status: 400 });
    }

    // Fetch both characters — must exist and belong to this user
    const [aResults, bResults] = await Promise.all([
      base44.entities.Character.filter({ id: characterAId }),
      base44.entities.Character.filter({ id: characterBId }),
    ]);

    const charA = aResults[0];
    const charB = bResults[0];

    if (!charA || !charB) {
      return Response.json({ error: 'One or both characters not found', characterAId, characterBId }, { status: 404 });
    }

    // Ownership check — legacy characters (missing owner_email) are allowed
    const aMismatch = charA.owner_email && charA.owner_email !== user.email;
    const bMismatch = charB.owner_email && charB.owner_email !== user.email;
    if (aMismatch || bMismatch) {
      return Response.json({ error: 'Ownership violation' }, { status: 403 });
    }

    // PROOF: character_type for both
    const charAType = charA.character_type || 'unknown';
    const charBType = charB.character_type || 'unknown';

    console.log(`[ensureBilateralCharacterAwareness] A=${charA.name} (${charAType}) | B=${charB.name} (${charBType})`);

    // ── FRESH READ BEFORE WRITE ────────────────────────────────────────────────
    // CRITICAL: Re-fetch each character immediately before writing to avoid the race
    // condition where a concurrent write (syncWorldPhoneMemory, AddPeopleInTheirWorldPanel,
    // NPCRelationshipEditor) wrote new entries between our initial fetch and this write.
    // Sequential (not parallel) to ensure each write reads the state left by the previous.

    let entriesCreated = 0;

    // A → B
    {
      const freshA = (await base44.entities.Character.filter({ id: characterAId }).catch(() => []))[0];
      const aRels = freshA?.fictional_relationships || charA.fictional_relationships || [];
      const aHasB = aRels.some(r => r.related_character_id === characterBId);
      if (!aHasB) {
        await base44.entities.Character.update(characterAId, {
          fictional_relationships: [...aRels, {
            person_name: charB.name,
            related_character_id: characterBId,
            relationship_type: 'acquaintance',
            current_status: 'ongoing',
            friendship_level: 50,
            user_respect_level: 50,
            romantic_level: 0,
            attraction_level: 0,
            chosen_family_level: 0,
            source: 'relationship_awareness_bootstrap',
            awareness_only: true,
          }],
        });
        entriesCreated++;
        console.log(`[ensureBilateralCharacterAwareness] Created A→B entry | ${charA.name}→${charB.name} | awareness_only=true`);
      } else {
        console.log(`[ensureBilateralCharacterAwareness] A→B already exists | ${charA.name}→${charB.name} | unchanged`);
      }
    }

    // B → A (fetched after A write completes so B sees latest state)
    {
      const freshB = (await base44.entities.Character.filter({ id: characterBId }).catch(() => []))[0];
      const bRels = freshB?.fictional_relationships || charB.fictional_relationships || [];
      const bHasA = bRels.some(r => r.related_character_id === characterAId);
      if (!bHasA) {
        await base44.entities.Character.update(characterBId, {
          fictional_relationships: [...bRels, {
            person_name: charA.name,
            related_character_id: characterAId,
            relationship_type: 'acquaintance',
            current_status: 'ongoing',
            friendship_level: 50,
            user_respect_level: 50,
            romantic_level: 0,
            attraction_level: 0,
            chosen_family_level: 0,
            source: 'relationship_awareness_bootstrap',
            awareness_only: true,
          }],
        });
        entriesCreated++;
        console.log(`[ensureBilateralCharacterAwareness] Created B→A entry | ${charB.name}→${charA.name} | awareness_only=true`);
      } else {
        console.log(`[ensureBilateralCharacterAwareness] B→A already exists | ${charB.name}→${charA.name} | unchanged`);
      }
    }

    return Response.json({
      success: true,
      characterA: { id: characterAId, name: charA.name, character_type: charAType },
      characterB: { id: characterBId, name: charB.name, character_type: charBType },
      entries_created: entriesCreated,
      memory_written: false,
      last_interaction_updated: false,
      score_progression: false,
      source: 'relationship_awareness_bootstrap',
    });

  } catch (error) {
    console.error('[ensureBilateralCharacterAwareness] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});