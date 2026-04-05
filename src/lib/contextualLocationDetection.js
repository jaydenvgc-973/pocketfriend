/**
 * Context-Aware Location Detection
 * 
 * Like Sims 4, we track PHYSICAL LOCATION separately from ACTIVITY.
 * - "Ethan is at the bar hanging out" → Location: The Bar, Activity: hanging out (NOT working)
 * - "Melody is at home praising God" → Location: Home, Activity: worship (NOT at church)
 * - "Lila is at VGP Medical Center working" → Location: VGP Medical Center, Activity: working (job context confirms)
 * 
 * Rules:
 * 1. Look for "at X" or "I'm at X" patterns to identify PHYSICAL LOCATION
 * 2. Context around location keyword determines if it's work, visit, or other activity
 * 3. Activity keywords should NOT be confused with location keywords
 * 4. If someone mentions an activity AT HOME (worship, relaxing, etc), location is HOME, activity is the action
 */

/**
 * Extract actual physical location and separate activity from a message.
 * Returns { location_id, location_name, activity_description, isWorkContext }
 */
export function extractLocationAndActivity(messageContent, allLocations = []) {
  if (!messageContent) {
    return { location_id: null, location_name: null, activity_description: null, isWorkContext: false };
  }

  const msgLower = messageContent.toLowerCase();

  // === STEP 1: LOCATION DETECTION ===
  // Look for explicit "at X" patterns FIRST
  let detectedLocation = null;
  let detectedLocationName = null;

  for (const loc of allLocations) {
    const locNameLower = loc.name.toLowerCase();
    const keywords = (loc.keywords || []).map(k => k.toLowerCase());
    
    // Pattern: "at X", "at the X", "I'm at X", "here at X", "heading to X", "going to X"
    const atPattern = new RegExp(
      `\\b(at|at the|i'm at|i am at|at my|currently at|heading to|going to|here at|located at|work at|work here|at the)\\s+${locNameLower.replace(/[\s.]/g, '\\s*')}\\b`,
      'i'
    );

    if (atPattern.test(messageContent)) {
      detectedLocation = loc.id;
      detectedLocationName = loc.name;
      break;
    }

    // Check keywords too (backup)
    if (keywords.length > 0 && keywords.some(kw => {
      const kwPattern = new RegExp(`\\b(at|at the|at my|here at)\\s+${kw.replace(/[\s.]/g, '\\s*')}\\b`, 'i');
      return kwPattern.test(messageContent);
    })) {
      detectedLocation = loc.id;
      detectedLocationName = loc.name;
      break;
    }
  }

  // === STEP 2: ACTIVITY EXTRACTION ===
  // Separate the activity description from location mention
  let activityDescription = null;
  let isWorkContext = false;

  if (detectedLocationName) {
    // Extract what they're doing AT that location
    // Pattern: "at X doing Y" or "at X I'm Y-ing" or just context after location mention
    
    // Remove the location part from the message to find activity
    const afterLocation = messageContent
      .split(new RegExp(`(at|at the)\\s+${detectedLocationName.replace(/[\s.]/g, '\\s*')}`, 'i'))[1] || '';
    
    // Parse activity from what comes after
    if (afterLocation) {
      // Look for work-related context
      const workKeywords = ['work', 'working', 'shift', 'on the clock', 'shift end', 'got off', 'clocked in', 'clocked out', 'job', 'bartending', 'serving', 'serving drinks'];
      const relaxKeywords = ['hanging out', 'hanging', 'chillin', 'chilling', 'relax', 'relaxing', 'hanging with', 'grabbing', 'having a drink', 'time out', 'break', 'after work', 'off work', 'off the clock'];
      const worshipKeywords = ['praying', 'worship', 'praise', 'pray', 'worshipping', 'spiritual'];
      const homeActivityKeywords = ['home', 'at home', 'got home', 'heading home', 'home now', 'back home'];

      const isWorkPhrase = workKeywords.some(k => afterLocation.toLowerCase().includes(k));
      const isRelaxPhrase = relaxKeywords.some(k => afterLocation.toLowerCase().includes(k));
      const isWorshipPhrase = worshipKeywords.some(k => msgLower.includes(k));
      const isHomePhrase = homeActivityKeywords.some(k => msgLower.includes(k));

      // Determine activity and work context
      if (isWorkPhrase) {
        isWorkContext = true;
        activityDescription = 'working';
      } else if (isRelaxPhrase) {
        isWorkContext = false;
        activityDescription = 'hanging out';
      } else if (isWorshipPhrase && !detectedLocationName?.toLowerCase().includes('church')) {
        // "Worship" mentioned but NOT at a church = activity at home or current location
        isWorkContext = false;
        activityDescription = 'worshipping';
      } else if (isHomePhrase) {
        isWorkContext = false;
        activityDescription = 'at home';
      } else {
        // Generic activity description from remaining text
        activityDescription = afterLocation.trim().substring(0, 50).replace(/[.,!?]$/, '') || null;
      }
    }
  } else {
    // NO EXPLICIT LOCATION MENTIONED
    // Try to infer activity from message (fallback)
    const msgTrimmed = msgLower.trim();
    
    // Check for activity keywords that indicate location
    if (msgTrimmed.includes('worship') || msgTrimmed.includes('praying') || msgTrimmed.includes('church')) {
      activityDescription = 'worshipping';
      // Note: location may be home, not necessarily a church
    } else if (msgTrimmed.includes('working') || msgTrimmed.includes('at work') || msgTrimmed.includes('job')) {
      isWorkContext = true;
      activityDescription = 'working';
    } else if (msgTrimmed.includes('home') || msgTrimmed.includes('at home')) {
      activityDescription = 'at home';
    }
  }

  return {
    location_id: detectedLocation,
    location_name: detectedLocationName,
    activity_description: activityDescription,
    isWorkContext: isWorkContext,
  };
}

/**
 * Determine if someone is ON THE CLOCK at a location.
 * Context: "hanging out at work" = NOT on the clock
 * Context: "working at the bar" OR shift time + location = ON THE CLOCK
 */
export function isCharacterOnClock(character, location, extractedData = {}) {
  if (!character || !location) return false;

  const { isWorkContext, activity_description } = extractedData;
  
  // Explicit work context phrase found ("working", "shift", etc.) = on clock
  if (isWorkContext) return true;

  // Check if character is listed as a worker at this location
  const isListedWorker = location.worker_character_ids?.includes(character.id);
  if (!isListedWorker) return false;

  // Listed worker but activity suggests they're NOT working = hanging out
  if (activity_description && ['hanging out', 'hanging', 'chilling', 'relaxing', 'taking a break'].includes(activity_description.toLowerCase())) {
    return false;
  }

  // Listed worker + no contradictory activity phrase + during shift time = on clock
  return true;
}