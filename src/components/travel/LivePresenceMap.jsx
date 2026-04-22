import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, MapPin } from "lucide-react";

// ─── Category metadata ────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  home: "Home", workplace: "Business", school: "School",
  gym: "Gym", food_drink: "Food & Drink", bar: "Bar",
  restaurant: "Food & Drink", park: "Park", outdoor: "Outdoor",
  hospital: "Medical", medical: "Medical", clinic: "Medical",
  grocery: "Grocery", church: "Church", religion: "Church",
  social: "Social", community: "Community", government: "Gov't",
  business: "Business", public: "Public", generic: "Place",
};

const CATEGORY_COLORS = {
  home:       { pin: "#3b82f6", dot: "#3b82f6" },
  workplace:  { pin: "#7c3aed", dot: "#7c3aed" },
  school:     { pin: "#ca8a04", dot: "#ca8a04" },
  gym:        { pin: "#16a34a", dot: "#16a34a" },
  food_drink: { pin: "#ea580c", dot: "#ea580c" },
  bar:        { pin: "#a855f7", dot: "#a855f7" },
  restaurant: { pin: "#f97316", dot: "#f97316" },
  park:       { pin: "#059669", dot: "#059669" },
  hospital:   { pin: "#ef4444", dot: "#ef4444" },
  medical:    { pin: "#ef4444", dot: "#ef4444" },
  church:     { pin: "#d97706", dot: "#d97706" },
  social:     { pin: "#ec4899", dot: "#ec4899" },
  grocery:    { pin: "#0891b2", dot: "#0891b2" },
  generic:    { pin: "#64748b", dot: "#64748b" },
};

const CATEGORY_ICONS = {
  home: "🏠", workplace: "🏢", school: "🏫", gym: "💪",
  food_drink: "☕", bar: "🍸", restaurant: "🍽️", park: "🌳",
  hospital: "🏥", medical: "💊", clinic: "🩺", grocery: "🛒",
  church: "⛪", religion: "⛪", social: "🎉", community: "🤝",
  government: "🏛️", business: "💼", public: "🌐", generic: "📍",
};

function getColors(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.generic;
}

// ─── City Map image background ───────────────────────────────────────────────
function CityMapBackground() {
  return (
    <img
      src="https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/689a0904c_file_00000000be4c71fdac83f8c9a646c536.png"
      style={{
        position: "absolute", inset: 0,
        width: "100%", height: "100%",
        objectFit: "cover",
        objectPosition: "center",
        pointerEvents: "none",
      }}
      alt="city map"
    />
  );
}

