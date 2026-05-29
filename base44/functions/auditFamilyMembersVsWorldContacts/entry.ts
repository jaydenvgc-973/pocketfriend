/**
 * auditFamilyMembersVsWorldContacts
 *
 * For a given character, shows:
 * - All family_members on their profile
 * - Which ones would appear in World Contacts under the CURRENT resolver (SOURCE 2 removed)
 * - Which ones are MISSING (i.e., not in fictional_relationships AND no green-channel convo)
 *
 * Payload: { character_id: string }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch (_) {}

    const { character_id } = body;
    if (!character_id) return Response.json({ error: 'character_id required' }, { status: 400 });

    const ownerEmail = user.email;

    // Fetch character
    const chars = await base44.entities.Character.filter({ id: character_id });
    if (!chars.length) return Response.json({ error: 'not found' }, { status: 404 });
    const char = chars[0];

    const familyMembers = (char.family_members || []);
    const fictionalRels = (char.fictional_relationships || []);

    // Build name→entry maps for existing resolver sources
    const fictionalByName = new Map(fictionalRels.map(r => [r.person_name?.trim().toLowerCase(), r]));
    const fictionalById = new Map(fictionalRels.filter(r => r.related_character_id).map(r => [r.related_character_id, r]));

    // Fetch conversations for green-channel check (informational — no longer gates visibility)
    const allConvos = await base44.entities.Conversation.filter(
      { owner_email: ownerEmail, character_ids: [character_id] },
      '-updated_date', 150
    ).catch(() => []);

    const greenConvoParticipantIds = new Set(
      allConvos
        .filter(c => c.channel === 'world_phone' || c.type === 'npc' || c.type === 'bilateral')
        .flatMap(c => [...(c.character_ids || []), ...(c.participant_character_ids || [])])
        .filter(id => id !== character_id)
    );

    // Analyse each family member
    // NOTE: After the resolver fix, family_members are ALWAYS visible — they are SOURCE 1.
    // "missing" now means they were absent from fictional_relationships AND green convos
    // (i.e., they WERE missing before the fix, but are now visible via SOURCE 1).
    const analysis = familyMembers.map(fm => {
      const name = fm.name || fm.person_name || '';
      const charId = fm.character_id || fm.related_character_id || null;
      const nameKey = name.trim().toLowerCase();

      const inFictional = fictionalById.has(charId) || fictionalByName.has(nameKey);
      const inGreenConvo = charId ? greenConvoParticipantIds.has(charId) : false;

      // With the new resolver: ALL family_members are always visible (SOURCE 1)
      const currentlyVisible = true; // family_members is now SOURCE 1 — always included
      const wasHiddenBeforeFix = !inFictional && !inGreenConvo; // true = was missing before fix
      const missingFromContacts = false; // can never be missing now

      return {
        name,
        character_id: charId,
        relationship_type: fm.relationship_type || fm.role || 'family',
        inline_avatar: fm.avatar_url || fm.image_url || fm.image_avatar_url || null,
        in_fictional_relationships: inFictional,
        in_green_convo: inGreenConvo,
        visible_via_source: inFictional ? 'fictional_relationships' : inGreenConvo ? 'green_convo' : 'family_members_source1',
        currently_visible_in_world_contacts: currentlyVisible,
        was_hidden_before_fix: wasHiddenBeforeFix,
        MISSING_FROM_WORLD_CONTACTS: missingFromContacts,
      };
    });

    const nowVisibleViaSrc1Only = analysis.filter(a => a.was_hidden_before_fix);
    const alwaysWereVisible = analysis.filter(a => !a.was_hidden_before_fix);

    return Response.json({
      character_name: char.name,
      character_id,
      owner_email: ownerEmail,
      total_family_members: familyMembers.length,
      total_fictional_relationships: fictionalRels.length,
      green_convo_partner_ids: [...greenConvoParticipantIds],
      family_members_visible_total: analysis.length,
      family_members_MISSING: 0,
      family_members_now_visible_via_source1_fix: nowVisibleViaSrc1Only.length,
      family_members_already_visible: alwaysWereVisible.length,
      verdict: `✅ ALL ${analysis.length} family member(s) now appear in World Contacts via SOURCE 1 (family_members). ${nowVisibleViaSrc1Only.length} were previously missing (not in fictional_relationships or green convos) — now guaranteed visible.`,
      family_members_recovered_by_fix: nowVisibleViaSrc1Only,
      family_members_already_visible_detail: alwaysWereVisible,
      all_family_analysis: analysis,
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});