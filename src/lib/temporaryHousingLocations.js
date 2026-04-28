/**
 * PHASE 3A: Temporary Housing Location Helpers
 * 
 * These helpers find or create one temporary housing location per owner.
 * Identity is based on stable system_location_role field, not location name.
 * Does NOT assign characters or write to Character records.
 */

import { base44 } from '@/api/base44Client';

/**
 * Get or create the Temporary Hotel location for an owner.
 * 
 * Query by owner_email + is_system_managed + system_location_role.
 * If found: return existing location ID.
 * If not found: create one new location.
 * 
 * @param {string} owner_email - The user's email (owner_email field)
 * @returns {Promise<string>} Location ID for temporary hotel
 */
export async function getOrCreateTemporaryHotelLocation(owner_email) {
  // Query for existing hotel location by stable fields
  const existing = await base44.entities.LocationReference.filter({
    owner_email,
    is_system_managed: true,
    system_location_role: 'temporary_hotel',
  });

  if (existing.length > 0) {
    // Reuse first match
    return existing[0].id;
  }

  // Create new hotel location
  const newHotel = await base44.entities.LocationReference.create({
    name: 'Temporary Hotel',
    location_type: 'account_global',
    category: 'generic',
    scope: 'account_global',
    owner_email,
    visibility_scope: 'account_private',
    is_system_managed: true,
    system_location_role: 'temporary_hotel',
    is_default_generic: false,
    zones: [
      {
        zone_name: 'Main Area',
        image_urls: [],
      },
    ],
    description: 'System-created temporary housing location for emergency hotel stays',
  });

  return newHotel.id;
}

/**
 * Get or create the Emergency Shelter location for an owner.
 * 
 * Query by owner_email + is_system_managed + system_location_role.
 * If found: return existing location ID.
 * If not found: create one new location.
 * 
 * @param {string} owner_email - The user's email (owner_email field)
 * @returns {Promise<string>} Location ID for emergency shelter
 */
export async function getOrCreateEmergencyShelterLocation(owner_email) {
  // Query for existing shelter location by stable fields
  const existing = await base44.entities.LocationReference.filter({
    owner_email,
    is_system_managed: true,
    system_location_role: 'emergency_shelter',
  });

  if (existing.length > 0) {
    // Reuse first match
    return existing[0].id;
  }

  // Create new shelter location
  const newShelter = await base44.entities.LocationReference.create({
    name: 'Emergency Shelter',
    location_type: 'account_global',
    category: 'generic',
    scope: 'account_global',
    owner_email,
    visibility_scope: 'account_private',
    is_system_managed: true,
    system_location_role: 'emergency_shelter',
    is_default_generic: false,
    zones: [
      {
        zone_name: 'Main Area',
        image_urls: [],
      },
    ],
    description: 'System-created emergency shelter location for characters without funds',
  });

  return newShelter.id;
}