import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, Briefcase, BookOpen, MapPin, Home } from "lucide-react";
import { assignMapCoordinates } from "@/lib/mapCoordinates";

// Category → label for map node display
const CATEGORY_LABELS = {
  home: "Home",
  workplace: "Work",
  school: "School",
  gym: "Gym",
  food_drink: "Food & Drink",
  bar: "Bar",
  restaurant: "Restaurant",
  park: "Park",
  outdoor: "Outdoor",
  hospital: "Hospital",
  medical: "Medical",
  clinic: "Clinic",
  grocery: "Grocery",
  church: "Church",
  religion: "Church",
  social: "Social",
  community: "Community",
  government: "Gov't",
  business: "Business",
  public: "Public",
  generic: "Place",
};

// Category → node color accent
const CATEGORY_COLORS = {
  home:       { bg: "#e0f2fe", border: "#38bdf8", text: "#0369a1" },
  workplace:  { bg: "#ede9fe", border: "#7c3aed", text: "#5b21b6" },
  school:     { bg: "#fef9c3", border: "#ca8a04", text: "#713f12" },
  gym:        { bg: "#dcfce7", border: "#16a34a", text: "#14532d" },
  food_drink: { bg: "#fff7ed", border: "#ea580c", text: "#7c2d12" },
  bar:        { bg: "#fdf4ff", border: "#a855f7", text: "#6b21a8" },
  restaurant: { bg: "#fff7ed", border: "#f97316", text: "#7c2d12" },
  park:       { bg: "#d1fae5", border: "#059669", text: "#064e3b" },
  hospital:   { bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d" },
  church:     { bg: "#fef3c7", border: "#d97706", text: "#78350f" },
  generic:    { bg: "#f1f5f9", border: "#94a3b8", text: "#334155" },
};

function getNodeColors(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.generic;
}

function CharacterPin({ marker, onClick, offset }) {
  const [hovered, setHovered] = useState(false);
  const isActive = marker.type === "active_created_character";
  const borderColor = isActive ? "#2563eb" : "#8b5cf6";

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(marker.characterId); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: `${marker.coordinates.x}%`,
        top: `${marker.coordinates.y}%`,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: `2.5px solid ${borderColor}`,
        background: "#fff",
        boxShadow: hovered
          ? `0 0 0 3px ${borderColor}33, 0 6px 18px rgba(0,0,0,0.18)`
          : "0 4px 12px rgba(0,0,0,0.14)",
        overflow: "hidden",
        cursor: "pointer",
        zIndex: 20,
        transition: "box-shadow 0.15s",
      }}
      title={`${marker.name} @ ${marker.locationName}`}
    >
      {marker.avatarUrl ? (
        <img
          src={marker.avatarUrl}
          alt={marker.name}
          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: marker.isAsleep ? 0.45 : 1 }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 700,
            color: borderColor,
            background: `${borderColor}18`,
            opacity: marker.isAsleep ? 0.5 : 1,
          }}
        >
          {marker.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      {marker.isAsleep && (
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          background: "rgba(0,0,0,0.35)",
        }}>
          <Moon style={{ width: 12, height: 12, color: "#93c5fd" }} />
        </div>
      )}

      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#1e293b",
              color: "#f1f5f9",
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 7px",
              borderRadius: 6,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 30,
            }}
          >
            {marker.name}
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

// Small dot anchor always shown at a location's position
function LocationDot({ location }) {
  const coords = location.map_coordinates;
  if (!coords) return null;
  const colors = getNodeColors(location.category || "generic");
  return (
    <div
      style={{
        position: "absolute",
        left: `${coords.x}%`,
        top: `${coords.y}%`,
        transform: "translate(-50%, -50%)",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: colors.border + "55",
        border: `1.5px solid ${colors.border}88`,
        pointerEvents: "none",
        zIndex: 5,
      }}
    />
  );
}

