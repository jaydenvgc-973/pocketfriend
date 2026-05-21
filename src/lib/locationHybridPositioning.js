/**
 * locationHybridPositioning.js
 *
 * Hybrid location positioning for the VGC world map.
 *
 * REAL-WORLD locations: use latitude/longitude (approximate neighborhood level).
 * APP-WORLD / VGC FICTIONAL locations: anchored to Greater Paterson / VGC District
 *   using map_x / map_y (0–100 scale) and fictional_region metadata.
 *
 * GEO MODE RULES:
 *   geo_mode = "real_world"  → use latitude / longitude
 *   geo_mode = "app_world"   → use map_x / map_y within VGC fictional grid
 *   geo_mode = "hybrid"      → has both real anchor + fictional overlay
 *   undefined / null         → auto-detect from location fields + category
 *
 * VGC FICTIONAL ANCHOR:
 *   All VGC app-world locations cluster around Greater Paterson, NJ.
 *   anchor_city = "Paterson", anchor_state = "NJ"
 *   fictional_region = "Greater Paterson / VGC District"
 *   map_x / map_y = stable fictional coordinates within the VGC grid
 *
 * REAL-WORLD KNOWN ANCHORS (neighborhood-level, not exact GPS):
 *   Private residences use city-level approximations — no street-level data needed.
 */

// ── KNOWN REAL-WORLD CITY ANCHORS ─────────────────────────────────────────────
// lat/lng represent city/neighborhood center — acceptable for travel time estimation
const CITY_ANCHORS = {
  'paterson':           { lat: 40.9168, lng: -74.1719 },
  'haledon':            { lat: 40.9279, lng: -74.1879 },
  'elmwood park':       { lat: 40.9012, lng: -74.1215 },
  'hawthorne':          { lat: 40.9487, lng: -74.1529 },
  'wayne':              { lat: 40.9290, lng: -74.2260 },
  'clifton':            { lat: 40.8584, lng: -74.1638 },
  'east paterson':      { lat: 40.8921, lng: -74.1237 },
  'fair lawn':          { lat: 40.9404, lng: -74.1318 },
  'newark':             { lat: 40.7357, lng: -74.1724 },
  'east orange':        { lat: 40.7673, lng: -74.2049 },
  'belleville':         { lat: 40.7940, lng: -74.1510 },
  'kearny':             { lat: 40.7682, lng: -74.1454 },
  'west new york':      { lat: 40.7876, lng: -74.0143 },
  'union city':         { lat: 40.7698, lng: -74.0323 },
  'jersey city':        { lat: 40.7178, lng: -74.0431 },
  'hoboken':            { lat: 40.7440, lng: -74.0324 },
  'new york':           { lat: 40.7128, lng: -74.0060 },
  'nyc':                { lat: 40.7128, lng: -74.0060 },
};

// ── VGC FICTIONAL LOCATION MAP_X/MAP_Y TEMPLATES ────────────────────────────
// These are stable fictional coordinates for VGC app-world location categories.
// Individual records should store their own map_x/map_y once assigned.
const VGC_CATEGORY_ZONES = {
  jail_prison:     { xMin: 5,  xMax: 12, yMin: 5,  yMax: 18 },
  home:            { xMin: 10, xMax: 30, yMin: 15, yMax: 85 },
  hotel:           { xMin: 20, xMax: 35, yMin: 20, yMax: 50 },
  shelter:         { xMin: 8,  xMax: 20, yMin: 55, yMax: 80 },
  workplace:       { xMin: 35, xMax: 60, yMin: 10, yMax: 35 },
  school:          { xMin: 35, xMax: 60, yMin: 38, yMax: 55 },
  education:       { xMin: 35, xMax: 60, yMin: 38, yMax: 55 },
  hospital:        { xMin: 62, xMax: 80, yMin: 10, yMax: 28 },
  medical:         { xMin: 62, xMax: 80, yMin: 10, yMax: 28 },
  grocery:         { xMin: 62, xMax: 80, yMin: 45, yMax: 60 },
  gym:             { xMin: 62, xMax: 80, yMin: 62, yMax: 78 },
  park:            { xMin: 35, xMax: 60, yMin: 62, yMax: 85 },
  outdoor:         { xMin: 35, xMax: 60, yMin: 62, yMax: 85 },
  religion:        { xMin: 84, xMax: 96, yMin: 15, yMax: 35 },
  food_drink:      { xMin: 84, xMax: 96, yMin: 40, yMax: 78 },
  social:          { xMin: 84, xMax: 96, yMin: 40, yMax: 78 },
  generic:         { xMin: 30, xMax: 92, yMin: 15, yMax: 85 },
};

