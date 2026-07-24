/**
 * OCCUPATION IMAGE CONTEXT BUILDER
 *
 * Preserves independent concepts for image generation:
 *   - Occupation (the character's job — e.g., "Manager")
 *   - Workplace (the specific establishment — e.g., "Anderson's Bar")
 *   - Workplace Location Type (what kind of establishment — e.g., "Bar")
 *   - Current Location (the authoritative parent location — e.g., "Escuelita's")
 *   - Current Zone (where the character is inside the parent — e.g., "Bar" zone)
 *   - Available Zones (the real zone list from the location record)
 *   - Current Activity (what the character is doing)
 *
 * Distinguishes:
 *   - "Bar" as a general business type
 *   - "Bar" as a physical counter or surface
 *   - "Bar" as an internal zone (e.g., inside Escuelita's)
 *   - Anderson's Bar as one specific named venue
 *   - Another named venue that contains a Bar zone
 *   - A character's parent location vs current zone inside that parent
 *   - A generic conversational reference to "the bar"
 *   - A contextually established reference to Anderson's Bar
 *
 * Returns { block, context }:
 *   block: prose guidance prepended to the image prompt
 *   context: structured authoritative fields (for validation/logging)
 */

// ── BAR-TYPE VENUE DETECTION ──────────────────────────────────────────────
// Uses the location NAME as the primary signal, NOT the broad "social" category.
// "social" covers community centers, parks, event spaces — not just bars.
// A venue is bar-type only when its name explicitly establishes it.
function isBarTypeVenue(category, name) {
  const nameLower = (name || '').toLowerCase().trim();
  if (!nameLower) return false;
  // Require the location name to contain a bar-type word
  return /\b(bar|nightclub|lounge|pub|tavern|sports bar|club|saloon|taproom|beer garden|cocktail lounge)\b/.test(nameLower);
}

// ── FOOD-SERVICE VENUE DETECTION ──────────────────────────────────────────
function isFoodServiceVenue(category, name) {
  const catLower = (category || '').toLowerCase().trim();
  const nameLower = (name || '').toLowerCase().trim();
  if (catLower === 'food_drink') return true;
  if (/\b(restaurant|diner|cafe|coffee shop|grill|eatery|bistro|kitchen|pub|tavern)\b/.test(nameLower)) return true;
  return false;
}

// ── BAR ZONE DETECTION ─────────────────────────────────────────────────────
// Does the location have a zone named "Bar"? This distinguishes:
//   - Bar as a zone inside a venue (Escuelita's has a "Bar" zone)
//   - Bar as the venue type itself (Anderson's Bar)
function detectBarZone(availableZones) {
  return availableZones.some(zn => {
    const z = zn.toLowerCase().trim();
    return z === 'bar' || z === 'bar area' || z === 'bar counter' || z === 'bar zone';
  });
}

/**
 * Build complete occupation image context.
 *
 * @param {Object} character - The character record (must have occupation, resolved_current_location_id, etc.)
 * @param {Object|null} currentLocation - The LocationReference for character.resolved_current_location_id
 * @param {Object|null} workplaceLocation - The LocationReference for the character's workplace
 * @returns {{ block: string, context: Object|null }}
 */
