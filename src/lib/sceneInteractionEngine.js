import { REQUIRED_STAFF_ROLES } from './sceneVenueNPCs.js';

/**
 * Scene Interaction Engine — Location-Scoped, Read-Only
 *
 * Rules:
 * - NO invented prices (location config only)
 * - NO invented staff (assigned workers only)
 * - NO invented zones (existing zones only)
 * - NO mutations to location data
 * - Fail visible when data is missing
 * - Workers must be assigned AND on shift
 */

/**
 * Get scene interactions for a location
 * Returns category-specific actions bound to real zones and configured prices
 *
 * @param {Object} location - LocationReference record
 * @param {string} activeZone - Currently active zone name
 * @param {Object} character - Character in scene (null if none)
 * @returns {Array} Interaction objects with zone/price validation
 */
// Subtype sets that map to specific shopping/venue action profiles
const CLOTHING_SUBTYPES = ['clothing', 'boutique', 'apparel', 'thrift', 'thrift_store', 'clothing_store', 'mall', 'department_store', 'shoe_store', 'accessories'];
const BAR_RESTAURANT_SUBTYPES = ['bar', 'restaurant', 'cafe', 'coffee', 'diner', 'fast_food', 'food', 'lounge', 'nightclub', 'pub', 'tavern', 'cocktail_bar', 'wine_bar', 'brewery'];
const SALON_SUBTYPES = ['salon', 'barbershop', 'spa', 'nail_salon', 'beauty_salon'];
const BOOKSTORE_SUBTYPES = ['bookstore', 'record_store', 'electronics_store', 'home_goods', 'toy_store', 'gift_shop'];

/**
 * Resolve the effective venue subtype for action routing.
 * Checks location.subtype array and venue_identity string.
 * Returns one of: 'clothing_store' | 'bar_restaurant' | 'salon' | 'retail_store' | null
 */
function resolveVenueSubtype(location) {
  const subtypes = (location.subtype || []).map(s => s.toLowerCase().replace(/\s+/g, '_'));
  const venueIdentity = (location.venue_identity || '').toLowerCase();
  const nameHint = (location.name || '').toLowerCase();

  if (subtypes.some(s => CLOTHING_SUBTYPES.includes(s)) ||
      CLOTHING_SUBTYPES.some(s => venueIdentity.includes(s)) ||
      CLOTHING_SUBTYPES.some(s => nameHint.includes(s))) {
    return 'clothing_store';
  }
  if (subtypes.some(s => BAR_RESTAURANT_SUBTYPES.includes(s)) ||
      BAR_RESTAURANT_SUBTYPES.some(s => venueIdentity.includes(s)) ||
      BAR_RESTAURANT_SUBTYPES.some(s => nameHint.includes(s))) {
    return 'bar_restaurant';
  }
  if (subtypes.some(s => SALON_SUBTYPES.includes(s)) ||
      SALON_SUBTYPES.some(s => venueIdentity.includes(s))) {
    return 'salon';
  }
  if (subtypes.some(s => BOOKSTORE_SUBTYPES.includes(s))) {
    return 'retail_store';
  }
  return null;
}