/**
 * Determines the geo_mode for a location if not explicitly set.
 */
export function inferGeoMode(location) {
  if (location.geo_mode) return location.geo_mode;
  // Has real lat/lng → real_world
  if (location.latitude && location.longitude) return 'real_world';
  // Has fictional map coords → app_world
  if (location.map_x != null && location.map_y != null) return 'app_world';
  // VGC Towers and known VGC names → app_world
  const nameLower = (location.name || '').toLowerCase();
  if (nameLower.includes('vgc') || nameLower.includes('jail') || nameLower.includes('prison')) return 'app_world';
  // Has an anchor_city → real_world (city-level)
  if (location.anchor_city) return 'real_world';
  return 'app_world'; // Default to VGC world
}

/**
 * Returns lat/lng for a location, using real coords or city anchor fallback.
 * Returns null if cannot determine.
 */
export function getLocationLatLng(location) {
  if (!location) return null;
  const mode = inferGeoMode(location);

  if (mode === 'real_world') {
    if (location.latitude && location.longitude) {
      return { lat: location.latitude, lng: location.longitude };
    }
    // Try city anchor
    const cityKey = (location.anchor_city || location.city || '').toLowerCase().trim();
    if (cityKey && CITY_ANCHORS[cityKey]) {
      return { ...CITY_ANCHORS[cityKey], is_approximate: true };
    }
  }
  return null;
}

/**
 * Returns normalized (0–100) map_x/map_y for a location.
 * Used for the VGC fictional world map.
 * Returns the stored values if present, otherwise assigns from zone template.
 */
export function getLocationMapXY(location) {
  if (!location) return null;
  if (location.map_x != null && location.map_y != null) {
    return { x: location.map_x, y: location.map_y };
  }
  // Assign from zone based on category
  const cat = location.category || 'generic';
  const zone = VGC_CATEGORY_ZONES[cat] || VGC_CATEGORY_ZONES.generic;
  // Deterministic from location ID to prevent re-jitter
  const seed = (location.id || location.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const x = zone.xMin + (seed % 1000) / 1000 * (zone.xMax - zone.xMin);
  const y = zone.yMin + ((seed * 7) % 1000) / 1000 * (zone.yMax - zone.yMin);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, is_assigned: true };
}

/**
 * Returns VGC app-world defaults for a fictional location.
 * Used when creating or upgrading fictional location records.
 */
export function getVGCAppWorldDefaults(location) {
  const xy = getLocationMapXY(location);
  return {
    geo_mode:         'app_world',
    anchor_city:      'Paterson',
    anchor_state:     'NJ',
    fictional_region: 'Greater Paterson / VGC District',
    map_x:            xy?.x ?? 50,
    map_y:            xy?.y ?? 50,
  };
}

/**
 * Returns a display label for a location's positioning quality.
 */
export function getPositioningQualityLabel(location) {
  if (!location) return 'Unknown position';
  const mode = inferGeoMode(location);
  if (mode === 'real_world' && location.latitude && location.longitude) {
    return null; // Accurate — no disclaimer
  }
  if (mode === 'real_world' && location.anchor_city) {
    return `Approximate — ${location.anchor_city} area`;
  }
  if (mode === 'app_world' && location.map_x != null) {
    return null; // VGC coordinates — accurate for VGC world
  }
  return 'Approximate travel — location is not fully positioned';
}

export { CITY_ANCHORS, VGC_CATEGORY_ZONES };