// ─── UNUSED SVG (kept for reference) ─────────────────────────────────────────
function _CityMapBackgroundSVG_unused() {
  return (
    <svg
      viewBox="0 0 800 420"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="800" height="420" fill="#e8f0dc" />
      <rect x="0" y="0" width="280" height="420" fill="#dcecd0" opacity="0.7" />
      <ellipse cx="80" cy="180" rx="55" ry="40" fill="#c8e0b8" opacity="0.7" />
      <ellipse cx="190" cy="340" rx="45" ry="35" fill="#c0dab0" opacity="0.6" />
      <rect x="285" y="0" width="230" height="420" fill="#e4e0f0" opacity="0.5" />
      <rect x="520" y="0" width="150" height="420" fill="#f0e8d8" opacity="0.5" />
      <rect x="675" y="0" width="125" height="420" fill="#f0d8ec" opacity="0.45" />

      {/* Residential blocks */}
      {[[10,30,58,45],[78,30,55,45],[145,30,52,45],[208,30,58,45],
        [10,100,55,48],[75,100,52,48],[138,100,55,48],[202,100,55,48],
        [10,178,60,45],[80,178,50,45],[140,178,52,45],[202,178,58,45],
        [10,248,55,45],[75,248,55,45],[140,248,52,45],[202,248,58,45],
        [10,320,58,48],[78,320,52,48],[142,320,55,48],[206,320,55,48],
      ].map(([x,y,w,h],i) => (
        <rect key={`rb${i}`} x={x} y={y} width={w} height={h} rx="5" fill="#c8ddb8" stroke="#b0cc9f" strokeWidth="0.8" />
      ))}

      {/* Work blocks */}
      {[[292,28,62,58],[362,28,58,58],[428,28,65,58],
        [292,108,65,55],[365,108,60,55],[433,108,60,55],
        [292,185,62,52],[362,185,65,52],[435,185,58,52],
        [292,258,65,52],[365,258,62,52],[435,258,58,52],
        [292,332,180,55],
      ].map(([x,y,w,h],i) => (
        <rect key={`wb${i}`} x={x} y={y} width={w} height={h} rx="4" fill="#cdc8e8" stroke="#b8b0d8" strokeWidth="0.8" />
      ))}

      {/* Services blocks */}
      {[[528,32,55,50],[590,32,50,50],[528,105,55,50],[590,105,50,50],
        [528,178,55,50],[590,178,50,50],[528,250,55,50],[590,250,50,50],[528,322,112,52],
      ].map(([x,y,w,h],i) => (
        <rect key={`sb${i}`} x={x} y={y} width={w} height={h} rx="4" fill="#e8d0b8" stroke="#d8b89f" strokeWidth="0.8" />
      ))}

      {/* Social blocks */}
      {[[682,32,55,52],[745,32,50,52],[682,108,55,52],[745,108,50,52],
        [682,185,55,52],[745,185,50,52],[682,260,55,52],[745,260,50,52],[682,332,113,52],
      ].map(([x,y,w,h],i) => (
        <rect key={`scb${i}`} x={x} y={y} width={w} height={h} rx="4" fill="#e8c8e0" stroke="#d8a8d0" strokeWidth="0.8" />
      ))}

      {/* Trees */}
      {[[55,82],[120,82],[190,82],[248,82],[40,163],[110,163],[175,163],[240,163],
        [40,232],[105,232],[175,232],[245,232],[40,303],[108,303],[170,303],[240,303],
      ].map(([cx,cy],i) => (
        <circle key={`tr${i}`} cx={cx} cy={cy} r="8" fill="#7abf6a" opacity="0.65" />
      ))}

      {/* Water */}
      <path d="M 0 390 Q 120 370 220 385 Q 320 400 420 378 Q 520 358 620 375 Q 720 390 800 372 L 800 420 L 0 420 Z" fill="#90cdf4" opacity="0.55" />
      <path d="M 0 400 Q 120 385 220 398 Q 320 410 420 392 Q 520 375 620 390 Q 720 405 800 388 L 800 420 L 0 420 Z" fill="#63b3ed" opacity="0.4" />

      {/* Roads — horizontal */}
      <rect x="0" y="85" width="800" height="11" fill="#f5f5f0" opacity="0.92" />
      <rect x="0" y="160" width="800" height="10" fill="#f5f5f0" opacity="0.88" />
      <rect x="0" y="235" width="800" height="10" fill="#f5f5f0" opacity="0.88" />
      <rect x="0" y="308" width="800" height="10" fill="#f5f5f0" opacity="0.85" />
      <rect x="0" y="380" width="800" height="10" fill="#f5f5f0" opacity="0.82" />

      {/* Roads — vertical */}
      <rect x="68" y="0" width="9" height="420" fill="#f5f5f0" opacity="0.85" />
      <rect x="138" y="0" width="8" height="420" fill="#f5f5f0" opacity="0.82" />
      <rect x="205" y="0" width="8" height="420" fill="#f5f5f0" opacity="0.82" />
      <rect x="276" y="0" width="13" height="420" fill="#f8f6f0" opacity="0.95" />
      <rect x="279" y="0" width="2" height="420" fill="#ddd" opacity="0.5" />
      <rect x="355" y="0" width="8" height="420" fill="#f5f5f0" opacity="0.8" />
      <rect x="430" y="0" width="8" height="420" fill="#f5f5f0" opacity="0.8" />
      <rect x="515" y="0" width="13" height="420" fill="#f8f6f0" opacity="0.95" />
      <rect x="518" y="0" width="2" height="420" fill="#ddd" opacity="0.5" />
      <rect x="583" y="0" width="8" height="420" fill="#f5f5f0" opacity="0.8" />
      <rect x="670" y="0" width="13" height="420" fill="#f8f6f0" opacity="0.95" />
      <rect x="673" y="0" width="2" height="420" fill="#ddd" opacity="0.5" />
      <rect x="742" y="0" width="8" height="420" fill="#f5f5f0" opacity="0.8" />

      {/* Road dashes */}
      {[90,165,240,313,385].map(y =>
        [0,70,140,210,280,350,420,490,560,630,700,770].map(x => (
          <rect key={`d${y}-${x}`} x={x+20} y={y+3} width="18" height="1.5" fill="#ccc" opacity="0.5" />
        ))
      )}

      {/* Vignette */}
      <rect width="800" height="420" fill="url(#vig)" />
      <defs>
        <radialGradient id="vig" cx="50%" cy="50%" r="70%">
          <stop offset="55%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.08)" />
        </radialGradient>
      </defs>
    </svg>
  );
}


