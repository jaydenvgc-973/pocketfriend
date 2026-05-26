import React, { useMemo, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { calcLocationGravity } from "@/lib/locationGravity";

// ─── Category metadata ────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  home: "Home", workplace: "Business", school: "School",
  gym: "Gym", food_drink: "Food & Drink", bar: "Bar",
  restaurant: "Food & Drink", park: "Park", outdoor: "Outdoor",
  hospital: "Medical", medical: "Medical", clinic: "Medical",
  grocery: "Grocery", church: "Church", religion: "Church",
  social: "Social", community: "Community", government: "Gov't",
  business: "Business", public: "Public", generic: "Place",
  jail_prison: "Jail / Prison",
};

const CATEGORY_COLORS = {
  home:        { pin: "#3b82f6", dot: "#3b82f6" },
  workplace:   { pin: "#7c3aed", dot: "#7c3aed" },
  school:      { pin: "#ca8a04", dot: "#ca8a04" },
  gym:         { pin: "#16a34a", dot: "#16a34a" },
  food_drink:  { pin: "#ea580c", dot: "#ea580c" },
  bar:         { pin: "#a855f7", dot: "#a855f7" },
  restaurant:  { pin: "#f97316", dot: "#f97316" },
  park:        { pin: "#059669", dot: "#059669" },
  hospital:    { pin: "#ef4444", dot: "#ef4444" },
  medical:     { pin: "#ef4444", dot: "#ef4444" },
  church:      { pin: "#d97706", dot: "#d97706" },
  social:      { pin: "#ec4899", dot: "#ec4899" },
  grocery:     { pin: "#0891b2", dot: "#0891b2" },
  generic:     { pin: "#64748b", dot: "#64748b" },
  jail_prison: { pin: "#475569", dot: "#475569" },
};

