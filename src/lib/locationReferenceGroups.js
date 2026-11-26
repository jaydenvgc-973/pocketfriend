/**
 * LOCATION REFERENCE GROUPS — the display groups on the Location References page.
 *
 * These are DISPLAY groups, not location categories. Each group lists the existing
 * category values it collects; nothing is renamed, reclassified or written to a record.
 *
 * A reference is filed by its PARENT location's own category, so a Generic city keeps
 * its hospitals, apartments, businesses and parks under Generic, and a university keeps
 * its dorm rooms and studios under Education. Nested zones never move a parent elsewhere.
 *
 * Global vs character sharing is untouched: it stays on the record and is shown on each
 * card, but it no longer decides where a reference appears in the list.
 */
export const LOCATION_REFERENCE_GROUPS = [
  { key: "generic", label: "Generic", categories: ["generic"] },
  { key: "medical", label: "Medical", categories: ["medical"] },
  { key: "education", label: "Education", categories: ["school", "education"] },
  { key: "residential", label: "Residential", categories: ["home", "hotel", "shelter"] },
  { key: "business", label: "Business & Employment", categories: ["workplace", "business", "gym", "grocery"] },
  { key: "food", label: "Food & Nightlife", categories: ["food_drink", "social"] },
  { key: "outdoor", label: "Outdoor & Public", categories: ["outdoor", "public"] },
  { key: "religion", label: "Religion & Community", categories: ["religion", "community"] },
  { key: "government", label: "Government & Corrections", categories: ["government", "jail_prison"] },
  { key: "transportation", label: "Transportation", categories: ["transportation"] },
];

/** Category value → the display group that collects it. */
const GROUP_BY_CATEGORY = (() => {
  const map = {};
  LOCATION_REFERENCE_GROUPS.forEach((group) => {
    group.categories.forEach((category) => { map[category] = group.key; });
  });
  return map;
})();

/**
 * Alphabetical by the parent location's own name, regardless of capitalization.
 * Records with the same name keep a stable order.
 */
const byLocationName = (a, b) => {
  const an = String(a?.name || "");
  const bn = String(b?.name || "");
  return an.localeCompare(bn, undefined, { sensitivity: "base" }) || an.localeCompare(bn);
};

/**
 * One category-organized view of the references the account can already access.
 * Groups come back in the fixed order above, each alphabetized across ALL of its
 * categories — never Homes first, then Hotels, then Shelters. Groups with nothing in
 * them are omitted. A record whose category resolves to no group is kept, never
 * reassigned, and shown in a clearly identified Uncategorized group at the end.
 */
export function groupLocationReferences(locations = []) {
  const buckets = {};
  LOCATION_REFERENCE_GROUPS.forEach((group) => { buckets[group.key] = []; });
  const uncategorized = [];

  (locations || []).forEach((location) => {
    if (!location) return;
    const category = String(location.category || "").trim().toLowerCase();
    const key = GROUP_BY_CATEGORY[category];
    if (key) buckets[key].push(location);
    else uncategorized.push(location);
  });

  const groups = LOCATION_REFERENCE_GROUPS
    .map((group) => ({ key: group.key, label: group.label, items: buckets[group.key].sort(byLocationName) }))
    .filter((group) => group.items.length > 0);

  if (uncategorized.length > 0) {
    groups.push({ key: "uncategorized", label: "Uncategorized", items: uncategorized.sort(byLocationName) });
  }

  return groups;
}