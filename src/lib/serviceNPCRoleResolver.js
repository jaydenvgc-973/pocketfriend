/**
 * serviceNPCRoleResolver.js
 *
 * Maps location categories to appropriate temporary service NPC roles.
 *
 * TEMPORARY NPC GUARD:
 *   These NPCs are npc_fictitious, npc_regular, or npc_family_member.
 *   They are NEVER active_created_character.
 *   They are NEVER npc_world_service (that's Vick).
 *   They are temporary — they have a lifecycle.
 *
 * ROLE VALIDATION:
 *   Each location category resolves a specific set of appropriate roles.
 *   Wrong roles in wrong locations = malfunction.
 *   Missing roles = uncovered location.
 */

// ── LOCATION CATEGORY → ROLE SET MAPPING ────────────────────────────────────
// Each entry: { roles: [approved role names], forbidden: [roles that must NEVER appear here] }

export const LOCATION_ROLE_MAP = {
  school: {
    roles: [
      'Student Success Advisor',
      'Guidance Specialist',
      'Academic Advisor',
      'Resident Advisor',
      'Career Counselor',
      'Student Support Coordinator',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Rehabilitation Coordinator',
      'Correctional Counselor',
    ],
    description: 'Education support — guidance, academic advising, student wellness',
  },
  workplace: {
    roles: [
      'Shift Supervisor',
      'Team Lead',
      'Workplace Mentor',
      'Employee Support Coordinator',
      'Floor Manager',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Rehabilitation Coordinator',
      'Case Manager',
    ],
    description: 'Workplace support — supervision, mentoring, employee coordination',
  },
  community: {
    roles: [
      'Community Advisor',
      'Community Mentor',
      'Community Liaison',
      'Wellness Coordinator',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Correctional Counselor',
    ],
    description: 'Community support — outreach, connection, wellness',
  },
  gym: {
    roles: [
      'Fitness Coach',
      'Wellness Coach',
      'Personal Trainer',
      'Lifestyle Coach',
      'Recovery Coach',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Student Success Advisor',
      'Correctional Counselor',
      'Case Manager',
    ],
    description: 'Fitness & wellness — coaching, training, recovery guidance',
  },
  medical: {
    roles: [
      'Nurse',
      'Patient Advocate',
      'Recovery Specialist',
      'Wellness Coordinator',
      'Case Manager',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Student Success Advisor',
    ],
    description: 'Medical support — patient advocacy, recovery, care coordination',
  },
  jail_prison: {
    roles: [
      'Behavioral Specialist',
      'Rehabilitation Coordinator',
      'Case Manager',
      'Reentry Counselor',
      'Correctional Counselor',
    ],
    forbidden: [
      'Fitness Coach',
      'Student Success Advisor',
      'Community Advisor',
      'Server',
      'Bartender',
    ],
    description: 'Correctional support — behavioral, rehabilitation, reentry planning',
  },
  residential: {
    roles: [
      'Resident Advisor',
      'Housing Coordinator',
      'Residential Support Staff',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Rehabilitation Coordinator',
    ],
    description: 'Residential support — housing coordination, resident advising',
  },
  food_drink: {
    roles: [
      'Server',
      'Bartender',
      'Host',
      'Shift Lead',
      'Floor Manager',
      'Dining Staff',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Student Success Advisor',
      'Academic Advisor',
      'Correctional Counselor',
    ],
    description: 'Hospitality service — food service, bar, dining support',
  },
  social: {
    roles: [
      'Host',
      'Event Coordinator',
      'Venue Staff',
      'Floor Manager',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Correctional Counselor',
    ],
    description: 'Social venue — hosting, event support, venue management',
  },
  outdoor: {
    roles: [
      'Community Liaison',
      'Wellness Coordinator',
      'Recreation Guide',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Correctional Counselor',
    ],
    description: 'Outdoor & recreation — outdoor wellness, community connection',
  },
  religion: {
    roles: [
      'Spiritual Advisor',
      'Community Liaison',
      'Wellness Coordinator',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Correctional Counselor',
    ],
    description: 'Religious/spiritual — spiritual guidance, community connection',
  },
  generic: {
    roles: [
      'Community Liaison',
    ],
    forbidden: [
      'Behavioral Specialist',
      'Correctional Counselor',
      'Student Success Advisor',
    ],
    description: 'Generic location — minimal support, community connection only',
  },
};

// ── ROLE BEHAVIOR BOUNDARIES ──────────────────────────────────────────────────
// What each role type is ALLOWED and NOT ALLOWED to do.
// This is the behavioral contract for temporary service NPCs.