// Popup card — shown only for the active location
function LocationPopup({ location, occupants, onClose }) {
  const coords = location.map_coordinates;
  if (!coords) return null;
  const colors = getNodeColors(location.category || "generic");
  const label = CATEGORY_LABELS[location.category] || "Place";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88, y: 6 }}
      transition={{ duration: 0.15 }}
      style={{
        position: "absolute",
        left: `${coords.x}%`,
        top: `${coords.y}%`,
        transform: "translate(-50%, calc(-100% - 14px))",
        zIndex: 40,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          minWidth: 110,
          maxWidth: 150,
          padding: "8px 11px",
          borderRadius: 12,
          background: colors.bg,
          boxShadow: `0 12px 32px rgba(0,0,0,0.16), 0 0 0 2px ${colors.border}`,
          border: `2px solid ${colors.border}`,
          textAlign: "left",
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            position: "absolute", top: 4, right: 6,
            background: "none", border: "none", cursor: "pointer",
            fontSize: 13, color: colors.text + "88", lineHeight: 1, padding: 2,
          }}
          title="Close"
        >✕</button>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.text, lineHeight: 1.3, paddingRight: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {location.name}
        </div>
        <div style={{ fontSize: 9, color: colors.text + "99", marginTop: 1 }}>{label}</div>
        {occupants.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 10, fontWeight: 600, color: colors.border }}>
            {occupants.map(o => o.name).join(", ")}
          </div>
        )}
        {/* Downward arrow */}
        <div style={{
          position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)",
          width: 0, height: 0,
          borderLeft: "7px solid transparent",
          borderRight: "7px solid transparent",
          borderTop: `7px solid ${colors.border}`,
        }} />
      </div>
    </motion.div>
  );
}

// Each category maps to its own exclusive zone bounding box.
// Categories that are semantically similar but distinct each get their own zone.
const CATEGORY_ZONES = {
  home:       { xMin: 2,  xMax: 31 },
  workplace:  { xMin: 34, xMax: 60 },
  school:     { xMin: 34, xMax: 60 },
  gym:        { xMin: 63, xMax: 82 },
  hospital:   { xMin: 63, xMax: 82 },
  medical:    { xMin: 63, xMax: 82 },
  clinic:     { xMin: 63, xMax: 82 },
  grocery:    { xMin: 63, xMax: 82 },
  park:       { xMin: 63, xMax: 82 },
  church:     { xMin: 63, xMax: 82 },
  food_drink: { xMin: 84, xMax: 98 },
  bar:        { xMin: 84, xMax: 98 },
  restaurant: { xMin: 84, xMax: 98 },
  social:     { xMin: 84, xMax: 98 },
  community:  { xMin: 84, xMax: 98 },
  generic:    { xMin: 34, xMax: 82 },
};

// Y band is always the full usable height (avoids top label and bottom edge)
const Y_MIN = 14;
const Y_MAX = 90;

/**
 * Groups all locations (with or without saved coords) by category,
 * then distributes each category's locations into evenly-spaced grid slots
 * across the full zone width and the full Y band.
 *
 * Stability: locations sorted by ID before slot assignment so order never
 * changes between renders unless locations are added/removed.
 *
 * Returns: Map<locationId, {x, y}>
 */
function buildLocationCoordinateMap(locations) {
  // Group by category — ALL locations (including those with map_coordinates,
  // so we can override with the grid system for a consistent layout)
  const catGroups = {}; // cat → loc[]
  for (const loc of locations) {
    const cat = loc.category || "generic";
    if (!catGroups[cat]) catGroups[cat] = [];
    catGroups[cat].push(loc);
  }

  const coordMap = {}; // locationId → {x, y}

  for (const [cat, locs] of Object.entries(catGroups)) {
    const zone = CATEGORY_ZONES[cat] || CATEGORY_ZONES.generic;
    const xMin = zone.xMin;
    const xMax = zone.xMax;

    // Sort by ID for stable, deterministic slot assignment
    const sorted = [...locs].sort((a, b) => a.id.localeCompare(b.id));
    const total = sorted.length;

    // Grid: choose cols to keep aspect ratio reasonable
    // For wide zones prefer more cols; for narrow zones prefer 1-2 cols
    const zoneWidth = xMax - xMin;
    const zoneHeight = Y_MAX - Y_MIN;
    const aspectRatio = zoneWidth / zoneHeight;

    // Target roughly square cells; bias toward more cols for wider zones
    const cols = Math.max(1, Math.round(Math.sqrt(total * aspectRatio)));
    const rows = Math.ceil(total / cols);

    // Divide zone into (cols) columns and (rows) rows
    // Place location anchors at the CENTER of each cell
    const cellW = zoneWidth / cols;
    const cellH = zoneHeight / rows;

    sorted.forEach((loc, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      coordMap[loc.id] = {
        x: Math.round(xMin + col * cellW + cellW / 2),
        y: Math.round(Y_MIN + row * cellH + cellH / 2),
      };
    });
  }

  return coordMap;
}

