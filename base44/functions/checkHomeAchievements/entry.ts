import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, eventType } = await req.json();

    if (!characterId || !eventType) {
      return Response.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const achievements = [];

    // Check for move-related achievements
    if (eventType === 'moved_in') {
      const existing = await base44.entities.UserAchievement.filter({
        character_id: characterId,
        achievement_id: 'first_move',
      });

      if (existing.length === 0) {
        await base44.entities.UserAchievement.create({
          character_id: characterId,
          achievement_id: 'first_move',
          title: 'Fresh Start',
          description: 'Moved into your first new home',
          icon: 'Home',
          unlocked_date: new Date().toISOString(),
        });
        achievements.push('first_move');
      }
    }

    // Check for cleanup achievements
    if (eventType === 'cleaned_home') {
      const existing = await base44.entities.UserAchievement.filter({
        character_id: characterId,
        achievement_id: 'home_cleaner',
      });

      if (existing.length === 0) {
        await base44.entities.UserAchievement.create({
          character_id: characterId,
          achievement_id: 'home_cleaner',
          title: 'Tidy Home',
          description: 'Cleaned up a home',
          icon: 'Sparkles',
          unlocked_date: new Date().toISOString(),
        });
        achievements.push('home_cleaner');
      }
    }

    // Check for decoration achievements
    if (eventType === 'decorated_home') {
      const existing = await base44.entities.UserAchievement.filter({
        character_id: characterId,
        achievement_id: 'interior_designer',
      });

      if (existing.length === 0) {
        await base44.entities.UserAchievement.create({
          character_id: characterId,
          achievement_id: 'interior_designer',
          title: 'Home Sweet Home',
          description: 'Decorated your home',
          icon: 'Palette',
          unlocked_date: new Date().toISOString(),
        });
        achievements.push('interior_designer');
      }
    }

    return Response.json({
      success: true,
      newAchievements: achievements,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});