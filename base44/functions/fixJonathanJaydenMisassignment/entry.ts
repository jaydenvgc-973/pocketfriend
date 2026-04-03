import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Fix: Remove incorrect son/Jayden identity from Jonathan Anthony Smith
 * and reassign maternal relationship descriptors to the user.
 * 
 * This is a targeted data correction — does NOT reset unrelated history.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const log = [];
    const fixes = [];

    // --- Step 1: Find all active characters for this user ---
    const allChars = await base44.asServiceRole.entities.Character.filter({ created_by: user.email });
    log.push(`Found ${allChars.length} characters for user ${user.email}`);

    // --- Step 2: Get user settings to find the display name ---
    const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
    const settings = settingsList[0] || {};
    const userDisplayName = settings.fictional_world_name || user.full_name || 'Jayden';
    log.push(`User display name: "${userDisplayName}"`);

    // --- Step 3: Find Jonathan Anthony Smith ---
    const jonathan = allChars.find(c =>
      c.name?.toLowerCase().includes('jonathan') &&
      (c.name?.toLowerCase().includes('smith') || c.name?.toLowerCase().includes('anthony'))
    );

    if (!jonathan) {
      return Response.json({
        success: false,
        message: 'Jonathan Anthony Smith not found in this user\'s characters.',
        log,
      });
    }
    log.push(`Found Jonathan: "${jonathan.name}" (ID: ${jonathan.id})`);

    // --- Step 4: Scan ALL characters for misassignment of Jonathan as son/Jayden ---
    for (const char of allChars) {
      if (char.id === jonathan.id) continue;

      let charUpdates = {};
      let charChanged = false;

      const familyMembers = char.family_members || [];
      const fictionalRels = char.fictional_relationships || [];

      // 4a: Remove Jonathan from family_members if listed as son/Jayden
      const jonathanFamilyIdx = familyMembers.findIndex(m => {
        const nameMatch = m.name?.toLowerCase().includes('jonathan') ||
          m.name?.toLowerCase().includes('jayden');
        const roleMatch = ['son', 'child', 'daughter'].includes((m.relationship_type || '').toLowerCase());
        const idMatch = m._character_id === jonathan.id;
        return (nameMatch && roleMatch) || idMatch;
      });

      let jaydenDescriptors = null; // Capture for reassignment

      if (jonathanFamilyIdx !== -1) {
        jaydenDescriptors = familyMembers[jonathanFamilyIdx];
        log.push(`[${char.name}] Removing Jonathan/Jayden from family_members at index ${jonathanFamilyIdx} (was: "${jaydenDescriptors.name}" / "${jaydenDescriptors.relationship_type}")`);
        fixes.push(`Removed "${jaydenDescriptors.name}" (son role) from ${char.name}'s family list`);
        charUpdates.family_members = familyMembers.filter((_, i) => i !== jonathanFamilyIdx);
        charChanged = true;
      }

      // 4b: Remove Jonathan from fictional_relationships if listed as son/Jayden
      const jonathanRelIdx = fictionalRels.findIndex(r => {
        const nameMatch = r.person_name?.toLowerCase().includes('jonathan') ||
          r.person_name?.toLowerCase().includes('jayden');
        const roleMatch = ['son', 'child', 'daughter'].includes((r.relationship_type || '').toLowerCase());
        const idMatch = r.related_character_id === jonathan.id;
        return (nameMatch && roleMatch) || (idMatch && roleMatch);
      });

      if (jonathanRelIdx !== -1) {
        const rel = fictionalRels[jonathanRelIdx];
        if (!jaydenDescriptors) jaydenDescriptors = rel;
        log.push(`[${char.name}] Removing Jonathan/Jayden from fictional_relationships at index ${jonathanRelIdx} (was: "${rel.person_name}" / "${rel.relationship_type}")`);
        fixes.push(`Removed "${rel.person_name}" (son/Jayden role) from ${char.name}'s fictional relationships`);
        const updatedRels = fictionalRels.filter((_, i) => i !== jonathanRelIdx);
        charUpdates.fictional_relationships = updatedRels;
        charChanged = true;
      }

      // 4c: Ensure user is correctly placed in family_members as son
      const currentFamily = charUpdates.family_members || familyMembers;
      const userAlreadyInFamily = currentFamily.some(m => m._is_user);

      if (!userAlreadyInFamily) {
        log.push(`[${char.name}] User not in family_members — adding user as son`);
        fixes.push(`Added user (${userDisplayName}) as son in ${char.name}'s family list`);
        charUpdates.family_members = [
          ...currentFamily,
          {
            name: userDisplayName,
            relationship_type: 'son',
            _is_user: true,
            age_at_creation: null,
            age_set_date: null,
          }
        ];
        charChanged = true;
      } else {
        // Make sure the existing _is_user entry has relationship_type = son
        const updatedFamily = currentFamily.map(m => {
          if (m._is_user && (m.relationship_type || '').toLowerCase() !== 'son') {
            log.push(`[${char.name}] Correcting user family entry from "${m.relationship_type}" to "son"`);
            fixes.push(`Corrected user role in ${char.name}'s family list to "son"`);
            return { ...m, relationship_type: 'son' };
          }
          return m;
        });
        if (JSON.stringify(updatedFamily) !== JSON.stringify(currentFamily)) {
          charUpdates.family_members = updatedFamily;
          charChanged = true;
        }
      }

      // 4d: Save changes to this character
      if (charChanged) {
        await base44.asServiceRole.entities.Character.update(char.id, charUpdates);
        log.push(`[${char.name}] Saved updates.`);
      } else {
        log.push(`[${char.name}] No changes needed.`);
      }
    }

    // --- Step 5: Fix Jonathan's own profile — remove any Jayden identity markers ---
    {
      const jonathanFamilyMembers = jonathan.family_members || [];
      const jonathanFictionalRels = jonathan.fictional_relationships || [];
      let jonathanUpdates = {};
      let jonathanChanged = false;

      // Remove any entry on Jonathan that positions him as son/Jayden in relationship to the main characters
      const cleanedRels = jonathanFictionalRels.map(r => {
        if (['son', 'child'].includes((r.relationship_type || '').toLowerCase()) &&
          r.person_name?.toLowerCase().includes('jayden')) {
          log.push(`[Jonathan] Removing Jayden identity marker from fictional_relationships: "${r.person_name}"`);
          fixes.push(`Removed Jayden identity marker from Jonathan's fictional relationships`);
          jonathanChanged = true;
          return null;
        }
        return r;
      }).filter(Boolean);

      if (jonathanChanged) {
        jonathanUpdates.fictional_relationships = cleanedRels;
        await base44.asServiceRole.entities.Character.update(jonathan.id, jonathanUpdates);
        log.push(`[Jonathan] Saved identity cleanup.`);
      } else {
        log.push(`[Jonathan] No Jayden identity markers found on his own profile.`);
      }
    }

    // --- Step 6: Update UserSettings user_relatives to ensure user is mapped as son to relevant character ---
    {
      // Find the character who should have a maternal relationship with the user
      // (the character where Jonathan was incorrectly listed as son/Jayden)
      const maternalChar = allChars.find(c =>
        c.id !== jonathan.id &&
        (c.family_members || []).some(m => m._is_user)
      );

      if (maternalChar && settings.id) {
        const existingRelatives = settings.user_relatives || {};
        if (!existingRelatives[maternalChar.id] || existingRelatives[maternalChar.id] !== 'mother') {
          const updatedRelatives = { ...existingRelatives, [maternalChar.id]: 'mother' };
          await base44.asServiceRole.entities.UserSettings.update(settings.id, {
            user_relatives: updatedRelatives
          });
          log.push(`Updated user_relatives: mapped ${maternalChar.name} as "mother" to user`);
          fixes.push(`Set ${maternalChar.name} as "mother" in user's relationship settings`);
        }
      }
    }

    return Response.json({
      success: true,
      fixes_applied: fixes,
      log,
      message: `Done. Applied ${fixes.length} fix(es). Jonathan Anthony Smith is no longer assigned as son/Jayden. The user (${userDisplayName}) now holds the son role.`,
    });

  } catch (error) {
    console.error('[fixJonathanJaydenMisassignment]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});