export function getSceneInteractions(location, activeZone, character) {
  if (!location) return [];

  const category = location.category || 'generic';
  const venueSubtype = resolveVenueSubtype(location);
  const actions = [];
  const now = new Date();
  const hour = now.getHours();

  // Get location's real zones and workers
  const realZones = (location.zones || []).map(z => z.zone_name);
  const assignedWorkerIds = location.worker_character_ids || [];
  const workerJobTitles = location.worker_job_titles || {};
  const workerShifts = location.worker_shifts || {};

  // Get workers on shift now
  const onShiftWorkerIds = assignedWorkerIds.filter(workerId => {
    const shift = workerShifts[workerId];
    if (!shift) return false;
    const dayOfWeek = now.getDay();
    const inShiftDays = (shift.days || []).includes(dayOfWeek);
    if (!inShiftDays) return false;

    // Time check
    const [startStr, endStr] = [shift.start || '09:00', shift.end || '17:00'];
    const [startHour, startMin] = startStr.split(':').map(Number);
    const [endHour, endMin] = endStr.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const nowMinutes = hour * 60 + now.getMinutes();

    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  });

  // Category-specific actions
  if (category === 'government') {
    actions.push(
      makeAction('📋', 'File Documents', 'government', hour, {
        location,
        realZones,
        requiredZone: 'Records',
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('⚖️', 'Pay Fine', 'government_payment', hour, {
        location,
        realZones,
        requiredZone: 'Payment',
        payer: 'user',
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('📞', 'Speak with Official', 'government', hour, {
        location,
        realZones,
        requiredZone: 'Offices',
        onShiftWorkers: onShiftWorkerIds,
      })
    );
  } else if (category === 'jail_prison') {
    actions.push(
      makeAction('👤', 'Visit Inmate', 'jail_visitation', hour, {
        location,
        realZones,
        requiredZone: 'Visitation',
        visitable: true,
      }),
      makeAction('📝', 'File Paperwork', 'jail', hour, {
        location,
        realZones,
        requiredZone: 'Records',
        onShiftWorkers: onShiftWorkerIds,
      })
    );
  } else if (category === 'hotel') {
    const nightlyRate = location.nightly_rate || null;
    actions.push(
      makeAction('🔑', 'Check In', 'hotel_booking', hour, {
        location,
        realZones,
        requiredZone: 'Front Desk',
        cost: nightlyRate,
        costSource: 'location.nightly_rate',
        payer: 'user',
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('🛏️', 'Go to Room', 'hotel_room', hour, {
        location,
        realZones,
        requiredZone: 'Rooms',
      }),
      makeAction('🍽️', 'Dine', 'hotel_dining', hour, {
        location,
        realZones,
        requiredZone: 'Restaurant',
        onShiftWorkers: onShiftWorkerIds,
      })
    );
  } else if (category === 'shelter') {
    const shelterRate = location.nightly_rate || null;
    actions.push(
      makeAction('🚪', 'Register', 'shelter_checkin', hour, {
        location,
        realZones,
        requiredZone: 'Reception',
        cost: shelterRate,
        costSource: 'location.nightly_rate',
        payer: 'user',
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('🛌', 'Rest', 'shelter_rest', hour, {
        location,
        realZones,
        requiredZone: 'Dormitory',
      })
    );
  } else if (category === 'gym') {
    const membershipFee = location.gym_membership_fee || null;
    actions.push(
      makeAction('💪', 'Work Out', 'gym_exercise', hour, {
        location,
        realZones,
        requiredZone: 'Fitness Area',
      }),
      makeAction('🏊', 'Swim', 'gym_swim', hour, {
        location,
        realZones,
        requiredZone: 'Pool',
      }),
      makeAction('📝', 'Sign Up Membership', 'gym_membership', hour, {
        location,
        realZones,
        requiredZone: 'Front Desk',
        cost: membershipFee,
        costSource: 'location.gym_membership_fee',
        payer: 'user',
        onShiftWorkers: onShiftWorkerIds,
      })
    );
  } else if (category === 'food_drink') {
    const _hasDiningFD = realZones.includes('Dining Area');
    const _hasBarFD = realZones.includes('Bar');
    actions.push(
      makeAction('🍔', 'Order Meal', 'food_order', hour, {
        location,
        realZones,
        ...(_hasDiningFD ? { requiredZone: 'Dining Area' } : {}),
        isPay: true,
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('☕', 'Get Drink', 'food_drink_order', hour, {
        location,
        realZones,
        ...(_hasBarFD ? { requiredZone: 'Bar' } : {}),
        isPay: true,
        onShiftWorkers: onShiftWorkerIds,
      })
    );
  } else if (category === 'social') {
    // RULE: Social/bar/nightclub actions must NEVER be disabled by missing zone config.
    // Zones are optional in social venues. If a zone exists, navigate to it.
    // If it doesn't exist, the action is still fully available — just not zone-locked.
    const hasBar = realZones.includes('Bar');
    const hasDining = realZones.includes('Dining Area');
    const hasDanceFloor = realZones.includes('Dance Floor');
    const hasStage = realZones.includes('Stage');

    actions.push(
      makeAction('🎉', 'Socialize', 'social_mingle', hour, {
        location, realZones,
        // No required zone — always clickable
      }),
      makeAction('🍹', 'Order Drink', 'drink_order', hour, {
        location, realZones,
        ...(hasBar ? { requiredZone: 'Bar' } : {}), // zone-lock only if zone exists
        isPay: true,
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('🍔', 'Order Food', 'food_order', hour, {
        location, realZones,
        ...(hasDining ? { requiredZone: 'Dining Area' } : {}),
        isPay: true,
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('🎵', 'Dance', 'social_dance', hour, {
        location, realZones,
        ...(hasDanceFloor ? { requiredZone: 'Dance Floor' } : {}),
      }),
      makeAction('🎤', 'Perform', 'social_perform', hour, {
        location, realZones,
        ...(hasStage ? { requiredZone: 'Stage' } : {}),
      })
    );
  } else if (category === 'medical') {
    actions.push(
      makeAction('🏥', 'Check In', 'medical_intake', hour, {
        location,
        realZones,
        requiredZone: 'Reception',
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('👨‍⚕️', 'See Doctor', 'medical_visit', hour, {
        location,
        realZones,
        requiredZone: 'Examination',
        onShiftWorkers: onShiftWorkerIds,
      })
    );
  } else if (category === 'education') {
    actions.push(
      makeAction('📚', 'Study', 'education_study', hour, {
        location,
        realZones,
        requiredZone: 'Classroom',
      }),
      makeAction('✏️', 'Take Class', 'education_class', hour, {
        location,
        realZones,
        requiredZone: 'Classroom',
        onShiftWorkers: onShiftWorkerIds,
      })
    );
  } else if (category === 'community') {
    actions.push(
      makeAction('👥', 'Gather', 'community_gather', hour, {
        location,
        realZones,
        requiredZone: 'Main Hall',
      }),
      makeAction('🗣️', 'Attend Event', 'community_event', hour, {
        location,
        realZones,
        requiredZone: 'Event Space',
      })
    );
  } else if (category === 'grocery') {
    actions.push(
      makeAction('🛒', 'Shop', 'grocery_shopping', hour, {
        location,
        realZones,
        requiredZone: 'Store Floor',
        isPay: true,
      }),
      makeAction('💳', 'Checkout', 'grocery_checkout', hour, {
        location,
        realZones,
        requiredZone: 'Checkout',
        isPay: true,
      })
    );
  } else if (category === 'outdoor') {
    actions.push(
      makeAction('🚴', 'Exercise', 'outdoor_exercise', hour, {
        location,
        realZones,
        requiredZone: 'Trails',
      }),
      makeAction('🏞️', 'Explore', 'outdoor_explore', hour, {
        location,
        realZones,
        requiredZone: 'Open Area',
      })
    );
  } else if (category === 'school') {
    actions.push(
      makeAction('📚', 'Attend Class', 'school_class', hour, {
        location,
        realZones,
        requiredZone: 'Classroom',
        onShiftWorkers: onShiftWorkerIds,
      }),
      makeAction('⚽', 'Sports', 'school_sports', hour, {
        location,
        realZones,
        requiredZone: 'Field',
      })
    );
  } else if (category === 'home') {
    actions.push(
      makeAction('🛋️', 'Relax', 'home_relax', hour, {
        location,
        realZones,
        requiredZone: 'Living Room',
      }),
      makeAction('😴', 'Sleep', 'home_sleep', hour, {
        location,
        realZones,
        requiredZone: 'Bedroom',
      })
    );
  } else if (category === 'business') {
    // Route by subtype first — clothing store gets shopping actions, not generic business actions
    if (venueSubtype === 'clothing_store') {
      actions.push(
        makeAction('🛍️', 'Browse Racks', 'clothing_browse', hour, { location, realZones, requiredZone: 'Sales Floor' }),
        makeAction('👗', 'Ask for Size', 'clothing_ask_size', hour, { location, realZones, requiredZone: 'Sales Floor', onShiftWorkers: onShiftWorkerIds }),
        makeAction('🪞', 'Try It On', 'clothing_try_on', hour, { location, realZones, requiredZone: 'Fitting Rooms' }),
        makeAction('💰', 'Ask Price', 'clothing_ask_price', hour, { location, realZones, requiredZone: 'Sales Floor', onShiftWorkers: onShiftWorkerIds }),
        makeAction('🛒', 'Buy Item', 'clothing_buy', hour, { location, realZones, requiredZone: 'Register', onShiftWorkers: onShiftWorkerIds }),
        makeAction('👜', 'Check Accessories', 'clothing_accessories', hour, { location, realZones, requiredZone: 'Accessories' }),
        makeAction('🏷️', 'Go to Register', 'clothing_register', hour, { location, realZones, requiredZone: 'Register', onShiftWorkers: onShiftWorkerIds })
      );
    } else if (venueSubtype === 'bar_restaurant') {
      const _hasBar2 = realZones.includes('Bar');
      const _hasDining2 = realZones.includes('Dining Area');
      const _hasMain2 = realZones.includes('Main Area');
      actions.push(
        makeAction('🍔', 'Order Food', 'food_order', hour, { location, realZones, ...(_hasDining2 ? { requiredZone: 'Dining Area' } : {}), isPay: true, onShiftWorkers: onShiftWorkerIds }),
        makeAction('🍹', 'Order Drink', 'drink_order', hour, { location, realZones, ...(_hasBar2 ? { requiredZone: 'Bar' } : {}), isPay: true, onShiftWorkers: onShiftWorkerIds }),
        makeAction('🎉', 'Socialize', 'social_mingle', hour, { location, realZones, ...(_hasMain2 ? { requiredZone: 'Main Area' } : {}) }),
        makeAction('💳', 'Get Check', 'food_check', hour, { location, realZones, ...(_hasDining2 ? { requiredZone: 'Dining Area' } : {}), onShiftWorkers: onShiftWorkerIds })
      );
    } else if (venueSubtype === 'salon') {
      actions.push(
        makeAction('💇', 'Book Service', 'salon_book', hour, { location, realZones, requiredZone: 'Reception', onShiftWorkers: onShiftWorkerIds }),
        makeAction('✂️', 'Get Cut', 'salon_cut', hour, { location, realZones, requiredZone: 'Styling Area', onShiftWorkers: onShiftWorkerIds })
      );
    } else if (venueSubtype === 'retail_store') {
      actions.push(
        makeAction('🛍️', 'Browse', 'retail_browse', hour, { location, realZones, requiredZone: 'Store Floor' }),
        makeAction('❓', 'Ask Staff', 'retail_ask', hour, { location, realZones, requiredZone: 'Store Floor', onShiftWorkers: onShiftWorkerIds }),
        makeAction('💳', 'Checkout', 'retail_checkout', hour, { location, realZones, requiredZone: 'Checkout', onShiftWorkers: onShiftWorkerIds })
      );
    } else {
      // Generic business fallback
      actions.push(
        makeAction('💼', 'Work', 'business_work', hour, { location, realZones, requiredZone: 'Office', onShiftWorkers: onShiftWorkerIds }),
        makeAction('📊', 'Meet', 'business_meet', hour, { location, realZones, requiredZone: 'Conference Room', onShiftWorkers: onShiftWorkerIds })
      );
    }
  } else if (category === 'religion') {
    actions.push(
      makeAction('🙏', 'Pray', 'religion_pray', hour, {
        location,
        realZones,
        requiredZone: 'Sanctuary',
      }),
      makeAction('📖', 'Study Scripture', 'religion_study', hour, {
        location,
        realZones,
        requiredZone: 'Library',
      })
    );
  } else if (category === 'workplace') {
    actions.push(
      makeAction('💼', 'Work', 'business_work', hour, { location, realZones, requiredZone: 'Office', onShiftWorkers: onShiftWorkerIds }),
      makeAction('📊', 'Meet', 'business_meet', hour, { location, realZones, requiredZone: 'Conference Room', onShiftWorkers: onShiftWorkerIds }),
      makeAction('☕', 'Coffee Break', 'workplace_break', hour, { location, realZones }),
      makeAction('🗣️', 'Check In', 'workplace_checkin', hour, { location, realZones, requiredZone: 'Reception', onShiftWorkers: onShiftWorkerIds })
    );
  } else if (category === 'public') {
    actions.push(
      makeAction('🚶', 'Walk Around', 'outdoor_walk', hour, { location, realZones }),
      makeAction('📸', 'Take Photos', 'outdoor_photo', hour, { location, realZones }),
      makeAction('💬', 'Talk', 'social_mingle', hour, { location, realZones }),
      makeAction('🔍', 'Explore', 'outdoor_explore', hour, { location, realZones })
    );
  } else if (category === 'hotel') {
    // hotel already handled above — this branch never runs, but kept for safety
  }

  // Universal fallback — if no category-specific actions were generated, provide sensible defaults
  // so no location ever has an empty strip.
  if (actions.length === 0) {
    actions.push(
      makeAction('💬', 'Talk', 'social_mingle', hour, { location, realZones }),
      makeAction('👀', 'Look Around', 'outdoor_explore', hour, { location, realZones }),
      makeAction('😄', 'Crack a Joke', 'social_joke', hour, { location, realZones }),
      makeAction('🤔', 'Ask Something', 'social_ask', hour, { location, realZones })
    );
  }

  // Filter and validate all actions
  return actions
    .map(action => validateAction(action))
    .filter(Boolean)
    .slice(0, 8); // Limit to 8 visible actions
}

/**
 * Create action object with context
 */
function makeAction(emoji, label, type, hour, config) {
  return {
    id: `${type}_${Date.now()}`,
    emoji,
    label,
    type,
    hour,
    ...config,
  };
}

/**
 * Validate action against location data
 * Returns null if action cannot be performed (zone missing, price missing, no workers assigned)
 * Otherwise returns action with metadata
 */
function validateAction(action) {
  const {
    type,
    location,
    realZones,
    requiredZone,
    cost,
    costSource,
    payer,
    onShiftWorkers,
  } = action;

  // Zone validation — zone is a NAVIGATION HINT, not a hard requirement.
  // If the zone doesn't exist on the location, the action still works, just without zone-locking.
  // This ensures ALL locations get functional actions regardless of whether zones are configured.
  if (requiredZone) {
    const zoneExists = realZones.includes(requiredZone);
    if (zoneExists) {
      action.suggested_zone_name = requiredZone;
    }
    // If zone doesn't exist: action is still available, just no zone navigation attached.
    // Do NOT disable the action — missing zones are a configuration gap, not a blocker.
  }

  // Price validation for paid actions.
  // If price is not configured, the action is still available — just shown without a cost badge.
  // This ensures actions like "Sign Up Membership" work even if gym_membership_fee is not set.
  // Do NOT disable — missing price is a config gap, not a hard blocker.
  if (cost === null && (action.isPay || type.includes('payment') || type.includes('membership'))) {
    // Show action without price — clear the cost so no "$null" badge appears
    delete action.cost;
    delete action.payer;
    delete action.costSource;
  }

  if (cost !== null && cost !== undefined) {
    action.cost = cost;
    action.payer = payer || 'user';
    action.price_source = costSource || 'unknown';
  }

  // Worker validation for actions requiring staff
  if (type.includes('_payment') || type.includes('_visit') || type.includes('_class') || type.includes('_meet') || type.includes('official') || type.includes('paperwork')) {
    if (onShiftWorkers && onShiftWorkers.length > 0) {
      action.workers_on_shift = onShiftWorkers;
    } else {
      // Show action but indicate no staff
      action.workers_on_shift = [];
      action.no_staff_warning = true;
    }
  }

  // ── ACTION CATEGORY — maps action type → item category for product card routing ──
  // This tells checkImageTrigger what kind of item to generate.
  // Categories: food | drink | clothing | home_goods | hardware | grocery | pharmacy | electronics
  const ACTION_CATEGORY_MAP = {
    // Food & drink venues
    food_order:        'food',
    drink_order:       'drink',
    food_drink_order:  'drink',
    food_check:        'food',
    hotel_dining:      'food',
    // Retail venues
    clothing_buy:      'clothing',
    clothing_register: 'clothing',
    retail_checkout:   'clothing',
    retail_browse:     'clothing',
    // Grocery
    grocery_checkout:  'grocery',
    grocery_shopping:  'grocery',
    // Generic business — subtype determines category at runtime
    business_buy:      'home_goods',   // default; overridden by venue subtype in checkImageTrigger
  };
  if (ACTION_CATEGORY_MAP[type]) {
    action.action_category = ACTION_CATEGORY_MAP[type];
  }

  return action;
}

/**
 * Get location staff presence for "Who's Here" section
 * Returns only assigned workers currently on shift + no placeholders
 */
export function getLocationStaffPresence(location, zone) {
  if (!location) return [];

  const assignedWorkerIds = location.worker_character_ids || [];
  const workerJobTitles = location.worker_job_titles || {};
  const workerShifts = location.worker_shifts || {};

  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();

  const staff = assignedWorkerIds
    .filter(workerId => {
      const shift = workerShifts[workerId];
      if (!shift) return false;

      const inShiftDays = (shift.days || []).includes(dayOfWeek);
      if (!inShiftDays) return false;

      const [startStr, endStr] = [shift.start || '09:00', shift.end || '17:00'];
      const [startHour, startMin] = startStr.split(':').map(Number);
      const [endHour, endMin] = endStr.split(':').map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;
      const nowMinutes = hour * 60 + now.getMinutes();

      return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    })
    .map(workerId => ({
      character_id: workerId,
      job_title: workerJobTitles[workerId] || 'Staff',
      shift: workerShifts[workerId] || {},
    }));

  return staff.length > 0 ? staff : [];
}

/**
 * Get temporary scene staff for a location.
 *
 * Priority order:
 *   1. Real assigned worker on shift → already shown by Scene page, excluded here
 *   2. Real assigned worker off shift → temporary NPC fills their role
 *   3. No assigned worker for required role → temporary NPC fills the role
 *
 * Returns only temporary NPC objects (isTemporary: true) for roles NOT covered by
 * a real worker currently on shift. Does NOT mutate location data.
 *
 * @param {Object} location - LocationReference record
 * @param {Array}  onShiftWorkerIds - IDs already confirmed on shift (exclude from filling)
 * @returns {Array} Temporary NPC staff objects (scene-only, not saved)
 */
export function getTemporarySceneStaff(location, onShiftWorkerIds = []) {
  if (!location) return [];

  const category = location.category || 'generic';
  const requiredRoles = REQUIRED_STAFF_ROLES[category];
  if (!requiredRoles || requiredRoles.length === 0) return [];

  // Home locations never need temp operational staff
  if (category === 'home') return [];

  const assignedWorkerIds = location.worker_character_ids || [];
  const workerJobTitles = location.worker_job_titles || {};
  const workerShifts = location.worker_shifts || {};

  // Workers assigned but not currently on shift
  const offShiftWorkerIds = assignedWorkerIds.filter(id => !onShiftWorkerIds.includes(id));

  // Collect job titles already covered by real on-shift workers
  const coveredRoles = new Set(
    onShiftWorkerIds.map(id => (workerJobTitles[id] || '').toLowerCase()).filter(Boolean)
  );

  const tempStaff = [];

  for (const templateNpc of requiredRoles) {
    const roleKey = templateNpc.role.toLowerCase();

    // Skip if a real on-shift worker already covers this role
    if (coveredRoles.has(roleKey)) continue;

    // Check if an off-shift real worker covers this role — still generate temp NPC for them
    // (real worker is absent; temp fills in until they come back on shift)
    const offShiftCoversRole = offShiftWorkerIds.some(id => {
      const title = (workerJobTitles[id] || '').toLowerCase();
      return title === roleKey || roleKey.includes(title) || title.includes(roleKey);
    });

    // Either off-shift absence or completely unassigned — fill with temp NPC
    tempStaff.push({
      ...templateNpc,
      id: `${templateNpc.id}_tmp_${location.id}`, // unique per-location so multiple locations don't collide
      isTemporary: true,
      temporaryLabel: offShiftCoversRole ? 'Filling in' : 'On duty',
    });
  }

  return tempStaff;
}

/**
 * Resolve zone target for action
 * Returns matched zone name or null if not found
 * NO zone invention — must exist on location record
 */
export function resolveSceneInteractionTargetZone(location, action) {
  if (!location || !action.suggested_zone_name) return null;

  const realZones = (location.zones || []).map(z => z.zone_name);
  const targetZone = action.suggested_zone_name;

  // Exact match required
  if (realZones.includes(targetZone)) {
    return targetZone;
  }

  // No fuzzy matching, no invention
  return null;
}