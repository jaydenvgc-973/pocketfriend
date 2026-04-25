import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characterNames = ['Brian', 'Ethan', 'Andre'];
    const chars = await base44.entities.Character.filter({ created_by: user.email });
    const targetChars = chars.filter(c => characterNames.some(name => c.name?.toLowerCase().includes(name.toLowerCase())));

    const investigation = {};

    for (const char of targetChars) {
      // Get recent messages from this character
      const recentMessages = await base44.entities.Message.filter(
        { character_id: char.id },
        '-created_date',
        10
      );

      // Find messages mentioning leaving/going
      const departureMessages = recentMessages.filter(m => {
        const content = (m.content || '').toLowerCase();
        return content.includes('out') || content.includes('bar') || content.includes('park') || content.includes('heading') || content.includes('leaving');
      });

      investigation[char.name] = {
        characterId: char.id,
        currentLocation: char.resolved_current_location_name || char.current_home_location_id,
        locationStatus: char.location_status,
        resolvedPresenceStatus: char.resolved_presence_status,
        isAtHome: char.location_status === 'home' || char.resolved_presence_status === 'home',
        lastLocationUpdate: char.last_location_update_time,
        departureMessageFound: departureMessages.length > 0,
        latestDepartureMessage: departureMessages[0] ? {
          timestamp: departureMessages[0].timestamp,
          content: departureMessages[0].content?.substring(0, 100)
        } : null,
        allRecentMessages: recentMessages.map(m => ({
          timestamp: m.timestamp,
          content: m.content?.substring(0, 80)
        }))
      };
    }

    return Response.json({ investigation, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[investigateCharacterMovement]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});