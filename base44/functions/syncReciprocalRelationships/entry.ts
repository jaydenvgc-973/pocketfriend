import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncReciprocalRelationships
 *
 * AUDIT + AUTO-REPAIR function for one-sided relationships.
 *
 * Scans all characters owned by the current user and:
 * 1. Finds every relationship where Person B has no entry back to Person A
 * 2. Auto-repairs bilateral and paired relationships using the correct inverse type
 * 3. Flags neutral/unknown types for manual review
 *
 * Uses the same RELATIONSHIP_TYPES inverse map as syncRelatedCharacterRelationship.
 * Single source of truth — no new relationship engine created.
 */

const RELATIONSHIP_TYPES = {
  friend: { type: 'bilateral', inverse: 'friend' },
  best_friend: { type: 'bilateral', inverse: 'best_friend' },
  close_friend: { type: 'bilateral', inverse: 'close_friend' },
  acquaintance: { type: 'bilateral', inverse: 'acquaintance' },
  neighbor: { type: 'bilateral', inverse: 'neighbor' },
  coworker: { type: 'bilateral', inverse: 'coworker' },
  known_contact: { type: 'neutral', inverse: 'known_contact' },
  associate: { type: 'neutral', inverse: 'known_contact' },
  partner: { type: 'bilateral', inverse: 'partner' },
  dating: { type: 'bilateral', inverse: 'dating' },
  romantic_interest: { type: 'bilateral', inverse: 'romantic_interest' },
  crush: { type: 'bilateral', inverse: 'crush' },
  situationship: { type: 'bilateral', inverse: 'situationship' },
  ex: { type: 'bilateral', inverse: 'ex' },
  friends_with_benefits: { type: 'bilateral', inverse: 'friends_with_benefits' },
  boss: { type: 'paired', inverse: 'employee' },
  employee: { type: 'paired', inverse: 'boss' },
  manager: { type: 'paired', inverse: 'employee_managed' },
  employee_managed: { type: 'paired', inverse: 'manager' },
  supervisor: { type: 'paired', inverse: 'supervised_by' },
  supervised_by: { type: 'paired', inverse: 'supervisor' },
  business_partner: { type: 'bilateral', inverse: 'business_partner' },
  mentor: { type: 'paired', inverse: 'mentee' },
  mentee: { type: 'paired', inverse: 'mentor' },
  coach: { type: 'paired', inverse: 'trainee' },
  trainee: { type: 'paired', inverse: 'coach' },
  confidant: { type: 'bilateral', inverse: 'confidant' },
  protector: { type: 'paired', inverse: 'protected_by' },
  protected_by: { type: 'paired', inverse: 'protector' },
  influencer: { type: 'paired', inverse: 'follower' },
  follower: { type: 'paired', inverse: 'influencer' },
  rival: { type: 'bilateral', inverse: 'rival' },
  enemy: { type: 'bilateral', inverse: 'enemy' },
  competitive_rival: { type: 'bilateral', inverse: 'competitive_rival' },
  obsessed_with: { type: 'paired', inverse: 'target_of_obsession' },
  target_of_obsession: { type: 'paired', inverse: 'obsessed_with' },
  family: { type: 'bilateral', inverse: 'family' },
  other: { type: 'neutral', inverse: 'known_contact' },
};

function normalizeType(t) {
  return (t || '').toLowerCase().replace(/\s+/g, '_');
}

function getInverseType(relationType) {
  const def = RELATIONSHIP_TYPES[normalizeType(relationType)];
  if (!def) return 'known_contact'; // unknown → minimum awareness
  return def.inverse;
}

function isAutoRepairable(relationType) {
  const def = RELATIONSHIP_TYPES[normalizeType(relationType)];
  return def?.type === 'bilateral' || def?.type === 'paired';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all characters scoped to this user — owner_email only
    // Use asServiceRole for read to ensure we get all characters regardless of RLS gaps,
    // but filter strictly by owner_email to maintain user isolation.
    const characters = await base44.asServiceRole.entities.Character.filter({
      owner_email: user.email,
    });

    if (!characters || characters.length === 0) {
      return Response.json({
        success: true,
        message: 'No characters to audit',
        totalRepairs: 0,
        totalIssues: 0,
        repairs: [],
        issues: [],
      });
    }

    const charMap = {};
    for (const c of characters) {
      charMap[c.id] = c;
    }

    const allRepairs = [];
    const allIssues = [];

    for (const charA of characters) {
      const rels = charA.fictional_relationships || [];

      for (const rel of rels) {
        if (!rel.related_character_id) continue; // unlinked NPC — skip
        const charB = charMap[rel.related_character_id];
        if (!charB) continue; // B not in this user's account — skip

        // Check if B has any relationship back to A
        const bRels = charB.fictional_relationships || [];
        const hasReciprocal = bRels.some(r => r.related_character_id === charA.id);

        if (!hasReciprocal) {
          const canRepair = isAutoRepairable(rel.relationship_type);
          const inverseType = getInverseType(rel.relationship_type);

          if (canRepair) {
            // Auto-repair: add the reciprocal entry to Person B
            const newEntry = {
              related_character_id: charA.id,
              person_name: charA.name,
              relationship_type: inverseType,
              description: `Auto-repaired reciprocal: ${charA.name} is ${rel.relationship_type} with ${charB.name}.`,
              avatar_url: charA.avatar_url || null,
              user_respect_level: 50,
              friendship_level: 75,
              romantic_level: 0,
              attraction_level: 0,
              chosen_family_level: 0,
              trust_level: 50,
            };

            const updatedBRels = [...bRels, newEntry];
            await base44.asServiceRole.entities.Character.update(charB.id, {
              fictional_relationships: updatedBRels,
            }).catch(err => {
              console.error(`Auto-repair failed for ${charB.name}: ${err.message}`);
            });

            console.log(`[REPAIR] ${charA.name} → ${charB.name} (${rel.relationship_type}) | added inverse: ${inverseType} to ${charB.name}`);
            allRepairs.push({
              from: charA.name,
              to: charB.name,
              originalType: rel.relationship_type,
              inverseApplied: inverseType,
            });
          } else {
            // Flag for review — neutral or unknown type
            allIssues.push({
              from: charA.name,
              to: charB.name,
              relationshipType: rel.relationship_type,
              reason: `One-sided "${rel.relationship_type}" — ${charB.name} has no awareness of ${charA.name}. Minimum awareness (known_contact) should be added manually.`,
            });
          }
        }
      }
    }

    return Response.json({
      success: true,
      message: 'Reciprocal relationship audit complete',
      totalRepairs: allRepairs.length,
      totalIssues: allIssues.length,
      repairs: allRepairs,
      issues: allIssues,
    });
  } catch (error) {
    console.error(`[syncReciprocalRelationships] ERROR: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});