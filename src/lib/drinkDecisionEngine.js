/**
 * DRINK DECISION ENGINE
 * 
 * A weighted, context-driven system for generating realistic drink choices.
 * Drink = behavior decision, not a default filler.
 * 
 * Inputs: character data, location, time, social context, needs bars
 * Output: { drink: string, category: string, narrative: string } | null
 */

// ─── DRINK CATEGORIES ────────────────────────────────────────────────────────

const DRINK_POOL = {
  hydration: ["water", "sparkling water", "flavored water", "electrolyte drink", "sports drink", "coconut water"],
  energy: ["coffee", "espresso", "cold brew", "black tea", "green tea", "energy drink", "pre-workout", "yerba mate", "iced coffee"],
  fitness: ["protein shake", "smoothie", "meal replacement shake", "electrolyte mix", "amino drink", "creatine water", "chocolate protein shake"],
  comfort: ["chamomile tea", "herbal tea", "hot cocoa", "warm milk", "cider", "sleepy tea"],
  social: ["soda", "juice", "lemonade", "mocktail", "iced tea", "beer", "wine", "hard seltzer", "sparkling cider"],
  alcohol: ["beer", "tequila shot", "vodka soda", "whiskey", "rum and coke", "cocktail", "wine", "straight whiskey", "gin and tonic", "margarita", "champagne"],
  wellness: ["green juice", "kombucha", "protein smoothie", "detox water", "vitamin mix", "collagen drink", "matcha latte"],
};

// ─── SCORING WEIGHTS ─────────────────────────────────────────────────────────

/**
 * Returns a weighted drink category + specific drink based on context.
 * 
 * @param {object} character - full character entity
 * @param {object} location  - current LocationReference (or null)
 * @param {object} options   - { socialContext, recentDrinks, userSettings }
 * @returns {{ drink: string, category: string, narrative: string } | null}
 */
