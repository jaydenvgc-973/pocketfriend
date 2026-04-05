import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, messageContent } = await req.json();
    if (!characterId || !messageContent) {
      return Response.json({ error: 'Missing characterId or messageContent' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: characterId }).then(r => r[0]);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const msg = messageContent.toLowerCase();

    // Extract explicit location/activity statements from the message
    // Pattern: "I'm [at/in/going to] [location/activity]"
    
    let extractedActivity = null;

    // EXPLICIT "at work" statements
    if (msg.includes('at work') || msg.includes('at the') || msg.includes('at my work')) {
      extractedActivity = 'at work';
    }
    // EXPLICIT "at home" statements
    else if (msg.includes('at home') || msg.includes('im home') || msg.includes('i\'m home')) {
      extractedActivity = 'at home';
    }
    // EXPLICIT "at bar/club" statements
    else if (msg.includes('at the bar') || msg.includes('at a bar') || msg.includes('at bar')) {
      extractedActivity = 'at the bar, hanging out';
    }
    else if (msg.includes('at club') || msg.includes('at the club') || msg.includes('nightclub')) {
      extractedActivity = 'at club';
    }
    // EXPLICIT "at gym" statements
    else if (msg.includes('at gym') || msg.includes('at the gym') || msg.includes('working out')) {
      extractedActivity = 'at gym, working out';
    }
    // EXPLICIT "at school/class" statements
    else if (msg.includes('at school') || msg.includes('in class') || msg.includes('at class')) {
      extractedActivity = 'in class';
    }
    // EXPLICIT "at church/worship" statements
    else if (msg.includes('church') || msg.includes('mosque') || msg.includes('temple') || msg.includes('worship')) {
      extractedActivity = 'at worship';
    }
    // EXPLICIT "reading" / "hanging out" / "relaxing" at a location
    else if ((msg.includes('reading') || msg.includes('hanging out') || msg.includes('relaxing')) && 
             (msg.includes('bar') || msg.includes('home') || msg.includes('coffee'))) {
      if (msg.includes('bar')) {
        extractedActivity = 'at the bar, hanging out, reading';
      } else if (msg.includes('home')) {
        extractedActivity = 'at home, relaxing';
      } else if (msg.includes('coffee')) {
        extractedActivity = 'at coffee shop, relaxing';
      }
    }
    // EXPLICIT "praying" statements
    else if (msg.includes('pray') || msg.includes('praying')) {
      extractedActivity = 'praying';
    }
    // EXPLICIT "sleeping/asleep" statements
    else if (msg.includes('sleep') || msg.includes('bed') || msg.includes('asleep')) {
      extractedActivity = 'asleep';
    }
    // General activity extraction: "I'm [activity]-ing" or "I'm [doing] [activity]"
    else if (msg.includes('i\'m') || msg.includes('im ')) {
      const match = msg.match(/i[\'m]*\s+([a-z\s]+?)(?:\.|,|!|\?|$)/);
      if (match && match[1]) {
        const activity = match[1].trim();
        if (activity.length < 50) { // Avoid capturing entire sentences
          extractedActivity = activity;
        }
      }
    }

    // Only update if we extracted something
    if (extractedActivity) {
      await base44.entities.Character.update(characterId, {
        current_activity: extractedActivity,
      });

      return Response.json({
        success: true,
        characterId,
        extractedActivity,
        message: `Updated ${character.name}'s activity to: "${extractedActivity}"`,
      });
    }

    return Response.json({
      success: false,
      characterId,
      message: 'No activity extracted from message',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});