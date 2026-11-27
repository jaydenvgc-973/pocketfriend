/**
 * LOCATION LEADERSHIP — what a Generic parent's authority roles are.
 *
 * Not every Generic location is a property or a business. A city has a mayor, a country has
 * a president or a monarch, a building has an owner or a property manager. The roles offered
 * follow the parent location type the user chose — never the categories of the places inside
 * it, and never an automatic assignment.
 *
 * This module only describes which role choices are appropriate. It assigns nobody, creates
 * nobody, and never changes a location record.
 */
import { getParentLocationType } from './genericParentLocation';

/** The roles every privately owned or managed place already offers. */
export const PROPERTY_ROLES = ['owner', 'landlord', 'manager', 'operator'];

const LEADERSHIP = {
  city: {
    heading: 'City Leadership',
    roles: ['Mayor', 'Deputy Mayor', 'City Manager', 'City Administrator'],
  },
  town: {
    heading: 'Town Leadership',
    roles: ['Mayor', 'Town Supervisor', 'Town Manager'],
  },
  village: {
    heading: 'Village Leadership',
    roles: ['Mayor', 'Village President', 'Village Administrator'],
  },
  neighborhood: {
    heading: 'Community Leadership',
    roles: ['Community Leader', 'Neighborhood Representative', 'Neighborhood Association President'],
  },
  district: {
    heading: 'District Leadership',
    roles: ['District Administrator', 'District Representative', 'District Commissioner'],
  },
  slum: {
    heading: 'Community Leadership',
    roles: ['Community Leader', 'Neighborhood Representative'],
  },
  state: {
    heading: 'Government Leadership',
    roles: ['Governor', 'Lieutenant Governor', 'Premier'],
  },
  country: {
    heading: 'National Leadership',
    roles: ['President', 'Vice President', 'Prime Minister', 'King', 'Queen', 'Monarch', 'Head of State'],
  },
  campus: {
    heading: 'Campus Leadership',
    roles: ['President', 'Chancellor', 'Provost', 'Campus Director'],
  },
  building: {
    heading: 'Owner / Property Management',
    roles: ['Owner', 'Landlord', 'Property Manager', 'Building Manager'],
  },
  property: {
    heading: 'Owner / Property Management',
    roles: ['Owner', 'Landlord', 'Property Manager'],
  },
  complex: {
    heading: 'Ownership / Management',
    roles: ['Owner', 'Property Manager', 'Complex Manager'],
  },
  other: {
    heading: 'Ownership / Management',
    roles: ['Owner', 'Landlord', 'Manager', 'Operator'],
    allowsCustom: true,
  },
};

/**
 * The leadership roles a location may offer, or null when it is not a Generic parent.
 * Null means the existing Owner / Manager controls stay exactly as they are.
 */
export function getLeadershipConfig(location) {
  if (!location || location.category !== 'generic') return null;
  const parent = getParentLocationType(location);
  if (!parent) return null;
  const entry = LEADERSHIP[parent.value] || LEADERSHIP.other;
  return {
    parentType: parent.value,
    parentLabel: parent.label,
    heading: entry.heading,
    roles: entry.roles,
    allowsCustom: !!entry.allowsCustom,
    // A place may legitimately hold more than one leadership position — a mayor and a
    // deputy mayor, a president and a prime minister. Never mandatory.
    allowsMultiple: true,
  };
}

/** Whether a stored role is one of the roles this parent type offers. */
export function isRoleMismatch(config, role) {
  if (!config || !role) return false;
  const wanted = String(role).trim().toLowerCase();
  return !config.roles.some((r) => r.toLowerCase() === wanted);
}

/** A stable id for one leadership assignment row. */
export function newLeadershipAssignmentId() {
  return `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}