// ─── Zone tab bar ─────────────────────────────────────────────────────────────
const ZONE_TABS = [
  { label: "HOMES", icon: "🏠", color: "#3b82f6" },
  { label: "WORK / SCHOOL", icon: "💼", color: "#7c3aed" },
  { label: "SERVICES", icon: "⭐", color: "#f59e0b" },
  { label: "SOCIAL", icon: "👥", color: "#ec4899" },
];

// ─── Location dot (small, clickable, always visible) ─────────────────────────
function LocationDot({ location, isActive, onClick }) {
  const coords = location.map_coordinates;
  if (!coords) return null;
  const colors = getColors(location.category || "generic");

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(location.id); }}
      style={{
        position: "absolute",
        left: `${coords.x}%`,
        top: `${coords.y}%`,
        transform: "translate(-50%, -50%)",
        width: isActive ? 14 : 10,
        height: isActive ? 14 : 10,
        borderRadius: "50%",
        background: isActive ? colors.dot : colors.dot + "88",
        border: `2px solid ${isActive ? colors.dot : colors.dot + "55"}`,
        boxShadow: isActive ? `0 0 0 4px ${colors.dot}33, 0 2px 8px rgba(0,0,0,0.2)` : "0 1px 4px rgba(0,0,0,0.15)",
        cursor: "pointer",
        zIndex: 10,
        padding: 0,
        transition: "all 0.15s ease",
      }}
    />
  );
}