export function buildOccupationImageContext({ character, currentLocation, workplaceLocation }) {
  if (!character) return { block: '', context: null };

  const occupation = character.occupation || null;
  if (!occupation) return { block: '', context: null };

  // ── 1. AUTHORITATIVE RESOLVED LOCATION ──────────────────────────────
  const resolvedLocId = character.resolved_current_location_id || null;
  const currentLoc = currentLocation || null;
  const currentLocId = currentLoc?.id || resolvedLocId || null;
  const currentLocName = currentLoc?.name || character.resolved_current_location_name || null;
  const currentLocType = currentLoc?.category || null;

  // ── 2. WORKPLACE (employment info — may differ from current location) ──
  const workLocId = character.current_work_location_id || character.occupation_location_id || null;
  const workplace = workplaceLocation || null;
  const workplaceId = workplace?.id || workLocId || null;
  const workplaceName = workplace?.name || character.occupation_location_name || null;
  const workplaceType = workplace?.category || null;

  // ── 3. isAtWork: grounded in authoritative resolved location matching workplace ──
  // FAILURE 8 FIX: Do NOT rely on presenceStatus === 'at_work' alone.
  // Require the resolved current location to match the workplace.
  const isAtWork = !!(workLocId && resolvedLocId && resolvedLocId === workLocId);

  if (!isAtWork) {
    // Character is not at their workplace — the occupation is still their job,
    // but workplace-specific context does not apply to this image.
    return { block: '', context: { occupation, isAtWork: false } };
  }

  // ── 4. AVAILABLE ZONES from the actual location record ──────────────
  // FAILURE 5 FIX: Use the location's real zone list, not a hard-coded generic list.
  const zonesSource = workplace || currentLoc;
  const availableZones = (zonesSource?.zones || [])
    .map(z => z.zone_name)
    .filter(Boolean);

  // ── 5. BAR-TYPE VENUE DETECTION — specific, not broad "social" ──────
  // FAILURE 4 FIX: Don't use "social" category alone as bar-type evidence.
  const isBarVenue = isBarTypeVenue(workplaceType, workplaceName);
  const isFoodVenue = isFoodServiceVenue(workplaceType, workplaceName);

  // ── 6. BAR ZONE DETECTION ────────────────────────────────────────────
  const hasBarZone = detectBarZone(availableZones);

  // ── 7. OCCUPATION CLASSIFICATION ───────────────────────────────────
  const occLower = occupation.toLowerCase().trim();
  const isManager = /\bmanager\b/.test(occLower);
  const isBartender = /\bbartender|barback|bar ?keep|bar ?tender\b/.test(occLower);
  const isWaiter = /\bwaiter|waitress|server|host(ess)?\b/.test(occLower);
  const isCook = /\bcook|chef|line cook|prep cook|kitchen\b/.test(occLower);

  // ── 8. STRUCTURED CONTEXT (authoritative fields) ────────────────────
  // FAILURE 7 FIX: Preserve structured fields, not just prose.
  const structuredContext = {
    occupation,
    isAtWork,
    workplace_id: workplaceId,
    workplace_name: workplaceName,
    workplace_location_type: workplaceType,
    current_location_id: currentLocId,
    current_location_name: currentLocName,
    current_location_type: currentLocType,
    available_zones: availableZones,
    has_bar_zone: hasBarZone,
    is_bar_venue: isBarVenue,
    is_food_drink_venue: isFoodVenue,
    current_activity: character.current_activity || null,
  };

  // ── 9. BUILD PROSE BLOCK ────────────────────────────────────────────
  const currentActivity = character.current_activity || null;
  const block = buildProseBlock({
    structuredContext,
    occupation,
    workplaceName,
    workplaceType,
    currentLocName,
    availableZones,
    hasBarZone,
    isBarVenue,
    isFoodVenue,
    isManager,
    isBartender,
    isWaiter,
    isCook,
    currentActivity,
  });

  return { block, context: structuredContext };
}

