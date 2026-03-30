const UNISEX_NAMES = [
  'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Cameron', 'Drew', 'Alex',
  'Avery', 'Quinn', 'Parker', 'Rowan', 'Blake', 'Dakota', 'Emerson', 'Reese',
  'Finley', 'Harper', 'Skyler', 'Kendall', 'Sawyer', 'Ellis', 'Remy', 'Phoenix',
  'River', 'Sage', 'Logan', 'Micah', 'Arden', 'Lennon', 'Hayden', 'Jesse',
  'Tatum', 'Spencer', 'Bailey', 'Lane', 'Shiloh', 'Marley', 'Devon', 'Justice',
  'Reagan', 'Payton', 'Alden', 'Briar', 'Greer', 'Hollis', 'Indigo', 'Jules',
  'Kieran', 'Noel'
];

// Track recently generated names to prevent repetition
const recentNames = { first: [], last: [] };
const MAX_RECENT = 12; // Track last 12 to prevent cycling back too quickly

export function generateRandomName() {
  // Pick first name, avoiding recent ones
  let firstName;
  const availableFirst = UNISEX_NAMES.filter(n => !recentNames.first.includes(n));
  firstName = availableFirst.length > 0 
    ? availableFirst[Math.floor(Math.random() * availableFirst.length)]
    : UNISEX_NAMES[Math.floor(Math.random() * UNISEX_NAMES.length)];

  // Pick last name, avoiding recent ones AND the first name
  let lastName;
  const availableLast = UNISEX_NAMES.filter(
    n => !recentNames.last.includes(n) && n !== firstName
  );
  lastName = availableLast.length > 0
    ? availableLast[Math.floor(Math.random() * availableLast.length)]
    : UNISEX_NAMES.find(n => n !== firstName) || UNISEX_NAMES[0];

  // Update recent tracking
  recentNames.first.push(firstName);
  recentNames.last.push(lastName);
  if (recentNames.first.length > MAX_RECENT) recentNames.first.shift();
  if (recentNames.last.length > MAX_RECENT) recentNames.last.shift();

  return { first_name: firstName, last_name: lastName };
}

export function getNamePoolSize() {
  return UNISEX_NAMES.length;
}