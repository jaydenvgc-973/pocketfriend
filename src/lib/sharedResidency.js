/**
 * Shared residency identity.
 *
 * Gateway House is the one administrator-shared residential property where
 * characters belonging to different user accounts may live together. It is
 * identified by its stable canonical location key — never by name matching.
 */
export const GATEWAY_HOUSE_KEY = "gateway_house";

export function isSharedResidencyLocation(location) {
  return location?.canonical_location_key === GATEWAY_HOUSE_KEY;
}