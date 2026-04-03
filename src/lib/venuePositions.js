/**
 * Venue-Based Position Lists
 * Used for dropdowns and smart role filling logic.
 * Maps location category to realistic position roles.
 */

export const VENUE_POSITIONS = {
  restaurant: [
    'owner', 'general manager', 'assistant manager', 'head chef', 'sous chef', 'cook',
    'line cook', 'prep cook', 'server', 'bartender', 'barback', 'host', 'host/greeter',
    'dishwasher', 'busser', 'sommelier', 'security', 'manager on duty'
  ],
  food_drink: [
    'owner', 'manager', 'assistant manager', 'bartender', 'server', 'barback', 'host',
    'cook', 'dishwasher', 'security', 'busser'
  ],
  social: [
    'owner', 'manager', 'assistant manager', 'bartender', 'server', 'barback', 'DJ',
    'sound engineer', 'promoter', 'security', 'doorman', 'host', 'busser'
  ],
  bar: [
    'owner', 'manager', 'assistant manager', 'bartender', 'barback', 'server', 'host',
    'security', 'DJ', 'sound tech', 'doorman'
  ],
  gym: [
    'owner', 'manager', 'assistant manager', 'front desk', 'personal trainer', 'group instructor',
    'yoga instructor', 'spinning instructor', 'cleaning staff', 'maintenance'
  ],
  workplace: [
    'owner', 'manager', 'director', 'supervisor', 'team lead', 'receptionist', 'coordinator',
    'clerk', 'specialist', 'analyst', 'assistant', 'executive assistant'
  ],
  school: [
    'principal', 'vice principal', 'teacher', 'substitute teacher', 'counselor', 'secretary',
    'administrative assistant', 'janitor', 'custodian', 'coach', 'PE teacher', 'nurse', 'aide'
  ],
  education: [
    'principal', 'vice principal', 'teacher', 'substitute teacher', 'counselor', 'secretary',
    'administrative assistant', 'janitor', 'custodian', 'coach', 'nurse', 'aide', 'professor'
  ],
  grocery: [
    'owner', 'manager', 'assistant manager', 'cashier', 'stock clerk', 'floor associate',
    'deli clerk', 'produce associate', 'customer service', 'security', 'cleaning staff'
  ],
  business: [
    'owner', 'manager', 'assistant manager', 'cashier', 'sales associate', 'stock clerk',
    'customer service', 'floor associate', 'security'
  ],
  medical: [
    'doctor', 'physician assistant', 'nurse', 'nurse practitioner', 'receptionist', 'medical assistant',
    'lab tech', 'administrator', 'office manager', 'janitor', 'security'
  ],
  religion: [
    'pastor', 'associate pastor', 'deacon', 'usher', 'choir director', 'organist', 'drummer',
    'musician', 'choir member', 'secretary', 'groundskeeper'
  ],
  outdoor: [
    'manager', 'groundskeeper', 'maintenance', 'recreation staff', 'facilities manager',
    'security', 'attendant', 'ranger'
  ],
  park: [
    'manager', 'groundskeeper', 'maintenance staff', 'recreation coordinator', 'security',
    'ranger', 'facilities attendant'
  ],
  home: [], // homes don't have positions
  generic: [], // generic locations don't have standard positions
};

/**
 * Get position dropdown options for a venue
 */
export function getVenuePositions(category) {
  return VENUE_POSITIONS[category] || [];
}

/**
 * Check if a position is valid for a venue type
 */
export function isValidPosition(category, position) {
  const positions = getVenuePositions(category);
  if (positions.length === 0) return true; // no restrictions for homes/generic
  return positions.some(p => p.toLowerCase() === position.toLowerCase());
}