function buildProseBlock({
  structuredContext,
  occupation,
  workplaceName,
  workplaceType,
  currentLocName,
  availableZones,
  hasBarZone,
  isBarVenue,
  isFoodVenue,
  isManager,
  isBartender,
  isWaiter,
  isCook,
  currentActivity,
}) {
  const lines = [];
  lines.push(`═══════════════════════════════════════════════════════════`);
  lines.push(`OCCUPATION & WORKPLACE CONTEXT — STRUCTURED FIELDS`);
  lines.push(`═══════════════════════════════════════════════════════════`);
  lines.push(`occupation: ${occupation}`);
  if (workplaceName) lines.push(`workplace_name: ${workplaceName}`);
  if (workplaceType) lines.push(`workplace_location_type: ${workplaceType}`);
  if (currentLocName) lines.push(`current_location_name: ${currentLocName}`);
  if (availableZones.length > 0) lines.push(`available_zones: ${availableZones.join(', ')}`);
  if (currentActivity) lines.push(`current_activity: ${currentActivity}`);
  lines.push(``);
  lines.push(`These are SEPARATE, INDEPENDENT concepts — do NOT collapse them:`);
  lines.push(`  • Occupation = the character's job (what they DO) — e.g., "${occupation}"`);
  lines.push(`  • Workplace = the specific establishment (where they work) — e.g., "${workplaceName || 'N/A'}"`);
  lines.push(`  • Workplace Location Type = what kind of establishment it is — e.g., "${workplaceType || 'N/A'}"`);
  lines.push(`  • Current Zone = where the character is INSIDE the workplace`);
  lines.push(`  • Available Zones = the real zones that exist in this location`);
  lines.push(``);
  lines.push(`⛔ DO NOT change "${occupation}" because of the workplace name or type.`);
  lines.push(`⛔ DO NOT collapse the occupation into the workplace type.`);
  lines.push(`⛔ DO NOT infer a different job from the venue category.`);

  // ── BAR ZONE vs BAR VENUE DISTINCTION ───────────────────────────────
  if (hasBarZone && !isBarVenue) {
    // The location has a zone named "Bar" but is NOT itself a bar venue.
    // e.g., Escuelita's has a "Bar" zone — "Bar" refers to the zone, not Anderson's Bar.
    lines.push(``);
    lines.push(`⚠️ BAR ZONE vs BAR VENUE — CRITICAL DISTINCTION:`);
    lines.push(`This location ("${currentLocName || 'the current location'}") has a zone named "Bar".`);
    lines.push(`"Bar" here identifies an INTERNAL AREA inside "${currentLocName || 'this venue'}".`);
    lines.push(`It does NOT refer to a separate venue called "Anderson's Bar" or any other named bar.`);
    lines.push(`The character has NOT traveled to Anderson's Bar.`);
    lines.push(`The "Bar" zone belongs to "${currentLocName || 'this location'}" — its parent location is "${currentLocName || 'this venue'}".`);
    lines.push(`⛔ Do NOT interpret "Bar" as the name of a different venue.`);
    lines.push(`⛔ Do NOT transport the character to Anderson's Bar or any other named bar.`);
  }
  if (hasBarZone && isBarVenue) {
    lines.push(``);
    lines.push(`⚠️ BAR ZONE AND BAR VENUE:`);
    lines.push(`"${workplaceName || 'this venue'}" is a bar-type venue AND has a zone named "Bar".`);
    lines.push(`The "Bar" zone is an internal area inside "${workplaceName || 'this venue'}".`);
    lines.push(`"Bar" as a zone refers to this internal area — not a different venue.`);
  }

  // ── AVAILABLE ZONES GUIDANCE ───────────────────────────────────────
  if (availableZones.length > 0) {
    lines.push(``);
    lines.push(`AVAILABLE ZONES in this location (derive scene placement from these ONLY):`);
    availableZones.forEach(z => lines.push(`  • ${z}`));
    lines.push(`⛔ Do NOT invent zones that are not listed above.`);
    lines.push(`⛔ Do NOT place the character in a zone that does not exist in this location.`);
    lines.push(`The current zone is determined by the scene description — it must be one of the zones listed above.`);
  }

  // ── OCCUPATION-SPECIFIC GUIDANCE ────────────────────────────────────
  if (isManager && isBarVenue) {
    lines.push(``);
    lines.push(`MANAGER at a BAR-TYPE VENUE — OCCUPATION GUIDANCE:`);
    lines.push(`"${occupation}" is a MANAGER — NOT a Bartender. Do NOT treat them as a bartender.`);
    lines.push(`⛔ DO NOT default to placing them behind the bar counter.`);
    lines.push(`⛔ DO NOT show them preparing/serving drinks unless the current activity explicitly calls for it.`);
    lines.push(``);
    lines.push(`A manager oversees the ENTIRE operation. Derive the scene from management`);
    lines.push(`responsibilities and the available zones listed above — do NOT default to the bar counter.`);
    lines.push(`Valid management scenes use the zones that exist in this location:`);
    availableZones.forEach(z => {
      if (/office/i.test(z)) lines.push(`  • Reviewing schedules, payroll, invoices, or reports in the ${z}`);
      if (/stock|storage|inventory|back/i.test(z)) lines.push(`  • Inspecting inventory or deliveries in the ${z}`);
      if (/kitchen/i.test(z)) lines.push(`  • Checking kitchen operations or food inventory in the ${z}`);
      if (/dining|floor|main|lounge|patio|entrance|bar/i.test(z)) lines.push(`  • Inspecting or walking through the ${z} overseeing operations`);
    });
    lines.push(`  • Resolving customer concerns`);
    lines.push(`  • Supervising opening or closing procedures`);
    lines.push(`  • Speaking with employees before a shift or conducting staff meetings`);
    lines.push(``);
    lines.push(`Bartending should be shown ONLY when the current activity or scene`);
    lines.push(`specifically supports the manager temporarily filling that role.`);
  } else if (isManager && isFoodVenue && !isBarVenue) {
    lines.push(``);
    lines.push(`MANAGER at a FOOD-SERVICE VENUE — OCCUPATION GUIDANCE:`);
    lines.push(`"${occupation}" is a MANAGER — NOT a waiter, server, or host.`);
    lines.push(`⛔ DO NOT default to placing them at a table serving customers.`);
    lines.push(`⛔ DO NOT show them taking orders or carrying food unless explicitly called for.`);
    lines.push(``);
    lines.push(`A manager oversees the ENTIRE operation. Derive the scene from management`);
    lines.push(`responsibilities and the available zones listed above.`);
  } else if (isBartender && isBarVenue) {
    lines.push(``);
    lines.push(`BARTENDER at a BAR-TYPE VENUE — OCCUPATION GUIDANCE:`);
    lines.push(`A bartender's primary responsibilities: preparing drinks, serving customers,`);
    lines.push(`maintaining the bar service area, processing orders and payments.`);
    lines.push(`The bar counter IS the appropriate primary zone for this occupation.`);
    lines.push(`Vary the camera angle and framing — do not repeat the same static viewpoint.`);
  } else if (isWaiter) {
    lines.push(``);
    lines.push(`WAITER/SERVER — OCCUPATION GUIDANCE:`);
    lines.push(`Primary responsibilities: taking orders, serving food and drinks, attending to tables.`);
    lines.push(`Derive the scene from the available zones — dining areas, floor, bar area as appropriate.`);
  } else if (isCook) {
    lines.push(``);
    lines.push(`COOK/CHEF — OCCUPATION GUIDANCE:`);
    lines.push(`Primary responsibilities: food preparation, cooking, kitchen operations.`);
    lines.push(`The kitchen zone is the appropriate primary zone for this occupation.`);
  } else if (isManager) {
    lines.push(``);
    lines.push(`MANAGER — OCCUPATION GUIDANCE:`);
    lines.push(`"${occupation}" is a MANAGER. A manager oversees the ENTIRE operation.`);
    lines.push(`Derive the scene from management responsibilities and the available zones.`);
    lines.push(`Do NOT default to a single zone or a single activity.`);
  } else {
    lines.push(``);
    lines.push(`Derive the scene from the character's occupation responsibilities`);
    lines.push(`and the available zones listed above. Do NOT default to a single zone`);
    lines.push(`or a single activity simply because of the location type.`);
  }

  // ── FOOD-SERVICE PRESERVATION (FAILURE 6 FIX) ───────────────────────
  // Explicitly preserve that bar/food venues can have food service, waiters,
  // kitchens, dining areas. The occupation distinction applies to the CHARACTER,
  // not the venue. Other employees may perform their jobs; customers may order food.
  if (isBarVenue || isFoodVenue) {
    lines.push(``);
    lines.push(`VENUE FUNCTION PRESERVATION — FOOD & DRINK SERVICE:`);
    lines.push(`This venue ("${workplaceName || currentLocName || 'this location'}") supports BOTH drinks and food.`);
    lines.push(`✅ The venue MAY include: waiters, servers, bartenders, kitchen staff, food orders,`);
    lines.push(`   meals, snacks, dining tables, a kitchen, a food menu, food inventory, and customers`);
    lines.push(`   eating at tables or at the bar counter.`);
    lines.push(`✅ Customers may order and eat food here. Dining scenes are valid.`);
    lines.push(`✅ Waiters and servers may appear and perform their established jobs.`);
    lines.push(`✅ The existence of waiters, food orders, kitchen activity, or dining scenes does NOT`);
    lines.push(`   incorrectly turn this bar into a "restaurant" — those are valid functions of this venue.`);
    lines.push(``);
    lines.push(`The occupation distinction above applies to the CHARACTER being depicted —`);
    lines.push(`NOT to the venue's other employees or customers.`);
    if (isManager) {
      lines.push(`✅ The manager may oversee BOTH drink service AND food service operations.`);
      lines.push(`✅ Valid manager scenes involving food service: supervising waiters, reviewing the food`);
      lines.push(`   menu, checking kitchen or food inventory, inspecting food deliveries, resolving a`);
      lines.push(`   customer complaint about a meal, coordinating kitchen and floor staff, reviewing food`);
      lines.push(`   costs or vendor invoices, monitoring food-safety compliance, speaking with kitchen staff.`);
      lines.push(`⛔ The manager must NOT automatically be depicted as the person directly serving every meal.`);
    }
  }

  lines.push(`═══════════════════════════════════════════════════════════`);

  return '\n' + lines.join('\n') + '\n';
}

/**
 * Resolve the workplace location record from the character's work location ID
 * and the provided location map.
 *
 * @param {Object} character - The character record
 * @param {Object|Map} locationMap - Map of locationId → LocationReference
 * @returns {Object|null} The workplace LocationReference, or null
 */
export function resolveWorkplaceLocation(character, locationMap) {
  if (!character || !locationMap) return null;
  const workLocId = character.current_work_location_id || character.occupation_location_id || null;
  if (!workLocId) return null;
  if (locationMap instanceof Map) return locationMap.get(workLocId) || null;
  return locationMap[workLocId] || null;
}

/**
 * Resolve the current location record from the character's resolved_current_location_id
 * and the provided location map.
 *
 * @param {Object} character - The character record
 * @param {Object|Map} locationMap - Map of locationId → LocationReference
 * @returns {Object|null} The current LocationReference, or null
 */
export function resolveCurrentLocation(character, locationMap) {
  if (!character || !locationMap) return null;
  const locId = character.resolved_current_location_id || null;
  if (!locId) return null;
  if (locationMap instanceof Map) return locationMap.get(locId) || null;
  return locationMap[locId] || null;
}