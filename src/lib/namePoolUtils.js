// Built-in unisex name pool for character generation
const UNISEX_NAME_POOL = [
  'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Cameron', 'Drew', 'Alex',
  'Avery', 'Quinn', 'Parker', 'Rowan', 'Blake', 'Dakota', 'Emerson', 'Reese',
  'Finley', 'Harper', 'Skyler', 'Kendall', 'Sawyer', 'Ellis', 'Remy', 'Phoenix',
  'River', 'Sage', 'Logan', 'Micah', 'Arden', 'Lennon', 'Hayden', 'Jesse',
  'Tatum', 'Spencer', 'Bailey', 'Lane', 'Shiloh', 'Marley', 'Devon', 'Justice',
  'Reagan', 'Payton', 'Alden', 'Briar', 'Greer', 'Hollis', 'Indigo', 'Jules',
  'Kieran', 'Noel'
];

const RECENT_NAMES_STORAGE_KEY = 'character_creation_recent_names';
const MAX_RECENT_HISTORY = 20; // Track last 20 generated names to avoid repetition

/**
 * Get recently generated full names from localStorage
 */
function getRecentNames() {
  try {
    const stored = localStorage.getItem(RECENT_NAMES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Add a generated name to the recent history
 */
function addToRecentNames(firstName, lastName) {
  const fullName = `${firstName} ${lastName}`;
  const recent = getRecentNames();
  
  // Add to front and remove duplicates
  const updated = [fullName, ...recent.filter(name => name !== fullName)];
  
  // Keep only last MAX_RECENT_HISTORY entries
  const trimmed = updated.slice(0, MAX_RECENT_HISTORY);
  
  try {
    localStorage.setItem(RECENT_NAMES_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Fail silently if localStorage unavailable
  }
}

/**
 * Get a weighted random name, deprioritizing recently used ones
 * Recently used names have lower probability of selection
 */
function getWeightedRandomName(recentNames, availableNames) {
  if (availableNames.length === 0) return null;
  
  // Extract recently used first/last names for deprioritization
  const recentFirstNames = new Set();
  const recentLastNames = new Set();
  
  recentNames.forEach(fullName => {
    const [first, last] = fullName.split(' ');
    recentFirstNames.add(first);
    recentLastNames.add(last);
  });
  
  // Weight calculation: recently used = 30% probability, others = 70% probability
  const weights = availableNames.map(name => {
    const isRecentFirst = recentFirstNames.has(name);
    const isRecentLast = recentLastNames.has(name);
    const isRecent = isRecentFirst || isRecentLast;
    return isRecent ? 0.3 : 1.0;
  });
  
  // Weighted random selection
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;
  
  for (let i = 0; i < availableNames.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return availableNames[i];
    }
  }
  
  return availableNames[availableNames.length - 1];
}

/**
 * Generate a random full name from the pool
 * Ensures first and last names are different
 * Tracks recent generations to minimize repetition
 */
export function generateRandomName() {
  const recentNames = getRecentNames();
  
  // Select first name with weighting
  const firstName = getWeightedRandomName(recentNames, UNISEX_NAME_POOL);
  
  // Select last name, ensuring it's different from first name
  const availableLastNames = UNISEX_NAME_POOL.filter(name => name !== firstName);
  const lastName = getWeightedRandomName(recentNames, availableLastNames);
  
  // Track this generation
  addToRecentNames(firstName, lastName);
  
  return { first_name: firstName, last_name: lastName };
}

/**
 * Clear recent name history (for testing or reset)
 */
export function clearRecentNames() {
  try {
    localStorage.removeItem(RECENT_NAMES_STORAGE_KEY);
  } catch {
    // Fail silently
  }
}

/**
 * Get the name pool (for reference/testing)
 */
export function getNamePool() {
  return [...UNISEX_NAME_POOL];
}