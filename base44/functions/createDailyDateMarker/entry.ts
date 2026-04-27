import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createDailyDateMarker
 * 
 * Inserts daily date marker messages for all active created characters.
 * Runs daily at midnight (user local time).
 * 
 * Creates a system message (not user, not character) that displays:
 * —— Monday, April 27, 2026 ——
 * 
 * Inserted into both:
 * - Conversation (Chat timeline)
 * - Message (if separate Text timeline exists)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all active created characters for this user
    const characters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active',
      character_type: 'active_created_character'
    });

    if (!characters || characters.length === 0) {
      return Response.json({
        success: true,
        message: 'No active characters found',
        characters_processed: 0,
        date_markers_created: 0,
        skipped: []
      });
    }

    // Support backfill via payload parameter
    const payload = await req.json().catch(() => ({}));
    const targetDate = payload.targetDate ? new Date(payload.targetDate) : new Date();
    const dateStr = targetDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    const markerText = `—— ${dateStr} ——`;

    let created = 0;
    const skipped = [];

    // For each character, get or create a conversation
    for (const character of characters) {
      if (!character.id) {
        skipped.push({
          character_id: character.id || 'unknown',
          character_name: character.name || 'unknown',
          reason: 'No character ID'
        });
        continue;
      }

      const characterId = character.id;
      const characterName = character.name || characterId;

      // Get the conversation for this character (usually exists from chat)
      const conversations = await base44.entities.Conversation.filter({
        character_ids: characterId,
        created_by: user.email
      });

      if (!conversations || conversations.length === 0) {
        skipped.push({
          character_id: characterId,
          character_name: characterName,
          reason: 'No conversation found'
        });
        continue;
      }

      const conversation = conversations[0];

      // Check if a marker already exists for today
      const existingMarker = await base44.entities.Message.filter({
        conversation_id: conversation.id,
        content: markerText,
        sender_type: 'system'
      });

      if (existingMarker && existingMarker.length > 0) {
        skipped.push({
          character_id: characterId,
          character_name: characterName,
          reason: 'Marker already exists for today'
        });
        continue;
      }

      // Create the date marker message
      await base44.entities.Message.create({
        conversation_id: conversation.id,
        sender_type: 'system',
        character_id: null,
        content: markerText,
        timestamp: new Date().toISOString(),
        is_narrative: false
      });

      created++;
    }

    return Response.json({
      success: true,
      message: 'Daily date markers created',
      characters_processed: characters.length,
      date_markers_created: created,
      date_string: dateStr,
      skipped: skipped,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});