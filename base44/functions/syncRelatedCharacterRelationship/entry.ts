import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

  // STEP 2: FETCH PRIMARY (service role to bypass created_by RLS gap)
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

  // STEP 6: BUILD UPDATED RELATIONSHIPS (server-side, do not trust frontend array)
  // Only the fields allowed in relationshipEntry are used — all others are discarded
  const safeEntry = {
    related_character_id: characterId,
    person_name: primary.name || relationshipEntry.person_name || '',
    relationship_type: relationshipEntry.relationship_type || 'acquaintance',
    description: relationshipEntry.description || '',
    respect_level: typeof relationshipEntry.respect_level === 'number' ? relationshipEntry.respect_level : 50,
    friendship_level: typeof relationshipEntry.friendship_level === 'number' ? relationshipEntry.friendship_level : 50,
    romantic_level: typeof relationshipEntry.romantic_level === 'number' ? relationshipEntry.romantic_level : 0,
    attraction_level: typeof relationshipEntry.attraction_level === 'number' ? relationshipEntry.attraction_level : 0,
    chosen_family_level: typeof relationshipEntry.chosen_family_level === 'number' ? relationshipEntry.chosen_family_level : 0,
  };

  const existing = related.fictional_relationships || [];
  const alreadyLinked = existing.find(r => r.related_character_id === characterId);

  const updatedRels = alreadyLinked
    ? existing.map(r => r.related_character_id === characterId ? safeEntry : r)
    : [...existing, safeEntry];

  // STEP 7: WRITE — ONLY fictional_relationships, nothing else
  await base44.asServiceRole.entities.Character.update(relatedCharacterId, {
    fictional_relationships: updatedRels,
  });

  // STEP 8: RETURN
  return Response.json({ success: true, skipped: false });
});