export function decideCharacterDrink(character, location, options = {}) {
  const { socialContext = "alone", recentDrinks = [], userSettings = {} } = options;

  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? "late_night" : hour < 12 ? "morning" : hour < 17 ? "midday" : hour < 21 ? "evening" : "late_night";
  const locCategory = location?.category || "generic";
  const locName = (location?.name || "").toLowerCase();

  // ── Pull character state ──
  const needs = {
    hunger:   character.hunger_value   ?? 70,
    energy:   character.energy_value   ?? 75,
    social:   character.social_value   ?? 65,
    health:   character.health_value   ?? 80,
    mental:   character.mental_value   ?? 70,
    hygiene:  character.hygiene_value  ?? 75,
    comfort:  character.comfort_value  ?? 70,
    financial: parseFloat(userSettings.user_balance ?? character.hunger_value ?? 5000),
  };

  const personality = (character.personality_summary || character.personality_traits?.join(" ") || "").toLowerCase();
  const archetype   = (character.archetype || "").toLowerCase();
  const bio         = (character.background_story || character.backstory || character.profile_summary || "").toLowerCase();
  const health      = (character.health_habits || character.health_status || "").toLowerCase();
  const occupation  = (character.occupation || "").toLowerCase();
  const quirks      = (character.quirks || []).map(q => q.quirk_id?.toLowerCase() || "");

  // ─── GATE: should a drink happen at all? ─────────────────────────────────
  // Skip drinks when character is in intense motion or the scene is not drink-appropriate
  const gymOrSport = ["gym", "sport", "athletic"].includes(locCategory) || locName.includes("gym") || locName.includes("fitness");
  const inTransit  = character.location_status === "traveling";
  const asleep     = character.resolved_presence_status === "sleeping" || character.resolved_presence_status === "napping";

  if (asleep) return null;
  // 30% skip chance on generic scenes with nothing driving a drink
  const driveScore = (needs.energy < 40 ? 1 : 0) + (needs.hunger < 40 ? 1 : 0) + (needs.health < 40 ? 1 : 0);
  if (driveScore === 0 && Math.random() < 0.3) return null;

  // ─── SCORES per category ─────────────────────────────────────────────────
  const scores = {
    hydration: 0,
    energy:    0,
    fitness:   0,
    comfort:   0,
    social:    0,
    alcohol:   0,
    wellness:  0,
  };

  // --- NEEDS BARS ---
  if (needs.energy   < 35) { scores.energy += 5; scores.hydration += 3; }
  if (needs.energy   < 55) { scores.energy += 2; }
  if (needs.hunger   < 40) { scores.fitness += 3; scores.wellness += 2; }
  if (needs.health   < 40) { scores.hydration += 5; scores.wellness += 4; scores.alcohol -= 4; }
  if (needs.mental   < 35) { scores.comfort += 4; scores.alcohol += 2; } // stress → comfort or escape
  if (needs.comfort  < 40) { scores.comfort += 3; }
  // If all good, lean toward social/light options
  if (needs.energy > 70 && needs.health > 70) { scores.social += 2; }

  // --- TIME OF DAY ---
  if (timeOfDay === "morning") {
    scores.energy    += 4;
    scores.hydration += 3;
    scores.fitness   += 2;
    scores.alcohol   -= 6;
    scores.comfort   -= 2;
  }
  if (timeOfDay === "midday") {
    scores.hydration += 3;
    scores.social    += 2;
    scores.energy    += 2;
  }
  if (timeOfDay === "evening") {
    scores.social    += 3;
    scores.alcohol   += 3;
    scores.comfort   += 2;
    scores.energy    -= 3;
  }
  if (timeOfDay === "late_night") {
    scores.alcohol   += 4;
    scores.comfort   += 3;
    scores.hydration += 2;
    scores.energy    -= 5; // no random coffee at midnight
    scores.wellness  -= 2;
  }

  // --- LOCATION ---
  if (gymOrSport) {
    scores.fitness   += 8;
    scores.hydration += 6;
    scores.energy    += 3; // pre-workout only
    scores.alcohol   -= 8;
    scores.comfort   -= 6; // no tea/cocoa at gym
    scores.social    -= 4;
  }
  if (["social", "bar", "nightlife"].includes(locCategory) || locName.includes("bar") || locName.includes("club") || locName.includes("lounge")) {
    scores.alcohol   += 8;
    scores.social    += 5;
    scores.fitness   -= 6;
    scores.wellness  -= 4;
  }
  if (locCategory === "home") {
    scores.comfort   += 4;
    scores.alcohol   += 2;
    scores.hydration += 2;
    scores.fitness   += 1;
  }
  if (locCategory === "workplace") {
    scores.energy    += 4;
    scores.hydration += 3;
    scores.alcohol   -= 6;
    if (timeOfDay !== "morning" && timeOfDay !== "midday") scores.energy -= 3;
  }
  if (locCategory === "food_drink" || locCategory === "restaurant") {
    scores.social    += 4;
    scores.alcohol   += 3;
    scores.hydration += 2;
  }
  if (locCategory === "medical" || locCategory === "hospital") {
    scores.hydration += 6;
    scores.wellness  += 4;
    scores.alcohol   -= 10;
    scores.fitness   -= 4;
  }
  if (locCategory === "religion" || locCategory === "church") {
    scores.alcohol   -= 10;
    scores.social    += 3; // punch, juice
    scores.comfort   += 2;
  }
  if (["outdoor", "park"].includes(locCategory)) {
    scores.hydration += 5;
    scores.social    += 2;
    scores.fitness   += 2;
  }
  if (locCategory === "education" || locCategory === "school") {
    scores.energy    += 3;
    scores.hydration += 3;
    scores.alcohol   -= 8;
  }

  // --- SOCIAL CONTEXT ---
  if (socialContext === "party" || socialContext === "group") {
    scores.alcohol   += 5;
    scores.social    += 4;
  }
  if (socialContext === "date") {
    scores.alcohol   += 3;
    scores.social    += 3;
    scores.comfort   -= 1;
  }
  if (socialContext === "friends") {
    scores.alcohol   += 2;
    scores.social    += 3;
  }
  if (socialContext === "alone") {
    scores.comfort   += 2;
    scores.wellness  += 1;
    scores.alcohol   += 1; // solo drink is still possible
  }

  // --- PERSONALITY / ARCHETYPE ---
  if (/fitness|gym|athlete|health|workout|nutrition|bodybuilder|runner|dancer/.test(personality + archetype + bio + health)) {
    scores.fitness   += 6;
    scores.hydration += 4;
    scores.wellness  += 3;
    scores.alcohol   -= 3;
    scores.comfort   -= 2;
  }
  if (/party|social|outgoing|extrovert|nightlife|club/.test(personality + archetype)) {
    scores.alcohol   += 4;
    scores.social    += 4;
  }
  if (/introvert|homebody|quiet|shy|reserved/.test(personality + archetype)) {
    scores.comfort   += 4;
    scores.social    -= 2;
    scores.alcohol   -= 1;
  }
  if (/anxious|stressed|overwork|overwhelm|burnout/.test(personality + bio)) {
    scores.energy    += 2;
    scores.comfort   += 3;
    scores.alcohol   += 2;
  }
  if (/sober|recovery|recovering|no alcohol|don.t drink|doesn.t drink/.test(bio + health)) {
    scores.alcohol   = -99; // hard block
    scores.social    += 3;
    scores.hydration += 3;
  }
  if (/discipline|structured|routine|mindful|clean/.test(personality + archetype)) {
    scores.hydration += 3;
    scores.fitness   += 2;
    scores.alcohol   -= 2;
  }
  if (/wealthy|luxury|rich|affluent|upscale/.test(bio + occupation)) {
    scores.alcohol   += 2; // premium cocktails, wine
    scores.wellness  += 1;
  }
  if (/broke|struggling|low income|poor|minimum wage/.test(bio)) {
    scores.alcohol   -= 2; // cheap options only
    scores.social    -= 1;
    scores.hydration += 2;
  }

  // ── Quirks ──
  if (quirks.includes("smoker"))     scores.energy  += 1;
  if (quirks.includes("shopaholic")) scores.social  += 1;
  if (quirks.includes("fitness_guru")) { scores.fitness += 5; scores.alcohol -= 3; }

  // --- OCCUPATION ---
  if (/bartender|mixologist|server|nightlife/.test(occupation)) {
    scores.alcohol   += 3;
    scores.social    += 2;
  }
  if (/nurse|doctor|medical|hospital/.test(occupation)) {
    scores.hydration += 2;
    scores.energy    += 2;
    scores.alcohol   -= 2;
  }
  if (/office|analyst|manager|corporate|engineer|developer|accountant/.test(occupation)) {
    scores.energy    += 3; // work coffee
    scores.hydration += 2;
  }

  // --- REPETITION PENALTY ---
  const lastThree = recentDrinks.slice(-3);
  const isCoffeeLoop = lastThree.filter(d => /coffee|espresso|latte|cold brew/.test(d)).length >= 2;
  const isTeaLoop    = lastThree.filter(d => /tea/.test(d)).length >= 2;
  if (isCoffeeLoop) scores.energy    -= 5;
  if (isTeaLoop)    scores.comfort   -= 4;

  // ─── PICK WINNING CATEGORY ────────────────────────────────────────────────
  // Add slight randomness so same state doesn't always produce same pick
  Object.keys(scores).forEach(k => { scores[k] += Math.random() * 1.5; });

  const validCategories = Object.entries(scores)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  if (validCategories.length === 0) return null;

  const [winningCategory] = validCategories[0];
  const pool = DRINK_POOL[winningCategory];
  if (!pool || pool.length === 0) return null;

  // Avoid exact repeat from last drink
  const lastDrink = recentDrinks[recentDrinks.length - 1] || "";
  const filtered = pool.filter(d => d !== lastDrink);
  const candidates = filtered.length > 0 ? filtered : pool;

  const drink = candidates[Math.floor(Math.random() * candidates.length)];

  // ─── NARRATIVE GENERATION ────────────────────────────────────────────────
  const narrative = buildDrinkNarrative(drink, winningCategory, character, timeOfDay, locCategory, socialContext, needs);

  return { drink, category: winningCategory, narrative };
}

