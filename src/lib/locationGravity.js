/**
 * Location Popularity & Gravity System
 *
 * Calculates social gravity scores for locations to drive
 * natural character clustering and world liveliness.
 */

// ── Base popularity by category (0–100) ──────────────────────────────────────
const CATEGORY_BASE_POPULARITY = {
  home:       10,   // private — low public pull
  workplace:  30,   // schedule-driven
  school:     30,   // schedule-driven
  gym:        45,
  grocery:    40,
  medical:    25,
  hospital:   25,
  clinic:     25,
  church:     35,
  religion:   35,
  park:       55,
  outdoor:    50,
  food_drink: 65,
  restaurant: 65,
  bar:        70,
  social:     75,
  community:  60,
  business:   40,
  government: 20,
  public:     50,
  generic:    40,
};

// ── Time-of-day multipliers per category ─────────────────────────────────────
// Each entry: [hourStart, hourEnd, multiplier]
const CATEGORY_TIME_RULES = {
  gym:        [[5, 9, 1.6], [17, 20, 1.5]],
  food_drink: [[7, 10, 1.4], [12, 14, 1.5], [17, 20, 1.3]],
  restaurant: [[11, 14, 1.6], [18, 21, 1.7]],
  bar:        [[20, 23, 1.9], [22, 24, 2.0], [0, 2, 1.7]],
  social:     [[18, 23, 1.8], [14, 17, 1.3]],
  park:       [[8, 12, 1.5], [15, 18, 1.4]],
  grocery:    [[10, 13, 1.5], [16, 19, 1.6]],
  church:     [[8, 13, 1.8]],   // weekends mostly but still
  workplace:  [[8, 17, 1.5]],
  school:     [[7, 15, 1.6]],
};

function getTimeMultiplier(category, hour) {
  const rules = CATEGORY_TIME_RULES[category];
  if (!rules) return 1.0;
  for (const [start, end, mult] of rules) {
    if (hour >= start && hour < end) return mult;
  }
  return 0.8; // off-peak slight penalty
}

// ── Social amplification: more people → higher boost ─────────────────────────
function socialAmplification(occupantCount) {
  if (occupantCount === 0) return 0;
  if (occupantCount === 1) return 5;
  if (occupantCount === 2) return 12;
  if (occupantCount === 3) return 20;
  if (occupantCount <= 5) return 30;
  if (occupantCount <= 8) return 42;
  if (occupantCount <= 12) return 55;
  return 65; // cap
}

/**
 * Calculate gravity score for a single location.
 *
 * @param {object} location  - LocationReference record
 * @param {number} occupants - current number of characters present
 * @param {Date}   now       - current date/time (defaults to new Date())
 * @returns {{ gravity: number, label: string, color: string, pulse: boolean }}
 */
export function calcLocationGravity(location, occupants = 0, now = new Date()) {
  const category = location.category || "generic";
  const hour = now.getHours();

  // Base score from category, or stored popularity_score if set
  const basePopularity =
    typeof location.popularity_score === "number"
      ? location.popularity_score
      : (CATEGORY_BASE_POPULARITY[category] ?? 40);

  // Homes get a hard cap — they're private spaces
  if (category === "home") {
    const gravity = Math.min(15 + socialAmplification(occupants), 40);
    return { gravity, ...gravityLabel(gravity, category) };
  }

  // Time-of-day multiplier
  const timeMult = getTimeMultiplier(category, hour);

  // Social amplification from current occupants
  const socialBoost = socialAmplification(occupants);

  // Optional: stored activity_boost from the record itself
  const storedBoost = typeof location.activity_boost === "number" ? location.activity_boost : 0;

  const gravity = Math.round(basePopularity * timeMult + socialBoost + storedBoost);

  return { gravity, ...gravityLabel(gravity, category) };
}

function gravityLabel(gravity, category) {
  if (category === "home") {
    return { label: null, color: null, pulse: false };
  }
  if (gravity >= 90) return { label: "🔥 Hot",   color: "#ef4444", pulse: true  };
  if (gravity >= 70) return { label: "⚡ Busy",  color: "#f97316", pulse: true  };
  if (gravity >= 50) return { label: "👥 Active", color: "#22c55e", pulse: false };
  if (gravity >= 30) return { label: "😌 Quiet",  color: "#64748b", pulse: false };
  return                     { label: null,        color: null,      pulse: false };
}

/**
 * Given a list of locations and current occupancy map,
 * perform weighted-random selection biased by gravity.
 *
 * Used by character movement logic when choosing a free destination.
 *
 * @param {object[]} locations        - array of LocationReference records
 * @param {Map<string,number>} occupancyMap - locationId → count
 * @param {object}  options
 * @param {string[]} options.exclude  - locationIds to skip
 * @param {string}  options.category  - if set, only pick from this category
 * @returns {object|null}             - chosen location or null
 */
export function pickLocationByGravity(locations, occupancyMap, options = {}) {
  const { exclude = [], category } = options;
  const now = new Date();

  const candidates = locations.filter(l => {
    if (exclude.includes(l.id)) return false;
    if (l.category === "home") return false; // homes are never public destinations
    if (category && l.category !== category) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // Weight each candidate by its gravity score
  const weighted = candidates.map(loc => {
    const occupants = occupancyMap?.get(loc.id) ?? 0;
    const { gravity } = calcLocationGravity(loc, occupants, now);
    return { loc, weight: Math.max(1, gravity) };
  });

  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  let rand = Math.random() * totalWeight;

  for (const { loc, weight } of weighted) {
    rand -= weight;
    if (rand <= 0) return loc;
  }

  return weighted[weighted.length - 1].loc;
}