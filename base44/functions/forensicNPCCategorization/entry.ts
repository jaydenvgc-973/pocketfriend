import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const leoId = '69e2ac3276e99598733d00f4';
    const mateoId = '69e2adcd435862dcccb898a0';

    // FORENSIC 1: Character Type & NPC Classification
    const chars = await base44.asServiceRole.entities.Character.filter({
      id: { $in: [leoId, mateoId] }
    });

    const forensic1 = {
      name: 'CHARACTER_TYPE_AUDIT',
      leo: {
        id: leoId,
        name: chars[0]?.name,
        character_type: chars[0]?.character_type,
        isNPC: ['npc', 'family_npc', 'promoted_npc'].includes(chars[0]?.character_type),
        data_scope: chars[0]?.data_scope,
        visibility_scope: chars[0]?.visibility_scope,
        created_by: chars[0]?.created_by,
        owner_email: chars[0]?.owner_email,
        is_test_character: chars[0]?.is_test_character,
        diagnostic_only: chars[0]?.diagnostic_only,
        exclude_from_homepage: chars[0]?.exclude_from_homepage,
        exclude_from_default_scene_queries: chars[0]?.exclude_from_default_scene_queries,
        exclude_from_roster: chars[0]?.exclude_from_roster,
      },
      mateo: {
        id: mateoId,
        name: chars[1]?.name,
        character_type: chars[1]?.character_type,
        isNPC: ['npc', 'family_npc', 'promoted_npc'].includes(chars[1]?.character_type),
        data_scope: chars[1]?.data_scope,
        visibility_scope: chars[1]?.visibility_scope,
        created_by: chars[1]?.created_by,
        owner_email: chars[1]?.owner_email,
        is_test_character: chars[1]?.is_test_character,
        diagnostic_only: chars[1]?.diagnostic_only,
        exclude_from_homepage: chars[1]?.exclude_from_homepage,
        exclude_from_default_scene_queries: chars[1]?.exclude_from_default_scene_queries,
        exclude_from_roster: chars[1]?.exclude_from_roster,
      }
    };

    // FORENSIC 2: Relationship Linking Audit
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: 'adobevgc@gmail.com'
    });

    const leoInRelationships = [];
    const mateoInRelationships = [];

    for (const char of allChars) {
      const rels = char.fictional_relationships || [];
      rels.forEach(rel => {
        if (rel.related_character_id === leoId) {
          leoInRelationships.push({
            character: char.name,
            relationship_type: rel.relationship_type,
            description: rel.description?.substring(0, 50),
          });
        }
        if (rel.related_character_id === mateoId) {
          mateoInRelationships.push({
            character: char.name,
            relationship_type: rel.relationship_type,
            description: rel.description?.substring(0, 50),
          });
        }
      });
    }

    const forensic2 = {
      name: 'RELATIONSHIP_LINKING_AUDIT',
      leo_appears_in: leoInRelationships.length,
      mateo_appears_in: mateoInRelationships.length,
      leo_relationships: leoInRelationships,
      mateo_relationships: mateoInRelationships,
      finding: leoInRelationships.length === 0 || mateoInRelationships.length === 0 ? 'MISSING_FROM_RELATIONSHIPS' : 'LINKED_OKAY',
    };

    // FORENSIC 3: Filter Qualification Check
    const forensic3 = {
      name: 'FILTER_QUALIFICATION_AUDIT',
      filters_checked: [
        {
          filter: 'CharacterProfile > People In Their World (lines 849-872)',
          leo_should_pass: chars[0] && ['npc', 'family_npc', 'npc_fictitious_person'].includes(chars[0].character_type),
          mateo_should_pass: chars[1] && ['npc', 'family_npc', 'npc_fictitious_person'].includes(chars[1].character_type),
          condition: 'character_type includes npc/family_npc/npc_fictitious_person OR has related_character_id missing',
        },
        {
          filter: 'Home > Custom Characters List (excludes NPCs)',
          leo_should_be_excluded: chars[0] && ['npc', 'family_npc', 'promoted_npc'].includes(chars[0].character_type),
          mateo_should_be_excluded: chars[1] && ['npc', 'family_npc', 'promoted_npc'].includes(chars[1].character_type),
          condition: 'character_type in [npc, family_npc, promoted_npc] or diagnostic flags true',
        },
        {
          filter: 'NPCContactPanel (lines in components/home)',
          leo_should_appear: chars[0] && ['npc', 'family_npc'].includes(chars[0].character_type) && !chars[0].protected_active,
          mateo_should_appear: chars[1] && ['npc', 'family_npc'].includes(chars[1].character_type) && !chars[1].protected_active,
          condition: 'character_type in [npc, family_npc] AND protected_active is NOT true',
        },
      ],
    };

    // Fix: Ensure character_type is set correctly
    const fixes = [];
    if (chars[0] && !['npc', 'family_npc', 'promoted_npc'].includes(chars[0].character_type)) {
      await base44.asServiceRole.entities.Character.update(leoId, {
        character_type: 'npc',
      });
      fixes.push({ id: leoId, name: 'Leo', fix: 'Set character_type to npc' });
    }

    if (chars[1] && !['npc', 'family_npc', 'promoted_npc'].includes(chars[1].character_type)) {
      await base44.asServiceRole.entities.Character.update(mateoId, {
        character_type: 'npc',
      });
      fixes.push({ id: mateoId, name: 'Mateo', fix: 'Set character_type to npc' });
    }

    return Response.json({
      success: true,
      forensic_1_character_type: forensic1,
      forensic_2_relationship_linking: forensic2,
      forensic_3_filter_qualifications: forensic3,
      fixes_applied: fixes,
      critical_findings: {
        leo_is_npc: forensic1.leo.isNPC,
        mateo_is_npc: forensic1.mateo.isNPC,
        leo_linked_in_relationships: forensic2.leo_appears_in > 0,
        mateo_linked_in_relationships: forensic2.mateo_appears_in > 0,
        next_step: forensic2.leo_appears_in === 0 || forensic2.mateo_appears_in === 0 
          ? 'ADD_TO_CHARACTER_FICTIONAL_RELATIONSHIPS' 
          : 'VERIFY_FILTER_LOGIC_IN_UI_COMPONENTS',
      }
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});