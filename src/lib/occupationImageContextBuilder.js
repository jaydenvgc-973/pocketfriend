/**
 * OCCUPATION IMAGE CONTEXT BUILDER
 *
 * Separates Occupation, Workplace, Location Type, and Current Zone into independent
 * concepts for image generation. Prevents the image generator from collapsing a
 * character's occupation into the workplace type (e.g., treating a Manager at a
 * bar as a Bartender, or defaulting every manager-at-bar image to behind the bar
 * counter).
 *
 * OCCUPATION answers: "What is this character's job?" (e.g., Manager)
 * WORKPLACE answers: "Where does this character work?" (e.g., Anderson's Bar)
 * LOCATION TYPE answers: "What kind of place is the workplace?" (e.g., Bar)
 * CURRENT ZONE answers: "Where is the character inside the workplace?" (e.g., Office)
 *
 * These concepts MUST remain independent. The occupation never changes because of
 * the workplace. A Manager at a bar is still a Manager — not a "Bar Manager" or
 * Bartender. A Manager at a restaurant is still a Manager — not a "Restaurant Manager."
 *
 * This block is prepended to the image generation prompt so the image provider
 * knows the character's actual job and can derive scenes from occupation
 * responsibilities and available workplace zones rather than defaulting to a
 * single zone (e.g., the bar counter) based solely on the location type.
 */

/**
 * Build the occupation context block for image generation.
 *
 * @param {Object} character - The character record (must have occupation, presence status)
 * @param {Object} workplaceLocation - The resolved workplace LocationReference record (optional)
 * @param {string} currentZoneName - The current zone name (optional)
 * @returns {string} The occupation context block, or empty string if not applicable
 */