const CATEGORY_ICONS = {
  home: "🏠", workplace: "🏢", school: "🏫", gym: "💪",
  food_drink: "☕", bar: "🍸", restaurant: "🍽️", park: "🌳",
  hospital: "🏥", medical: "💊", clinic: "🩺", grocery: "🛒",
  church: "⛪", religion: "⛪", social: "🎉", community: "🤝",
  government: "🏛️", business: "💼", public: "🌐", generic: "📍",
  jail_prison: "🏛️",
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

// ─── Location dot (small, clickable, gravity-aware) ──────────────────────────
function LocationDot({ location, isActive, onClick, occupants = 0 }) {
  const coords = location.map_coordinates;
  if (!coords) return null;
  const colors = getColors(location.category || "generic");
  const { gravity, color: gravColor, pulse } = calcLocationGravity(location, occupants);

  // Scale dot size with gravity (hot = bigger)
  const baseSize = isActive ? 14 : gravity >= 70 ? 13 : gravity >= 50 ? 11 : 9;
  const dotColor = isActive ? colors.dot : (gravColor || colors.dot);

  return (
    <div
      style={{
        position: "absolute",
        left: `${coords.x}%`,
        top: `${coords.y}%`,
        transform: "translate(-50%, -50%)",
        zIndex: 10,
      }}
    >
      {/* Pulsing ring for hot/busy locations */}
      {pulse && !isActive && (
        <motion.div
          animate={{ scale: [1, 1.9, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: dotColor,
            width: baseSize, height: baseSize,
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onClick(location.id); }}
        style={{
          width: baseSize,
          height: baseSize,
          borderRadius: "50%",
          background: isActive ? dotColor : dotColor + "99",
          border: `2px solid ${isActive ? dotColor : dotColor + "66"}`,
          boxShadow: isActive
            ? `0 0 0 4px ${dotColor}33, 0 2px 8px rgba(0,0,0,0.25)`
            : gravity >= 70
              ? `0 0 6px 2px ${dotColor}55`
              : "0 1px 4px rgba(0,0,0,0.18)",
          cursor: "pointer",
          padding: 0,
          transition: "all 0.15s ease",
          display: "block",
        }}
      />
    </div>
  );
}

// ─── Side detail panel ────────────────────────────────────────────────────────
// CRITICAL: Must display location resident truth from location record, not just markers
// allCharacters needed to hydrate family avatar images from character profiles
function LocationDetailPanel({ location, occupants, onClose, onGoHere, isLocationClosed, allCharacters = [], familyAvatarMap = {} }) {
  if (!location) return null;
  const colors = getColors(location.category || "generic");
  const label = CATEGORY_LABELS[location.category] || "Place";
  const icon = CATEGORY_ICONS[location.category] || "📍";
  
  const { gravity, label: vibeLabel, color: vibeColor } = calcLocationGravity(location, occupants.length);

  /**
   * AVATAR HYDRATION — priority order:
   * 1. occupant.avatarUrl (already resolved, e.g. from Character record avatar_url)
   * 2. familyAvatarMap[name] — from parent character's family_members[].photo_url
   * 3. allCharacters match — Character record avatar_url / image_avatar_url
   * 4. null → initials fallback
   */
  const hydrateAvatarForOccupant = (occupant) => {
    if (occupant.avatarUrl) return occupant.avatarUrl;
    const nameLc = occupant.name?.toLowerCase();
    if (nameLc && familyAvatarMap[nameLc]) return familyAvatarMap[nameLc];
    const matchedChar = allCharacters.find(c => 
      c.display_name?.toLowerCase() === nameLc ||
      c.name?.toLowerCase() === nameLc
    );
    const resolved = matchedChar?.avatar_url || matchedChar?.image_avatar_url || null;
    console.log(`[LocationDetailPanel] Avatar for ${occupant.name}: ${resolved ? 'found from Character record' : 'using initials'}`);
    return resolved;
  };

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
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {occupants.length > 0 && (
                <span style={{ fontSize: 11, color: colors.pin, fontWeight: 700 }}>
                  {occupants.length} here now
                </span>
              )}
              {vibeLabel && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: vibeColor,
                  background: vibeColor + "18",
                  border: `1px solid ${vibeColor}44`,
                  borderRadius: 20, padding: "1px 7px",
                }}>
                  {vibeLabel}
                </span>
              )}
            </div>
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
            {occupants.map(o => {
              const isUser = o.isUserMarker || o.type === "user";
              const isActiveChar = o.type === "active_created_character";
              const isFamilyChar = o.isFamilyMember || o.type === "npc_family_member";
              const pinColor = isUser ? "#f59e0b" : isActiveChar ? "#3b82f6" : isFamilyChar ? "#f43f5e" : "#8b5cf6";
              // Ensure initials exist for family members from location record
              const safeInitials = o.initials || o.name?.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || '?';
              // HYDRATE: Get real avatar from character profile if available
              const realAvatar = hydrateAvatarForOccupant(o);
              const displayAvatar = o.avatarUrl || realAvatar; // Prefer passed avatar, then hydrated, then use initials
              return (
                <div key={o.characterId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    border: `2px solid ${pinColor}`,
                    overflow: "hidden", flexShrink: 0,
                  }}>
                    {displayAvatar ? (
                      <img src={displayAvatar} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt={o.name} />
                    ) : (
                      <div style={{
                        width: "100%", height: "100%",
                        background: `linear-gradient(135deg, ${pinColor}, ${pinColor}cc)`,
                        display: "grid", placeItems: "center",
                        fontSize: safeInitials?.length > 1 ? 9 : 12, fontWeight: 700, color: "#fff",
                      }}>
                        {safeInitials}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{o.name}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>
                      {o.isAsleep ? "😴 Sleeping" : isUser ? "You" : isFamilyChar ? "Family" : label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Only show if truly no data available; keep neutral if uncertain */}

      {/* Details */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
          Details
        </div>
        {[
          { key: "Category", val: label, icon: icon },
          { key: "Gravity", val: `${gravity} / 100`, icon: "⚡" },
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

      {/* Action Button */}
      <div style={{ padding: "12px 14px" }}>
        <button
          onClick={() => onGoHere?.(location.id)}
          disabled={isLocationClosed}
          style={{
            width: "100%",
            padding: "10px 14px",
            background: isLocationClosed ? "#64748b" : colors.pin,
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 700,
            cursor: isLocationClosed ? "not-allowed" : "pointer",
            transition: "opacity 0.2s",
            opacity: isLocationClosed ? 0.5 : 1,
          }}
          onMouseEnter={(e) => !isLocationClosed && (e.target.style.opacity = "0.9")}
          onMouseLeave={(e) => !isLocationClosed && (e.target.style.opacity = "1")}
          title={isLocationClosed ? "Location is closed" : ""}
        >
          {isLocationClosed ? "Closed" : "Go Here"}
        </button>
        {isLocationClosed && (
          <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, textAlign: "center" }}>Open during business hours</p>
        )}
      </div>
    </motion.div>
  );
}

// ─── Character pin ────────────────────────────────────────────────────────────
function CharacterPin({ marker, onClick, offset }) {
  const [hovered, setHovered] = useState(false);
  const isActive = marker.type === "active_created_character";
  const isUser = marker.isUserMarker || marker.type === "user";
  const isFamilyMember = marker.isFamilyMember;
  // user = gold, active = blue, family = pink/rose, npc_fictitious = purple
  const borderColor = isUser ? "#f59e0b" : isActive ? "#3b82f6" : isFamilyMember ? "#f43f5e" : "#8b5cf6";

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
          fontSize: marker.initials?.length > 1 ? 10 : 13, fontWeight: 700, color: "#fff",
          background: `linear-gradient(135deg, ${borderColor}, ${borderColor}cc)`,
        }}>
          {marker.initials || marker.name?.slice(0, 1)?.toUpperCase() || '?'}
        </div>
      )}
      {/* "You" badge for user marker */}
      {isUser && (
        <div style={{
          position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)",
          background: "#f59e0b", color: "#fff",
          fontSize: 7, fontWeight: 800,
          padding: "1px 4px", borderRadius: 4,
          whiteSpace: "nowrap", pointerEvents: "none", lineHeight: 1.4,
        }}>
          YOU
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
// Safe building-block anchor points manually mapped from the city map image.
// Each category has a pool of (x%, y%) spots that sit on actual buildings/structures.
// Locations are assigned to these spots in order (by sorted id), cycling if needed.
const BUILDING_ANCHORS = {
  home: [
    {x:7,  y:24}, {x:14, y:20}, {x:20, y:26}, {x:6,  y:35},
    {x:13, y:38}, {x:21, y:32}, {x:7,  y:50}, {x:15, y:46},
    {x:22, y:52}, {x:6,  y:63}, {x:14, y:60}, {x:21, y:66},
    {x:8,  y:75}, {x:16, y:72}, {x:23, y:76},
  ],
  workplace: [
    {x:36, y:22}, {x:44, y:26}, {x:52, y:20}, {x:37, y:36},
    {x:45, y:40}, {x:53, y:34}, {x:36, y:52}, {x:44, y:56},
    {x:52, y:48}, {x:37, y:66}, {x:45, y:70}, {x:53, y:62},
  ],
  school: [
    {x:38, y:28}, {x:47, y:24}, {x:55, y:30}, {x:39, y:44},
    {x:48, y:50}, {x:56, y:42}, {x:38, y:62}, {x:47, y:68},
  ],
  gym: [
    {x:63, y:22}, {x:70, y:26}, {x:77, y:20}, {x:64, y:38},
    {x:71, y:42}, {x:63, y:56}, {x:70, y:60}, {x:77, y:52},
  ],
  hospital: [
    {x:65, y:30}, {x:73, y:24}, {x:65, y:48}, {x:73, y:54},
  ],
  medical: [
    {x:66, y:34}, {x:74, y:28}, {x:66, y:52}, {x:74, y:58},
  ],
  clinic: [
    {x:67, y:36}, {x:75, y:30}, {x:67, y:54},
  ],
  grocery: [
    {x:64, y:40}, {x:72, y:44}, {x:64, y:62}, {x:72, y:66},
  ],
  park: [
    {x:68, y:46}, {x:76, y:50}, {x:68, y:64}, {x:76, y:68},
  ],
  church: [
    {x:65, y:70}, {x:73, y:74}, {x:65, y:28},
  ],
  food_drink: [
    {x:84, y:22}, {x:91, y:26}, {x:97, y:20}, {x:84, y:38},
    {x:91, y:42}, {x:97, y:36}, {x:84, y:56}, {x:91, y:60},
    {x:97, y:52}, {x:84, y:70}, {x:91, y:74}, {x:97, y:66},
  ],
  bar: [
    {x:86, y:28}, {x:93, y:32}, {x:86, y:48}, {x:93, y:52},
  ],
  restaurant: [
    {x:85, y:24}, {x:92, y:28}, {x:85, y:44}, {x:92, y:48},
  ],
  social: [
    {x:87, y:34}, {x:94, y:38}, {x:87, y:58}, {x:94, y:62},
  ],
  community: [
    {x:88, y:40}, {x:95, y:44}, {x:88, y:64},
  ],
  generic: [
    {x:40, y:30}, {x:50, y:24}, {x:60, y:32}, {x:40, y:50},
    {x:50, y:56}, {x:60, y:48}, {x:40, y:68}, {x:50, y:72},
  ],
  // Jail/prison: placed in the government/civic zone near the top-right edge of the map
  jail_prison: [
    {x:93, y:80}, {x:97, y:76},
  ],
};

// Fallback zone boundaries (used only if a category has no anchor list)
const CATEGORY_ZONES = {
  home:       { xMin: 3,  xMax: 28 },
  workplace:  { xMin: 35, xMax: 58 },
  school:     { xMin: 35, xMax: 58 },
  gym:        { xMin: 62, xMax: 78 },
  hospital:   { xMin: 62, xMax: 78 },
  medical:    { xMin: 62, xMax: 78 },
  clinic:     { xMin: 62, xMax: 78 },
  grocery:    { xMin: 62, xMax: 78 },
  park:       { xMin: 62, xMax: 78 },
  church:     { xMin: 62, xMax: 78 },
  food_drink: { xMin: 82, xMax: 98 },
  bar:        { xMin: 82, xMax: 98 },
  restaurant: { xMin: 82, xMax: 98 },
  social:     { xMin: 82, xMax: 98 },
  community:  { xMin: 82, xMax: 98 },
  generic:     { xMin: 35, xMax: 78 },
  jail_prison: { xMin: 88, xMax: 98 },
};

const Y_MIN = 18;
const Y_MAX = 82;

function buildLocationCoordinateMap(locations) {
  const catGroups = {};
  for (const loc of locations) {
    const cat = loc.category || "generic";
    if (!catGroups[cat]) catGroups[cat] = [];
    catGroups[cat].push(loc);
  }
  const coordMap = {};

  for (const [cat, locs] of Object.entries(catGroups)) {
    const sorted = [...locs].sort((a, b) => a.id.localeCompare(b.id));
    const anchors = BUILDING_ANCHORS[cat] || BUILDING_ANCHORS.generic;

    sorted.forEach((loc, i) => {
      // Cycle through anchors if more locations than anchors
      const anchor = anchors[i % anchors.length];
      coordMap[loc.id] = { x: anchor.x, y: anchor.y };
    });
  }
  return coordMap;
}

// Normalized presence entities provide all location/display info directly — no fallback resolvers needed

// ONE-TRUTH RULE: Characters with an active in_transit session must ONLY appear as
// a TransitMarker (moving dot), never as a static pin at their origin.
// travelingCharacterIds is the Set of character_ids currently in_transit.
// 
// CRITICAL VERIFICATION RULE (added to fix arrival failure re-suppression):
// After travel ends, the static marker must NOT reappear using a stale origin location.
// Static pins are ONLY shown if Character.resolved_current_location_id is verified as current.
// If a travel session failed, the character's travel flags should be cleared and location updated
// to the actual verified location — NOT the old origin.
function buildMarkers(entities, locations, gridCoords, travelingCharacterIds = new Set()) {
  const locationMap = new Map(locations.map((l) => [l.id, l]));
  const markers = [];
  const seenIds = new Set();
  
  for (const entity of entities) {
    if (seenIds.has(entity.id)) continue;

    // SUPPRESS: character has an active travel session — only the TransitMarker should render.
    // This enforces the one-truth rule: a character cannot appear at two places at once.
    if (travelingCharacterIds.has(entity.id)) {
      console.log(`[LivePresenceMap] SUPPRESSED static pin for traveling character: ${entity.display_name} (${entity.id}) — TransitMarker is authoritative`);
      seenIds.add(entity.id);
      continue;
    }
    
    // NORMALIZED ENTITY: always has resolved_current_location_id if is_currently_present
    const locId = entity.resolved_current_location_id;
    if (!locId || !entity.is_currently_present) continue;
    
    // Look up the location record. For user entities, the location may not be in the
    // local locations array (timing/staleness) — fall back to coordinates by locId directly.
    const location = locationMap.get(locId);
    const coordinates = location ? gridCoords[location.id] : gridCoords[locId];
    if (!coordinates) continue;
    
    // Use location from map if available, or synthesize minimal shape for the user entity
    const resolvedLocation = location || { id: locId, name: entity.resolved_current_location_name || locId };
    
    seenIds.add(entity.id);
    
    markers.push({
      characterId: entity.id,
      name: entity.display_name,
      initials: entity.initials,
      // Use effective_presence_type as the canonical type — includes 'user' for user entity
      type: entity.effective_presence_type || entity.character_type || 'npc_fictitious',
      avatarUrl: entity.avatar_url,
      locationId: locId,
      locationName: resolvedLocation.name,
      coordinates,
      isAsleep: entity.resolved_presence_status === 'sleeping' || entity.resolved_presence_status === 'napping',
      isFamilyMember: entity.effective_presence_type === 'npc_family_member',
      isUserMarker: entity.effective_presence_type === 'user',
    });
  }
  return markers;
}

/**
 * Build a name→avatarUrl map by scanning all characters' family_members[] arrays.
 * This is the REAL source of internal family avatars.
 */
function buildFamilyAvatarMap(allCharacters) {
  const map = {};
  for (const char of allCharacters) {
    for (const fm of (char.family_members || [])) {
      if (fm.name && (fm.photo_url || fm.avatar_url)) {
        map[fm.name.toLowerCase()] = fm.photo_url || fm.avatar_url;
      }
    }
  }
  return map;
}

// ─── Transit marker (animated, interpolates between origin and destination) ──
function TransitMarker({ session, originCoords, destCoords }) {
  const [progress, setProgress] = useState(session.progress_percent ?? 0);
  const intervalRef = useRef(null);

  useEffect(() => {
    // Smoothly tick progress forward based on real ETA
    const tick = () => {
      if (!session.estimated_departure_time || !session.estimated_arrival_time) return;
      const now = Date.now();
      const start = new Date(session.estimated_departure_time).getTime();
      const end   = new Date(session.estimated_arrival_time).getTime();
      const total = end - start;
      if (total <= 0) { setProgress(100); return; }
      const elapsed = now - start;
      setProgress(Math.min(99, Math.round((elapsed / total) * 100)));
    };
    tick();
    intervalRef.current = setInterval(tick, 10000); // refresh every 10s
    return () => clearInterval(intervalRef.current);
  }, [session.estimated_departure_time, session.estimated_arrival_time]);

  if (!originCoords || !destCoords) return null;

  // Interpolate x/y between origin and destination based on progress
  const t = Math.min(1, Math.max(0, progress / 100));
  const x = originCoords.x + (destCoords.x - originCoords.x) * t;
  const y = originCoords.y + (destCoords.y - originCoords.y) * t;

  return (
    <div style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)", zIndex: 30, pointerEvents: "none" }}>
      {/* Pulsing transit ring */}
      <motion.div
        animate={{ scale: [1, 1.7, 1], opacity: [0.7, 0, 0.7] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        style={{ position: "absolute", inset: -4, borderRadius: "50%", background: "#f59e0b44", border: "2px solid #f59e0b88" }}
      />
      {/* Avatar / initials */}
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        border: "2.5px solid #f59e0b",
        background: "#1e293b",
        display: "grid", placeItems: "center",
        overflow: "hidden", position: "relative",
        boxShadow: "0 0 0 2px #f59e0b44, 0 3px 10px rgba(0,0,0,0.3)",
      }}>
        {session._avatarUrl ? (
          <img src={session._avatarUrl} alt={session.character_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b" }}>
            {(session.character_name || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      {/* Progress label */}
      <div style={{
        position: "absolute", bottom: -14, left: "50%", transform: "translateX(-50%)",
        background: "#f59e0b", color: "#000", fontSize: 7, fontWeight: 800,
        padding: "1px 4px", borderRadius: 3, whiteSpace: "nowrap",
      }}>
        {progress}% ✈
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function LivePresenceMap({ locations = [], characters = [], onLocationClick, onCharacterClick, onLocationPanelGoHere, allCharacters = [] }) {
  const [activeLocationId, setActiveLocationId] = useState(null);
  const [activeSessions, setActiveSessions] = useState([]);

  // ── RENDER-LAYER EMPTY GUARD ─────────────────────────────────────────────────
  // The query layer (Home/Travel queryFn) owns deletion-safe LKG stabilization.
  // This guard is intentionally thin: only block an empty prop from wiping dots
  // while the query layer has already provided valid data before.
  // Partial or reduced results pass through — the query layer already vetted them.
  // Explicit deletions are trusted because they come through a confirmed full result.
  const stableLocationsRef = useRef([]);
  const stableLocations = useMemo(() => {
    const incoming = Array.isArray(locations) ? locations : [];
    if (incoming.length === 0 && stableLocationsRef.current.length > 0) {
      console.warn(`[LivePresenceMap] RENDER GUARD: empty prop received, keeping ${stableLocationsRef.current.length} stable locations.`);
      return stableLocationsRef.current;
    }
    stableLocationsRef.current = incoming;
    return incoming;
  }, [locations]);

  // TravelSession transit rendering PERMANENTLY DISABLED.
  // The old slow-transit travel system has been removed. Characters teleport at scheduled time.
  // Rendering stale in_transit TravelSession records as animated markers is forbidden.
  // activeSessions is always empty — TransitMarkers will never render.
  useEffect(() => {
    setActiveSessions([]);
  }, []);

  const gridCoords = useMemo(() => buildLocationCoordinateMap(stableLocations), [stableLocations]);

  // travelingCharacterIds is always empty — transit system removed, no pin suppression needed.
  const travelingCharacterIds = useMemo(() => new Set(), []);

  const markers = useMemo(() => buildMarkers(characters, stableLocations, gridCoords, travelingCharacterIds), [characters, stableLocations, gridCoords, travelingCharacterIds]);
  
  // Build family avatar map: name (lowercase) → photo_url
  // Scans all characters' family_members[] arrays — the REAL avatar source for internal family
  const familyAvatarMap = useMemo(() => buildFamilyAvatarMap(allCharacters), [allCharacters]);

  const groupedByLocation = useMemo(() => {
    const map = new Map();
    for (const m of markers) {
      if (!map.has(m.locationId)) map.set(m.locationId, []);
      map.get(m.locationId).push(m);
    }
    return map;
  }, [markers]);

  const allLocations = useMemo(() =>
    stableLocations.filter(l => gridCoords[l.id]).map(l => ({ ...l, map_coordinates: gridCoords[l.id] })),
    [stableLocations, gridCoords]
  );

  const activeLocation = allLocations.find(l => l.id === activeLocationId) || null;

  const handleCharacterClick = (characterId) => {
    const marker = markers.find(m => m.characterId === characterId);
    if (marker) setActiveLocationId(prev => prev === marker.locationId ? null : marker.locationId);
    onCharacterClick?.(characterId);
  };

  const handleLocationDotClick = (locationId) => {
    setActiveLocationId(prev => prev === locationId ? null : locationId);
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

        {/* Location dots — always visible, gravity-aware */}
        {allLocations.map(location => (
          <LocationDot
            key={location.id}
            location={location}
            isActive={location.id === activeLocationId}
            onClick={handleLocationDotClick}
            occupants={groupedByLocation.get(location.id)?.length ?? 0}
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

        {/* Transit markers — animated movers for in_transit TravelSessions */}
         {activeSessions.map(session => {
          const originCoords = session.origin_location_id ? gridCoords[session.origin_location_id] : null;
          const destCoords   = session.destination_location_id ? gridCoords[session.destination_location_id] : null;
          // WARN: Both coordinates missing — cannot render transit marker
          if (!originCoords || !destCoords) {
            console.warn(`[LivePresenceMap] Transit session ${session.id} missing coordinates: origin=${!!originCoords}, dest=${!!destCoords}`);
            return null;
          }
          return (
            <TransitMarker
              key={session.id}
              session={session}
              originCoords={originCoords}
              destCoords={destCoords}
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
        {activeLocation && (() => {
          // Build occupants: travel-capable characters with confirmed presence PLUS resident_family_members
          // resident_family_members are household residents shown in "Who's here" — they are NOT travel actors
          // PRESENCE SOURCE OF TRUTH: only characters with resolved_current_location_id === this location
          // No resident-list fallback. No family member inference. Map markers are the only source.
          const finalOccupants = groupedByLocation.get(activeLocation.id) ?? [];
          
          return (
            <LocationDetailPanel
              location={activeLocation}
              occupants={finalOccupants}
              onClose={() => setActiveLocationId(null)}
              onGoHere={onLocationPanelGoHere}
              allCharacters={allCharacters}
              familyAvatarMap={familyAvatarMap}
              isLocationClosed={(() => {
              const now = new Date();
              const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
              if (!activeLocation.operating_hours || activeLocation.operating_hours.length === 0) return false;
              const dayOfWeek = nowET.getDay();
              const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
              const todayEntries = activeLocation.operating_hours.filter(h => h.day_of_week === dayOfWeek);
              const dayAgnostic = activeLocation.operating_hours.filter(h => h.day_of_week == null);
              const entries = todayEntries.length > 0 ? todayEntries : dayAgnostic;
              if (entries.length === 0) return false;
              return !entries.some(h => {
                if (!h.open_time || !h.close_time) return true;
                const [oh, om] = h.open_time.split(':').map(Number);
                const [ch, cm] = h.close_time.split(':').map(Number);
                const openMin = oh * 60 + om;
                const closeMin = ch * 60 + cm;
                if (openMin <= closeMin) return currentMinutes >= openMin && currentMinutes <= closeMin;
                return currentMinutes >= openMin || currentMinutes <= closeMin;
              });
            })()}
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
}