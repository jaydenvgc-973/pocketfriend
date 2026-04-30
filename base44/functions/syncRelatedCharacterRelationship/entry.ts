import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RELATIONSHIP TYPE DEFINITIONS (mirrored from lib/relationshipTypeDefinitions.js)
 * Source of truth for inverse relationship types.
 * bilateral = same type on both sides
 * paired = specific inverse type on the other side
 * neutral = no enforced reciprocal (but awareness must still exist)
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

/**
 * Derive the correct inverse relationship type for Person B when Person A has a given type.
 * For bilateral types: same type.
 * For paired types: exact inverse.
 * For neutral/unknown: default to 'known_contact' to ensure minimum awareness.
 */
function getInverseType(relationType) {
  const normalized = (relationType || '').toLowerCase().replace(/\s+/g, '_');
  const def = RELATIONSHIP_TYPES[normalized];
  if (!def) return 'known_contact'; // unknown type → minimum awareness fallback
  return def.inverse;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // STEP 1: AUTH
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { characterId, relatedCharacterId, relationshipEntry } = await req.json();

  if (!characterId || !relatedCharacterId || !relationshipEntry) {
    return Response.json({ error: 'Missing required fields: characterId, relatedCharacterId, relationshipEntry' }, { status: 400 });
  }

  // STEP 2: FETCH PRIMARY (service role to bypass RLS gap)
  let primary;
  try {
    primary = await base44.asServiceRole.entities.Character.get(characterId);
  } catch {
    return Response.json({ error: 'Primary character not found' }, { status: 404 });
  }
  if (!primary) {
    return Response.json({ error: 'Primary character not found' }, { status: 404 });
  }

  // STEP 3: VALIDATE PRIMARY OWNERSHIP — owner_email only, never created_by
  if (primary.owner_email !== user.email) {
    console.warn(`[syncRelatedCharacterRelationship] BLOCKED: primary ${characterId} owner_email (${primary.owner_email}) !== caller (${user.email})`);
    return Response.json({ error: 'Forbidden: primary character does not belong to caller' }, { status: 403 });
  }

  // STEP 4: FETCH RELATED (service role)
  let related;
  try {
    related = await base44.asServiceRole.entities.Character.get(relatedCharacterId);
  } catch {
    return Response.json({ error: 'Related character not found' }, { status: 404 });
  }
  if (!related) {
    return Response.json({ error: 'Related character not found' }, { status: 404 });
  }

  // STEP 5: VALIDATE RELATED OWNERSHIP — skip (do not 403) if mismatch, log it
  if (related.owner_email !== user.email) {
    console.warn(`[syncRelatedCharacterRelationship] SKIPPED: related ${relatedCharacterId} owner_email (${related.owner_email}) !== caller (${user.email})`);
    return Response.json({ success: false, skipped: true, reason: 'owner_email_mismatch' });
  }

  // STEP 6: DERIVE THE CORRECT INVERSE TYPE — ENFORCES RECIPROCAL RELATIONSHIP RULE
  // Person A has relationship_type X with Person B.
  // Person B MUST have the correct inverse type back to Person A.
  // For bilateral: same type. For paired: exact inverse. For unknown: known_contact.
  const sourceType = relationshipEntry.relationship_type || 'known_contact';
  const inverseType = getInverseType(sourceType);

  console.log(`[syncRelatedCharacterRelationship] ${primary.name} → ${related.name}: ${sourceType} | inverse: ${inverseType}`);

  // STEP 7: BUILD UPDATED RELATIONSHIPS FOR PERSON B (server-side, do not trust frontend array)
  // IMPORTANT: Only the relationship_type (inverse), person_name, and avatar_url are written from A's data.
  // Emotional bars (friendship, trust, romantic, etc.) are PRESERVED from B's existing record if it exists,
  // or initialized to neutral defaults if this is a new reciprocal entry.
  // This keeps bars asymmetric — B's feelings toward A are independent from A's feelings toward B.
  const existing = related.fictional_relationships || [];
  const alreadyLinked = existing.find(r => r.related_character_id === characterId);

  const safeEntry = {
    related_character_id: characterId,
    person_name: primary.name || '',
    relationship_type: inverseType, // CRITICAL: use the derived inverse, not what the frontend sent
    description: alreadyLinked?.description || relationshipEntry.description || '',
    avatar_url: primary.avatar_url || null,
    // Preserve B's existing emotional bars — never overwrite with A's values
    user_respect_level: alreadyLinked?.user_respect_level ?? 50,
    friendship_level: alreadyLinked?.friendship_level ?? 50,
    romantic_level: alreadyLinked?.romantic_level ?? 0,
    attraction_level: alreadyLinked?.attraction_level ?? 0,
    chosen_family_level: alreadyLinked?.chosen_family_level ?? 0,
    trust_level: alreadyLinked?.trust_level ?? 50,
    relational_jealousy: alreadyLinked?.relational_jealousy ?? 0,
    envy_jealousy: alreadyLinked?.envy_jealousy ?? 0,
  };

  const updatedRels = alreadyLinked
    ? existing.map(r => r.related_character_id === characterId ? { ...r, ...safeEntry } : r)
    : [...existing, safeEntry];

  // STEP 8: WRITE — ONLY fictional_relationships, nothing else
  await base44.asServiceRole.entities.Character.update(relatedCharacterId, {
    fictional_relationships: updatedRels,
  });

  console.log(`[syncRelatedCharacterRelationship] ✓ Reciprocal written: ${related.name} → ${primary.name} (${inverseType})`);

  // STEP 9: RETURN
  return Response.json({ success: true, skipped: false, inverseType });
});