// ─── NARRATIVE BUILDER ───────────────────────────────────────────────────────

function buildDrinkNarrative(drink, category, character, timeOfDay, locCategory, socialContext, needs) {
  const name = character.name || "They";
  const he = character.gender === "female" ? "She" : character.gender === "non-binary" ? "They" : "He";
  const his = character.gender === "female" ? "her" : character.gender === "non-binary" ? "their" : "his";

  const isLowEnergy = needs.energy < 45;
  const isLowHealth = needs.health < 45;
  const isStressed  = needs.mental < 45;

  const narratives = {
    hydration: [
      `${he} reaches for water, already overdue on hydration.`,
      `${he} twists open a bottle and drinks half of it in one go.`,
      `${he} grabs a sports drink, still feeling the burn from earlier.`,
      `${he} fills up a glass of water — ${his} body's been running on empty.`,
    ],
    energy: isLowEnergy ? [
      `${he} grabs ${a(drink)}, needing it to actually function right now.`,
      `${he} wraps ${his} hands around ${a(drink)} and takes a long sip — ${he}'s been running on fumes.`,
      `${he} gives in and orders ${a(drink)} because the day isn't close to over.`,
    ] : timeOfDay === "morning" ? [
      `${he} pours ${a(drink)} as part of the morning routine, the smell already doing half the work.`,
      `${he} starts the day with ${a(drink)} — ${he} barely functions without it.`,
    ] : [
      `${he} grabs ${a(drink)} on the way out, not really thinking about it.`,
      `${he} stops for ${a(drink)}, a small decision that still counts as self-care.`,
    ],
    fitness: [
      `${he} shakes up ${a(drink)} and gets it down while ${his} body's still in recovery mode.`,
      `${he} mixes ${a(drink)} automatically — post-workout habit that never wavers.`,
      `${he} downs ${a(drink)}, grimacing slightly at the taste but trusting the process.`,
      `${he} finishes the ${drink} before ${he}'s even left the gym floor.`,
    ],
    comfort: isStressed ? [
      `${he} makes ${a(drink)} and lets the ritual of it quiet everything else down.`,
      `${he} curls up with ${a(drink)}, choosing soft over sharp tonight.`,
    ] : [
      `${he} settles in with ${a(drink)}, letting the day finally slow down.`,
      `${he} pours ${a(drink)} and actually sits with it instead of rushing.`,
    ],
    social: socialContext === "party" || socialContext === "group" ? [
      `${he} grabs ${a(drink)} and falls back into the rhythm of the group.`,
      `${he} holds ${a(drink)}, more about the social ritual than the drink itself.`,
    ] : socialContext === "date" ? [
      `${he} orders ${a(drink)}, wanting the night to feel intentional.`,
    ] : [
      `${he} picks up ${a(drink)}, nothing complicated about it.`,
      `${he} sips ${a(drink)} and lets the conversation carry the rest.`,
    ],
    alcohol: isStressed ? [
      `${he} pours ${a(drink)} and doesn't move from the spot — just holds it and breathes.`,
      `The ${drink} burns a little, but it's quieter than everything else ${he}'s been carrying.`,
    ] : locCategory === "social" || locCategory === "bar" ? [
      `${he} knocks back ${a(drink)}, matching the energy in the room.`,
      `${he} orders ${a(drink)} at the bar and leans in like ${he} owns the night.`,
    ] : [
      `${he} pours ${a(drink)} now that the apartment's finally gone quiet.`,
      `${he} sits with ${a(drink)}, not celebrating anything — just coming down from the day.`,
    ],
    wellness: isLowHealth ? [
      `${he} drinks ${a(drink)} because ${his} body's been asking for it.`,
      `${he} makes ${a(drink)} — not exciting, but ${he} knows ${he} needs it.`,
    ] : [
      `${he} mixes ${a(drink)} and treats it like the small discipline it is.`,
      `${he} drinks ${a(drink)} like it's homework — done without complaint.`,
    ],
  };

  const pool = narratives[category] || [`${he} reaches for ${a(drink)}.`];
  return pool[Math.floor(Math.random() * pool.length)];
}

