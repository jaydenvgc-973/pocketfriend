/**
 * Capture user action as achievement event and evaluate achievements
 * Event-driven trigger system with user-scoped progress tracking
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Achievement trigger definitions (user-scoped evaluation)
const ACHIEVEMENT_TRIGGERS = {
  first_impression: { event_types: ["first_message_to_character"], target: 1 },
  consistent: { event_types: ["message_sent"], target: 3 },
  they_opened_up: { event_types: ["message_received"], target: 1 },
  inner_circle: { event_types: ["relationship_level_change"], target: 1 },
  the_push: { event_types: ["message_sent"], target: 1 },
  voice_of_reason: { event_types: ["message_sent"], target: 1 },
  bad_influence: { event_types: ["message_sent"], target: 1 },
  that_meant_something: { event_types: ["message_sent"], target: 1 },
  hit_deep: { event_types: ["message_sent"], target: 1 },
  tension: { event_types: ["message_sent"], target: 1 },
  shifted_perspective: { event_types: ["message_sent"], target: 1 },
  seen_it_all: { event_types: ["message_received"], target: 1 },
  progress_witness: { event_types: ["character_reached_status"], target: 1 },
  big_moment: { event_types: ["character_reached_status"], target: 1 },
  you_were_there: { event_types: ["character_reached_status"], target: 1 },
  still_here: { event_types: ["message_sent"], target: 5 },
  they_came_back: { event_types: ["message_received"], target: 1 },
  left_on_read: { event_types: ["message_received"], target: 1 }
};

function evaluateAchievement(achievementId, allEvents) {
  const trigger = ACHIEVEMENT_TRIGGERS[achievementId];
  if (!trigger) return false;
  
  const relevantEvents = allEvents.filter(e => trigger.event_types.includes(e.event_type));
  const count = relevantEvents.length;
  
  // Simple count-based evaluation
  // More complex rules will use metadata
  if (achievementId === 'consistent' || achievementId === 'still_here') {
    // Check multiple days
    if (!relevantEvents.length) return false;
    const dates = new Set(relevantEvents.map(e => new Date(e.timestamp).toDateString()));
    return dates.size >= trigger.target;
  }
  
  // Default: check if we have enough events
  return count >= trigger.target;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { event_type, character_id, conversation_id, message_id, metadata = {} } = await req.json();
    
    if (!event_type) {
      return Response.json({ error: 'Missing event_type' }, { status: 400 });
    }

    // 1. CAPTURE THE EVENT
    const event = await base44.entities.UserAchievementEvent.create({
      user_email: user.email,
      event_type,
      character_id,
      conversation_id,
      message_id,
      metadata,
      timestamp: new Date().toISOString(),
    });

    // 2. FETCH ALL EVENTS FOR THIS USER (to evaluate achievements)
    const allEvents = await base44.entities.UserAchievementEvent.filter(
      { user_email: user.email },
      "-timestamp",
      500 // Keep last 500 events for evaluation
    );

    // 3. FETCH CURRENT PROGRESS FOR THIS USER
    const progressRecords = await base44.entities.UserAchievementProgress.filter(
      { user_email: user.email }
    );
    
    const progressMap = progressRecords.reduce((acc, r) => {
      acc[r.achievement_id] = r;
      return acc;
    }, {});

    // 4. EVALUATE ALL ACHIEVEMENTS AGAINST NEW EVENT
    const achievementsToEvaluate = Object.keys(ACHIEVEMENT_TRIGGERS);
    const evaluated = {};
    
    for (const achievementId of achievementsToEvaluate) {
      const currentRecord = progressMap[achievementId];
      const shouldUnlock = evaluateAchievement(
        achievementId, 
        allEvents, 
        currentRecord?.current_progress || 0,
        { user_email: user.email, character_id, ...metadata }
      );
      
      evaluated[achievementId] = {
        achievement_id: achievementId,
        should_unlock: shouldUnlock,
        currently_locked: !currentRecord?.unlocked,
        current_progress: currentRecord?.current_progress || 0
      };
    }

    // 5. UPDATE PROGRESS RECORDS & AWARD ACHIEVEMENTS
    const awarded = [];
    
    for (const achievementId of achievementsToEvaluate) {
      const isLocked = !progressMap[achievementId]?.unlocked;
      const shouldUnlock = evaluated[achievementId].should_unlock;
      
      // Only award if currently locked AND now should be unlocked
      if (isLocked && shouldUnlock) {
        // Update progress record
        if (progressMap[achievementId]) {
          await base44.entities.UserAchievementProgress.update(
            progressMap[achievementId].id,
            {
              unlocked: true,
              unlocked_at: new Date().toISOString(),
              last_evaluated_at: new Date().toISOString(),
              source_event_count: allEvents.filter(e => 
                ACHIEVEMENT_TRIGGERS[achievementId]?.event_types.includes(e.event_type)
              ).length
            }
          );
        } else {
          // Create new progress record
          await base44.entities.UserAchievementProgress.create({
            user_email: user.email,
            achievement_id: achievementId,
            current_progress: 1,
            target_progress: 1,
            unlocked: true,
            unlocked_at: new Date().toISOString(),
            last_evaluated_at: new Date().toISOString(),
            source_event_count: 1
          });
        }
        
        // Also create UserAchievement record if it doesn't exist
        const existing = await base44.entities.UserAchievement.filter({
          achievement_id: achievementId,
          created_by: user.email
        });
        
        if (existing.length === 0) {
          await base44.entities.UserAchievement.create({
            achievement_id: achievementId,
            unlocked_at: new Date().toISOString(),
            tier: 'bronze'
          });
        }
        
        awarded.push(achievementId);
      }
    }

    // 6. RETURN RESULTS
    return Response.json({
      event_captured: event.id,
      achievements_evaluated: Object.keys(ACHIEVEMENT_TRIGGERS).length,
      achievements_awarded: awarded,
      evaluated,
      debug: {
        event_type,
        user_email: user.email,
        total_events_on_record: allEvents.length
      }
    });

  } catch (error) {
    console.error('[captureAchievementEvent] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});