/**
 * Layered location resolution — tries multiple fields before excluding a character.
 * Returns { locId, source } or null if no location can be determined.
 */
function resolveCharacterLocation(char) {
  // 1. Primary: resolved current location
  if (char.resolved_current_location_id) {
    return { locId: char.resolved_current_location_id, source: "resolved" };
  }
  // 2. Travel destination (actively traveling)
  if (char.travel_destination_location_id) {
    return { locId: char.travel_destination_location_id, source: "travel_destination" };
  }
  // 3. Work location (if currently at work based on status)
  if (
    char.resolved_presence_status === "at_work" ||
    char.location_status === "at_location"
  ) {
    if (char.current_work_location_id) {
      return { locId: char.current_work_location_id, source: "work" };
    }
    if (char.occupation_location_id) {
      return { locId: char.occupation_location_id, source: "occupation" };
    }
  }
  // 4. School location (if at school)
  if (char.resolved_presence_status === "at_school") {
    if (char.current_school_location_id) {
      return { locId: char.current_school_location_id, source: "school" };
    }
    if (char.education_location_id) {
      return { locId: char.education_location_id, source: "education" };
    }
  }
  // 5. Home fallback (housed character with no active location)
  if (char.current_home_location_id) {
    return { locId: char.current_home_location_id, source: "home_fallback" };
  }
  // 6. Work as last resort (character is a worker somewhere)
  if (char.current_work_location_id) {
    return { locId: char.current_work_location_id, source: "work_fallback" };
  }
  if (char.occupation_location_id) {
    return { locId: char.occupation_location_id, source: "occupation_fallback" };
  }
  return null;
}

/**
 * Builds renderable character markers using layered location resolution.
 * Each unique location gets its own stable grid slot.
 * Only characters at the exact same location share a cluster.
 */
function buildMarkers(characters, locations, gridCoords) {
  const locationMap = new Map(locations.map((l) => [l.id, l]));
  const syntheticCoords = gridCoords || buildLocationCoordinateMap(locations);
  const markers = [];
  const seenIds = new Set();

  for (const char of characters) {
    if (seenIds.has(char.id)) continue;

    const resolved = resolveCharacterLocation(char);
    if (!resolved) {
      console.log(`[LivePresenceMap] EXCLUDED "${char.name}": no location source found`);
      continue;
    }

    const { locId, source } = resolved;
    const location = locationMap.get(locId);
    if (!location) {
      console.log(`[LivePresenceMap] EXCLUDED "${char.name}": location ${locId} not in locations list (source: ${source})`);
      continue;
    }

    // Always use the grid-distributed coords (ignore saved map_coordinates
    // so every location is placed by the distribution system, not ad-hoc)
    const coordinates = syntheticCoords[location.id];
    if (!coordinates) {
      console.log(`[LivePresenceMap] EXCLUDED "${char.name}": no grid slot for "${location.name}"`);
      continue;
    }

    console.log(`[LivePresenceMap] RENDERED "${char.name}" @ "${location.name}" slot=(${coordinates.x},${coordinates.y}) source=${source}`);

    seenIds.add(char.id);
    markers.push({
      characterId: char.id,
      name: char.name,
      type: char.character_type,
      avatarUrl: char.avatar_url || null,
      locationId: locId,
      locationName: location.name,
      coordinates,
      isAsleep: char.resolved_presence_status === "sleeping" || char.resolved_presence_status === "napping",
      locationSource: source,
    });
  }

  console.log(`[LivePresenceMap] Summary: ${characters.length} chars considered, ${markers.length} rendered`);
  return markers;
}