function a(drink) {
  const vowels = /^[aeiou]/i;
  return (vowels.test(drink) ? "an " : "a ") + drink;
}

// ─── SYSTEM PROMPT INJECTION ─────────────────────────────────────────────────

/**
 * Returns a condensed drink decision block to inject into character system prompts.
 * Tells the LLM the correct drink for THIS character in THIS context.
 * 
 * @param {object} character
 * @param {object} location
 * @param {object} options - { socialContext, recentDrinks, userSettings }
 * @returns {string} - system prompt block (empty string if no drink warranted)
 */
export function buildDrinkContextBlock(character, location, options = {}) {
  const result = decideCharacterDrink(character, location, options);
  if (!result) return "";

  return `\n\nDRINK BEHAVIOR CONTEXT:
The drink decision engine has evaluated this character's current state, location, time, needs, and personality.

DETERMINED DRINK: ${result.drink}
CATEGORY: ${result.category}
REASONING: Context-driven selection based on needs (energy: ${character.energy_value ?? 75}, health: ${character.health_value ?? 80}, mental: ${character.mental_value ?? 70}), time of day, location type (${location?.category || 'unknown'}), and personality profile.

NARRATIVE EXAMPLE:
"${result.narrative}"

RULES FOR DRINK USAGE:
- Only reference this drink if it naturally fits the current conversation or scene
- Do NOT force it — mention it only when there is a logical opening
- Do NOT default to tea or coffee unless the above selection is tea or coffee
- The drink must reflect WHY the character is drinking it right now
- If the conversation has nothing to do with food, drink, or routine, omit it entirely
- Match the drink to the scene visually and emotionally`;
}

