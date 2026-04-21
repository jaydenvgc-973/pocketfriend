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
      onClick={() => onClick?.(marker.characterId)}
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

function LocationNode({ location, occupants, onClick }) {
  const [hovered, setHovered] = useState(false);
  const coords = location.map_coordinates;
  if (!coords) return null;

  const colors = getNodeColors(location.category || "generic");
  const label = CATEGORY_LABELS[location.category] || "Place";
  const hasOccupants = occupants.length > 0;

  return (
    <button
      onClick={() => onClick?.(location.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: `${coords.x}%`,
        top: `${coords.y}%`,
        transform: "translate(-50%, -50%)",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        zIndex: 10,
      }}
    >
      <div
        style={{
          minWidth: 64,
          maxWidth: 90,
          padding: "6px 9px",
          borderRadius: 12,
          background: colors.bg,
          boxShadow: hovered
            ? `0 10px 28px rgba(0,0,0,0.13), 0 0 0 2px ${colors.border}`
            : `0 6px 18px rgba(0,0,0,0.07)`,
          border: `${hasOccupants ? "2px" : "1.5px"} solid ${hasOccupants ? colors.border : colors.border + "80"}`,
          transition: "box-shadow 0.15s",
          textAlign: "left",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.text, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {location.name}
        </div>
        <div style={{ fontSize: 9, color: colors.text + "99", marginTop: 1 }}>{label}</div>
        {hasOccupants && (
          <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, color: colors.border }}>
            {occupants.length} here
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * Builds renderable character markers from raw character + location data.
 * HARD RULE: only attaches to resolved_current_location_id — no home fallback.
 */
function buildMarkers(characters, locations) {
  const locationMap = new Map(locations.map((l) => [l.id, l]));
  const markers = [];
  const seenIds = new Set();

  for (const char of characters) {
    if (seenIds.has(char.id)) continue;
    const locId = char.resolved_current_location_id;
    if (!locId) continue; // NO fallback — no location = no marker

    const location = locationMap.get(locId);
    if (!location?.map_coordinates) continue;

    seenIds.add(char.id);
    markers.push({
      characterId: char.id,
      name: char.name,
      type: char.character_type,
      avatarUrl: char.avatar_url || null,
      locationId: locId,
      locationName: location.name,
      coordinates: location.map_coordinates,
      isAsleep: char.resolved_presence_status === "sleeping" || char.resolved_presence_status === "napping",
    });
  }

  return markers;
}

export default function LivePresenceMap({ locations = [], characters = [], onLocationClick, onCharacterClick }) {
  // Group markers by location
  const markers = useMemo(() => buildMarkers(characters, locations), [characters, locations]);

  const groupedByLocation = useMemo(() => {
    const map = new Map();
    for (const m of markers) {
      if (!map.has(m.locationId)) map.set(m.locationId, []);
      map.get(m.locationId).push(m);
    }
    return map;
  }, [markers]);

  const mappedLocations = locations.filter((l) => l.map_coordinates);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 380,
        borderRadius: 18,
        overflow: "hidden",
        background: "linear-gradient(160deg, #f0f6ff 0%, #f8faff 50%, #f0f4f8 100%)",
        border: "1px solid #dde8f5",
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

      {/* Location nodes */}
      {mappedLocations.map((location) => (
        <LocationNode
          key={location.id}
          location={location}
          occupants={groupedByLocation.get(location.id) ?? []}
          onClick={onLocationClick}
        />
      ))}

      {/* Character pins — offset within their location cluster */}
      {markers.map((marker, index) => {
        const siblings = groupedByLocation.get(marker.locationId) ?? [];
        const siblingIndex = siblings.findIndex((s) => s.characterId === marker.characterId);
        const cols = Math.min(siblings.length, 3);
        const col = siblingIndex % cols;
        const row = Math.floor(siblingIndex / cols);
        const offset = {
          x: 12 + col * 18 - (cols * 18) / 2,
          y: -36 - row * 20,
        };

        return (
          <CharacterPin
            key={marker.characterId}
            marker={marker}
            onClick={onCharacterClick}
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
            <div style={{ fontSize: 12, color: "#64748b" }}>No characters with known locations</div>
          </div>
        </div>
      )}
    </div>
  );
}