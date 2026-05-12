/**
 * Leo Parker Duplicate Identity Diagnostic
 * 
 * CRITICAL: Detects and reports Leo Parker duplicate npc_family_member records.
 * 
 * Leo Parker is the shared son of Nathan Parker and Lila Green.
 * Leo Parker must be ONE Character.id, not multiple npc_family_member records.
 * 
 * This function:
 * 1. Finds all "Leo Parker" records under the user's owner_email
 * 2. Reports character_type, age, avatar, status, family/relationship references
 * 3. Identifies which is the primary record (best identity data)
 * 4. Shows all references pointing to each record
 * 5. Flags duplicates for merge
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

    // Find all "Leo Parker" records (case-insensitive)
    const leoParkerRecords = allCharacters.filter(c => {
      if (!c.name?.trim()) return false;
      return c.name.trim().toLowerCase() === 'leo parker';
    });

    if (leoParkerRecords.length === 0) {
      return Response.json({
        success: true,
        message: 'No Leo Parker records found',
        leo_parker_records: [],
        duplicate_count: 0,
        references: {}
      });
    }

    // Score each record for "primary" status
    const scored = leoParkerRecords.map(char => {
      const score = {
        hasAge: (char.age != null || char.birthday != null) ? 2 : 0,
        hasAvatar: char.avatar_url ? 2 : 0,
        hasHome: (char.current_home_location_id || char.home_location_id) ? 2 : 0,
        characterType: char.character_type === 'npc_family_member' ? 1 : 0,
        status: char.status === 'active' ? 1 : 0,
      };
      const total = Object.values(score).reduce((a, b) => a + b, 0);
      return { char, score, total };
    });

    scored.sort((a, b) => b.total - a.total);
    const primaryRecord = scored[0];
    const duplicates = scored.slice(1);

    // For each record, find all references
    const references = {};
    const allIds = leoParkerRecords.map(c => c.id);

    for (const recordData of scored) {
      const char = recordData.char;
      const refs = {
        id: char.id,
        characterType: char.character_type,
        age: char.age,
        birthday: char.birthday,
        avatar: char.avatar_url ? 'yes' : 'no',
        home: char.current_home_location_id || char.home_location_id || 'none',
        status: char.status,
        score: recordData.total,
        isPrimary: char.id === primaryRecord.char.id,
        fictionalRelationships: [],
        familyRows: [],
        parentReferences: []
      };

      // Find fictional relationships pointing to this record
      for (const otherChar of allCharacters) {
        if (otherChar.fictional_relationships?.length > 0) {
          otherChar.fictional_relationships.forEach(rel => {
            if (rel.related_character_id === char.id) {
              refs.fictionalRelationships.push({
                source: otherChar.name,
                sourceId: otherChar.id,
                relationship: rel.relationship_type
              });
            }
          });
        }

        // Find family rows pointing to this record (especially Nathan and Lila)
        if (otherChar.family_members?.length > 0) {
          otherChar.family_members.forEach(fm => {
            if (fm._linked_character_id === char.id) {
              refs.familyRows.push({
                source: otherChar.name,
                sourceId: otherChar.id,
                relationship: fm.relationship_type,
                familyMemberName: fm.name
              });
            }
          });
        }

        // Track Nathan/Lila specifically
        if ((otherChar.name?.toLowerCase().includes('nathan') || otherChar.name?.toLowerCase().includes('lila')) &&
            otherChar.family_members?.length > 0) {
          otherChar.family_members.forEach(fm => {
            if (fm.name?.toLowerCase() === 'leo parker' || fm._linked_character_id === char.id) {
              refs.parentReferences.push({
                parent: otherChar.name,
                parentId: otherChar.id,
                linkedTo: char.id,
                familyTitle: fm.relationship_type
              });
            }
          });
        }
      }

      references[char.id] = refs;
    }

    return Response.json({
      success: true,
      user_email: user.email,
      leo_parker_records: leoParkerRecords.map(c => ({
        id: c.id,
        characterType: c.character_type,
        age: c.age,
        birthday: c.birthday,
        avatar: c.avatar_url ? 'yes' : 'no',
        home: c.current_home_location_id || c.home_location_id,
        status: c.status,
        createdDate: c.created_date
      })),
      duplicate_count: duplicates.length,
      primary_record: {
        id: primaryRecord.char.id,
        name: primaryRecord.char.name,
        characterType: primaryRecord.char.character_type,
        score: primaryRecord.total,
        age: primaryRecord.char.age,
        avatar: primaryRecord.char.avatar_url ? 'yes' : 'no',
        home: primaryRecord.char.current_home_location_id || primaryRecord.char.home_location_id
      },
      duplicate_records: duplicates.map(d => ({
        id: d.char.id,
        characterType: d.char.character_type,
        score: d.total,
        age: d.char.age,
        avatar: d.char.avatar_url ? 'yes' : 'no'
      })),
      references: references,
      migration_required: duplicates.length > 0
    });
  } catch (error) {
    return Response.json(
      { error: error.message, type: 'backend_error' },
      { status: 500 }
    );
  }
});