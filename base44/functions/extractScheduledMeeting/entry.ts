import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * extractScheduledMeeting
 *
 * Detects if user and character agreed to meet in the conversation.
 * Extracts meeting time and location if mentioned.
 *
 * Input:
 *  - characterId: character ID
 *  - userMessage: the user's message
 *  - characterResponse: the character's response
 *  - recentMessages: array of recent messages for context
 *  - conversationId: current conversation ID
 *
 * Returns:
 *  - meetingScheduled: boolean
 *  - scheduledTime: ISO 8601 datetime (if detected)
 *  - location: string (if mentioned)
 *  - confidence: 'high' | 'medium' | 'low'
 *  - extractedText: string (snippet that indicated the meeting)
 */

const MEETING_PATTERNS = [
  /\b(meet|see|hang out|get together|catch up|come (by|over|to)|pick you up|pick up|let's meet|meet up)\b/i,
  /\b(see you (at|in|tonight|tomorrow|later|soon|at \d+))\b/i,
  /\b(I'll (be|meet|come) (at|to|over|by))\b/i,
  /\b(come (pick me up|get me|meet me))\b/i,
];

const TIME_PATTERNS = [
  /\b(at )(\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)?)\b/,
  /\b(tonight|this evening|later today)\b/i,
  /\b(tomorrow|tomorrow night|tomorrow morning)\b/i,
  /\b(in (\d+) (minutes?|hours?|days?))\b/i,
  /\b(\d{1,2}:\d{2})\b/,
];

const LOCATION_PATTERNS = [
  /\b(at|near|by|outside|inside|in front of|back of)\s+([a-zA-Z\s]+?)(?:\.|,|$)/i,
  /\b(my place|your place|your house|my house|the|coffee|bar|restaurant|park|mall)\b/i,
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, userMessage, characterResponse, recentMessages = [], conversationId } = await req.json();
    if (!characterId || !conversationId) {
      return Response.json({ error: 'characterId and conversationId required' }, { status: 400 });
    }

    let meetingScheduled = false;
    let scheduledTime = null;
    let location = '';
    let confidence = 'low';
    let extractedText = '';

    const combinedText = [userMessage, characterResponse, ...recentMessages.map(m => m.content || '').slice(-5)].join(' ');
    const combined = combinedText.toLowerCase();

    // Check if meeting language is present
    const hasMeetingKeyword = MEETING_PATTERNS.some(p => p.test(combinedText));

    if (hasMeetingKeyword) {
      meetingScheduled = true;
      confidence = 'high';
      extractedText = combinedText.substring(0, 200);

      // Try to extract time
      const timeMatch = combinedText.match(TIME_PATTERNS[0]) || combinedText.match(TIME_PATTERNS[4]);
      if (timeMatch) {
        const timeStr = timeMatch[1] || timeMatch[0];
        // Basic time parsing (real implementation would be more robust)
        if (timeStr.includes(':') || combined.includes('am') || combined.includes('pm')) {
          const now = new Date();
          let scheduledDate = new Date(now);
          
          // If 'tonight' or 'later today' mentioned, same day
          if (combined.includes('tonight') || combined.includes('later today')) {
            scheduledDate.setHours(18); // assume evening
          }
          // If 'tomorrow' mentioned, next day
          else if (combined.includes('tomorrow')) {
            scheduledDate.setDate(scheduledDate.getDate() + 1);
            scheduledDate.setHours(10);
          }
          // Otherwise use extracted time or default to 2 hours from now
          else {
            scheduledDate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
          }
          
          scheduledTime = scheduledDate.toISOString();
        }
      }

      // Try to extract location
      const locMatch = combinedText.match(LOCATION_PATTERNS[0]);
      if (locMatch) {
        location = locMatch[2]?.trim() || '';
      }
    }

    // If meeting detected, update PresenceState
    if (meetingScheduled) {
      const existing = await base44.asServiceRole.entities.PresenceState.filter({ character_id: characterId });
      const presenceState = existing[0] || { character_id: characterId, state: 'remote' };

      presenceState.meeting_scheduled = true;
      presenceState.scheduled_time = scheduledTime || new Date(Date.now() + 3600000).toISOString(); // 1 hour default
      presenceState.meeting_location = location;
      presenceState.conversation_id = conversationId;
      presenceState.state = presenceState.state || 'remote'; // Pre-meeting state, not yet same_space

      if (existing[0]) {
        await base44.asServiceRole.entities.PresenceState.update(presenceState.id, presenceState);
      } else {
        await base44.asServiceRole.entities.PresenceState.create(presenceState);
      }
    }

    return Response.json({
      meetingScheduled,
      scheduledTime,
      location,
      confidence,
      extractedText,
      success: true,
    });
  } catch (error) {
    console.error('[extractScheduledMeeting]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});