export const ROLE_BEHAVIOR_BOUNDARIES = {
  // ── Education Roles ──
  'Student Success Advisor': {
    allows: ['encourage attendance', 'notice academic struggle', 'suggest study habits', 'connect to resources', 'check in on wellbeing'],
    forbids: ['force enrollment', 'override autonomy', 'control schedule', 'become a therapist', 'act as a parent'],
    context: 'School/academic settings only',
  },
  'Guidance Specialist': {
    allows: ['provide academic guidance', 'discuss career paths', 'suggest courses', 'notice struggling students'],
    forbids: ['force decisions', 'override student choice', 'become a life coach', 'act outside school context'],
    context: 'School settings only',
  },
  'Academic Advisor': {
    allows: ['advise on course selection', 'discuss academic progress', 'suggest study strategies'],
    forbids: ['force enrollment decisions', 'override autonomy', 'act as a therapist'],
    context: 'School/higher education settings only',
  },
  'Resident Advisor': {
    allows: ['check on residents', 'encourage healthy routines', 'de-escalate roommate conflicts', 'suggest resources'],
    forbids: ['force behavior', 'control residents', 'become a parent figure', 'override autonomy'],
    context: 'Residential/dorm settings',
  },

  // ── Workplace Roles ──
  'Shift Supervisor': {
    allows: ['manage shift flow', 'notice struggling workers', 'suggest breaks', 'encourage rest', 'remind about food'],
    forbids: ['force compliance', 'override autonomy', 'become a therapist', 'control personal life'],
    context: 'Workplace during shift hours only',
  },
  'Team Lead': {
    allows: ['coordinate team', 'notice overwhelmed workers', 'suggest pacing', 'check in on wellbeing'],
    forbids: ['force behavior', 'override autonomy', 'act as a life coach'],
    context: 'Workplace during active shifts',
  },
  'Workplace Mentor': {
    allows: ['offer guidance', 'share experience', 'notice struggling workers', 'encourage growth'],
    forbids: ['force career decisions', 'override autonomy', 'become a therapist'],
    context: 'Workplace mentoring context',
  },

  // ── Correctional Roles ──
  'Behavioral Specialist': {
    allows: ['address behavioral escalation', 'de-escalate conflict', 'suggest coping strategies', 'notice concerning patterns'],
    forbids: ['force behavior', 'override autonomy', 'act as a therapist outside scope', 'appear in non-correctional settings'],
    context: 'Correctional/rehabilitation settings only',
  },
  'Rehabilitation Coordinator': {
    allows: ['coordinate reentry planning', 'connect to resources', 'track progress', 'suggest programs'],
    forbids: ['force participation', 'override autonomy', 'act as a parole officer'],
    context: 'Correctional/rehabilitation settings only',
  },
  'Case Manager': {
    allows: ['coordinate care', 'track needs', 'connect to services', 'monitor progress'],
    forbids: ['force compliance', 'override autonomy', 'become a guardian'],
    context: 'Medical, correctional, or structured support settings',
  },
  'Reentry Counselor': {
    allows: ['discuss reentry planning', 'connect to community resources', 'address reintegration concerns'],
    forbids: ['force decisions', 'override autonomy', 'act as a probation officer'],
    context: 'Correctional/reentry settings only',
  },
  'Correctional Counselor': {
    allows: ['provide counseling within correctional context', 'address behavioral concerns', 'support rehabilitation'],
    forbids: ['force compliance', 'override autonomy', 'appear in non-correctional settings'],
    context: 'Correctional facilities only',
  },

  // ── Fitness/Wellness Roles ──
  'Fitness Coach': {
    allows: ['suggest workouts', 'encourage form', 'notice fatigue', 'suggest recovery', 'remind about hydration'],
    forbids: ['force exercise', 'override autonomy', 'become a personal trainer for life', 'act as a therapist'],
    context: 'Gym/fitness settings only',
  },
  'Wellness Coach': {
    allows: ['suggest wellness practices', 'encourage balance', 'notice burnout signs', 'suggest rest'],
    forbids: ['force wellness routines', 'override autonomy', 'become a life coach'],
    context: 'Gym, community, or wellness settings',
  },
  'Personal Trainer': {
    allows: ['provide training guidance', 'suggest workout plans', 'notice fatigue', 'encourage proper form'],
    forbids: ['force training', 'override autonomy', 'control diet or lifestyle'],
    context: 'Gym/fitness settings only',
  },
  'Lifestyle Coach': {
    allows: ['discuss lifestyle balance', 'suggest healthy habits', 'notice concerning patterns'],
    forbids: ['force lifestyle changes', 'override autonomy', 'become a life controller'],
    context: 'Gym/wellness settings',
  },
  'Recovery Coach': {
    allows: ['support recovery goals', 'notice setbacks', 'encourage healthy choices', 'connect to resources'],
    forbids: ['force recovery path', 'override autonomy', 'act as a sponsor without consent'],
    context: 'Gym/recovery/wellness settings',
  },

  // ── Medical Roles ──
  'Nurse': {
    allows: ['assess medical needs', 'provide care', 'notice health concerns', 'recommend rest'],
    forbids: ['force treatment', 'override autonomy', 'diagnose beyond scope'],
    context: 'Medical/hospital settings only',
  },
  'Patient Advocate': {
    allows: ['support patient rights', 'help navigate care', 'voice concerns', 'connect to resources'],
    forbids: ['force decisions', 'override patient autonomy', 'act as a guardian'],
    context: 'Medical settings only',
  },
  'Recovery Specialist': {
    allows: ['support recovery process', 'monitor progress', 'suggest next steps', 'notice setbacks'],
    forbids: ['force recovery path', 'override autonomy', 'control patient decisions'],
    context: 'Medical/recovery settings',
  },

  // ── Hospitality Roles ──
  'Server': {
    allows: ['take orders', 'serve food', 'notice hungry customers', 'suggest menu items'],
    forbids: ['force food choices', 'override autonomy', 'act as a nutritionist'],
    context: 'Food/drink venues only',
  },
  'Bartender': {
    allows: ['serve drinks', 'notice concerning drinking patterns', 'suggest water', 'listen'],
    forbids: ['force drinking limits', 'override autonomy', 'act as a therapist'],
    context: 'Bar/venue settings only',
  },
  'Host': {
    allows: ['welcome guests', 'manage seating', 'notice uncomfortable guests', 'keep atmosphere pleasant'],
    forbids: ['force social interaction', 'override autonomy', 'control guest experience'],
    context: 'Venue settings',
  },

  // ── Community Roles ──
  'Community Advisor': {
    allows: ['offer community guidance', 'connect people to resources', 'notice community needs'],
    forbids: ['force community participation', 'override autonomy', 'become a community controller'],
    context: 'Community/generic settings',
  },
  'Community Liaison': {
    allows: ['connect people', 'facilitate introductions', 'notice isolation', 'suggest community events'],
    forbids: ['force social connections', 'override autonomy', 'control community dynamics'],
    context: 'Community/outdoor/generic settings',
  },
  'Spiritual Advisor': {
    allows: ['provide spiritual guidance', 'listen', 'offer perspective', 'respect beliefs'],
    forbids: ['force religious participation', 'override autonomy', 'push specific beliefs'],
    context: 'Religious/spiritual settings',
  },
};

