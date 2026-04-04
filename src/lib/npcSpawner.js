/**
 * NPC Spawner & Schedule Checker
 * Intelligently spawns NPCs based on location, time, schedule, and availability
 */

/**
 * Determine if a character is currently available (not asleep, at work, etc)
 * @param {Object} character - Character entity
 * @param {Object} locationMap - Map of location IDs to LocationReference entities
 * @param {Object} currentTime - Current time object {hour, day, date}
 * @returns {Object} {available: boolean, reason: string, availableAt: string}
 */
export function checkCharacterAvailability(character, locationMap = {}, currentTime = null) {
  if (!character) {
    return { available: false, reason: 'Character not found', availableAt: null };
  }

  const now = currentTime || {
    hour: new Date().getHours(),
    day: new Date().getDay(),
    date: new Date(),
  };

  // Check if asleep
  if (isAsleep(character, now.hour)) {
    const wakeTime = character.wake_up_time || '07:00';
    return { available: false, reason: 'Asleep', availableAt: `Wakes at ${wakeTime}` };
  }

  // Check if at work
  const workStatus = isAtWork(character, now.day, now.hour, locationMap);
  if (workStatus.atWork) {
    return { available: false, reason: 'At work', availableAt: workStatus.availableTime };
  }

  // Check if at education
  const eduStatus = isInEducation(character, now.day, now.hour, locationMap);
  if (eduStatus.inEducation) {
    return { available: false, reason: 'In class/education', availableAt: eduStatus.availableTime };
  }

  // Check if training
  if (character.current_job_training_activity === 'active') {
    const endDate = new Date(character.job_training_expected_completion_date);
    return { available: false, reason: 'Job training in progress', availableAt: `Until ${endDate.toLocaleDateString()}` };
  }

  return { available: true, reason: null, availableAt: null };
}

/**
 * Check if character is asleep
 */
function isAsleep(character, hour) {
  if (!character.sleep_start_time || !character.wake_up_time) return false;

  const [sleepHour, sleepMin] = character.sleep_start_time.split(':').map(Number);
  const [wakeHour, wakeMin] = character.wake_up_time.split(':').map(Number);

  const sleepMinutes = sleepHour * 60 + sleepMin;
  const wakeMinutes = wakeHour * 60 + wakeMin;
  const currentMinutes = hour * 60;

  // Sleep wraps midnight
  if (sleepMinutes > wakeMinutes) {
    return currentMinutes >= sleepMinutes || currentMinutes < wakeMinutes;
  }

  return currentMinutes >= sleepMinutes && currentMinutes < wakeMinutes;
}

/**
 * Check if character is at work
 */
function isAtWork(character, dayOfWeek, hour, locationMap = {}) {
  if (!character.work_days || character.work_days.length === 0) {
    return { atWork: false, availableTime: null };
  }

  const isWorkDay = character.work_days.includes(dayOfWeek);
  if (!isWorkDay) return { atWork: false, availableTime: null };

  if (!character.work_start_time || !character.work_end_time) {
    return { atWork: false, availableTime: null };
  }

  const [startHour] = character.work_start_time.split(':').map(Number);
  const [endHour] = character.work_end_time.split(':').map(Number);

  const atWork = hour >= startHour && hour < endHour;

  if (atWork) {
    const locationName = character.occupation_location_name || 'work';
    return { atWork: true, availableTime: `Available after ${character.work_end_time} (at ${locationName})` };
  }

  return { atWork: false, availableTime: null };
}

/**
 * Check if character is in education
 */
function isInEducation(character, dayOfWeek, hour, locationMap = {}) {
  if (!character.current_education_activity || character.current_education_activity === 'none') {
    return { inEducation: false, availableTime: null };
  }

  // Simplified: assume Mon-Fri 9am-3pm for school
  const isSchoolDay = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isSchoolHours = hour >= 9 && hour < 15;

  if (isSchoolDay && isSchoolHours) {
    return { inEducation: true, availableTime: 'Available after 3pm' };
  }

  return { inEducation: false, availableTime: null };
}