export function buildOccupationImageContext({ character, workplaceLocation, currentZoneName }) {
  if (!character) return '';

  const occupation = character.occupation || null;
  if (!occupation) return '';

  // Determine if the character is currently AT their workplace.
  // isAtWork = on shift OR presence status is 'at_work' AND the resolved location
  // matches their workplace.
  const presenceStatus = character.resolved_presence_status || character.location_status || '';
  const workLocId = character.current_work_location_id || character.occupation_location_id || null;
  const resolvedLocId = character.resolved_current_location_id || null;

  const isAtWork = presenceStatus === 'at_work' ||
    (workLocId && resolvedLocId === workLocId);

  if (!isAtWork) return '';

  const workplaceName = workplaceLocation?.name || character.occupation_location_name || null;
  const locationType = workplaceLocation?.category || null;
  const currentActivity = character.current_activity || null;

  const occLower = occupation.toLowerCase().trim();
  const locTypeLower = (locationType || '').toLowerCase().trim();

  const isManager = /\bmanager\b/.test(occLower);
  const isBartender = /\bbartender|barback|bar ?keep|bar ?tender\b/.test(occLower);
  const isBarTypeVenue = locTypeLower === 'social' || /\bbar|nightclub|lounge|pub|tavern|club\b/.test(locTypeLower);
  const isRestaurantType = locTypeLower === 'food_drink' || /\brestaurant|diner|cafe|coffee shop\b/.test(locTypeLower);

  const lines = [];
  lines.push(`═══════════════════════════════════════════════════════════`);
  lines.push(`OCCUPATION CONTEXT — INDEPENDENT CONCEPTS (DO NOT COLLAPSE)`);
  lines.push(`═══════════════════════════════════════════════════════════`);
  lines.push(`OCCUPATION: ${occupation}`);
  if (workplaceName) lines.push(`WORKPLACE: ${workplaceName}`);
  if (locationType) lines.push(`LOCATION TYPE: ${locationType}`);
  if (currentZoneName) lines.push(`CURRENT ZONE: ${currentZoneName}`);
  if (currentActivity) lines.push(`CURRENT ACTIVITY: ${currentActivity}`);
  lines.push(``);
  lines.push(`These are SEPARATE pieces of information:`);
  lines.push(`  • Occupation = the character's job (what they DO)`);
  lines.push(`  • Workplace = the specific establishment (where they work)`);
  lines.push(`  • Location Type = what kind of establishment it is`);
  lines.push(`  • Current Zone = where the character is INSIDE the workplace`);
  lines.push(``);
  lines.push(`⛔ DO NOT collapse the occupation into the workplace type.`);
  lines.push(`⛔ DO NOT change "${occupation}" because of the workplace.`);

  if (isManager && isBarTypeVenue) {
    lines.push(`⛔ "${occupation}" is a MANAGER — NOT a Bartender. Do NOT treat them as a bartender.`);
    lines.push(`⛔ DO NOT default to placing them behind the bar counter.`);
    lines.push(`⛔ DO NOT show them preparing/serving drinks unless the current activity explicitly calls for it.`);
    lines.push(``);
    lines.push(`A manager oversees the ENTIRE operation. Valid management scenes:`);
    lines.push(`  • Reviewing schedules, payroll, invoices, or reports in the office`);
    lines.push(`  • Inspecting inventory in the stock room or storage area`);
    lines.push(`  • Receiving or supervising deliveries`);
    lines.push(`  • Waiting outside for vendors or shipments`);
    lines.push(`  • Counting registers or preparing deposits`);
    lines.push(`  • Speaking with employees before a shift or conducting staff meetings`);
    lines.push(`  • Resolving customer concerns`);
    lines.push(`  • Inspecting the dining room, lounge, patio, entrance, kitchen, or other zones`);
    lines.push(`  • Reviewing compliance documents or vendor orders`);
    lines.push(`  • Supervising opening or closing procedures`);
    lines.push(`  • Walking through the establishment overseeing operations`);
    lines.push(``);
    lines.push(`Bartending should be shown ONLY when the current activity or scene`);
    lines.push(`specifically supports the manager temporarily filling that role.`);
    lines.push(`The bar counter must NOT become the default scene simply because`);
    lines.push(`the workplace is a bar. Use available workplace zones and management`);
    lines.push(`responsibilities to derive the scene.`);
  } else if (isManager && isRestaurantType) {
    lines.push(`⛔ "${occupation}" is a MANAGER — NOT a waiter, server, or host.`);
    lines.push(`⛔ DO NOT default to placing them at a table serving customers.`);
    lines.push(`⛔ DO NOT show them taking orders or carrying food unless explicitly called for.`);
    lines.push(``);
    lines.push(`A restaurant manager oversees the ENTIRE operation. Valid scenes:`);
    lines.push(`  • Reviewing schedules, payroll, or inventory in the office`);
    lines.push(`  • Inspecting the kitchen, stock room, or storage areas`);
    lines.push(`  • Supervising staff or conducting pre-shift meetings`);
    lines.push(`  • Resolving customer concerns on the floor`);
    lines.push(`  • Inspecting the dining room, entrance, patio, or bar area`);
    lines.push(`  • Reviewing compliance, vendor orders, or financial reports`);
    lines.push(`  • Walking through the establishment overseeing operations`);
  } else if (isBartender && isBarTypeVenue) {
    lines.push(`A bartender's primary responsibilities: preparing drinks, serving`);
    lines.push(`customers, maintaining the bar service area, processing orders and`);
    lines.push(`payments, verifying identification, and supporting customer service.`);
    lines.push(`The bar counter IS the appropriate primary zone for this occupation.`);
    lines.push(`However, vary the camera angle and framing — do not repeat the same`);
    lines.push(`static behind-the-bar viewpoint in every image.`);
  } else {
    lines.push(`Derive the scene from the character's occupation responsibilities`);
    lines.push(`and the available workplace zones. Do NOT default to a single zone`);
    lines.push(`or a single activity simply because of the location type.`);
  }
  lines.push(`═══════════════════════════════════════════════════════════`);

  return '\n' + lines.join('\n') + '\n';
}

/**
 * Resolve the workplace location record from the character's work location ID
 * and the provided location map.
 *
 * @param {Object} character - The character record
 * @param {Object|Map} locationMap - Map of locationId → LocationReference (from Chat.jsx)
 * @returns {Object|null} The workplace LocationReference, or null
 */
export function resolveWorkplaceLocation(character, locationMap) {
  if (!character || !locationMap) return null;
  const workLocId = character.current_work_location_id || character.occupation_location_id || null;
  if (!workLocId) return null;
  // locationMap can be a Map or a plain object
  if (locationMap instanceof Map) return locationMap.get(workLocId) || null;
  return locationMap[workLocId] || null;
}