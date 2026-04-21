// Comprehensive relationship type definitions
// Bilateral: same role on both sides, auto-reverse
// Paired: inverse role assigned to other character, must stay synced

export const RELATIONSHIP_TYPES = {
  // SOCIAL (bilateral)
  friend: {
    label: "Friend",
    category: "social",
    type: "bilateral",
    inverse: "friend",
    description: "Mutual friendship"
  },
  best_friend: {
    label: "Best Friend",
    category: "social",
    type: "bilateral",
    inverse: "best_friend",
    description: "Close, trusted friendship"
  },
  close_friend: {
    label: "Close Friend",
    category: "social",
    type: "bilateral",
    inverse: "close_friend",
    description: "Established close friendship"
  },
  acquaintance: {
    label: "Acquaintance",
    category: "social",
    type: "bilateral",
    inverse: "acquaintance",
    description: "Casual, know each other"
  },
  neighbor: {
    label: "Neighbor",
    category: "social",
    type: "bilateral",
    inverse: "neighbor",
    description: "Live near each other"
  },
  coworker: {
    label: "Coworker",
    category: "social",
    type: "bilateral",
    inverse: "coworker",
    description: "Work together"
  },
  known_contact: {
    label: "Known Contact",
    category: "social",
    type: "neutral",
    description: "Professional or casual contact"
  },
  associate: {
    label: "Associate",
    category: "social",
    type: "neutral",
    description: "Neutral association"
  },

  // ROMANTIC (bilateral)
  partner: {
    label: "Partner",
    category: "romantic",
    type: "bilateral",
    inverse: "partner",
    description: "Committed relationship"
  },
  dating: {
    label: "Dating",
    category: "romantic",
    type: "bilateral",
    inverse: "dating",
    description: "Actively dating"
  },
  romantic_interest: {
    label: "Romantic Interest",
    category: "romantic",
    type: "bilateral",
    inverse: "romantic_interest",
    description: "Mutual romantic interest"
  },
  crush: {
    label: "Crush",
    category: "romantic",
    type: "bilateral",
    inverse: "crush",
    description: "Mutual attraction/interest"
  },
  situationship: {
    label: "Situationship",
    category: "romantic",
    type: "bilateral",
    inverse: "situationship",
    description: "Undefined romantic dynamic"
  },
  ex: {
    label: "Ex",
    category: "romantic",
    type: "bilateral",
    inverse: "ex",
    description: "Former romantic relationship"
  },
  friends_with_benefits: {
    label: "Friends with Benefits",
    category: "romantic",
    type: "bilateral",
    inverse: "friends_with_benefits",
    description: "Intimate friends without commitment"
  },

  // WORK / STRUCTURE (paired)
  boss: {
    label: "Boss",
    category: "work",
    type: "paired",
    inverse: "employee",
    description: "Direct supervisor"
  },
  employee: {
    label: "Employee",
    category: "work",
    type: "paired",
    inverse: "boss",
    description: "Works under this person"
  },
  manager: {
    label: "Manager",
    category: "work",
    type: "paired",
    inverse: "employee_managed",
    description: "Manages this person"
  },
  employee_managed: {
    label: "Managed By",
    category: "work",
    type: "paired",
    inverse: "manager",
    description: "Managed by this person"
  },
  supervisor: {
    label: "Supervisor",
    category: "work",
    type: "paired",
    inverse: "supervised_by",
    description: "Supervises this person"
  },
  supervised_by: {
    label: "Supervised By",
    category: "work",
    type: "paired",
    inverse: "supervisor",
    description: "Supervised by this person"
  },
  business_partner: {
    label: "Business Partner",
    category: "work",
    type: "bilateral",
    inverse: "business_partner",
    description: "Joint business ownership"
  },

  // MENTORSHIP (paired)
  mentor: {
    label: "Mentor",
    category: "mentorship",
    type: "paired",
    inverse: "mentee",
    description: "Guides and teaches this person"
  },
  mentee: {
    label: "Mentee",
    category: "mentorship",
    type: "paired",
    inverse: "mentor",
    description: "Guided by this person"
  },
  coach: {
    label: "Coach",
    category: "mentorship",
    type: "paired",
    inverse: "trainee",
    description: "Trains and coaches this person"
  },
  trainee: {
    label: "Trainee",
    category: "mentorship",
    type: "paired",
    inverse: "coach",
    description: "Trained by this person"
  },

  // DYNAMICS
  confidant: {
    label: "Confidant",
    category: "dynamics",
    type: "bilateral",
    inverse: "confidant",
    description: "Trusted with secrets"
  },
  protector: {
    label: "Protector",
    category: "dynamics",
    type: "paired",
    inverse: "protected_by",
    description: "Protects this person"
  },
  protected_by: {
    label: "Protected By",
    category: "dynamics",
    type: "paired",
    inverse: "protector",
    description: "Protected by this person"
  },
  influencer: {
    label: "Influencer",
    category: "dynamics",
    type: "paired",
    inverse: "follower",
    description: "Influences this person"
  },
  follower: {
    label: "Follower",
    category: "dynamics",
    type: "paired",
    inverse: "influencer",
    description: "Influenced by this person"
  },

  // CONFLICT
  rival: {
    label: "Rival",
    category: "conflict",
    type: "bilateral",
    inverse: "rival",
    description: "Competitive or opposing"
  },
  enemy: {
    label: "Enemy",
    category: "conflict",
    type: "bilateral",
    inverse: "enemy",
    description: "Hostile relationship"
  },
  competitive_rival: {
    label: "Competitive Rival",
    category: "conflict",
    type: "bilateral",
    inverse: "competitive_rival",
    description: "Engaged in competition"
  },
  obsessed_with: {
    label: "Obsessed With",
    category: "conflict",
    type: "paired",
    inverse: "target_of_obsession",
    description: "Obsessed with this person"
  },
  target_of_obsession: {
    label: "Target Of Obsession",
    category: "conflict",
    type: "paired",
    inverse: "obsessed_with",
    description: "Target of this person's obsession"
  },

  // LEGACY / OTHER (for backward compatibility)
  family: {
    label: "Family",
    category: "legacy",
    type: "bilateral",
    inverse: "family",
    description: "Family relationship (use Family Member NPC for formal family)"
  },
  other: {
    label: "Other",
    category: "legacy",
    type: "neutral",
    description: "Uncategorized relationship"
  },
};

