/**
 * Relationship Tag System — Reciprocal Logic Utility
 * 
 * Supports both broad (non-gendered) and specific (gendered) roles.
 * User gender from Settings is the source of truth for gendered reciprocals.
 */

// All available relationship options the user can assign to a character
export const RELATIONSHIP_OPTIONS = [
  // Broad / non-gendered
  { value: "parent", label: "Parent", gendered: false },
  { value: "child", label: "Child", gendered: false },
  { value: "sibling", label: "Sibling", gendered: false },
  { value: "cousin", label: "Cousin", gendered: false },
  { value: "spouse", label: "Spouse", gendered: false },
  { value: "significant_other", label: "Significant Other", gendered: false },
  // Specific / gendered
  { value: "mother", label: "Mother", gendered: true },
  { value: "father", label: "Father", gendered: true },
  { value: "son", label: "Son", gendered: true },
  { value: "daughter", label: "Daughter", gendered: true },
  { value: "aunt", label: "Aunt", gendered: true },
  { value: "uncle", label: "Uncle", gendered: true },
  { value: "niece", label: "Niece", gendered: true },
  { value: "nephew", label: "Nephew", gendered: true },
];

/**
 * Get the display label for a relationship value.
 */
export function getRelationshipLabel(value) {
  const opt = RELATIONSHIP_OPTIONS.find(o => o.value === value);
  return opt ? opt.label : (value ? value.charAt(0).toUpperCase() + value.slice(1) : "");
}

/**
 * Compute the reciprocal relationship the CHARACTER has toward the USER.
 * 
 * @param {string} userAssignedRole - what the user called the character (e.g. "mother")
 * @param {string} userGender - "male" | "female" | "non-binary" | "other"
 * @returns {string} - the reciprocal role label (e.g. "son")
 */
export function getReciprocalRole(userAssignedRole, userGender) {
  const gender = userGender || "other";

  const isMale = gender === "male";
  const isFemale = gender === "female";

  // Helper: pick male/female/neutral
  const pick = (male, female, neutral = "child") => {
    if (isMale) return male;
    if (isFemale) return female;
    return neutral;
  };

  switch (userAssignedRole) {
    // Broad roles — no gender logic
    case "parent":           return "child";
    case "child":            return "parent";
    case "sibling":          return "sibling";
    case "cousin":           return "cousin";
    case "spouse":           return "spouse";
    case "significant_other":return "significant_other";

    // Gendered roles — user gender determines reciprocal
    case "mother":           return pick("son", "daughter", "child");
    case "father":           return pick("son", "daughter", "child");
    case "son":              return pick("father", "mother", "parent");
    case "daughter":         return pick("father", "mother", "parent");
    case "aunt":             return pick("nephew", "niece", "niece/nephew");
    case "uncle":            return pick("nephew", "niece", "niece/nephew");
    case "niece":            return pick("uncle", "aunt", "aunt/uncle");
    case "nephew":           return pick("uncle", "aunt", "aunt/uncle");

    default:                 return userAssignedRole;
  }
}

/**
 * Determine if a relationship is family-type (should appear in family list).
 */
export function isFamilyRelationship(role) {
  if (!role) return false;
  const familyRoles = [
    "parent", "child", "sibling", "cousin",
    "mother", "father", "son", "daughter",
    "aunt", "uncle", "niece", "nephew",
    "spouse", "significant_other"
  ];
  return familyRoles.includes(role);
}

/**
 * Map reciprocal value back to a family_members relationship_type string
 * compatible with the existing FamilyEditor.
 */
export function reciprocalToFamilyType(reciprocalRole) {
  // Normalize to the strings FamilyEditor uses
  const map = {
    son: "son",
    daughter: "daughter",
    child: "son", // fallback for FamilyEditor (which uses son/daughter)
    parent: "mother", // fallback
    mother: "mother",
    father: "father",
    sibling: "sister", // neutral fallback
    cousin: "cousin",
    spouse: "spouse",
    significant_other: "spouse",
    aunt: "aunt",
    uncle: "uncle",
    niece: "niece",
    nephew: "nephew",
  };
  return map[reciprocalRole] || reciprocalRole;
}