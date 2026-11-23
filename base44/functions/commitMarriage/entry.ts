/**
 * commitMarriage
 *
 * Records a completed marriage through Pocketfriend's existing relationship data.
 * It creates no parallel marriage system: the marriage lives where relationships
 * already live — each character's fictional_relationships and family_members, and the
 * bilateral CharacterRelationship records the profile and world already read.
 *
 * Called only after the user has confirmed the two people and the ceremony has
 * actually taken place. It never moves anyone in: household decisions stay with the
 * existing move-in flow.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const SPOUSE_LEVELS = {
  user_respect_level: 75,
  friendship_level: 80,
  romantic_level: 70,
  attraction_level: 60,
  chosen_family_level: 85,
};

function newMemberId() {
  return `fm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function upsertRelationshipEntry(existing, other, spouseName) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const otherName = (other.name || '').trim().toLowerCase();
  const idx = list.findIndex((r) =>
    r?.related_character_id === other.id ||
    ((r?.person_name || '').trim().toLowerCase() === otherName && !r?.related_character_id)
  );
  const base = idx >= 0 ? list[idx] : {};
  const entry = {
    ...SPOUSE_LEVELS,
    ...base,
    person_name: other.name,
    relationship_type: 'spouse',
    related_character_id: other.id,
    description: `${other.name} is ${spouseName}'s spouse.`,
    current_status: 'married',
    married_date: base.married_date || new Date().toISOString(),
    romantic_level: Math.max(Number(base.romantic_level) || 0, 70),
  };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  return list;
}

function upsertFamilyMember(existing, other) {
  const list = Array.isArray(existing) ? [...existing] : [];
  const otherName = (other.name || '').trim().toLowerCase();
  const idx = list.findIndex((m) =>
    m?.source_character_id === other.id ||
    m?._linked_character_id === other.id ||
    (m?.name || '').trim().toLowerCase() === otherName
  );
  const base = idx >= 0 ? list[idx] : {};
  const entry = {
    ...base,
    _member_id: base._member_id || newMemberId(),
    name: other.name,
    relationship_type: 'spouse',
    source_character_id: other.id,
    _linked_character_id: other.id,
    ...SPOUSE_LEVELS,
    romantic_level: Math.max(Number(base.romantic_level) || 0, 70),
    photo_url: base.photo_url || other.avatar_url || null,
  };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  return list;
}

async function upsertCharacterRelationship(base44, sourceId, targetId, shareHousehold) {
  const existing = await base44.asServiceRole.entities.CharacterRelationship.filter({
    source_character_id: sourceId,
    target_character_id: targetId,
  }).catch(() => []);
  const payload = {
    relationship_type: 'spouse',
    label_from_source_perspective: 'my spouse',
    label_from_target_perspective: 'my spouse',
    is_household_member: !!shareHousehold,
    is_family: true,
    romantic_level: 70,
  };
  if (existing?.[0]?.id) {
    await base44.asServiceRole.entities.CharacterRelationship.update(existing[0].id, payload);
    return existing[0].id;
  }
  const created = await base44.asServiceRole.entities.CharacterRelationship.create({
    source_character_id: sourceId,
    target_character_id: targetId,
    ...payload,
  });
  return created?.id || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const spouseAId = body.spouse_a_id;
    const spouseBId = body.spouse_b_id;
    const witnessIds = Array.isArray(body.witness_ids) ? body.witness_ids.filter(Boolean) : [];

    if (!spouseAId || !spouseBId) return Response.json({ error: 'Two characters are required' }, { status: 400 });
    if (spouseAId === spouseBId) return Response.json({ error: 'A character cannot marry themselves' }, { status: 400 });

    const owned = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email }, null, 500);
    const byId = new Map((owned || []).map((c) => [c.id, c]));
    const a = byId.get(spouseAId);
    const b = byId.get(spouseBId);
    if (!a || !b) return Response.json({ error: 'Both characters must belong to this account' }, { status: 403 });
    for (const c of [a, b]) {
      if (['deleted', 'soft_deleted', 'merged'].includes(c.status)) {
        return Response.json({ error: `${c.name} is no longer an active character` }, { status: 400 });
      }
      if (c.life_status === 'deceased' || c.status === 'deceased') {
        return Response.json({ error: `${c.name} is deceased and cannot marry` }, { status: 400 });
      }
    }

    const shareHousehold = !!a.current_home_location_id && a.current_home_location_id === b.current_home_location_id;
    const marriedAt = new Date().toISOString();
    const place = body.location_name || 'City Hall';

    await base44.asServiceRole.entities.Character.update(a.id, {
      fictional_relationships: upsertRelationshipEntry(a.fictional_relationships, b, a.name),
      family_members: upsertFamilyMember(a.family_members, b),
    });
    await base44.asServiceRole.entities.Character.update(b.id, {
      fictional_relationships: upsertRelationshipEntry(b.fictional_relationships, a, b.name),
      family_members: upsertFamilyMember(b.family_members, a),
    });

    const forwardId = await upsertCharacterRelationship(base44, a.id, b.id, shareHousehold);
    const reverseId = await upsertCharacterRelationship(base44, b.id, a.id, shareHousehold);

    await Promise.allSettled([
      base44.asServiceRole.entities.LifeEvent.create({
        character_id: a.id,
        character_name: a.name,
        event_type: 'life_milestone_event',
        valence: 'positive',
        severity: 'major',
        title: `Married ${b.name}`,
        description: `${a.name} and ${b.name} were married at ${place}${body.ceremony_type === 'civil' ? ' in a civil ceremony' : ''}.`,
        emotional_impact: 'A defining commitment',
        triggered_by: 'user_confirmed_marriage',
        timestamp: marriedAt,
        context_tags: ['marriage', 'ceremony', 'user_confirmed'],
      }),
      base44.asServiceRole.entities.LifeEvent.create({
        character_id: b.id,
        character_name: b.name,
        event_type: 'life_milestone_event',
        valence: 'positive',
        severity: 'major',
        title: `Married ${a.name}`,
        description: `${b.name} and ${a.name} were married at ${place}${body.ceremony_type === 'civil' ? ' in a civil ceremony' : ''}.`,
        emotional_impact: 'A defining commitment',
        triggered_by: 'user_confirmed_marriage',
        timestamp: marriedAt,
        context_tags: ['marriage', 'ceremony', 'user_confirmed'],
      }),
    ]);

    return Response.json({
      success: true,
      married_at: marriedAt,
      location_name: place,
      spouses: [
        { id: a.id, name: a.name },
        { id: b.id, name: b.name },
      ],
      witness_ids: witnessIds,
      household_shared: shareHousehold,
      relationship_record_ids: [forwardId, reverseId].filter(Boolean),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});