import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const ACTIVITIES = [
  { type: 'out', places: ['bar', 'restaurant', 'club', 'park', 'social event'], weight: 0.25 },
  { type: 'home', activities: ['resting', 'watching TV', 'cooking', 'cleaning'], weight: 0.25 },
  { type: 'errands', places: ['grocery store', 'laundromat', 'pharmacy'], weight: 0.15 },
  { type: 'social', places: ["friend's place", 'family home'], weight: 0.20 },
  { type: 'routine', places: ['work', 'gym', 'appointment'], weight: 0.15 }
];

function getActivityForTime(hour) {
  // 6-9am: sleep ending, morning routine
  if (hour >= 6 && hour < 9) return { type: 'home', activity: 'morning routine' };
  // 9-17: work/appointments likely
  if (hour >= 9 && hour < 17) return { type: 'routine', activity: 'work or appointment' };
  // 17-21: social/dinner time
  if (hour >= 17 && hour < 21) return { type: 'out', activity: 'dinner or social' };
  // 21-23: wind down
  if (hour >= 21 && hour < 23) return { type: 'home', activity: 'winding down' };
  // 23-6: sleep
  return { type: 'sleep', activity: 'sleeping' };
}

function selectRandomActivity() {
  const rand = Math.random();
  let cumWeight = 0;
  for (const activity of ACTIVITIES) {
    cumWeight += activity.weight;
    if (rand <= cumWeight) {
      if (activity.type === 'out' || activity.type === 'social' || activity.type === 'errands') {
        const place = activity.places[Math.floor(Math.random() * activity.places.length)];
        return { type: activity.type, location: place };
      } else if (activity.type === 'home') {
        const act = activity.activities[Math.floor(Math.random() * activity.activities.length)];
        return { type: activity.type, activity: act };
      }
    }
  }
  return { type: 'home', activity: 'resting' };
}

function shouldTriggerAutonomy(character) {
  // Only trigger if character is active and not in an active conversation recently
  if (character.status !== 'active') return false;
  
  const now = new Date();
  const lastMessage = character.life_last_updated ? new Date(character.life_last_updated) : null;
  
  // Trigger autonomy every 2-6 hours of inactivity
  if (lastMessage) {
    const hoursSince = (now - lastMessage) / (1000 * 60 * 60);
    return hoursSince > Math.random() * 4 + 2; // 2-6 hours
  }
  
  return Math.random() < 0.4; // 40% chance on first run
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all active characters for this user
    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      '-updated_date',
      50
    );

    const updated = [];

    for (const character of characters) {
      if (!shouldTriggerAutonomy(character)) continue;

      const now = new Date();
      const hour = now.getHours();
      
      // Get activity based on time of day
      const timeBasedActivity = getActivityForTime(hour);
      const randomActivity = selectRandomActivity();
      
      // Merge logic: if it's sleep time, sleep; otherwise use weighted random
      const finalActivity = hour >= 23 || hour < 6 
        ? { type: 'sleep', activity: 'sleeping' }
        : Math.random() < 0.6 ? timeBasedActivity : randomActivity;

      // Update character state
      const updates = {
        current_activity: finalActivity.activity || finalActivity.location || 'in activity',
        life_last_updated: now.toISOString(),
      };

      // Optionally update current_life_event for narrative
      if (finalActivity.type === 'out' || finalActivity.type === 'social') {
        updates.current_situation = `Out at ${finalActivity.location}`;
      } else if (finalActivity.type === 'home') {
        updates.current_situation = `Home, ${finalActivity.activity}`;
      }

      await base44.asServiceRole.entities.Character.update(character.id, updates);
      updated.push({ id: character.id, name: character.name, activity: finalActivity });
    }

    return Response.json({
      success: true,
      autonomous_actions_triggered: updated.length,
      characters_updated: updated
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});