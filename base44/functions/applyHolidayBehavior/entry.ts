import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Check if holiday observation is enabled
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const userSettings = await base44.entities.UserSettings.filter({ owner_email: user.email });
    const settings = userSettings[0] || {};
    
    if (settings.holiday_observation_enabled === false) {
      return Response.json({
        timestamp: new Date().toISOString(),
        status: 'skipped',
        reason: 'Holiday observation disabled in settings',
      });
    }

    // Holiday logic will be implemented via autonomy system integration
    // For now, return placeholder
    const now = new Date();
    const currentHoliday = null; // Would be populated by getHolidayForDate(now)

    if (!currentHoliday) {
      return Response.json({
        timestamp: new Date().toISOString(),
        status: 'no_holiday',
        reason: 'No holiday today',
      });
    }

    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const characters = await base44.entities.Character.filter({ owner_email: user.email });
    const relationships = await base44.entities.CharacterRelationship.list();
    const locations = await base44.entities.LocationReference.list();

    const updates = [];

    for (const character of characters) {
      // Get character relationships
      const charRelationships = relationships.filter(r => r.source_character_id === character.id);

      // Participation determination will be integrated with autonomy system
      // For now, mark as pending integration
      const activity = 'pending_integration';

      // Update character activity for logging
      const updateData = {
        current_activity: `${activity} (${currentHoliday.name})`,
      };

      // Update emotional state if relevant
      const themes = currentHoliday.emotionalThemes || [];
      if (themes.length > 0) {
        const emotionalMap = {
          'joy': 'joyful',
          'celebration': 'excited',
          'reflection': 'reflective',
          'family': 'content',
          'community': 'content',
          'remembrance': 'reflective',
          'gratitude': 'content',
          'grief': 'sad',
          'freedom': 'joyful',
          'pride': 'pride',
        };
        
        const primaryTheme = themes[0];
        const newMood = emotionalMap[primaryTheme];
        if (newMood && character.emotional_state !== newMood) {
          updateData.emotional_state = newMood;
        }
      }

      await base44.entities.Character.update(character.id, updateData);

      updates.push({
        characterId: character.id,
        characterName: character.name,
        holiday: currentHoliday.name,
        action: activity,
        participationScore: participation.score,
      });
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      status: 'success',
      holiday: currentHoliday.name,
      charactersAffected: updates.length,
      updates,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});