/**
 * Get all active employees at a location at current time
 * Checks shift schedules
 * 
 * @param {Object} location - LocationReference entity
 * @param {Array} characters - All character entities
 * @param {Object} currentTime - {hour, day}
 * @returns {Array} Array of {characterId, name, jobTitle, isOnShift}
 */
export function getLocationEmployees(location, characters = [], currentTime = null) {
  if (!location || !location.worker_character_ids || location.worker_character_ids.length === 0) {
    return [];
  }

  const now = currentTime || {
    hour: new Date().getHours(),
    day: new Date().getDay(),
  };

  return location.worker_character_ids
    .map(charId => {
      const char = characters.find(c => c.id === charId);
      if (!char) return null;

      const jobTitle = location.worker_job_titles?.[charId] || 'Staff';
      const shifts = location.worker_shifts || {};
      const charShifts = shifts[charId];

      let isOnShift = false;
      let status = 'off-duty';

      if (charShifts) {
        const days = charShifts.days || [1,2,3,4,5];
        const isWorking = days.includes(now.day);
        if (isWorking && charShifts.start && charShifts.end) {
          const [startHour] = charShifts.start.split(':').map(Number);
          const [endHour] = charShifts.end.split(':').map(Number);
          isOnShift = now.hour >= startHour && now.hour < endHour;
          status = isOnShift ? 'on-shift' : 'off-duty';
        }
      }

      return {
        characterId: charId,
        name: char.name,
        jobTitle,
        isOnShift,
        status,
        mood: char.emotional_state || 'neutral',
      };
    })
    .filter(Boolean);
}

/**
 * Spawn NPCs for a location based on:
 * - Time of day
 * - Day of week
 * - Location type
 * - Existing characters
 * - Employees on shift
 * 
 * @param {Object} location - LocationReference entity
 * @param {Array} presentCharacterIds - IDs of active characters already present
 * @param {Array} allCharacters - All character entities
 * @param {Object} currentTime - {hour, day}
 * @returns {Array} Array of spawned NPC objects {id, name, type, role, mood, activity, approachability}
 */
export function spawnLocationNPCs(location, presentCharacterIds = [], allCharacters = [], currentTime = null) {
  if (!location) return [];

  const now = currentTime || {
    hour: new Date().getHours(),
    day: new Date().getDay(),
  };

  const npcs = [];
  const npcCount = calculateNPCDensity(location, now.hour);

  // 1. Add on-shift employees
  const employees = getLocationEmployees(location, allCharacters, now);
  const onShiftEmployees = employees.filter(e => e.isOnShift);
  npcs.push(
    ...onShiftEmployees.map(emp => ({
      id: `emp_${emp.characterId}`,
      name: emp.name,
      type: 'employee',
      role: emp.jobTitle,
      mood: emp.mood,
      activity: getEmployeeActivity(emp.jobTitle, location.category),
      approachability: 0.4, // Professional
      groupSize: 1,
    }))
  );

  // 2. Add background NPCs
  const backgroundCount = npcCount - npcs.length;
  for (let i = 0; i < backgroundCount; i++) {
    npcs.push(generateBackgroundNPC(location, now.hour, i));
  }

  // 3. Occasionally add interactive NPCs
  if (Math.random() < 0.4) {
    npcs.push(generateInteractiveNPC(location, now.hour));
  }

  return npcs;
}

/**
 * Calculate how many NPCs should be present based on location type and time
 */
function calculateNPCDensity(location, hour) {
  const category = location.category;

  // Time-based multiplier
  let timeMultiplier = 1;
  if (hour >= 12 && hour < 14) timeMultiplier = 1.5; // Lunch rush
  if (hour >= 18 && hour < 21) timeMultiplier = 1.3; // Dinner/evening
  if (hour >= 22 || hour < 6) timeMultiplier = 0.3; // Late night/early morning
  if (hour >= 6 && hour < 10) timeMultiplier = 1.2; // Morning

  // Category base
  const baseDensity = {
    food_drink: 8,
    social: 12,
    gym: 6,
    home: 0,
    workplace: 5,
    outdoor: 4,
    school: 10,
    retail: 5,
  };

  const base = baseDensity[category] || 4;
  return Math.ceil(base * timeMultiplier);
}

