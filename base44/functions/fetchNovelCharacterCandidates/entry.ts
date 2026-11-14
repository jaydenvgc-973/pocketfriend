/**
 * fetchNovelCharacterCandidates
 *
 * Returns the people the Novel focus-character selector may offer for a central
 * character:
 *   1. connected_ids — every character ID with an established connection to the
 *      central character, derived ONLY from existing Pocketfriend records:
 *      relationships, memories, family/fictional relationship lists (linked by
 *      _linked_character_id), household residency (unit-aware), Story Event
 *      participation, conversations, messages (chat, text, scene, world phone)
 *      and gathering-room co-presence. No source is required to repeat: a family
 *      link, a shared household or a documented Story Event is enough on its own.
 *   2. cross_account_characters — those connected characters that belong to another
 *      account, resolved by exact ID so the selector can group them by account.
 *
 * READ-ONLY. Nothing is created, updated or deleted. No relationship or contact
 * record is modified to support this list.
 *
 * Cross-account records are resolved by the service role for IDs that came out of
 * the caller's OWN readable records (a proven contact graph), exactly like
 * fetchCharactersByIds — arbitrary ID fishing is not possible.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const DEAD_STATUS = ['deleted', 'soft_deleted', 'merged'];
const asArray = (value) => (Array.isArray(value) ? value : (value && value.items) || []);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const characterId = body?.character_id;
    if (!characterId) return Response.json({ error: 'character_id is required' }, { status: 400 });

    const central = await base44.entities.Character.get(characterId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!central) return Response.json({ error: 'Character not found' }, { status: 404 });

    // ── EXISTING RECORDS ONLY (caller-scoped) ────────────────────────────────
    const [relationshipsRaw, memoriesRaw, conversationsRaw, messagesRaw, participationsRaw, storyEventsRaw] = await Promise.all([
      base44.entities.CharacterRelationship.filter({
        $or: [{ source_character_id: characterId }, { target_character_id: characterId }],
      }, null, 200).catch(() => []),
      base44.entities.CharacterMemory.filter({ character_id: characterId }, '-importance_score', 200).catch(() => []),
      base44.entities.Conversation.filter({ character_ids: { $in: [characterId] } }, '-last_message_date', 100).catch(() => []),
      base44.entities.Message.filter({ participant_character_ids: { $in: [characterId] } }, '-timestamp', 200).catch(() => []),
      base44.entities.GatheringRoomParticipant.filter({ participant_id: characterId }, null, 100).catch(() => []),
      // Established Story Events the central character took part in. Read through the
      // caller-scoped client, so the event's own access rules decide what is visible.
      base44.entities.StoryEvent.filter({ participant_character_ids: { $in: [characterId] } }, '-event_date', 80).catch(() => []),
    ]);

    const relationships = asArray(relationshipsRaw);
    const memories = asArray(memoriesRaw);
    const conversations = asArray(conversationsRaw);
    const messages = asArray(messagesRaw);
    const participations = asArray(participationsRaw);
    const storyEvents = asArray(storyEventsRaw);

    // ── HOUSEHOLD / RESIDENCY (existing assignments, unit-aware) ─────────────
    // A residence is read from the central character's own home fields. A shared
    // residence on another account is resolved by the exact ID the character's own
    // record points at — read-only, never modified.
    const homeIds = [...new Set([
      central.current_home_location_id,
      central.temporary_housing_location_id,
      central.vacation_mode ? central.vacation_home_location_id : null,
    ].filter(Boolean))];

    let homeLocations = homeIds.length
      ? asArray(await base44.entities.LocationReference.filter({ id: { $in: homeIds } }, null, homeIds.length).catch(() => []))
      : [];
    const unreadableHomeIds = homeIds.filter((id) => !homeLocations.some((h) => h.id === id));
    if (unreadableHomeIds.length) {
      homeLocations = homeLocations.concat(asArray(await base44.asServiceRole.entities.LocationReference
        .filter({ id: { $in: unreadableHomeIds } }, null, unreadableHomeIds.length).catch(() => [])));
    }

    // Multi-unit property: ONLY the actual apartment/unit assignment is a household.
    // A building without units uses its own resident list. Nothing is assumed.
    const householdIdsOf = (home) => {
      const units = Array.isArray(home?.residential_units) ? home.residential_units : [];
      if (units.length) {
        const myUnit = units.find((u) => (u.occupant_character_ids || []).includes(characterId));
        return myUnit ? (myUnit.occupant_character_ids || []) : [];
      }
      return [...new Set([
        ...(home?.resident_character_ids || []),
        ...asArray(home?.residents).map((r) => r?.character_id).filter(Boolean),
      ])];
    };

    // Co-presence in gathering rooms is a documented interaction too.
    const roomIds = [...new Set(participations.map((p) => p?.gathering_room_id).filter(Boolean))].slice(0, 40);
    const roomParticipants = roomIds.length
      ? asArray(await base44.entities.GatheringRoomParticipant
        .filter({ gathering_room_id: { $in: roomIds } }, null, 300).catch(() => []))
      : [];

    // ── CONNECTION GRAPH ─────────────────────────────────────────────────────
    const connections = new Map();
    const note = (id, reason) => {
      // The account holder is not a character connection.
      if (!id || typeof id !== 'string' || id === characterId || id === user.id) return;
      if (!connections.has(id)) connections.set(id, reason);
    };

    // Family list — linked family members, including cross-account ones
    // (_linked_character_id is how an established family link is stored).
    (central.family_members || []).forEach((f) => note(
      f?._linked_character_id || f?.character_id || f?.related_character_id,
      'family'
    ));
    (central.fictional_relationships || []).forEach((r) => note(r?.related_character_id || r?.character_id, 'relationship'));
    [...(central.people_in_world || []), ...(central.known_people || [])]
      .forEach((p) => note(p?.related_character_id || p?.character_id, 'relationship'));
    relationships.forEach((r) => note(
      r.source_character_id === characterId ? r.target_character_id : r.source_character_id,
      'relationship'
    ));
    memories.forEach((m) => note(m?.related_character_id, 'shared memory'));
    conversations.forEach((c) => {
      [...(c.character_ids || []), ...(c.participant_character_ids || [])].forEach((id) => note(id, 'conversation'));
    });
    messages.forEach((m) => {
      [...(m.participant_character_ids || []), m.sender_character_id, m.receiver_character_id]
        .forEach((id) => note(id, 'conversation'));
    });
    roomParticipants.forEach((p) => {
      if (p?.participant_type === 'character') note(p.participant_id, 'shared scene');
    });
    // Shared household — established co-residents, unit-aware.
    homeLocations.forEach((home) => householdIdsOf(home).forEach((id) => note(id, 'shared household')));
    // Story Events — documented co-participation in an established event.
    storyEvents.forEach((e) => {
      [...(e?.participant_character_ids || []), ...(e?.focus_character_ids || [])]
        .forEach((id) => note(id, 'story event'));
    });

    const connectedIds = [...connections.keys()];

    // ── RESOLVE RECORDS BY EXACT ID (proven contact graph) ────────────────────
    const batches = [];
    for (let i = 0; i < connectedIds.length; i += 25) batches.push(connectedIds.slice(i, i + 25));
    const resolved = [];
    for (const batch of batches) {
      const rows = await base44.asServiceRole.entities.Character
        .filter({ id: { $in: batch } }, null, batch.length)
        .catch(() => []);
      resolved.push(...asArray(rows));
    }

    const myEmail = String(user.email || '').toLowerCase();
    const crossAccount = resolved
      .filter((c) => c && c.id && c.name)
      .filter((c) => !DEAD_STATUS.includes(c.status) && c.life_status !== 'deceased')
      .filter((c) => c.is_test_character !== true && c.character_type !== 'npc_world_service')
      .filter((c) => c.owner_email && String(c.owner_email).toLowerCase() !== myEmail)
      .map((c) => ({
        id: c.id,
        name: c.name,
        avatar_url: c.avatar_url || c.image_avatar_url || '',
        owner_email: c.owner_email,
        character_type: c.character_type || '',
        account_email: c.owner_email,
        connection: connections.get(c.id) || 'connection',
        is_cross_account: true,
      }))
      .sort((a, b) =>
        String(a.owner_email).localeCompare(String(b.owner_email)) ||
        String(a.name).localeCompare(String(b.name))
      );

    return Response.json({
      connected_ids: connectedIds,
      connection_reasons: Object.fromEntries(connections),
      cross_account_characters: crossAccount,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});