export default function LivePresenceMap({ locations = [], characters = [], onLocationClick, onCharacterClick }) {
  const [activeLocationId, setActiveLocationId] = useState(null);

  const gridCoords = useMemo(() => buildLocationCoordinateMap(locations), [locations]);
  const markers = useMemo(() => buildMarkers(characters, locations, gridCoords), [characters, locations, gridCoords]);

  const groupedByLocation = useMemo(() => {
    const map = new Map();
    for (const m of markers) {
      if (!map.has(m.locationId)) map.set(m.locationId, []);
      map.get(m.locationId).push(m);
    }
    return map;
  }, [markers]);

  const allLocations = useMemo(() =>
    locations
      .filter(l => gridCoords[l.id])
      .map(l => ({ ...l, map_coordinates: gridCoords[l.id] })),
    [locations, gridCoords]
  );

  const activeLocation = allLocations.find(l => l.id === activeLocationId) || null;

  // Click a character pin → open its location popup
  const handleCharacterClick = (characterId) => {
    const marker = markers.find(m => m.characterId === characterId);
    if (marker) {
      setActiveLocationId(prev => prev === marker.locationId ? null : marker.locationId);
    }
    onCharacterClick?.(characterId);
  };

  // Click on map background → close popup
  const handleMapClick = () => setActiveLocationId(null);

  return (
    <div
      onClick={handleMapClick}
      style={{
        position: "relative",
        width: "100%",
        height: 380,
        borderRadius: 18,
        overflow: "hidden",
        background: "linear-gradient(160deg, #f0f6ff 0%, #f8faff 50%, #f0f4f8 100%)",
        border: "1px solid #dde8f5",
        cursor: "default",
      }}
    >
      {/* Grid lines */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(to right, rgba(100,130,180,0.06) 1px, transparent 1px), " +
            "linear-gradient(to bottom, rgba(100,130,180,0.06) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          pointerEvents: "none",
        }}
      />

      {/* Zone labels */}
      {[
        { label: "Homes", x: "3%", y: "3%", color: "#0369a1" },
        { label: "Work / School", x: "37%", y: "3%", color: "#5b21b6" },
        { label: "Services", x: "64%", y: "3%", color: "#ef4444" },
        { label: "Social", x: "85%", y: "3%", color: "#ea580c" },
      ].map((z) => (
        <div
          key={z.label}
          style={{
            position: "absolute",
            left: z.x,
            top: z.y,
            fontSize: 9,
            fontWeight: 700,
            color: z.color,
            opacity: 0.45,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            pointerEvents: "none",
          }}
        >
          {z.label}
        </div>
      ))}

      {/* Divider lines between zones */}
      {[33, 62, 83].map((pct) => (
        <div
          key={pct}
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: "8%",
            bottom: "4%",
            width: 1,
            background: "rgba(100,130,180,0.10)",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Faint dot anchors for all locations */}
      {allLocations.map(location => (
        <LocationDot key={location.id} location={location} />
      ))}

      {/* Active location popup — only one at a time */}
      <AnimatePresence>
        {activeLocation && (
          <LocationPopup
            key={activeLocation.id}
            location={activeLocation}
            occupants={groupedByLocation.get(activeLocation.id) ?? []}
            onClose={() => setActiveLocationId(null)}
          />
        )}
      </AnimatePresence>

      {/* Character pins — clicking reveals their location popup */}
      {markers.map((marker) => {
        const siblings = groupedByLocation.get(marker.locationId) ?? [];
        const siblingIndex = siblings.findIndex((s) => s.characterId === marker.characterId);
        const cols = Math.min(siblings.length, 3);
        const col = siblingIndex % cols;
        const row = Math.floor(siblingIndex / cols);
        const offset = {
          x: 12 + col * 18 - (cols * 18) / 2,
          y: -16 - row * 20,
        };

        return (
          <CharacterPin
            key={marker.characterId}
            marker={marker}
            onClick={handleCharacterClick}
            offset={offset}
          />
        );
      })}

      {/* Empty state */}
      {markers.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ textAlign: "center", opacity: 0.4 }}>
            <MapPin style={{ width: 28, height: 28, margin: "0 auto 6px", color: "#94a3b8" }} />
            <div style={{ fontSize: 12, color: "#64748b" }}>No characters placed on map</div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Tap a character pin to see their location</div>
          </div>
        </div>
      )}
    </div>
  );
}