// ── VALIDATION ────────────────────────────────────────────────────────────────

/**
 * Resolves the appropriate role set for a location category.
 * Returns { roles, forbidden, description } or null if uncategorized.
 */
export function resolveRolesForCategory(locationCategory) {
  const normalized = (locationCategory || '').toLowerCase();
  return LOCATION_ROLE_MAP[normalized] || null;
}

/**
 * Checks if a given role name is valid for a location category.
 */
export function isRoleValidForCategory(roleName, locationCategory) {
  const mapping = resolveRolesForCategory(locationCategory);
  if (!mapping) return { valid: false, reason: `Uncategorized location: ${locationCategory}` };
  if (mapping.roles.includes(roleName)) return { valid: true };
  if (mapping.forbidden.includes(roleName))
    return { valid: false, reason: `${roleName} is FORBIDDEN in ${locationCategory} — belongs in different setting` };
  return { valid: false, reason: `${roleName} is not in the approved role set for ${locationCategory}` };
}

/**
 * Returns behavioral boundaries for a role.
 */
export function getRoleBoundaries(roleName) {
  return ROLE_BEHAVIOR_BOUNDARIES[roleName] || null;
}

/**
 * Classifies a service NPC issue into Recovery Yard categories.
 */
export function classifyServiceNPCIssue(issue) {
  const { type } = issue;
  switch (type) {
    case 'missing_coverage':
      return { classification: 'REPAIR', reason: 'Fixable — location needs service NPC assignment' };
    case 'wrong_role':
      return { classification: 'QUARANTINE', reason: 'Wrong role in wrong location — quarantine and reassign' };
    case 'duplicate':
      return { classification: 'DISPOSAL', reason: 'Duplicate service NPC — archive/destroy the extra' };
    case 'overstepping':
      return { classification: 'QUARANTINE', reason: 'Behavioral drift — quarantine and review boundaries' };
    case 'becoming_permanent':
      return { classification: 'QUARANTINE', reason: 'Temporary NPC becoming permanent — quarantine and retire' };
    case 'malfunction':
      return { classification: 'RECOVERY', reason: 'Damaged but salvageable — inspect and repair' };
    case 'abandoned':
      return { classification: 'DISPOSAL', reason: 'No longer serves purpose — archive and destroy' };
    case 'stale_cache':
      return { classification: 'DISPOSAL', reason: 'Stale cache — dispose, authoritative state wins' };
    default:
      return { classification: 'RECOVERY', reason: 'General — inspect and evaluate' };
  }
}