// Organize by category
export const RELATIONSHIP_CATEGORIES = {
  social: {
    label: "Social",
    color: "text-blue-400",
    bg: "bg-blue-400/10"
  },
  romantic: {
    label: "Romantic",
    color: "text-pink-400",
    bg: "bg-pink-400/10"
  },
  work: {
    label: "Work / Structure",
    color: "text-amber-400",
    bg: "bg-amber-400/10"
  },
  mentorship: {
    label: "Mentorship",
    color: "text-purple-400",
    bg: "bg-purple-400/10"
  },
  dynamics: {
    label: "Dynamics",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10"
  },
  conflict: {
    label: "Conflict",
    color: "text-red-400",
    bg: "bg-red-400/10"
  },
  legacy: {
    label: "Other",
    color: "text-slate-400",
    bg: "bg-slate-400/10"
  }
};

// Get inverse relationship type for a given relationship
export function getInverseRelationType(relationType) {
  const def = RELATIONSHIP_TYPES[relationType];
  if (!def) return null;
  return def.inverse;
}

// Check if a relationship is bilateral
export function isBilateralRelationship(relationType) {
  const def = RELATIONSHIP_TYPES[relationType];
  if (!def) return false;
  return def.type === "bilateral";
}

// Check if a relationship is paired
export function isPairedRelationship(relationType) {
  const def = RELATIONSHIP_TYPES[relationType];
  if (!def) return false;
  return def.type === "paired";
}

// Get relationship label
export function getRelationshipLabel(relationType) {
  const def = RELATIONSHIP_TYPES[relationType];
  return def?.label || relationType;
}

// Get relationship description
export function getRelationshipDescription(relationType) {
  const def = RELATIONSHIP_TYPES[relationType];
  return def?.description || "";
}