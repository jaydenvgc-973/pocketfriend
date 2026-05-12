/**
 * Ghost Duplicate Diagnostic
 * 
 * CRITICAL: Detects duplicate same-name Character records created from family-title references.
 * 
 * Ghost duplicates are created when the system wrongly assumes "every family row = create npc_family_member"
 * instead of "family row = link to existing Character or create ONLY if no match exists".
 * 
 * Ghosts contaminate:
 * - Age-restricted locations (minors default to adult if ghost has no age)
 * - Travel/presence simulation (using ghost instead of primary)
 * - Avatar display (using ghost with missing avatar_url)
 * - Home location (ghost has no home, primary does)
 * - Relationship references (split across primary + ghost)
 * 
 * This diagnostic finds:
 * 1. All same-name groups within owner_email scope
 * 2. Primary record (best identity data: age + avatar + home + character_type)
 * 3. Ghost records (missing age/avatar/home, created from family titles)
 * 4. All Character.ids, character_type, age, avatar_url, home, current_location
 * 5. Relationship links pointing to each (fictional_relationships, family_members arrays)
 * 6. World Contact links
 * 7. Safety violations (minors in adult locations via ghost record)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch all characters for this user
    const allCharacters = await base44.entities.Character.filter({
      owner_email: user.email
    }, '', 500);

    // Group by normalized name
    const nameGroups = {};
    allCharacters.forEach(char => {
      if (!char.name?.trim()) return;
      const nameKey = char.name.trim().toLowerCase();
      if (!nameGroups[nameKey]) nameGroups[nameKey] = [];
      nameGroups[nameKey].push(char);
    });

    // Find duplicate groups (same name, multiple IDs)
    const duplicateGroups = Object.entries(nameGroups)
      .filter(([, records]) => records.length > 1)
      .map(([name, records]) => {
        // Rank each record: primary has best identity data
        const scored = records.map(char => {
          const score = {
            hasAge: char.age != null || char.birthday != null ? 2 : 0,
            hasAvatar: char.avatar_url ? 2 : 0,
            hasHome: char.current_home_location_id || char.home_location_id ? 2 : 0,
            hasCharacterType: char.character_type && char.character_type !== 'npc_family_member' ? 2 : 0,
            isActivated: char.is_active_character ? 1 : 0,
            isNotNPC: !char.character_type?.startsWith('npc') ? 2 : 0,
          };
          const total = Object.values(score).reduce((a, b) => a + b, 0);
          return { char, score, total };
        });

        scored.sort((a, b) => b.total - a.total);
        const primary = scored[0];
        const ghosts = scored.slice(1);

        return {
          name,
          primary: primary.char,
          primaryScore: primary.total,
          ghosts: ghosts.map(g => ({ char: g.char, score: g.total })),
          totalRecords: records.length
        };
      });

    // For each duplicate group, find all relationship references
    const referencesMap = {};
    const safetyViolations = [];

    for (const group of duplicateGroups) {
      const allIds = [group.primary.id, ...group.ghosts.map(g => g.char.id)];
      const references = {
        primary: {
          id: group.primary.id,
          characterType: group.primary.character_type,
          age: group.primary.age || (group.primary.birthday ? new Date().getFullYear() - new Date(group.primary.birthday).getFullYear() : null),
          avatar: group.primary.avatar_url ? 'yes' : 'no',
          home: group.primary.current_home_location_id || group.primary.home_location_id || 'none',
          currentLocation: group.primary.resolved_current_location_id || group.primary.current_home_location_id || 'unknown',
          fictionalRelationships: [],
          familyRows: [],
          worldContacts: [],
          relatedCharacterLinks: []
        },
        ghosts: group.ghosts.map(g => ({
          id: g.char.id,
          characterType: g.char.character_type,
          age: g.char.age || (g.char.birthday ? new Date().getFullYear() - new Date(g.char.birthday).getFullYear() : null),
          avatar: g.char.avatar_url ? 'yes' : 'no',
          home: g.char.current_home_location_id || g.char.home_location_id || 'none',
          currentLocation: g.char.resolved_current_location_id || g.char.current_home_location_id || 'unknown',
          fictionalRelationships: [],
          familyRows: [],
          worldContacts: [],
          relatedCharacterLinks: [],
          ghostScore: g.score
        }))
      };

      // Find all relationships pointing to these IDs
      for (const char of allCharacters) {
        // Check fictional_relationships
        if (char.fictional_relationships?.length > 0) {
          char.fictional_relationships.forEach(rel => {
            if (allIds.includes(rel.related_character_id)) {
              const targetId = rel.related_character_id;
              if (targetId === group.primary.id) {
                references.primary.fictionalRelationships.push({
                  source: char.name,
                  sourceId: char.id,
                  relationship: rel.relationship_type,
                  description: rel.description
                });
              } else {
                const ghostRef = references.ghosts.find(g => g.id === targetId);
                if (ghostRef) {
                  ghostRef.fictionalRelationships.push({
                    source: char.name,
                    sourceId: char.id,
                    relationship: rel.relationship_type,
                    description: rel.description
                  });
                }
              }
            }
          });
        }

        // Check family_members array
        if (char.family_members?.length > 0) {
          char.family_members.forEach(fm => {
            if (fm._linked_character_id && allIds.includes(fm._linked_character_id)) {
              const targetId = fm._linked_character_id;
              if (targetId === group.primary.id) {
                references.primary.familyRows.push({
                  source: char.name,
                  sourceId: char.id,
                  familyMemberName: fm.name,
                  relationship: fm.relationship_type,
                  photoUrl: fm.photo_url ? 'yes' : 'no'
                });
              } else {
                const ghostRef = references.ghosts.find(g => g.id === targetId);
                if (ghostRef) {
                  ghostRef.familyRows.push({
                    source: char.name,
                    sourceId: char.id,
                    familyMemberName: fm.name,
                    relationship: fm.relationship_type,
                    photoUrl: fm.photo_url ? 'yes' : 'no'
                  });
                }
              }
            }
          });
        }
      }

      // Check for age safety violations (ghost with no age in adult location, or minor ghost in adult venue)
      for (const ghost of group.ghosts) {
        const ghostChar = ghost.char;
        const ghostAge = ghost.age;
        
        // If ghost has no age and is in an adult location, flag it
        if (!ghostAge && ghostChar.resolved_current_location_id) {
          // Try to determine if location is adult-only
          safetyViolations.push({
            name: group.name,
            issue: 'Ghost record with no age in location',
            ghostId: ghostChar.id,
            primaryId: group.primary.id,
            primaryAge: references.primary.age,
            ghostAge: ghostAge,
            ghostLocation: ghostChar.resolved_current_location_id,
            severity: 'HIGH - Missing age data in ghost record'
          });
        }

        // If primary is minor but ghost has no age
        if (references.primary.age && references.primary.age < 18 && !ghostAge) {
          safetyViolations.push({
            name: group.name,
            issue: 'Real character is minor, ghost has no age data',
            ghostId: ghostChar.id,
            primaryId: group.primary.id,
            primaryAge: references.primary.age,
            ghostAge: ghostAge,
            severity: 'HIGH - Ghost duplicate defaulting to adult behavior'
          });
        }
      }

      referencesMap[group.name] = references;
    }

    return Response.json({
      success: true,
      user_email: user.email,
      total_characters: allCharacters.length,
      duplicate_groups_count: duplicateGroups.length,
      safety_violations_count: safetyViolations.length,
      duplicate_groups: duplicateGroups.map(g => ({
        name: g.name,
        totalRecords: g.totalRecords,
        primary: {
          id: g.primary.id,
          characterType: g.primary.character_type,
          status: g.primary.status,
          age: g.primary.age,
          birthday: g.primary.birthday,
          avatar: g.primary.avatar_url ? 'yes' : 'no',
          home: g.primary.current_home_location_id || g.primary.home_location_id,
          currentLocation: g.primary.resolved_current_location_id
        },
        ghosts: g.ghosts.map(ghostData => ({
          id: ghostData.char.id,
          characterType: ghostData.char.character_type,
          status: ghostData.char.status,
          age: ghostData.char.age,
          birthday: ghostData.char.birthday,
          avatar: ghostData.char.avatar_url ? 'yes' : 'no',
          home: ghostData.char.current_home_location_id || ghostData.char.home_location_id,
          currentLocation: ghostData.char.resolved_current_location_id,
          score: ghostData.score
        }))
      })),
      references_by_group: referencesMap,
      safety_violations: safetyViolations
    });
  } catch (error) {
    return Response.json(
      { error: error.message, type: 'backend_error' },
      { status: 500 }
    );
  }
});