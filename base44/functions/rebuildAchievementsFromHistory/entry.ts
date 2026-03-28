import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Rebuild achievements for the current user from their existing conversation history
 * This retroactively awards achievements if they've already done the work
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || !user.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`[rebuildAchievementsFromHistory] Starting for ${user.email}`);

    // Fetch all conversations for this user
    const conversations = await base44.entities.Conversation.filter(
      { created_by: user.email },
      "-updated_date"
    );

    // Fetch all messages across all conversations
    const allMessages = [];
    for (const conv of conversations) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: conv.id },
        "-created_date"
      );
      allMessages.push(...msgs);
    }

    console.log(`[rebuildAchievementsFromHistory] Found ${allMessages.length} messages across ${conversations.length} conversations`);

    // Reconstruct events from message history
    const reconstructedEvents = [];

    // Event: first_message_to_character - per unique character
    const characterInteractions = new Map();
    allMessages
      .filter(m => m.sender_type === "user")
      .forEach(m => {
        if (m.character_id) {
          if (!characterInteractions.has(m.character_id)) {
            // First message to this character
            reconstructedEvents.push({
              event_type: "first_message_to_character",
              character_id: m.character_id,
              timestamp: m.created_date,
              metadata: { message_id: m.id }
            });
            characterInteractions.set(m.character_id, true);
          }
        }
      });

    // Event: message_sent
    allMessages
      .filter(m => m.sender_type === "user" && m.content && m.content.trim() !== "")
      .forEach(m => {
        reconstructedEvents.push({
          event_type: "message_sent",
          character_id: m.character_id,
          conversation_id: m.conversation_id,
          timestamp: m.created_date,
          metadata: { has_image: !!m.image_url, text_length: m.content.length }
        });
      });

    // Event: message_received
    allMessages
      .filter(m => m.sender_type === "character" && m.content && m.content.trim() !== "")
      .forEach(m => {
        reconstructedEvents.push({
          event_type: "message_received",
          character_id: m.character_id,
          conversation_id: m.conversation_id,
          timestamp: m.created_date,
          metadata: {}
        });
      });

    // Event: image_sent
    allMessages
      .filter(m => m.sender_type === "user" && m.image_url)
      .forEach(m => {
        reconstructedEvents.push({
          event_type: "image_sent",
          character_id: m.character_id,
          conversation_id: m.conversation_id,
          timestamp: m.created_date,
          metadata: {}
        });
      });

    // Event: emoji_reaction (from reactions array)
    allMessages
      .filter(m => m.reactions && m.reactions.length > 0)
      .forEach(m => {
        const userReactions = m.reactions.filter(r => r.reactor_type === "user");
        userReactions.forEach(r => {
          reconstructedEvents.push({
            event_type: "emoji_reaction",
            character_id: m.character_id,
            conversation_id: m.conversation_id,
            timestamp: m.created_date,
            metadata: { emoji: r.emoji }
          });
        });
      });

    console.log(`[rebuildAchievementsFromHistory] Reconstructed ${reconstructedEvents.length} events`);

    // Now evaluate achievements based on reconstructed events
    const ACHIEVEMENT_TRIGGERS = {
      first_impression: {
        event_types: ["first_message_to_character"],
        target_progress: 1,
        check: (events) => events.some(e => e.event_type === "first_message_to_character")
      },
      method_spree: {
        event_types: ["message_sent"],
        target_progress: 5,
        check: (events) => {
          const charIds = new Set(
            events.filter(e => e.event_type === "message_sent").map(e => e.character_id)
          );
          return charIds.size >= 5;
        }
      },
      emoticon_addict: {
        event_types: ["emoji_reaction"],
        target_progress: 5,
        check: (events) => events.filter(e => e.event_type === "emoji_reaction").length >= 5
      },
      trigger_two_emojis: {
        event_types: ["emoji_reaction"],
        target_progress: 2,
        check: (events) => {
          const emojis = new Set(
            events
              .filter(e => e.event_type === "emoji_reaction")
              .map(e => e.metadata?.emoji)
          );
          return emojis.size >= 2;
        }
      },
      photo_sharer: {
        event_types: ["image_sent"],
        target_progress: 3,
        check: (events) => events.filter(e => e.event_type === "image_sent").length >= 3
      },
      the_push: {
        event_types: ["message_sent", "message_received"],
        target_progress: 1,
        check: (events) => {
          const userMsgs = events.filter(e => e.event_type === "message_sent").length;
          const charMsgs = events.filter(e => e.event_type === "message_received").length;
          return userMsgs >= 3 && charMsgs >= 3;
        }
      }
    };

    const awardsToGrant = [];

    for (const [achievementId, triggerDef] of Object.entries(ACHIEVEMENT_TRIGGERS)) {
      // Check if already unlocked
      const existing = await base44.entities.UserAchievementProgress.filter({
        user_email: user.email,
        achievement_id: achievementId
      });

      if (existing.length > 0 && existing[0].unlocked) {
        console.log(`[rebuildAchievementsFromHistory] ${achievementId} already unlocked, skipping`);
        continue;
      }

      // Check if condition is met
      if (triggerDef.check(reconstructedEvents)) {
        console.log(`[rebuildAchievementsFromHistory] ✓ AWARD: ${achievementId}`);
        awardsToGrant.push(achievementId);
      }
    }

    // Grant awards
    const timestamp = new Date().toISOString();
    for (const achievementId of awardsToGrant) {
      const triggerDef = ACHIEVEMENT_TRIGGERS[achievementId];

      // Create or update progress
      const existing = await base44.entities.UserAchievementProgress.filter({
        user_email: user.email,
        achievement_id: achievementId
      });

      if (existing.length > 0) {
        await base44.entities.UserAchievementProgress.update(existing[0].id, {
          unlocked: true,
          unlocked_at: timestamp,
          last_evaluated_at: timestamp
        });
      } else {
        await base44.entities.UserAchievementProgress.create({
          user_email: user.email,
          achievement_id: achievementId,
          current_progress: triggerDef.target_progress,
          target_progress: triggerDef.target_progress,
          unlocked: true,
          unlocked_at: timestamp,
          last_evaluated_at: timestamp,
          source_event_count: reconstructedEvents.filter(e =>
            triggerDef.event_types.includes(e.event_type)
          ).length
        });
      }

      // Also create UserAchievement for backwards compatibility
      const existingUA = await base44.entities.UserAchievement.filter({
        achievement_id: achievementId,
        created_by: user.email
      });

      if (existingUA.length === 0) {
        await base44.entities.UserAchievement.create({
          achievement_id: achievementId,
          unlocked_at: timestamp,
          tier: 'bronze',
          is_seen: false
        });
      }
    }

    console.log(`[rebuildAchievementsFromHistory] Granted ${awardsToGrant.length} achievements`);

    return Response.json({
      success: true,
      messages_analyzed: allMessages.length,
      events_reconstructed: reconstructedEvents.length,
      achievements_awarded: awardsToGrant
    });

  } catch (error) {
    console.error('[rebuildAchievementsFromHistory] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});