import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * sanitizeMarkMemories
 * 
 * One-time retroactive fix for cross-account identity contamination.
 * Scans ALL Memory records for this user's characters and replaces
 * any occurrences of "Mark" (a different user's name) with "Jayden"
 * (the correct current user's world name).
 * 
 * This corrects the root cause: service-role-created memories stored
 * "Mark" as the user identity, causing characters to split-reference
 * the user as two different people.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the current user's world name from UserSettings
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    const worldName = settingsList[0]?.fictional_world_name || null;

    if (!worldName) {
      return Response.json({ error: 'No world name found for user' }, { status: 400 });
    }

    const FOREIGN_NAME = 'Mark';

    // Only run if the user is NOT named Mark (safety check)
    if (worldName === FOREIGN_NAME) {
      return Response.json({ 
        success: true, 
        message: 'User world name is Mark — no sanitization needed.',
        updated: 0
      });
    }

    // Get all characters owned by this user
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const characterIds = characters.map(c => c.id);

    if (characterIds.length === 0) {
      return Response.json({ success: true, message: 'No characters found', updated: 0 });
    }

    let totalUpdated = 0;
    let totalScanned = 0;
    const updates = [];

    // Scan memories for ALL user's characters
    for (const charId of characterIds) {
      // Get all memories for this character (both user-scoped and service-role-created)
      const memories = await base44.asServiceRole.entities.Memory.filter(
        { character_id: charId },
        '-timestamp',
        500
      );

      totalScanned += memories.length;

      for (const mem of memories) {
        const foreignRegex = new RegExp(`\\b${FOREIGN_NAME}\\b`, 'g');
        
        const titleHasForeign = foreignRegex.test(mem.title || '');
        foreignRegex.lastIndex = 0;
        const descHasForeign = foreignRegex.test(mem.description || '');
        foreignRegex.lastIndex = 0;
        const impactHasForeign = foreignRegex.test(mem.emotional_impact || '');
        foreignRegex.lastIndex = 0;
        const lessonHasForeign = foreignRegex.test(mem.lesson_learned || '');

        if (titleHasForeign || descHasForeign || impactHasForeign || lessonHasForeign) {
          const newTitle = (mem.title || '').replace(new RegExp(`\\b${FOREIGN_NAME}\\b`, 'g'), worldName);
          const newDesc = (mem.description || '').replace(new RegExp(`\\b${FOREIGN_NAME}\\b`, 'g'), worldName);
          const newImpact = (mem.emotional_impact || '').replace(new RegExp(`\\b${FOREIGN_NAME}\\b`, 'g'), worldName);
          const newLesson = (mem.lesson_learned || '').replace(new RegExp(`\\b${FOREIGN_NAME}\\b`, 'g'), worldName);

          updates.push(
            base44.asServiceRole.entities.Memory.update(mem.id, {
              title: newTitle,
              description: newDesc,
              emotional_impact: newImpact,
              lesson_learned: newLesson,
            })
          );
          totalUpdated++;
        }
      }
    }

    // Execute all updates in parallel
    if (updates.length > 0) {
      await Promise.all(updates);
    }

    return Response.json({
      success: true,
      worldName,
      foreignNameReplaced: FOREIGN_NAME,
      totalScanned,
      totalUpdated,
      message: `Sanitized ${totalUpdated} memories across ${characterIds.length} characters. All "${FOREIGN_NAME}" references replaced with "${worldName}".`
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});