/**
 * Relationship utility — handles reciprocal logic for user ↔ active character relationships.
 * Gendered roles use the user's gender from Settings as source of truth.
 * Broad (non-gendered) roles bypass gender logic entirely.
 */

export const RELATIONSHIP_OPTIONS = [
  // Broad (non-gendered)
  { value: "parent",             label: "Parent",             gendered: false },
  { value: "child",              label: "Child",              gendered: false },
  { value: "sibling",            label: "Sibling",            gendered: false },
  { value: "cousin",             label: "Cousin",             gendered: false },
  { value: "spouse",             label: "Spouse",             gendered: false },
  { value: "significant_other",  label: "Significant Other",  gendered: false },
  // Specific (gendered)
  { value: "mother",             label: "Mother",             gendered: true },
  { value: "father",             label: "Father",             gendered: true },
  { value: "son",                label: "Son",                gendered: true },
  { value: "daughter",           label: "Daughter",           gendered: true },
  { value: "aunt",               label: "Aunt",               gendered: true },
  { value: "uncle",              label: "Uncle",              gendered: true },
  { value: "niece",              label: "Niece",              gendered: true },
  { value: "nephew",             label: "Nephew",             gendered: true },
];

export function getRelationshipLabel(value) {
  return RELATIONSHIP_OPTIONS.find(r => r.value === value)?.label || value;
}

/**
 * Given the relationship the USER assigned to the CHARACTER,
 * and the user's gender, return what the USER should appear as
 * from the CHARACTER's perspective.
 *
 * @param {string} userAssignedRole - e.g. "mother", "sibling", "child"
 * @param {string} userGender - "male" | "female" | "non-binary" | "other"
 * @returns {string} reciprocal role value
 */
export function getReciprocalRole(userAssignedRole, userGender) {
  const isMale = userGender === "male";
  const isFemale = userGender === "female";

  switch (userAssignedRole) {
    // Broad non-gendered — symmetric or simple swap
    case "parent":            return "child";
    case "child":             return "parent";
    case "sibling":           return "sibling";
    case "cousin":            return "cousin";
    case "spouse":            return "spouse";
    case "significant_other": return "significant_other";

    // Gendered — user's gender determines reciprocal label
    case "mother":
    case "father":
      if (isMale)   return "son";
      if (isFemale) return "daughter";
      return "child"; // non-binary / other → broad label

    case "son":
    case "daughter":
      if (isMale)   return "father";
      if (isFemale) return "mother";
      return "parent";

    case "aunt":
    case "uncle":
      if (isMale)   return "nephew";
      if (isFemale) return "niece";
      return "child"; // fallback

    case "niece":
    case "nephew":
      if (isMale)   return "uncle";
      if (isFemale) return "aunt";
      return "parent";

    default:
      return userAssignedRole;
  }
}

/**
 * Returns a human-readable display label for the reciprocal role.
 */
export function getReciprocalLabel(userAssignedRole, userGender) {
  const reciprocal = getReciprocalRole(userAssignedRole, userGender);
  return getRelationshipLabel(reciprocal);
}