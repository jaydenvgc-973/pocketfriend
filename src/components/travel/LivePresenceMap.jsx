import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, MapPin } from "lucide-react";

// ─── Category metadata ────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  home: "Residential", workplace: "Workplace", school: "School",
  gym: "Gym", food_drink: "Food & Drink", bar: "Bar",
  restaurant: "Restaurant", park: "Park", outdoor: "Outdoor",
  hospital: "Hospital", medical: "Medical", clinic: "Clinic",
  grocery: "Grocery", church: "Church", religion: "Church",
  social: "Social", community: "Community", government: "Gov't",
  business: "Business", public: "Public", generic: "Place",
};

const CATEGORY_COLORS = {
  home:       { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8", pin: "#3b82f6" },
  workplace:  { bg: "#ede9fe", border: "#7c3aed", text: "#5b21b6", pin: "#7c3aed" },
  school:     { bg: "#fef9c3", border: "#ca8a04", text: "#713f12", pin: "#ca8a04" },
  gym:        { bg: "#dcfce7", border: "#16a34a", text: "#14532d", pin: "#16a34a" },
  food_drink: { bg: "#fff7ed", border: "#ea580c", text: "#7c2d12", pin: "#ea580c" },
  bar:        { bg: "#fdf4ff", border: "#a855f7", text: "#6b21a8", pin: "#a855f7" },
  restaurant: { bg: "#fff7ed", border: "#f97316", text: "#7c2d12", pin: "#f97316" },
  park:       { bg: "#d1fae5", border: "#059669", text: "#064e3b", pin: "#059669" },
  hospital:   { bg: "#fee2e2", border: "#ef4444", text: "#7f1d1d", pin: "#ef4444" },
  church:     { bg: "#fef3c7", border: "#d97706", text: "#78350f", pin: "#d97706" },
  generic:    { bg: "#f1f5f9", border: "#64748b", text: "#334155", pin: "#64748b" },
};

// Category icons (emoji — lightweight, no import needed)
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

// ─── City Map SVG background ──────────────────────────────────────────────────
// A stylized, static vector city map — roads, blocks, parks, water
function CityMapBackground() {
  return (
    <svg
      viewBox="0 0 800 380"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      preserveAspectRatio="xMidYMid slice"
    >
      {/* Base land */}
      <rect width="800" height="380" fill="#eaf0f8" />

      {/* === RESIDENTIAL ZONE (left ~0–33%) === */}
      {/* Soft green backdrop for residential */}
      <rect x="0" y="0" width="265" height="380" fill="#e8f4ec" opacity="0.5" />

      {/* Residential blocks */}
      <rect x="12" y="45" width="50" height="38" rx="4" fill="#d0e8d8" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="70" y="45" width="55" height="38" rx="4" fill="#d0e8d8" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="133" y="45" width="48" height="38" rx="4" fill="#d0e8d8" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="188" y="45" width="52" height="38" rx="4" fill="#d0e8d8" stroke="#b5d4be" strokeWidth="0.8" />

      <rect x="12" y="105" width="55" height="42" rx="4" fill="#cce4d4" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="75" y="105" width="48" height="42" rx="4" fill="#cce4d4" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="131" y="105" width="55" height="42" rx="4" fill="#cce4d4" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="194" y="105" width="50" height="42" rx="4" fill="#cce4d4" stroke="#b5d4be" strokeWidth="0.8" />

      <rect x="12" y="175" width="60" height="40" rx="4" fill="#c8e0d0" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="80" y="175" width="52" height="40" rx="4" fill="#c8e0d0" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="140" y="175" width="48" height="40" rx="4" fill="#c8e0d0" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="196" y="175" width="50" height="40" rx="4" fill="#c8e0d0" stroke="#b5d4be" strokeWidth="0.8" />

      <rect x="14" y="245" width="55" height="40" rx="4" fill="#c4dccb" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="77" y="245" width="50" height="40" rx="4" fill="#c4dccb" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="135" y="245" width="55" height="40" rx="4" fill="#c4dccb" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="198" y="245" width="48" height="40" rx="4" fill="#c4dccb" stroke="#b5d4be" strokeWidth="0.8" />

      <rect x="14" y="315" width="58" height="42" rx="4" fill="#c0d8c7" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="80" y="315" width="52" height="42" rx="4" fill="#c0d8c7" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="140" y="315" width="52" height="42" rx="4" fill="#c0d8c7" stroke="#b5d4be" strokeWidth="0.8" />
      <rect x="200" y="315" width="50" height="42" rx="4" fill="#c0d8c7" stroke="#b5d4be" strokeWidth="0.8" />

      {/* Trees (residential area) */}
      <circle cx="60" cy="158" r="7" fill="#6abf7b" opacity="0.6" />
      <circle cx="120" cy="158" r="6" fill="#6abf7b" opacity="0.55" />
      <circle cx="180" cy="158" r="7" fill="#6abf7b" opacity="0.6" />
      <circle cx="240" cy="158" r="5" fill="#6abf7b" opacity="0.5" />
      <circle cx="40" cy="228" r="6" fill="#6abf7b" opacity="0.5" />
      <circle cx="100" cy="228" r="7" fill="#6abf7b" opacity="0.55" />
      <circle cx="165" cy="228" r="6" fill="#6abf7b" opacity="0.5" />
      <circle cx="228" cy="228" r="7" fill="#6abf7b" opacity="0.6" />
      <circle cx="60" cy="298" r="6" fill="#6abf7b" opacity="0.5" />
      <circle cx="120" cy="298" r="7" fill="#6abf7b" opacity="0.55" />
      <circle cx="180" cy="298" r="6" fill="#6abf7b" opacity="0.5" />
      <circle cx="245" cy="298" r="5" fill="#6abf7b" opacity="0.45" />

      {/* === WORK / SCHOOL ZONE (mid 33–62%) === */}
      <rect x="270" y="0" width="226" height="380" fill="#ece8f8" opacity="0.4" />

      {/* Commercial / office blocks — taller/denser */}
      <rect x="278" y="35" width="60" height="60" rx="4" fill="#d8d0f0" stroke="#bbb0e0" strokeWidth="0.8" />
      <rect x="345" y="35" width="55" height="60" rx="4" fill="#d8d0f0" stroke="#bbb0e0" strokeWidth="0.8" />
      <rect x="408" y="35" width="62" height="60" rx="4" fill="#d8d0f0" stroke="#bbb0e0" strokeWidth="0.8" />

      <rect x="278" y="115" width="65" height="55" rx="4" fill="#cec6eb" stroke="#bbb0e0" strokeWidth="0.8" />
      <rect x="350" y="115" width="58" height="55" rx="4" fill="#cec6eb" stroke="#bbb0e0" strokeWidth="0.8" />
      <rect x="415" y="115" width="58" height="55" rx="4" fill="#cec6eb" stroke="#bbb0e0" strokeWidth="0.8" />

      <rect x="278" y="190" width="62" height="52" rx="4" fill="#c8bee8" stroke="#bbb0e0" strokeWidth="0.8" />
      <rect x="348" y="190" width="62" height="52" rx="4" fill="#c8bee8" stroke="#bbb0e0" strokeWidth="0.8" />
      <rect x="418" y="190" width="55" height="52" rx="4" fill="#c8bee8" stroke="#bbb0e0" strokeWidth="0.8" />

      <rect x="278" y="262" width="65" height="52" rx="4" fill="#c2b8e4" stroke="#bbb0e0" strokeWidth="0.8" />
      <rect x="350" y="262" width="60" height="52" rx="4" fill="#c2b8e4" stroke="#bbb0e0" strokeWidth="0.8" />
      <rect x="418" y="262" width="55" height="52" rx="4" fill="#c2b8e4" stroke="#bbb0e0" strokeWidth="0.8" />

      <rect x="278" y="330" width="195" height="38" rx="4" fill="#bdb2e0" stroke="#bbb0e0" strokeWidth="0.8" />

      {/* Small park in work zone */}
      <ellipse cx="340" cy="155" rx="10" ry="8" fill="#8dc98d" opacity="0.5" />
      <ellipse cx="420" cy="245" rx="9" ry="7" fill="#8dc98d" opacity="0.45" />

      {/* === SERVICES ZONE (mid-right 62–82%) === */}
      <rect x="498" y="0" width="162" height="380" fill="#fdf0e8" opacity="0.45" />

      <rect x="505" y="42" width="55" height="48" rx="4" fill="#f8d8c0" stroke="#e8c0a8" strokeWidth="0.8" />
      <rect x="568" y="42" width="52" height="48" rx="4" fill="#f8d8c0" stroke="#e8c0a8" strokeWidth="0.8" />
      <rect x="628" y="42" width="24" height="48" rx="4" fill="#f8d8c0" stroke="#e8c0a8" strokeWidth="0.8" />

      <rect x="505" y="108" width="55" height="48" rx="4" fill="#f5ceb4" stroke="#e8c0a8" strokeWidth="0.8" />
      <rect x="568" y="108" width="52" height="48" rx="4" fill="#f5ceb4" stroke="#e8c0a8" strokeWidth="0.8" />
      <rect x="628" y="108" width="24" height="48" rx="4" fill="#f5ceb4" stroke="#e8c0a8" strokeWidth="0.8" />

      <rect x="505" y="178" width="55" height="48" rx="4" fill="#f0c4aa" stroke="#e8c0a8" strokeWidth="0.8" />
      <rect x="568" y="178" width="52" height="48" rx="4" fill="#f0c4aa" stroke="#e8c0a8" strokeWidth="0.8" />
      <rect x="628" y="178" width="24" height="48" rx="4" fill="#f0c4aa" stroke="#e8c0a8" strokeWidth="0.8" />

      <rect x="505" y="244" width="55" height="48" rx="4" fill="#ebbaa0" stroke="#e8c0a8" strokeWidth="0.8" />
      <rect x="568" y="244" width="52" height="48" rx="4" fill="#ebbaa0" stroke="#e8c0a8" strokeWidth="0.8" />
      <rect x="628" y="244" width="24" height="48" rx="4" fill="#ebbaa0" stroke="#e8c0a8" strokeWidth="0.8" />

      <rect x="505" y="316" width="147" height="48" rx="4" fill="#e6b096" stroke="#e8c0a8" strokeWidth="0.8" />

      {/* === SOCIAL / NIGHTLIFE ZONE (right 82–100%) === */}
      <rect x="662" y="0" width="138" height="380" fill="#fdf4ff" opacity="0.5" />

      <rect x="668" y="40" width="52" height="50" rx="4" fill="#edd8f8" stroke="#d8b8ee" strokeWidth="0.8" />
      <rect x="728" y="40" width="52" height="50" rx="4" fill="#edd8f8" stroke="#d8b8ee" strokeWidth="0.8" />

      <rect x="668" y="108" width="52" height="50" rx="4" fill="#e8ccf5" stroke="#d8b8ee" strokeWidth="0.8" />
      <rect x="728" y="108" width="52" height="50" rx="4" fill="#e8ccf5" stroke="#d8b8ee" strokeWidth="0.8" />

      <rect x="668" y="178" width="52" height="50" rx="4" fill="#e2c0f2" stroke="#d8b8ee" strokeWidth="0.8" />
      <rect x="728" y="178" width="52" height="50" rx="4" fill="#e2c0f2" stroke="#d8b8ee" strokeWidth="0.8" />

      <rect x="668" y="248" width="52" height="50" rx="4" fill="#dcb4ef" stroke="#d8b8ee" strokeWidth="0.8" />
      <rect x="728" y="248" width="52" height="50" rx="4" fill="#dcb4ef" stroke="#d8b8ee" strokeWidth="0.8" />

      <rect x="668" y="318" width="112" height="46" rx="4" fill="#d8aaec" stroke="#d8b8ee" strokeWidth="0.8" />

      {/* Venue lights (social zone) */}
      <circle cx="694" cy="160" r="4" fill="#c084fc" opacity="0.4" />
      <circle cx="752" cy="160" r="4" fill="#f472b6" opacity="0.4" />
      <circle cx="694" cy="232" r="4" fill="#a78bfa" opacity="0.35" />
      <circle cx="752" cy="232" r="4" fill="#fb923c" opacity="0.35" />

      {/* === WATER ELEMENT === */}
      <path d="M 0 358 Q 100 340 200 355 Q 300 368 400 352 Q 500 338 600 355 Q 700 368 800 352 L 800 380 L 0 380 Z"
        fill="#bdd8f0" opacity="0.5" />
      <path d="M 0 365 Q 100 352 200 364 Q 300 375 400 362 Q 500 350 600 363 Q 700 375 800 362 L 800 380 L 0 380 Z"
        fill="#a8ccec" opacity="0.4" />

      {/* === PRIMARY ROADS === */}
      {/* Main horizontal boulevard */}
      <rect x="0" y="92" width="800" height="10" fill="#fff" opacity="0.85" />
      <rect x="0" y="95" width="800" height="1.5" fill="#e2e8f0" opacity="0.6" />
      {/* Second horizontal */}
      <rect x="0" y="162" width="800" height="9" fill="#fff" opacity="0.8" />
      {/* Third horizontal */}
      <rect x="0" y="232" width="800" height="9" fill="#fff" opacity="0.8" />
      {/* Fourth horizontal */}
      <rect x="0" y="302" width="800" height="8" fill="#fff" opacity="0.75" />

      {/* Main vertical roads */}
      <rect x="62" y="0" width="8" height="380" fill="#fff" opacity="0.8" />
      <rect x="128" y="0" width="8" height="380" fill="#fff" opacity="0.75" />
      <rect x="196" y="0" width="8" height="380" fill="#fff" opacity="0.75" />
      {/* Zone separator road — residential/work */}
      <rect x="260" y="0" width="12" height="380" fill="#f8faff" opacity="0.9" />
      <rect x="263" y="0" width="1.5" fill="#e2e8f0" height="380" opacity="0.6" />
      <rect x="340" y="0" width="8" height="380" fill="#fff" opacity="0.75" />
      <rect x="412" y="0" width="8" height="380" fill="#fff" opacity="0.75" />
      {/* Zone separator road — work/services */}
      <rect x="494" y="0" width="12" height="380" fill="#f8faff" opacity="0.9" />
      <rect x="497" y="0" width="1.5" fill="#e2e8f0" height="380" opacity="0.6" />
      <rect x="566" y="0" width="8" height="380" fill="#fff" opacity="0.75" />
      <rect x="630" y="0" width="8" height="380" fill="#fff" opacity="0.75" />
      {/* Zone separator road — services/social */}
      <rect x="656" y="0" width="12" height="380" fill="#f8faff" opacity="0.9" />
      <rect x="659" y="0" width="1.5" fill="#e2e8f0" height="380" opacity="0.6" />
      <rect x="726" y="0" width="8" height="380" fill="#fff" opacity="0.75" />

      {/* Road center dashes */}
      {[92, 162, 232, 302].map((y) =>
        [0,80,160,240,320,400,480,560,640,720].map(x => (
          <rect key={`${y}-${x}`} x={x+30} y={y+3.5} width="20" height="1.5" fill="#dde8f0" opacity="0.7" />
        ))
      )}

      {/* === PEDESTRIAN PATHS (dashed) === */}
      <line x1="0" y1="380" x2="800" y2="0" stroke="#d4e0ea" strokeWidth="0.8" strokeDasharray="6,8" opacity="0.25" />
      <line x1="0" y1="0" x2="800" y2="380" stroke="#d4e0ea" strokeWidth="0.8" strokeDasharray="6,8" opacity="0.2" />

      {/* === INTERSECTION DOTS === */}
      {[98, 170, 240, 308].flatMap(y =>
        [66, 132, 200, 264, 344, 416, 498, 570, 634, 660, 730].map(x => (
          <circle key={`i-${x}-${y}`} cx={x} cy={y} r="2.5" fill="#cbd5e1" opacity="0.6" />
        ))
      )}

      {/* Small park patches */}
      <ellipse cx="132" cy="57" rx="12" ry="9" fill="#86efac" opacity="0.45" />
      <ellipse cx="340" cy="57" rx="10" ry="8" fill="#86efac" opacity="0.4" />
      <ellipse cx="560" cy="57" rx="10" ry="8" fill="#86efac" opacity="0.4" />
      <ellipse cx="692" cy="57" rx="10" ry="8" fill="#c4b5fd" opacity="0.3" />

      {/* Subtle vignette */}
      <rect width="800" height="380"
        fill="url(#vignette)" />
      <defs>
        <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
          <stop offset="60%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.06)" />
        </radialGradient>
      </defs>
    </svg>
  );
}

// ─── Location pin anchor (small, always visible) ─────────────────────────────
function LocationPin({ location }) {
  const coords = location.map_coordinates;
  if (!coords) return null;
  const colors = getColors(location.category || "generic");
  const icon = CATEGORY_ICONS[location.category] || "📍";

  return (
    <div
      style={{
        position: "absolute",
        left: `${coords.x}%`,
        top: `${coords.y}%`,
        transform: "translate(-50%, -100%)",
        pointerEvents: "none",
        zIndex: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Pin body */}
      <div style={{
        width: 22, height: 22,
        borderRadius: "50% 50% 50% 0",
        background: colors.pin,
        transform: "rotate(-45deg)",
        boxShadow: `0 2px 8px ${colors.pin}55`,
        display: "grid",
        placeItems: "center",
        border: "1.5px solid rgba(255,255,255,0.6)",
      }}>
        <span style={{ transform: "rotate(45deg)", fontSize: 9, lineHeight: 1 }}>{icon}</span>
      </div>
      {/* Pin stem dot */}
      <div style={{
        width: 4, height: 4, borderRadius: "50%",
        background: colors.pin + "66",
        marginTop: 1,
      }} />
    </div>
  );
}

// ─── Location popup (Google Maps preview style) ───────────────────────────────
function LocationPopup({ location, occupants, onClose }) {
  const coords = location.map_coordinates;
  if (!coords) return null;
  const colors = getColors(location.category || "generic");
  const label = CATEGORY_LABELS[location.category] || "Place";
  const icon = CATEGORY_ICONS[location.category] || "📍";

  // Flip popup upward if near bottom of map
  const flipUp = coords.y > 70;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: flipUp ? 8 : -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: `${coords.x}%`,
        top: `${coords.y}%`,
        transform: flipUp
          ? "translate(-50%, calc(-100% - 38px))"
          : "translate(-50%, calc(-100% - 38px))",
        zIndex: 50,
        pointerEvents: "auto",
        filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.18))",
      }}
    >
      <div style={{
        background: "#ffffff",
        borderRadius: 14,
        minWidth: 140,
        maxWidth: 180,
        overflow: "hidden",
        border: `1.5px solid ${colors.border}44`,
      }}>
        {/* Header stripe */}
        <div style={{
          background: `linear-gradient(135deg, ${colors.pin}22, ${colors.pin}08)`,
          borderBottom: `1px solid ${colors.border}22`,
          padding: "9px 12px 7px",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
        }}>
          <div style={{
            width: 30, height: 30,
            borderRadius: 8,
            background: colors.pin + "22",
            border: `1.5px solid ${colors.pin}44`,
            display: "grid",
            placeItems: "center",
            fontSize: 14,
            flexShrink: 0,
          }}>
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: "#1e293b", lineHeight: 1.3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {location.name}
            </div>
            <div style={{
              fontSize: 10, color: colors.pin,
              fontWeight: 600, marginTop: 1,
            }}>
              {label}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#94a3b8", fontSize: 14, lineHeight: 1,
              padding: "1px 2px", flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Occupants */}
        {occupants.length > 0 && (
          <div style={{ padding: "7px 12px 9px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>
              {occupants.length} {occupants.length === 1 ? "person" : "people"} here
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {occupants.map(o => (
                <div key={o.characterId} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "#f1f5f9", borderRadius: 20, padding: "2px 7px 2px 3px",
                }}>
                  {o.avatarUrl ? (
                    <img src={o.avatarUrl} style={{ width: 14, height: 14, borderRadius: "50%", objectFit: "cover" }} />
                  ) : (
                    <div style={{
                      width: 14, height: 14, borderRadius: "50%",
                      background: o.type === "active_created_character" ? "#3b82f6" : "#8b5cf6",
                      display: "grid", placeItems: "center", fontSize: 7, color: "#fff", fontWeight: 700,
                    }}>
                      {o.name[0]?.toUpperCase()}
                    </div>
                  )}
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#475569", whiteSpace: "nowrap" }}>
                    {o.name.split(" ")[0]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {occupants.length === 0 && (
          <div style={{ padding: "6px 12px 9px", fontSize: 10, color: "#94a3b8" }}>
            No one here right now
          </div>
        )}
      </div>

      {/* Downward arrow */}
      <div style={{
        position: "absolute", bottom: -8, left: "50%",
        transform: "translateX(-50%)",
        width: 0, height: 0,
        borderLeft: "8px solid transparent",
        borderRight: "8px solid transparent",
        borderTop: "8px solid #ffffff",
        filter: `drop-shadow(0 2px 2px rgba(0,0,0,0.1))`,
      }} />
    </motion.div>
  );
}

// ─── Character pin ────────────────────────────────────────────────────────────
function CharacterPin({ marker, onClick, offset }) {
  const [hovered, setHovered] = useState(false);
  const isActive = marker.type === "active_created_character";
  const borderColor = isActive ? "#3b82f6" : "#8b5cf6";
  const glowColor = isActive ? "#3b82f633" : "#8b5cf633";

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
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: `2.5px solid ${borderColor}`,
        background: "#fff",
        boxShadow: hovered
          ? `0 0 0 4px ${glowColor}, 0 8px 20px rgba(0,0,0,0.22)`
          : `0 3px 10px rgba(0,0,0,0.18), 0 0 0 2px ${glowColor}`,
        overflow: "hidden",
        cursor: "pointer",
        zIndex: 20,
        transition: "box-shadow 0.15s, transform 0.12s",
        outline: "none",
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
        <div style={{
          width: "100%", height: "100%",
          display: "grid", placeItems: "center",
          fontSize: 12, fontWeight: 700,
          color: "#fff",
          background: `linear-gradient(135deg, ${borderColor}, ${borderColor}cc)`,
          opacity: marker.isAsleep ? 0.6 : 1,
        }}>
          {marker.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      {marker.isAsleep && (
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          background: "rgba(15,23,42,0.45)",
        }}>
          <Moon style={{ width: 11, height: 11, color: "#93c5fd" }} />
        </div>
      )}
      {/* Hover name tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              position: "absolute",
              bottom: "calc(100% + 7px)",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#1e293b",
              color: "#f1f5f9",
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 6,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 30,
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
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
    return { locId: char.resolved_current_location_id, source: "resolved" };
  if (char.travel_destination_location_id)
    return { locId: char.travel_destination_location_id, source: "travel_destination" };
  if (char.resolved_presence_status === "at_work" || char.location_status === "at_location") {
    if (char.current_work_location_id) return { locId: char.current_work_location_id, source: "work" };
    if (char.occupation_location_id) return { locId: char.occupation_location_id, source: "occupation" };
  }
  if (char.resolved_presence_status === "at_school") {
    if (char.current_school_location_id) return { locId: char.current_school_location_id, source: "school" };
    if (char.education_location_id) return { locId: char.education_location_id, source: "education" };
  }
  if (char.current_home_location_id) return { locId: char.current_home_location_id, source: "home_fallback" };
  if (char.current_work_location_id) return { locId: char.current_work_location_id, source: "work_fallback" };
  if (char.occupation_location_id) return { locId: char.occupation_location_id, source: "occupation_fallback" };
  return null;
}

function buildMarkers(characters, locations, gridCoords) {
  const locationMap = new Map(locations.map((l) => [l.id, l]));
  const syntheticCoords = gridCoords || buildLocationCoordinateMap(locations);
  const markers = [];
  const seenIds = new Set();
  for (const char of characters) {
    if (seenIds.has(char.id)) continue;
    const resolved = resolveCharacterLocation(char);
    if (!resolved) continue;
    const { locId, source } = resolved;
    const location = locationMap.get(locId);
    if (!location) continue;
    const coordinates = syntheticCoords[location.id];
    if (!coordinates) continue;
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
  return markers;
}

// ─── Zone label overlays ──────────────────────────────────────────────────────
const ZONE_LABELS = [
  { label: "Residential", x: "3%", color: "#2563eb" },
  { label: "Work & School", x: "36%", color: "#6d28d9" },
  { label: "Services", x: "64%", color: "#c2410c" },
  { label: "Social", x: "85%", color: "#9333ea" },
];

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

  return (
    <div
      onClick={() => setActiveLocationId(null)}
      style={{
        position: "relative",
        width: "100%",
        height: 380,
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.10), 0 1px 0 rgba(255,255,255,0.8) inset",
        border: "1px solid #dde8f5",
        cursor: "default",
      }}
    >
      {/* City map background */}
      <CityMapBackground />

      {/* Zone labels */}
      {ZONE_LABELS.map(z => (
        <div
          key={z.label}
          style={{
            position: "absolute",
            left: z.x,
            top: "3%",
            fontSize: 8,
            fontWeight: 800,
            color: z.color,
            opacity: 0.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            pointerEvents: "none",
            zIndex: 6,
            textShadow: "0 1px 3px rgba(255,255,255,0.9)",
          }}
        >
          {z.label}
        </div>
      ))}

      {/* Location pins (always visible, minimal) */}
      {allLocations.map(location => (
        <LocationPin key={location.id} location={location} />
      ))}

      {/* Active popup — one at a time */}
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

      {/* Character pins */}
      {markers.map((marker) => {
        const siblings = groupedByLocation.get(marker.locationId) ?? [];
        const siblingIndex = siblings.findIndex(s => s.characterId === marker.characterId);
        const cols = Math.min(siblings.length, 3);
        const col = siblingIndex % cols;
        const row = Math.floor(siblingIndex / cols);
        const offset = {
          x: 10 + col * 20 - (cols * 20) / 2,
          y: -14 - row * 22,
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
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none", zIndex: 10,
        }}>
          <div style={{
            textAlign: "center", opacity: 0.7,
            background: "rgba(255,255,255,0.85)",
            borderRadius: 12, padding: "14px 20px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}>
            <MapPin style={{ width: 24, height: 24, margin: "0 auto 6px", color: "#94a3b8" }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>No characters on the map</div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>Tap a character pin to see their location</div>
          </div>
        </div>
      )}
    </div>
  );
}