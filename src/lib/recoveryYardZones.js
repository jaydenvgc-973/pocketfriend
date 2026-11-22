/**
 * VGC Recovery Yard — zone authority.
 *
 * The Recovery Yard is a system-managed facility operated by Vick Servicio. Its own
 * operating zones belong to the facility: an account may add zones of its own to the
 * property and save them normally, but it may not change, replace or remove the
 * facility's zones. Administrators keep full control of every zone.
 */
export const RECOVERY_YARD_LOCKED_ZONES = [
  'Recovery Warehouse',
  'Inspection & Review Area',
  'Restoration & Repair Workshop',
  'Quarantine Storage',
  'Archive Storage',
  'Administrative Offices',
  'Residential Suite',
];

const normalize = (name) => String(name ?? '').trim().toLowerCase();

/** Is this record the VGC Recovery Yard? */
export function isRecoveryYard(location) {
  if (!location) return false;
  return (
    normalize(location.name) === 'vgc recovery yard' ||
    (location.is_system_managed === true && normalize(location.owner_npc_name) === 'vick servicio')
  );
}

/** May this zone be edited by this user? The facility's own zones are admins-only. */
export function isLockedRecoveryYardZone(location, zoneName, isAdmin = false) {
  if (isAdmin || !isRecoveryYard(location)) return false;
  return RECOVERY_YARD_LOCKED_ZONES.some((name) => normalize(name) === normalize(zoneName));
}

/** The facility zone names, or none when this user may edit freely. */
export function lockedRecoveryYardZoneNames(location, isAdmin = false) {
  return isAdmin || !isRecoveryYard(location) ? [] : RECOVERY_YARD_LOCKED_ZONES;
}

/**
 * The zones a save may write. The facility's own zones come from what the property
 * already stores — never from what the save submitted — and can never be dropped.
 * Zones the account added pass through untouched.
 */
export function withLockedRecoveryYardZones(location, zones, isAdmin = false) {
  if (isAdmin || !isRecoveryYard(location)) return zones;
  const locked = (location.zones || []).filter((zone) =>
    isLockedRecoveryYardZone(location, zone.zone_name, false)
  );
  if (locked.length === 0) return zones;

  const lockedByName = new Map(locked.map((zone) => [normalize(zone.zone_name), zone]));
  const kept = (zones || []).map((zone) => lockedByName.get(normalize(zone.zone_name)) || zone);
  const present = new Set(kept.map((zone) => normalize(zone.zone_name)));
  locked.forEach((zone) => {
    if (!present.has(normalize(zone.zone_name))) kept.push(zone);
  });
  return kept;
}