/**
 * Generate realistic activity for an employee
 */
function getEmployeeActivity(jobTitle, category) {
  const activities = {
    barista: ['making drinks', 'at register', 'wiping counter', 'chatting with customers'],
    bartender: ['mixing drinks', 'taking orders', 'wiping bar', 'chatting'],
    server: ['taking orders', 'delivering food', 'checking on tables', 'at counter'],
    cashier: ['at register', 'bagging items', 'restocking', 'helping customers'],
    trainer: ['spotting member', 'explaining form', 'on machine', 'chatting with client'],
    manager: ['working register', 'in office', 'checking on staff', 'dealing with customer'],
  };

  const jobActivities = activities[jobTitle.toLowerCase()] || ['working', 'busy', 'at counter'];
  return jobActivities[Math.floor(Math.random() * jobActivities.length)];
}

/**
 * Generate a background NPC
 */
function generateBackgroundNPC(location, hour, index) {
  const moods = ['calm', 'content', 'engaged', 'focused', 'bored', 'excited'];
  const activities = {
    food_drink: ['eating', 'drinking', 'reading', 'working on laptop', 'chatting', 'waiting for order'],
    social: ['dancing', 'drinking', 'chatting', 'sitting', 'laughing', 'flirting'],
    gym: ['working out', 'stretching', 'on machine', 'resting', 'spotting friend'],
    outdoor: ['walking', 'sitting', 'with dog', 'jogging', 'picnicking', 'reading'],
    workplace: ['at desk', 'in meeting', 'at coffee', 'on phone', 'walking'],
  };

  const activityPool = activities[location.category] || ['present', 'existing', 'here'];
  const activity = activityPool[Math.floor(Math.random() * activityPool.length)];

  return {
    id: `npc_bg_${location.id}_${index}`,
    name: generateRandomName(),
    type: 'background',
    role: null,
    mood: moods[Math.floor(Math.random() * moods.length)],
    activity,
    approachability: Math.random() * 0.6, // 0-0.6
    groupSize: Math.random() > 0.6 ? 2 : 1,
  };
}

/**
 * Generate an interactive NPC
 */
function generateInteractiveNPC(location, hour) {
  const moods = ['flirtatious', 'friendly', 'curious', 'engaged', 'interesting'];

  return {
    id: `npc_int_${location.id}_${Math.random().toString(36).substr(2, 9)}`,
    name: generateRandomName(),
    type: 'interactive',
    role: null,
    mood: moods[Math.floor(Math.random() * moods.length)],
    activity: 'looking around',
    approachability: 0.6 + Math.random() * 0.4, // 0.6-1.0
    groupSize: 1,
    conversationStarter: generateConversationStarter(location),
  };
}

/**
 * Generate a conversation starter for interactive NPC
 */
function generateConversationStarter(location) {
  const starters = {
    food_drink: [
      "Have you tried the [signature drink]?",
      "First time here?",
      "Do you come here often?",
      "What's good here?",
    ],
    social: [
      "Having fun?",
      "First time at this place?",
      "Want to dance?",
      "You look like you're having a good night",
    ],
    gym: [
      "How long have you been lifting?",
      "Want a spot?",
      "You doing a routine?",
      "New here?",
    ],
  };

  const pool = starters[location.category] || ["Hey, how's it going?", "Come here often?"];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate a random realistic name
 */
function generateRandomName() {
  const firstNames = ['Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Sam', 'Taylor', 'Quinn', 'Blake', 'Dylan', 'Avery', 'Jamie'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

/**
 * Check if NPC should interact with user
 * Based on approachability, location, and randomness
 */
export function shouldNPCApproach(npc, locationAtmosphere = 'neutral') {
  const atmosphereBoost = {
    'crowded': 0.2,
    'empty': -0.2,
    'friendly': 0.3,
    'tense': -0.3,
  };

  const boost = atmosphereBoost[locationAtmosphere] || 0;
  const threshold = 0.7 + boost;

  return npc.approachability >= threshold && Math.random() < (npc.approachability + boost);
}