// ─── Side detail panel ────────────────────────────────────────────────────────
function LocationDetailPanel({ location, occupants, onClose }) {
  if (!location) return null;
  const colors = getColors(location.category || "generic");
  const label = CATEGORY_LABELS[location.category] || "Place";
  const icon = CATEGORY_ICONS[location.category] || "📍";

  // Pick the first available image — check multiple possible fields
  const locationImage = (() => {
    // Direct image fields
    if (location.image_url) return location.image_url;
    if (location.cover_image_url) return location.cover_image_url;
    if (location.thumbnail_url) return location.thumbnail_url;
    // Zones array
    const zones = location.zones || [];
    for (const zone of zones) {
      const imgs = zone.image_urls || [];
      if (imgs.length > 0) return imgs[0];
      if (zone.image_url) return zone.image_url;
    }
    // Top-level image_urls array
    if (Array.isArray(location.image_urls) && location.image_urls.length > 0) return location.image_urls[0];
    // Photos array
    if (Array.isArray(location.photos) && location.photos.length > 0) return location.photos[0]?.url || location.photos[0];
    return null;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 0, right: 0, bottom: 0,
        width: 230,
        background: "#1a1f2e",
        borderLeft: "1px solid rgba(255,255,255,0.08)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div style={{ padding: "14px 14px 10px", borderBottom: locationImage ? "none" : "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span style={{
                width: 24, height: 24, borderRadius: 6,
                background: colors.pin + "22", border: `1px solid ${colors.pin}44`,
                display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0,
              }}>{icon}</span>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.2 }}>
                {location.name}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{label}</div>
            {occupants.length > 0 && (
              <div style={{ fontSize: 11, color: colors.pin, fontWeight: 700, marginTop: 4 }}>
                {occupants.length} here now
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.08)", border: "none",
            borderRadius: 6, width: 26, height: 26,
            cursor: "pointer", color: "#94a3b8", fontSize: 13,
            display: "grid", placeItems: "center", flexShrink: 0,
          }}>✕</button>
        </div>
      </div>

      {/* Location image */}
      {locationImage && (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <img
            src={locationImage}
            alt={location.name}
            style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }}
          />
        </div>
      )}

      {/* Who's here */}
      {occupants.length > 0 && (
        <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
            Who's here
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {occupants.map(o => (
              <div key={o.characterId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  border: `2px solid ${o.type === "active_created_character" ? "#3b82f6" : "#8b5cf6"}`,
                  overflow: "hidden", flexShrink: 0,
                }}>
                  {o.avatarUrl ? (
                    <img src={o.avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{
                      width: "100%", height: "100%",
                      background: `linear-gradient(135deg, ${o.type === "active_created_character" ? "#3b82f6" : "#8b5cf6"}, #a78bfa)`,
                      display: "grid", placeItems: "center",
                      fontSize: 12, fontWeight: 700, color: "#fff",
                    }}>
                      {o.name[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{o.name}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>
                    {o.isAsleep ? "😴 Sleeping" : label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {occupants.length === 0 && (
        <div style={{ padding: "12px 14px", fontSize: 11, color: "#64748b" }}>No one here right now</div>
      )}

      {/* Details */}
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
          Details
        </div>
        {[
          { key: "Category", val: label, icon: icon },
          { key: "Type", val: location.category || "generic", icon: "🏷️" },
          location.city ? { key: "City", val: location.city, icon: "🌆" } : null,
          location.state ? { key: "State", val: location.state, icon: "📍" } : null,
        ].filter(Boolean).map(row => (
          <div key={row.key} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            paddingTop: 6, paddingBottom: 6,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
              <span>{row.icon}</span>{row.key}
            </div>
            <div style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 500 }}>{row.val}</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Character pin ────────────────────────────────────────────────────────────
function CharacterPin({ marker, onClick, offset }) {
  const [hovered, setHovered] = useState(false);
  const isActive = marker.type === "active_created_character";
  const borderColor = isActive ? "#3b82f6" : "#8b5cf6";

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
        width: 32, height: 32,
        borderRadius: "50%",
        border: `2.5px solid ${borderColor}`,
        background: "#fff",
        boxShadow: hovered
          ? `0 0 0 4px ${borderColor}33, 0 8px 20px rgba(0,0,0,0.22)`
          : `0 3px 10px rgba(0,0,0,0.2), 0 0 0 1.5px ${borderColor}44`,
        overflow: "hidden",
        cursor: "pointer",
        zIndex: 20,
        outline: "none",
        transition: "box-shadow 0.15s",
        padding: 0,
      }}
      title={`${marker.name} @ ${marker.locationName}`}
    >
      {marker.avatarUrl ? (
        <img src={marker.avatarUrl} alt={marker.name}
          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: marker.isAsleep ? 0.45 : 1 }} />
      ) : (
        <div style={{
          width: "100%", height: "100%",
          display: "grid", placeItems: "center",
          fontSize: 13, fontWeight: 700, color: "#fff",
          background: `linear-gradient(135deg, ${borderColor}, ${borderColor}cc)`,
        }}>
          {marker.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      {marker.isAsleep && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.4)" }}>
          <Moon style={{ width: 11, height: 11, color: "#93c5fd" }} />
        </div>
      )}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              position: "absolute",
              bottom: "calc(100% + 7px)",
              left: "50%", transform: "translateX(-50%)",
              background: "#1e293b", color: "#f1f5f9",
              fontSize: 10, fontWeight: 600,
              padding: "3px 8px", borderRadius: 6,
              whiteSpace: "nowrap", pointerEvents: "none", zIndex: 35,
            }}
          >
            {marker.name}
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

// ─── Coordinate / logic (unchanged) ──────────────────────────────────────────
const CATEGORY_ZONES = {
  home:       { xMin: 2,  xMax: 32 },
  workplace:  { xMin: 36, xMax: 62 },
  school:     { xMin: 36, xMax: 62 },
  gym:        { xMin: 65, xMax: 82 },
  hospital:   { xMin: 65, xMax: 82 },
  medical:    { xMin: 65, xMax: 82 },
  clinic:     { xMin: 65, xMax: 82 },
  grocery:    { xMin: 65, xMax: 82 },
  park:       { xMin: 65, xMax: 82 },
  church:     { xMin: 65, xMax: 82 },
  food_drink: { xMin: 84, xMax: 98 },
  bar:        { xMin: 84, xMax: 98 },
  restaurant: { xMin: 84, xMax: 98 },
  social:     { xMin: 84, xMax: 98 },
  community:  { xMin: 84, xMax: 98 },
  generic:    { xMin: 36, xMax: 82 },
};
const Y_MIN = 14;
const Y_MAX = 88;

function buildLocationCoordinateMap(locations) {
  const catGroups = {};
  for (const loc of locations) {
    const cat = loc.category || "generic";
    if (!catGroups[cat]) catGroups[cat] = [];
    catGroups[cat].push(loc);
  }
  const coordMap = {};
  for (const [cat, locs] of Object.entries(catGroups)) {
    const zone = CATEGORY_ZONES[cat] || CATEGORY_ZONES.generic;
    const { xMin, xMax } = zone;
    const sorted = [...locs].sort((a, b) => a.id.localeCompare(b.id));
    const total = sorted.length;
    const zoneWidth = xMax - xMin;
    const zoneHeight = Y_MAX - Y_MIN;
    const cols = Math.max(1, Math.round(Math.sqrt(total * (zoneWidth / zoneHeight))));
    const rows = Math.ceil(total / cols);
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

function resolveCharacterLocation(char) {
  if (char.resolved_current_location_id)
    return { locId: char.resolved_current_location_id };
  if (char.travel_destination_location_id)
    return { locId: char.travel_destination_location_id };
  if (char.resolved_presence_status === "at_work" || char.location_status === "at_location") {
    if (char.current_work_location_id) return { locId: char.current_work_location_id };
    if (char.occupation_location_id) return { locId: char.occupation_location_id };
  }
  if (char.resolved_presence_status === "at_school") {
    if (char.current_school_location_id) return { locId: char.current_school_location_id };
    if (char.education_location_id) return { locId: char.education_location_id };
  }
  if (char.current_home_location_id) return { locId: char.current_home_location_id };
  if (char.current_work_location_id) return { locId: char.current_work_location_id };
  if (char.occupation_location_id) return { locId: char.occupation_location_id };
  return null;
}

function buildMarkers(characters, locations, gridCoords) {
  const locationMap = new Map(locations.map((l) => [l.id, l]));
  const markers = [];
  const seenIds = new Set();
  for (const char of characters) {
    if (seenIds.has(char.id)) continue;
    const resolved = resolveCharacterLocation(char);
    if (!resolved) continue;
    const location = locationMap.get(resolved.locId);
    if (!location) continue;
    const coordinates = gridCoords[location.id];
    if (!coordinates) continue;
    seenIds.add(char.id);
    markers.push({
      characterId: char.id,
      name: char.name,
      type: char.character_type,
      avatarUrl: char.avatar_url || null,
      locationId: resolved.locId,
      locationName: location.name,
      coordinates,
      isAsleep: char.resolved_presence_status === "sleeping" || char.resolved_presence_status === "napping",
    });
  }
  return markers;
}

// ─── Main component ───────────────────────────────────────────────────────────
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
    locations.filter(l => gridCoords[l.id]).map(l => ({ ...l, map_coordinates: gridCoords[l.id] })),
    [locations, gridCoords]
  );

  const activeLocation = allLocations.find(l => l.id === activeLocationId) || null;

  const handleCharacterClick = (characterId) => {
    const marker = markers.find(m => m.characterId === characterId);
    if (marker) setActiveLocationId(prev => prev === marker.locationId ? null : marker.locationId);
    onCharacterClick?.(characterId);
  };

  const handleLocationDotClick = (locationId) => {
    setActiveLocationId(prev => prev === locationId ? null : locationId);
    onLocationClick?.(locationId);
  };

  return (
    <div
      onClick={() => setActiveLocationId(null)}
      style={{
        position: "relative",
        width: "100%",
        height: 420,
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        border: "1px solid rgba(255,255,255,0.1)",
        display: "flex",
      }}
    >
      {/* Map area — shrinks when panel is open */}
      <div style={{
        position: "relative",
        flex: 1,
        height: "100%",
        overflow: "hidden",
        minWidth: 0,
      }}>
        <CityMapBackground />

        {/* Zone tab bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          display: "flex", zIndex: 20,
          background: "rgba(15,20,35,0.82)",
          backdropFilter: "blur(8px)",
        }}>
          {ZONE_TABS.map(tab => (
            <div key={tab.label} style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              gap: 5, padding: "8px 4px",
            }}>
              <span style={{ fontSize: 11 }}>{tab.icon}</span>
              <span style={{ fontSize: 9, fontWeight: 800, color: tab.color, letterSpacing: "0.06em" }}>
                {tab.label}
              </span>
            </div>
          ))}
        </div>

        {/* Location dots — always visible, clickable */}
        {allLocations.map(location => (
          <LocationDot
            key={location.id}
            location={location}
            isActive={location.id === activeLocationId}
            onClick={handleLocationDotClick}
          />
        ))}

        {/* Character pins — one per character, no duplicates */}
        {markers.map((marker) => {
          const siblings = groupedByLocation.get(marker.locationId) ?? [];
          const siblingIndex = siblings.findIndex(s => s.characterId === marker.characterId);
          const cols = Math.min(siblings.length, 3);
          const col = siblingIndex % cols;
          const row = Math.floor(siblingIndex / cols);
          const offset = {
            x: 10 + col * 22 - (cols * 22) / 2,
            y: -18 - row * 24,
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

        {/* Bottom hint */}
        <div style={{
          position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)",
          background: "rgba(15,20,35,0.7)", backdropFilter: "blur(6px)",
          borderRadius: 20, padding: "5px 14px",
          fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: 500,
          pointerEvents: "none", zIndex: 10, whiteSpace: "nowrap",
        }}>
          Tap a character to see their location ℹ️
        </div>

        {/* Empty state */}
        {markers.length === 0 && allLocations.length === 0 && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none", zIndex: 10,
          }}>
            <div style={{
              textAlign: "center",
              background: "rgba(255,255,255,0.88)", borderRadius: 12,
              padding: "14px 20px", boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            }}>
              <MapPin style={{ width: 24, height: 24, margin: "0 auto 6px", color: "#94a3b8" }} />
              <div style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>No locations yet</div>
            </div>
          </div>
        )}
      </div>

      {/* Side detail panel — slides in on right */}
      <AnimatePresence>
        {activeLocation && (
          <LocationDetailPanel
            location={activeLocation}
            occupants={groupedByLocation.get(activeLocation.id) ?? []}
            onClose={() => setActiveLocationId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}