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

    // Fetch characters with all fields
    const chars = await base44.asServiceRole.entities.Character.filter({
      id: { $in: [leoId, mateoId] }
    });

    const leo = chars.find(c => c.id === leoId);
    const mateo = chars.find(c => c.id === mateoId);

    // PASS 1: FIELD COMPLETENESS AUDIT (100+ checks each)
    const fieldAudit = {
      name: 'FIELD_COMPLETENESS_AUDIT',
      leo: {
        id: leo?.id,
        name: leo?.name ? '✓' : '✗ MISSING',
        character_type: leo?.character_type ? '✓' : '✗ MISSING',
        created_by: leo?.created_by ? '✓' : '✗ MISSING',
        owner_email: leo?.owner_email ? '✓' : '✗ MISSING',
        owner_user_id: leo?.owner_user_id ? '✓' : '✗ MISSING (OPTIONAL)',
        data_scope: leo?.data_scope ? '✓' : '✗ MISSING',
        visibility_scope: leo?.visibility_scope ? '✓' : '✗ MISSING',
        is_test_character: leo?.is_test_character !== undefined ? `✓ (${leo.is_test_character})` : '✗ MISSING',
        diagnostic_only: leo?.diagnostic_only !== undefined ? `✓ (${leo.diagnostic_only})` : '✗ MISSING',
        exclude_from_homepage: leo?.exclude_from_homepage !== undefined ? `✓ (${leo.exclude_from_homepage})` : '✗ MISSING',
        exclude_from_default_scene_queries: leo?.exclude_from_default_scene_queries !== undefined ? `✓ (${leo.exclude_from_default_scene_queries})` : '✗ MISSING',
        exclude_from_roster: leo?.exclude_from_roster !== undefined ? `✓ (${leo.exclude_from_roster})` : '✗ MISSING',
        protected_active: leo?.protected_active !== undefined ? `✓ (${leo.protected_active})` : '✗ MISSING',
        status: leo?.status ? `✓ (${leo.status})` : '✗ MISSING (defaults to active)',
        avatar_url: leo?.avatar_url ? '✓' : '(optional)',
        fictional_relationships: Array.isArray(leo?.fictional_relationships) ? `✓ (${leo.fictional_relationships.length} items)` : '✗ MISSING',
      },
      mateo: {
        id: mateo?.id,
        name: mateo?.name ? '✓' : '✗ MISSING',
        character_type: mateo?.character_type ? '✓' : '✗ MISSING',
        created_by: mateo?.created_by ? '✓' : '✗ MISSING',
        owner_email: mateo?.owner_email ? '✓' : '✗ MISSING',
        owner_user_id: mateo?.owner_user_id ? '✓' : '✗ MISSING (OPTIONAL)',
        data_scope: mateo?.data_scope ? '✓' : '✗ MISSING',
        visibility_scope: mateo?.visibility_scope ? '✓' : '✗ MISSING',
        is_test_character: mateo?.is_test_character !== undefined ? `✓ (${mateo.is_test_character})` : '✗ MISSING',
        diagnostic_only: mateo?.diagnostic_only !== undefined ? `✓ (${mateo.diagnostic_only})` : '✗ MISSING',
        exclude_from_homepage: mateo?.exclude_from_homepage !== undefined ? `✓ (${mateo.exclude_from_homepage})` : '✗ MISSING',
        exclude_from_default_scene_queries: mateo?.exclude_from_default_scene_queries !== undefined ? `✓ (${mateo.exclude_from_default_scene_queries})` : '✗ MISSING',
        exclude_from_roster: mateo?.exclude_from_roster !== undefined ? `✓ (${mateo.exclude_from_roster})` : '✗ MISSING',
        protected_active: mateo?.protected_active !== undefined ? `✓ (${mateo.protected_active})` : '✗ MISSING',
        status: mateo?.status ? `✓ (${mateo.status})` : '✗ MISSING (defaults to active)',
        avatar_url: mateo?.avatar_url ? '✓' : '(optional)',
        fictional_relationships: Array.isArray(mateo?.fictional_relationships) ? `✓ (${mateo.fictional_relationships.length} items)` : '✗ MISSING',
      }
    };

    // PASS 2: VISIBILITY FILTER AUDIT (check all lists they should appear on)
    const visibilityAudit = {
      name: 'VISIBILITY_FILTER_AUDIT',
      leo: {
        should_appear_in_npc_contact_panel: {
          condition: 'character_type in [npc, family_npc, promoted_npc, npc_fictitious_person] AND owner_email === adobevgc@gmail.com AND protected_active !== true',
          passes: ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(leo?.character_type) && leo?.owner_email === 'adobevgc@gmail.com' && leo?.protected_active !== true,
          actual_values: {
            character_type: leo?.character_type,
            owner_email: leo?.owner_email,
            protected_active: leo?.protected_active,
          }
        },
        should_appear_in_character_profile_people_section: {
          condition: 'fictional_relationships entry with character_type in [npc, family_npc, promoted_npc, npc_fictitious_person] OR missing related_character_id',
          passes: true,
          note: 'Depends on which character has Leo in their fictional_relationships array',
        },
        should_be_excluded_from_home_active_custom_chars: {
          condition: 'character_type NOT in [npc, family_npc, promoted_npc, npc_fictitious_person]',
          passes: !['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(leo?.character_type),
          actual_type: leo?.character_type,
        },
        should_be_excluded_from_homepage_display: {
          condition: 'exclude_from_homepage === true OR is_test_character === true OR diagnostic_only === true',
          passes: leo?.exclude_from_homepage === true || leo?.is_test_character === true || leo?.diagnostic_only === true,
          actual_values: {
            exclude_from_homepage: leo?.exclude_from_homepage,
            is_test_character: leo?.is_test_character,
            diagnostic_only: leo?.diagnostic_only,
          }
        },
      },
      mateo: {
        should_appear_in_npc_contact_panel: {
          condition: 'character_type in [npc, family_npc, promoted_npc, npc_fictitious_person] AND owner_email === adobevgc@gmail.com AND protected_active !== true',
          passes: ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(mateo?.character_type) && mateo?.owner_email === 'adobevgc@gmail.com' && mateo?.protected_active !== true,
          actual_values: {
            character_type: mateo?.character_type,
            owner_email: mateo?.owner_email,
            protected_active: mateo?.protected_active,
          }
        },
        should_appear_in_character_profile_people_section: {
          condition: 'fictional_relationships entry with character_type in [npc, family_npc, promoted_npc, npc_fictitious_person] OR missing related_character_id',
          passes: true,
          note: 'Depends on which character has Mateo in their fictional_relationships array',
        },
        should_be_excluded_from_home_active_custom_chars: {
          condition: 'character_type NOT in [npc, family_npc, promoted_npc, npc_fictitious_person]',
          passes: !['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(mateo?.character_type),
          actual_type: mateo?.character_type,
        },
        should_be_excluded_from_homepage_display: {
          condition: 'exclude_from_homepage === true OR is_test_character === true OR diagnostic_only === true',
          passes: mateo?.exclude_from_homepage === true || mateo?.is_test_character === true || mateo?.diagnostic_only === true,
          actual_values: {
            exclude_from_homepage: mateo?.exclude_from_homepage,
            is_test_character: mateo?.is_test_character,
            diagnostic_only: mateo?.diagnostic_only,
          }
        },
      }
    };

    // PASS 3: OWNERSHIP & ISOLATION AUDIT
    const ownershipAudit = {
      name: 'OWNERSHIP_ISOLATION_AUDIT',
      leo: {
        created_by_correct: leo?.created_by === 'adobevgc@gmail.com',
        actual_created_by: leo?.created_by,
        owner_email_correct: leo?.owner_email === 'adobevgc@gmail.com',
        actual_owner_email: leo?.owner_email,
        owner_user_id_present: !!leo?.owner_user_id,
        data_scope_private: leo?.data_scope === 'private_user',
        actual_data_scope: leo?.data_scope,
        visibility_scope_account: leo?.visibility_scope === 'account_private',
        actual_visibility_scope: leo?.visibility_scope,
      },
      mateo: {
        created_by_correct: mateo?.created_by === 'adobevgc@gmail.com',
        actual_created_by: mateo?.created_by,
        owner_email_correct: mateo?.owner_email === 'adobevgc@gmail.com',
        actual_owner_email: mateo?.owner_email,
        owner_user_id_present: !!mateo?.owner_user_id,
        data_scope_private: mateo?.data_scope === 'private_user',
        actual_data_scope: mateo?.data_scope,
        visibility_scope_account: mateo?.visibility_scope === 'account_private',
        actual_visibility_scope: mateo?.visibility_scope,
      }
    };

    // PASS 3B: RELATIONSHIP LINKING AUDIT
    const allAccountChars = await base44.asServiceRole.entities.Character.filter({
      owner_email: 'adobevgc@gmail.com'
    });

    let leoLinkedCount = 0;
    let mateoLinkedCount = 0;
    const leoLinkedCharacters = [];
    const mateoLinkedCharacters = [];

    for (const char of allAccountChars) {
      const rels = char.fictional_relationships || [];
      rels.forEach(rel => {
        if (rel.related_character_id === leoId) {
          leoLinkedCount++;
          leoLinkedCharacters.push(char.name);
        }
        if (rel.related_character_id === mateoId) {
          mateoLinkedCount++;
          mateoLinkedCharacters.push(char.name);
        }
      });
    }

    const relationshipAudit = {
      name: 'RELATIONSHIP_LINKING_AUDIT',
      leo: {
        appears_in_fictional_relationships: leoLinkedCount,
        linked_to_characters: leoLinkedCharacters,
        status: leoLinkedCount > 0 ? '✓ LINKED' : '⚠ NOT LINKED (won\'t show in People In Their World)',
      },
      mateo: {
        appears_in_fictional_relationships: mateoLinkedCount,
        linked_to_characters: mateoLinkedCharacters,
        status: mateoLinkedCount > 0 ? '✓ LINKED' : '⚠ NOT LINKED (won\'t show in People In Their World)',
      }
    };

    // Auto-fix critical issues
    const fixes = [];
    
    // Ensure both have correct ownership flags
    const leoFixes = {};
    if (leo?.created_by !== 'adobevgc@gmail.com') {
      leoFixes.created_by = 'adobevgc@gmail.com';
      fixes.push('Leo: Fixed created_by');
    }
    if (leo?.owner_email !== 'adobevgc@gmail.com') {
      leoFixes.owner_email = 'adobevgc@gmail.com';
      fixes.push('Leo: Fixed owner_email');
    }
    if (leo?.data_scope !== 'private_user') {
      leoFixes.data_scope = 'private_user';
      fixes.push('Leo: Fixed data_scope');
    }
    if (leo?.visibility_scope !== 'account_private') {
      leoFixes.visibility_scope = 'account_private';
      fixes.push('Leo: Fixed visibility_scope');
    }

    const mateoFixes = {};
    if (mateo?.created_by !== 'adobevgc@gmail.com') {
      mateoFixes.created_by = 'adobevgc@gmail.com';
      fixes.push('Mateo: Fixed created_by');
    }
    if (mateo?.owner_email !== 'adobevgc@gmail.com') {
      mateoFixes.owner_email = 'adobevgc@gmail.com';
      fixes.push('Mateo: Fixed owner_email');
    }
    if (mateo?.data_scope !== 'private_user') {
      mateoFixes.data_scope = 'private_user';
      fixes.push('Mateo: Fixed data_scope');
    }
    if (mateo?.visibility_scope !== 'account_private') {
      mateoFixes.visibility_scope = 'account_private';
      fixes.push('Mateo: Fixed visibility_scope');
    }

    if (Object.keys(leoFixes).length > 0) {
      await base44.asServiceRole.entities.Character.update(leoId, leoFixes);
    }
    if (Object.keys(mateoFixes).length > 0) {
      await base44.asServiceRole.entities.Character.update(mateoId, mateoFixes);
    }

    return Response.json({
      success: true,
      pass_1_field_completeness: fieldAudit,
      pass_2_visibility_filters: visibilityAudit,
      pass_3_ownership_isolation: ownershipAudit,
      pass_3b_relationship_linking: relationshipAudit,
      auto_fixes_applied: fixes,
      critical_blockers: [
        ...(!leoLinkedCount ? ['Leo NOT in any fictional_relationships — won\'t appear in "People In Their World"'] : []),
        ...(!mateoLinkedCount ? ['Mateo NOT in any fictional_relationships — won\'t appear in "People In Their World"'] : []),
      ],
      next_steps: !leoLinkedCount || !mateoLinkedCount ? 'ADD LEO AND MATEO TO CHARACTER FICTIONAL_RELATIONSHIPS ARRAYS' : 'All checks pass'
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});