/**
 * Returns a comprehensive drink decision rule block for system prompts
 * when the character's specific state isn't available.
 * Used as a lightweight rule injection for LLMs.
 */
export function getDrinkDecisionRules() {
  return `\n\nDRINK BEHAVIOR RULES (APPLY ALWAYS):
CORE RULE: A drink is a behavior decision, not a default. Only mention a drink if there is a clear contextual reason.

DECISION ORDER:
1. Should they be drinking anything right now? (if no clear reason → skip)
2. What category fits? (hydration / energy / fitness / comfort / social / alcohol / wellness)
3. What specific drink fits this character?
4. Does it conflict with location, time, personality, or health?

TIME RULES:
- Morning: water, coffee, tea, smoothie, protein shake — NOT alcohol
- Midday: water, juice, soda, light caffeine — NOT nightlife drinks
- Evening: wine, beer, cocktails, water, soft drinks — coffee only if justified fatigue
- Late night: water, alcohol (if nightlife/coping), calming drinks — NOT random coffee/tea

LOCATION RULES:
- Gym: protein shake, water, electrolytes, pre-workout — NOT tea or wine
- Bar/club: beer, cocktails, shots, soda, mocktails — NOT gym shakes
- Home: flexible, personality-driven — wine, whiskey, tea, water, juice
- Office: coffee (reasonable hours), water — NOT alcohol
- Church: water, juice, punch — NOT alcohol
- Hospital: water, juice — NOT alcohol or gym shakes
- Park/outdoor: water, sports drink, juice — NOT cocktails

PERSONALITY RULES:
- Health-focused → water, protein, electrolytes, green juice
- Party/social → alcohol, cocktails, beer
- Introvert/homebody → tea, wine, water at home
- Stressed/anxious → comfort drink or alcohol (depending on coping style)
- Sober/recovering → NEVER alcohol — water, mocktail, soda, juice
- Disciplined → routine drinks, measured caffeine, hydration habits
- Broke → cheap drinks: water, soda, cheap beer
- Wealthy → premium: cocktails, wine, specialty coffee

FAILURE PATTERNS TO AVOID:
- Tea/coffee as universal defaults in any situation
- Coffee at midnight with no fatigue justification
- Tea after a workout
- Alcohol in church or hospital
- Gym shakes at restaurants
- Same drink used repeatedly without habit justification`;
}