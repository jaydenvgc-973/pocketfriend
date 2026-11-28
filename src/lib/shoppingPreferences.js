/**
 * shoppingPreferences.js — WHAT THIS STORE VISIT IS FOR
 *
 * A shopping visit has a purpose the shopper states before anything is offered. This file
 * resolves which actual business the scene is inside, what that business sells, and keeps
 * the stated preferences with that destination for the current visit.
 *
 * It reuses the app's existing classifications only:
 *   - the store's own assigned Venue Types (a workplace's business types, or a standalone
 *     location's subtype) and venueMerchandise's existing retail mapping,
 *   - the existing outfit category list (outfitRotationEngine).
 *
 * It creates no store, no venue type, no merchandise category and no record. Preferences are
 * a visit's purpose, never a purchase: nothing here charges, owns or generates anything.
 */
import { getActiveSceneSpaceId } from '@/lib/activeSceneSpace';
import { getWorkplaceById } from '@/lib/locationWorkspaces';
import { workplaceVenueSubtypes } from '@/lib/actionGenerator';
import { merchandiseFamiliesForVenue, MERCHANDISE_FAMILIES, MERCHANDISE_FAMILY_LABELS, PET_TYPE_OPTIONS, VEHICLE_TYPE_OPTIONS } from '@/lib/venueMerchandise';
import { OUTFIT_CATEGORIES } from '@/lib/outfitRotationEngine';

function normalizeTypes(types) {
  const raw = Array.isArray(types) ? types : [types];
  return raw.filter(Boolean).map((t) => String(t).toLowerCase().replace(/[\s\-&]+/g, '_').replace(/_+/g, '_'));
}

/** A readable name for each venue type, from the value the store actually carries. */
export function venueTypeLabel(type) {
  return String(type || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * THE ACTUAL RETAIL DESTINATION.
 *
 * The space on screen decides, never the property that merely contains it:
 *   - a workplace selected inside a property is that business (its own venue types only),
 *   - any other space inside a property (an apartment, a room) is not the store,
 *   - with no space selected, the location itself is the destination.
 * A destination with no retail venue type is not a retail destination at all.
 */
export function resolveShoppingDestination(location, spaceId = undefined) {
  if (!location?.id) return null;
  const activeSpaceId = spaceId === undefined ? getActiveSceneSpaceId() : spaceId;
  const workplace = getWorkplaceById(location, activeSpaceId);

  // A space inside the property that is not this store is not the store.
  if (activeSpaceId && !workplace) return null;

  const venueTypes = workplace ? workplaceVenueSubtypes(workplace) : normalizeTypes(location.subtype);
  const families = merchandiseFamiliesForVenue(venueTypes);
  if (families.length === 0) return null;

  return {
    key: `${location.id}|${workplace?.workplace_id || 'location'}`,
    storeName: workplace?.name || location.name,
    venueTypes: [...new Set(venueTypes)],
    families,
    workplaceId: workplace?.workplace_id || null,
    isWorkspace: !!workplace,
  };
}

/**
 * The selectors this destination actually supports.
 *   outfitCategories — the existing outfit categories, offered when the store sells anything
 *                      worn (clothing, footwear, accessories). Empty otherwise.
 *   families         — the store's own merchandise types, each an existing family.
 */
export function shoppingSelectorsFor(destination) {
  if (!destination) return { outfitCategories: [], families: [], petTypes: [], vehicleTypes: [] };
  const sellsWearables = destination.families.some((f) => MERCHANDISE_FAMILIES[f]?.category === 'clothing');
  return {
    outfitCategories: sellsWearables ? OUTFIT_CATEGORIES : [],
    families: destination.families.map((f) => ({ key: f, label: MERCHANDISE_FAMILY_LABELS[f] || venueTypeLabel(f) })),
    // A pet store asks what kind of animal; a dealership asks what kind of vehicle. Both
    // describe the type being looked for — never a brand or a manufacturer.
    petTypes: destination.families.includes('pets') ? PET_TYPE_OPTIONS : [],
    vehicleTypes: destination.families.includes('vehicles') ? VEHICLE_TYPE_OPTIONS : [],
  };
}

const storageKey = (destinationKey) => `shopping_prefs_${destinationKey}`;

/** The preferences already confirmed for this destination in this visit, if any. */
export function readShoppingPreferences(destinationKey) {
  if (!destinationKey) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(destinationKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      families: Array.isArray(parsed.families) ? parsed.families : [],
      petTypes: Array.isArray(parsed.petTypes) ? parsed.petTypes : [],
      vehicleTypes: Array.isArray(parsed.vehicleTypes) ? parsed.vehicleTypes : [],
      note: typeof parsed.note === 'string' ? parsed.note : '',
    };
  } catch {
    return null;
  }
}

export function saveShoppingPreferences(destinationKey, preferences) {
  if (!destinationKey) return;
  try { sessionStorage.setItem(storageKey(destinationKey), JSON.stringify(preferences)); } catch { /* visit only */ }
}

export function clearShoppingPreferences(destinationKey) {
  if (!destinationKey) return;
  try { sessionStorage.removeItem(storageKey(destinationKey)); } catch { /* visit only */ }
}

/** True when the shopper actually stated something. */
export function hasShoppingPreferences(preferences) {
  if (!preferences) return false;
  return (preferences.categories?.length || 0) > 0
    || (preferences.families?.length || 0) > 0
    || (preferences.petTypes?.length || 0) > 0
    || (preferences.vehicleTypes?.length || 0) > 0
    || !!String(preferences.note || '').trim();
}

/** The confirmed purpose, in words the scene can be given. Never a purchase. */
export function shoppingPreferenceSummary(preferences, destination) {
  if (!hasShoppingPreferences(preferences)) return '';
  const parts = [];
  if (preferences.categories?.length > 0) {
    const labels = preferences.categories
      .map((value) => OUTFIT_CATEGORIES.find((c) => c.value === value)?.label)
      .filter(Boolean);
    if (labels.length > 0) parts.push(`styles: ${labels.join(', ')}`);
  }
  if (preferences.families?.length > 0) {
    const labels = preferences.families
      .map((f) => MERCHANDISE_FAMILY_LABELS[f] || venueTypeLabel(f));
    if (labels.length > 0) parts.push(`looking at: ${labels.join(', ')}`);
  }
  if (preferences.petTypes?.length > 0) {
    const labels = preferences.petTypes.map((t) => PET_TYPE_OPTIONS.find((o) => o.value === t)?.label).filter(Boolean);
    if (labels.length > 0) parts.push(`kind of animal: ${labels.join(', ')}`);
  }
  if (preferences.vehicleTypes?.length > 0) {
    const labels = preferences.vehicleTypes.map((t) => VEHICLE_TYPE_OPTIONS.find((o) => o.value === t)?.label).filter(Boolean);
    if (labels.length > 0) parts.push(`kind of vehicle: ${labels.join(', ')}`);
  }
  const note = String(preferences.note || '').trim();
  if (note) parts.push(`in their own words: "${note}"`);
  const store = destination?.storeName ? ` at ${destination.storeName}` : '';
  return `The shopper said what they are looking for${store} — ${parts.join('; ')}. Nothing has been bought yet.`;
}