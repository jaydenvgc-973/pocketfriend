import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, MapPin, Globe, User, Trash2, Upload, X, Pencil,
  ChevronDown, ChevronUp, Home, Briefcase, Coffee, Trees,
  Wine, GraduationCap, Heart, Dumbbell, ArrowLeft
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import LocationHoursEditor from "@/components/location/LocationHoursEditor";
import LocationMatchSuggestion from "@/components/approvals/LocationMatchSuggestion";
import LocationDetailPanel from "@/components/location/LocationDetailPanel";
import { Link } from "react-router-dom";
import { getVenuePositions } from "@/lib/venuePositions";
import PositionInput from "@/components/location/PositionInput";

// ── Zone presets per category ────────────────────────────────────────────────
const ZONE_PRESETS = {
  home: ["Living Room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bedroom 4", "Bathroom", "Dining Room", "Hallway", "Backyard", "Basement", "Office"],
  gym: ["Workout Floor", "Front Desk", "Locker Room", "Bathroom", "Stretching Area", "Cardio Zone", "Weight Room", "Pool", "Sauna"],
  workplace: ["Office", "Office 1", "Office 2", "Admin Office", "Manager Office", "Staff Office", "Break Room", "Conference Room", "Reception", "Hallway", "Parking"],
  social: ["Main Floor", "Bar Area", "VIP Section", "Outdoor Patio", "Entrance", "Bathroom"],
  food_drink: ["Dining Area", "Counter / Bar", "Outdoor Seating", "Bathroom", "Entrance"],
  grocery: ["Main Floor", "Produce", "Deli", "Checkout", "Entrance", "Bakery", "Pharmacy"],
  // School and Education are the same system
  school: ["Classroom", "Classroom 2", "Hallway", "Office", "Admin Office", "Cafeteria", "Gym", "Courtyard", "Library", "Auditorium", "Parking"],
  education: ["Classroom", "Classroom 2", "Hallway", "Office", "Admin Office", "Cafeteria", "Gym", "Courtyard", "Library", "Auditorium", "Parking"],
  religion: ["Main Sanctuary", "Prayer Room", "Chapel", "Office", "Admin Office", "Fellowship Hall", "Study Room", "Entrance", "Parking"],
  outdoor: ["Main Area", "Trail", "Parking", "Entrance", "Shelter / Pavilion", "Picnic Area", "Playground"],
  medical: ["Waiting Area", "Front Desk", "Triage", "Patient Room", "Hallway", "Office", "Admin Office", "Operating Room", "Recovery Room", "Pharmacy"],
  business: ["Office", "Office 1", "Office 2", "Admin Office", "Manager Office", "Staff Office", "Conference Room", "Break Room", "Reception", "Hallway"],
  government: ["Office", "Admin Office", "Reception", "Hallway", "Meeting Room", "Entrance"],
  public: ["Main Area", "Entrance", "Information Desk", "Hallway", "Bathroom"],
  generic: ["Main Area", "Entrance", "Back Area", "Bathroom"],
  other: ["Main Area", "Entrance", "Back Area", "Bathroom"],
};

const CATEGORIES = [
  { value: "home", label: "Home", icon: Home, emoji: "🏠" },
  { value: "workplace", label: "Workplace", icon: Briefcase, emoji: "💼" },
  { value: "school", label: "School / Education", icon: GraduationCap, emoji: "🏫" },
  { value: "gym", label: "Gym", icon: Dumbbell, emoji: "🏋️" },
  { value: "grocery", label: "Grocery Store", icon: Coffee, emoji: "🛒" },
  { value: "religion", label: "Religion / Worship", icon: GraduationCap, emoji: "🛐" },
  { value: "food_drink", label: "Food & Drink", icon: Coffee, emoji: "🍽️" },
  { value: "outdoor", label: "Outdoors", icon: Trees, emoji: "🌳" },
  { value: "social", label: "Social / Nightlife", icon: Wine, emoji: "🍸" },
  { value: "medical", label: "Medical", icon: Heart, emoji: "🏨" },
  { value: "business", label: "Business", icon: Briefcase, emoji: "🏢" },
  { value: "government", label: "Government", icon: MapPin, emoji: "🏛️" },
  { value: "public", label: "Public", icon: MapPin, emoji: "🗺️" },
  { value: "generic", label: "Generic", icon: MapPin, emoji: "📍" },
];

// ── LocationCard ─────────────────────────────────────────────────────────────
function LocationCard({ location, onDelete, onEdit, characters = [], currentUser = {} }) {
  const [expanded, setExpanded] = useState(false);
  const catDef = CATEGORIES.find(c => c.value === location.category) || CATEGORIES[CATEGORIES.length - 1];
  const zones = location.zones || [];
  const totalImages = zones.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0);
  const isGenericHome = location.is_default_generic;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-card border rounded-2xl overflow-hidden transition-colors border-border"
    >
      <div className="flex items-center gap-3 p-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 text-lg">
          {catDef.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{location.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {location.location_type === "global" ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="w-3 h-3" /> Global
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="w-3 h-3" /> {location.character_name || "Character"}
              </span>
            )}
            {(location.category === 'home' || location.category === 'generic') && (
              location.resident_character_ids?.length > 0 ? (
                <span className="text-xs text-blue-400/80 font-medium">
                  {location.resident_character_names?.join(', ') || `${location.resident_character_ids.length} resident${location.resident_character_ids.length > 1 ? "s" : ""}`}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground/60 italic">vacant</span>
              )
            )}
            {location.category !== 'home' && location.category !== 'generic' && location.resident_character_ids?.length > 0 && (
              <span className="text-xs text-blue-400/80 font-medium">
                {location.resident_character_ids.length} resident{location.resident_character_ids.length > 1 ? "s" : ""}
              </span>
            )}
            <span className="text-xs text-muted-foreground">· {zones.length} zone{zones.length !== 1 ? "s" : ""}</span>
            <span className="text-xs text-muted-foreground">· {totalImages} img{totalImages !== 1 ? "s" : ""}</span>
            {(location.category === 'home' || location.category === 'generic') && location.rent_or_housing_cost && (
              <span className="text-xs text-green-400/80 font-medium">
                ${location.rent_or_housing_cost}/mo rent
              </span>
            )}
            {location.category === 'gym' && location.gym_membership_fee && (
              <span className="text-xs text-blue-400/80 font-medium">
                ${location.gym_membership_fee}/mo membership
              </span>
            )}
            {location.category === 'religion' && location.religion_denomination && (
              <span className="text-xs text-purple-400/80 font-medium">
                {location.religion_denomination}
              </span>
            )}
            {(location.owner_character_name || (location.owner_is_npc && location.owner_npc_name)) && (
              <span className="text-xs text-muted-foreground/70">
                · {location.owner_role || "owner"}: {location.owner_is_npc ? location.owner_npc_name : location.owner_character_name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(location)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => onDelete(location.id)} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={() => setExpanded(v => !v)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border overflow-hidden"
          >
            {/* Category-aware detail panel */}
            <LocationDetailPanel location={location} characters={characters} />

            {/* Zones / images section */}
            <div className="px-4 pb-4 space-y-3">
              {location.description && (
                <p className="text-xs text-muted-foreground border-t border-border pt-3">{location.description}</p>
              )}
              {location.keywords?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1">Keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {location.keywords.map(kw => (
                      <span key={kw} className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">{kw}</span>
                    ))}
                  </div>
                </div>
              )}
              {zones.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No zones added yet.</p>
              ) : (
                <div className="space-y-3 border-t border-border pt-3">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Zones & Images</p>
                  {zones.map((zone, zi) => (
                    <div key={zi} className="space-y-2">
                      <p className="text-xs font-medium text-foreground">{zone.zone_name}</p>
                      {zone.image_urls?.length > 0 ? (
                        <div className="grid grid-cols-4 gap-2">
                          {zone.image_urls.map((url, i) => (
                            <img key={i} src={url} alt={`${zone.zone_name} ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No images.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── SUBTYPE OPTIONS MAPPING ───────────────────────────────────────────────────
const SUBTYPE_OPTIONS = {
  home: ["apartment", "house", "condo", "studio"],
  food_drink: ["coffee_shop", "cafe", "diner", "lunch_spot", "breakfast_spot", "fine_dining_restaurant", "casual_restaurant", "fast_casual", "pizza_place", "sushi_restaurant", "steakhouse", "taco_stand", "burger_joint", "bbq_place", "ramen_shop", "thai_restaurant", "mexican_restaurant", "italian_restaurant", "asian_fusion", "vegan_restaurant", "gastropub"],
  social: ["cocktail_bar", "dive_bar", "sports_bar", "beer_hall", "gay_bar", "lesbian_bar", "queer_bar", "upscale_lounge", "neighborhood_bar", "wine_bar", "tiki_bar", "house_music_club", "hip_hop_club", "electronic_club", "punk_venue", "rock_venue", "latin_dance_club", "country_bar", "jazz_club", "karaoke_bar", "nightclub", "dance_club", "rave_venue", "rooftop_bar", "lounge_club"],
  gym: ["gym", "yoga_studio", "pilates_studio", "crossfit_box", "swimming_pool"],
  outdoor: ["park", "hiking_trail", "beach", "lake", "river", "botanical_garden", "urban_plaza"],
  grocery: ["grocery_store", "supermarket", "farmers_market", "convenience_store"],
  business: ["clothing_store", "bookstore", "record_store", "electronics_store", "home_goods_store", "thrift_store", "mall", "shopping_district", "salon", "barbershop"],
  workplace: ["office", "corporate_office", "startup_office", "factory", "warehouse", "retail_store"],
  medical: ["hospital", "clinic", "urgent_care", "dentist_office", "therapist_office"],
  education: ["university", "college", "high_school", "elementary_school", "library", "classroom"],
  school: ["university", "college", "high_school", "elementary_school"],
  religion: ["church", "temple", "mosque", "synagogue", "meditation_center"],
  public: ["museum", "art_gallery", "theater", "cinema", "concert_venue", "sports_arena", "stadium", "community_center"],
  government: ["government_office", "police_station", "courthouse", "city_hall", "park_ranger_station"],
};

// ── ZoneEditor — manages images for a single zone ────────────────────────────
function ZoneEditor({ zone, onUpdateImages, onDelete }) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 5 - (zone.image_urls?.length || 0);
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    const uploaded = [];
    for (const file of toUpload) {
      const res = await base44.integrations.Core.UploadFile({ file });
      if (res?.file_url) uploaded.push(res.file_url);
    }
    onUpdateImages([...(zone.image_urls || []), ...uploaded]);
    setUploading(false);
  };

  const removeImage = (i) => {
    onUpdateImages((zone.image_urls || []).filter((_, idx) => idx !== i));
  };

  const imgCount = zone.image_urls?.length || 0;

  return (
    <div className="border border-border rounded-xl p-3 space-y-3 bg-secondary/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{zone.zone_name}</p>
        <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {imgCount > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {zone.image_urls.map((url, i) => (
            <div key={i} className="relative group">
              <img src={url} alt={`ref ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
              <button
                onClick={() => removeImage(i)}
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      {imgCount < 5 ? (
        <label className="block cursor-pointer">
          <input type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />
          <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-xs">
            <Upload className="w-3.5 h-3.5" />
            {uploading ? "Uploading..." : `Upload images (${5 - imgCount} remaining)`}
          </div>
        </label>
      ) : (
        <p className="text-xs text-muted-foreground text-center">Maximum 5 images per zone</p>
      )}

      {imgCount === 0 && (
        <p className="text-xs text-amber-500/80">⚠ No images yet — add reference photos for this zone</p>
      )}
    </div>
  );
}

// ── Worker Availability Helper ───────────────────────────────────────────────
const WORK_CATEGORIES = ['workplace', 'business', 'food_drink', 'gym', 'social', 'education', 'medical', 'school', 'grocery', 'religion', 'government'];
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function formatShift(shift) {
  if (!shift) return null;
  const parts = [];
  if (shift.start && shift.end) parts.push(`${shift.start}–${shift.end}`);
  if (shift.days?.length > 0) parts.push(shift.days.map(d => DAY_LABELS[d]).join('/'));
  return parts.join(' ') || null;
}

function getWorkerAvailability(workerId, locations, currentLocationId = null) {
  const assignedLocations = locations.filter(loc =>
    loc.id !== currentLocationId &&
    (loc.worker_character_ids || []).includes(workerId)
  );
  const otherJobLocs = assignedLocations.filter(l => WORK_CATEGORIES.includes(l.category));
  if (otherJobLocs.length === 0) return { status: 'available', jobs: [] };
  return {
    status: otherJobLocs.length >= 2 ? 'overbooked' : 'employed',
    jobs: otherJobLocs.map(loc => ({
      name: loc.name,
      title: loc.worker_job_titles?.[workerId] || null,
      shift: formatShift(loc.worker_shifts?.[workerId]),
    })),
  };
}

// ── LocationForm ─────────────────────────────────────────────────────────────
function LocationForm({ editingLocation, characters, onSave, onCancel, isWorkerTooYoung, getNPCAge, allLocations = [] }) {
  // Collect all unique NPCs from fictional_relationships across all characters
  const allNPCs = [];
  const seenNames = new Set();
  characters.forEach(char => {
    (char.fictional_relationships || []).forEach(rel => {
      if (!rel.related_character_id && rel.person_name && !seenNames.has(rel.person_name)) {
        seenNames.add(rel.person_name);
        allNPCs.push({ id: `npc__${rel.person_name}`, name: rel.person_name, isNPC: true, relationship_type: rel.relationship_type });
      }
    });
  });

  const [form, setForm] = useState({
    name: editingLocation?.name || "",
    location_type: editingLocation?.location_type || "global",
    character_id: editingLocation?.character_id || "",
    category: editingLocation?.category || "home",
    subtype: Array.isArray(editingLocation?.subtype) ? editingLocation.subtype : (editingLocation?.subtype ? [editingLocation.subtype] : []),
    description: editingLocation?.description || "",
    keywords: editingLocation?.keywords?.join(", ") || "",
    zones: editingLocation?.zones || [],
    resident_character_ids: editingLocation?.resident_character_ids || [],
    resident_family_members: editingLocation?.resident_family_members || [],
    cost_split_method: editingLocation?.cost_split_method || "even",
    resident_cost_split: editingLocation?.resident_cost_split || {},
    owner_character_id: editingLocation?.owner_character_id || "",
    owner_character_name: editingLocation?.owner_character_name || "",
    owner_is_npc: editingLocation?.owner_is_npc || false,
    owner_npc_name: editingLocation?.owner_npc_name || "",
    owner_role: editingLocation?.owner_role || "owner",
    is_default_generic: editingLocation?.is_default_generic || false,
    religion_denomination: editingLocation?.religion_denomination || "",
    rent_or_housing_cost: editingLocation?.rent_or_housing_cost || 1200,
    bedroom_count: editingLocation?.bedroom_count || 1,
    gym_membership_fee: editingLocation?.gym_membership_fee || 50,
    utility_costs: editingLocation?.utility_costs || { electricity: 80, water: 40, gas: 50, internet: 60, other: 0 },
    operating_hours: editingLocation?.operating_hours || [],
    worker_character_ids: editingLocation?.worker_character_ids || [],
    worker_pay_rates: editingLocation?.worker_pay_rates || {},
    worker_pay_type: editingLocation?.worker_pay_type || {},
    worker_job_titles: editingLocation?.worker_job_titles || {},
    worker_shifts: editingLocation?.worker_shifts || {},
  });
  const [newZoneName, setNewZoneName] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));

  const presets = ZONE_PRESETS[form.category] || ZONE_PRESETS.other;
  const existingZoneNames = form.zones.map(z => z.zone_name.toLowerCase());

  const addPresetZone = (name) => {
    if (existingZoneNames.includes(name.toLowerCase())) return;
    update("zones", [...form.zones, { zone_name: name, image_urls: [] }]);
  };

  const addCustomZone = () => {
    const trimmed = newZoneName.trim();
    if (!trimmed || existingZoneNames.includes(trimmed.toLowerCase())) return;
    update("zones", [...form.zones, { zone_name: trimmed, image_urls: [] }]);
    setNewZoneName("");
    setShowCustomInput(false);
  };

  const removeZone = (i) => {
    update("zones", form.zones.filter((_, idx) => idx !== i));
  };

  const updateZoneImages = (i, newUrls) => {
    const updated = form.zones.map((z, idx) => idx === i ? { ...z, image_urls: newUrls } : z);
    update("zones", updated);
  };

  // Generic homes don't require zones or images; other locations require at least one zone
  const isGenericHome = form.is_default_generic;
  const canSave = form.name.trim() && (isGenericHome || form.zones.length > 0);

  const handleSave = () => {
    if (!canSave) return;
    const charObj = form.location_type === "character_specific"
      ? characters.find(c => c.id === form.character_id)
      : null;
    const ownerChar = !form.owner_is_npc && form.owner_character_id
      ? characters.find(c => c.id === form.owner_character_id)
      : null;
    onSave({
      ...form,
      keywords: form.keywords.split(",").map(k => k.trim()).filter(Boolean),
      character_name: charObj?.name || "",
      owner_character_name: ownerChar?.name || form.owner_character_name || "",
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="bg-card border border-border rounded-2xl p-5 space-y-5"
    >
      <h3 className="text-sm font-semibold text-foreground">{editingLocation ? "Edit Location" : "Add Location"}</h3>

      {/* Name */}
      <Input
        value={form.name}
        onChange={e => update("name", e.target.value)}
        placeholder="e.g. Jayden's Apartment, Downtown Gym"
        className="h-11 rounded-xl"
      />

      {/* Type */}
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Type</label>
        <div className="grid grid-cols-2 gap-2">
          {["global", "character_specific"].map(t => (
            <button key={t} onClick={() => update("location_type", t)}
              className={`py-2 px-3 rounded-xl text-sm border transition-colors ${form.location_type === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
              {t === "global" ? "🌐 Global" : "👤 Character-specific"}
            </button>
          ))}
        </div>
      </div>

      {/* Character picker */}
      {form.location_type === "character_specific" && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Character</label>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {characters.map(c => (
              <button key={c.id} onClick={() => update("character_id", c.id)}
                className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.character_id === c.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
                <CharacterAvatar character={c} size="sm" />
                <span className="text-sm text-foreground">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category */}
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Category</label>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map(cat => (
            <button key={cat.value} onClick={() => update("category", cat.value)}
              className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs transition-colors ${form.category === cat.value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
              <span className="text-base">{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── SUBTYPE / VENUE TYPE ─ specific location subtype ─────────── */}
      {SUBTYPE_OPTIONS[form.category] && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Venue Type</label>
          <div className="grid grid-cols-2 gap-2">
            {SUBTYPE_OPTIONS[form.category].map(subtype => (
              <button
                key={subtype}
                onClick={() => update("subtype", form.subtype.includes(subtype) ? form.subtype.filter(s => s !== subtype) : [...form.subtype, subtype])}
                className={`py-2 px-3 rounded-xl text-xs border transition-colors text-left capitalize ${form.subtype.includes(subtype) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
              >
                {subtype.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── RELIGION DENOMINATION — only for religion category ─────────── */}
      {form.category === 'religion' && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Religion / Denomination</label>
          <div className="grid grid-cols-2 gap-2">
            {["Christianity", "Catholicism", "Islam", "Judaism", "Hinduism", "Buddhism", "Sikhism", "Jehovah's Witnesses", "Seventh-day Adventist", "Baptist", "Pentecostal", "Non-denominational", "Other"].map(rel => (
              <button
                key={rel}
                onClick={() => update("religion_denomination", form.religion_denomination === rel ? "" : rel)}
                className={`py-2 px-3 rounded-xl text-xs border transition-colors text-left ${form.religion_denomination === rel ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
              >
                {rel}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── ZONE SECTION — required ─────────────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
            Rooms / Zones <span className="text-destructive">*</span>
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each uploaded set of images must be assigned to a specific room or zone. Select from presets or add a custom one.
          </p>
        </div>

        {/* Preset zone chips */}
        <div className="flex flex-wrap gap-2">
          {presets.map(name => {
            const already = existingZoneNames.includes(name.toLowerCase());
            return (
              <button
                key={name}
                onClick={() => addPresetZone(name)}
                disabled={already}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  already
                    ? "bg-primary/10 border-primary/30 text-primary cursor-default"
                    : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {already ? "✓ " : "+ "}{name}
              </button>
            );
          })}
          <button
            onClick={() => setShowCustomInput(v => !v)}
            className="px-3 py-1.5 rounded-full text-xs border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
          >
            + Custom zone
          </button>
        </div>

        {/* Custom zone input */}
        {showCustomInput && (
          <div className="flex gap-2">
            <Input
              value={newZoneName}
              onChange={e => setNewZoneName(e.target.value)}
              placeholder="e.g. Rooftop, Garage, Studio..."
              className="h-9 rounded-xl text-sm"
              onKeyDown={e => e.key === "Enter" && addCustomZone()}
            />
            <Button size="sm" onClick={addCustomZone} disabled={!newZoneName.trim()} className="rounded-xl px-4">Add</Button>
          </div>
        )}

        {/* Zone editors */}
        {form.zones.length === 0 && !isGenericHome && (
          <div className="py-4 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 text-center">
            <p className="text-xs text-destructive font-medium">At least one zone is required before uploading images.</p>
            <p className="text-xs text-muted-foreground mt-1">Select a room or zone from the list above to get started.</p>
          </div>
        )}

        <div className="space-y-3">
          {form.zones.map((zone, i) => (
            <ZoneEditor
              key={i}
              zone={zone}
              onUpdateImages={(urls) => updateZoneImages(i, urls)}
              onDelete={() => removeZone(i)}
            />
          ))}
        </div>
      </div>

      {/* ── RESIDENTS ─────────────────────────────────────────────────── */}
      {(form.category === 'home' || form.category === 'generic') && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Who lives here?</label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Add resident characters. Rent and utilities will be split among them.
            </p>
          </div>

          {/* Resident list */}
          <div className="space-y-2">
            {form.resident_character_ids?.length > 0 || form.resident_family_members?.length > 0 ? (
              <>
                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {/* Active character residents */}
                  {form.resident_character_ids.map((resId, idx) => {
                    const resChar = characters.find(c => c.id === resId);
                    return (
                      <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-secondary border border-border">
                        {resChar && <CharacterAvatar character={resChar} size="sm" />}
                        <span className="text-sm text-foreground flex-1">{resChar?.name || resId}</span>
                        <button
                          onClick={() => update("resident_character_ids", form.resident_character_ids.filter((_, i) => i !== idx))}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  {/* Family member residents */}
                  {form.resident_family_members?.map((fam, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-secondary border border-border">
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-primary">
                        {fam.name?.[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">{fam.name}</p>
                        <p className="text-xs text-muted-foreground/70 capitalize">{fam.relationship_type}</p>
                      </div>
                      <button
                        onClick={() => update("resident_family_members", form.resident_family_members.filter((_, i) => i !== idx))}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Cost split method — only show if multiple residents */}
                {(form.resident_character_ids.length + (form.resident_family_members?.length || 0)) > 1 && (
                  <div className="mt-3 p-3 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
                    <label className="text-xs font-semibold text-foreground uppercase">Split costs</label>
                    <div className="flex gap-2">
                      {["even", "custom"].map(method => (
                        <button
                          key={method}
                          onClick={() => update("cost_split_method", method)}
                          className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors capitalize ${form.cost_split_method === method ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}
                        >
                          {method === "even" ? "Split evenly" : "Custom split"}
                        </button>
                      ))}
                    </div>

                    {/* Custom split inputs */}
                    {form.cost_split_method === "custom" && (
                      <div className="space-y-2 mt-2">
                        {form.resident_character_ids.map((resId, idx) => {
                          const resChar = characters.find(c => c.id === resId);
                          return (
                            <div key={idx} className="flex items-center gap-2">
                              <label className="text-xs text-muted-foreground w-24 truncate">{resChar?.name || resId}:</label>
                              <div className="flex items-center gap-1 flex-1">
                                <span className="text-xs">$</span>
                                <Input
                                  type="number"
                                  value={form.resident_cost_split?.[resId] || 0}
                                  onChange={e => update("resident_cost_split", { ...form.resident_cost_split, [resId]: parseFloat(e.target.value) || 0 })}
                                  placeholder="0"
                                  className="h-8 text-xs flex-1"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">No residents added yet.</p>
            )}
          </div>

          {/* Add resident: active characters + family members + NPCs */}
          <div className="space-y-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card p-1">
            {characters.length > 0 && (
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-1 pb-0.5">Active Characters</p>
            )}
            {characters.map(char => {
              const alreadyResident = form.resident_character_ids?.includes(char.id);
              return (
                <button
                  key={char.id}
                  onClick={() => {
                    if (!alreadyResident) {
                      update("resident_character_ids", [...(form.resident_character_ids || []), char.id]);
                    }
                  }}
                  disabled={alreadyResident}
                  className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors rounded-lg ${alreadyResident ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : "hover:bg-secondary"}`}
                >
                  <CharacterAvatar character={char} size="sm" />
                  <span className="text-sm text-foreground font-medium flex-1">{char.name}</span>
                  {alreadyResident && <span className="text-xs text-primary font-medium">✓ Resident</span>}
                </button>
              );
            })}

            {/* Family members from all characters */}
            {characters.flatMap(char =>
              (char.family_members || []).map((fam, idx) => {
                const familyKey = `${char.id}__${fam.name}`;
                const alreadyResident = form.resident_family_members?.some(f => f.name === fam.name);
                return (
                  <button
                    key={familyKey}
                    onClick={() => {
                      if (!alreadyResident) {
                        update("resident_family_members", [...(form.resident_family_members || []), { name: fam.name, relationship_type: fam.relationship_type, source_character_id: char.id }]);
                      }
                    }}
                    disabled={alreadyResident}
                    className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors rounded-lg ${alreadyResident ? "bg-secondary/50 border-l-2 border-border opacity-50 cursor-default" : "hover:bg-secondary"}`}
                  >
                    <div className="w-7 h-7 rounded-full bg-secondary/60 flex items-center justify-center flex-shrink-0 text-xs font-semibold">
                      {fam.name?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground font-medium truncate">{fam.name}</p>
                      <p className="text-xs text-muted-foreground/70 capitalize">{fam.relationship_type} of {char.name}</p>
                    </div>
                    {alreadyResident && <span className="text-xs text-primary font-medium">✓</span>}
                  </button>
                );
              })
            )}

            {/* NPCs & Fictional Characters */}
            {allNPCs.length > 0 && (
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-2 pb-0.5">NPCs & Fictional Characters</p>
            )}
            {allNPCs.map(npc => {
              const alreadyResident = form.resident_family_members?.some(f => f.name === npc.name && f.isNPC);
              return (
                <button
                  key={npc.id}
                  onClick={() => {
                    if (!alreadyResident) {
                      update("resident_family_members", [...(form.resident_family_members || []), { name: npc.name, relationship_type: npc.relationship_type || "NPC", isNPC: true }]);
                    }
                  }}
                  disabled={alreadyResident}
                  className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors rounded-lg ${alreadyResident ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : "hover:bg-secondary"}`}
                >
                  <div className="w-8 h-8 rounded-full bg-secondary/60 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-muted-foreground">
                    {npc.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-medium">{npc.name}</p>
                    {npc.relationship_type && <p className="text-xs text-muted-foreground/70 capitalize">{npc.relationship_type}</p>}
                  </div>
                  {alreadyResident ? <span className="text-xs text-primary font-medium">✓ Resident</span> : <span className="text-xs text-muted-foreground/50">NPC</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── WORKERS / EMPLOYEES ───────────────────────────────────────── */}
      {(form.category === 'workplace' || form.category === 'business' || form.category === 'food_drink' || form.category === 'gym' || form.category === 'social' || form.category === 'education' || form.category === 'medical' || form.category === 'school' || form.category === 'grocery' || form.category === 'religion' || form.category === 'government') && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Workers & Employees</label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              Add characters who work at this location. Set their pay, title, and work schedule.
            </p>
          </div>

          {/* Workers list */}
          <div className="space-y-2">
            {form.worker_character_ids?.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto rounded-xl border border-border bg-card p-2">
                {form.worker_character_ids.map((workerId, idx) => {
                  const worker = characters.find(c => c.id === workerId);
                  const npcWorker = !worker ? allNPCs.find(n => n.id === workerId) : null;
                  const workerName = worker?.name || npcWorker?.name || workerId;
                  return (
                    <div key={idx} className="bg-secondary/50 border border-border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2 justify-between">
                        <div className="flex items-center gap-2">
                          {worker ? <CharacterAvatar character={worker} size="sm" /> : (
                            <div className="w-7 h-7 rounded-full bg-secondary/60 flex items-center justify-center text-xs font-semibold text-muted-foreground flex-shrink-0">
                              {workerName[0]?.toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm font-medium text-foreground">{workerName}</span>
                          {npcWorker && <span className="text-xs text-muted-foreground/60 bg-secondary px-1.5 py-0.5 rounded">NPC</span>}
                        </div>
                        <button
                          onClick={() => update("worker_character_ids", form.worker_character_ids.filter((_, i) => i !== idx))}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg"
                        ><X className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground uppercase tracking-wider">Type</label>
                            <select
                              value={form.worker_pay_type[workerId] || 'hourly'}
                              onChange={(e) => update("worker_pay_type", { ...form.worker_pay_type, [workerId]: e.target.value })}
                              className="text-xs px-2 py-1.5 bg-input border border-border rounded text-foreground"
                            >
                              <option value="hourly">Hourly</option>
                              <option value="annual">Annual</option>
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground uppercase tracking-wider">Rate</label>
                            <div className="flex items-center gap-1">
                              <span className="text-xs">$</span>
                              <Input
                                type="number"
                                value={form.worker_pay_rates[workerId] || 0}
                                onChange={(e) => update("worker_pay_rates", { ...form.worker_pay_rates, [workerId]: parseFloat(e.target.value) || 0 })}
                                className="h-8 text-xs flex-1"
                                placeholder="15"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground uppercase tracking-wider">Position</label>
                            <PositionInput
                              category={form.category}
                              value={form.worker_job_titles[workerId] || ''}
                              onChange={(val) => update("worker_job_titles", { ...form.worker_job_titles, [workerId]: val })}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground uppercase tracking-wider">Shift Start</label>
                            <Input
                              type="time"
                              value={form.worker_shifts?.[workerId]?.start || '09:00'}
                              onChange={(e) => update("worker_shifts", { ...form.worker_shifts, [workerId]: { ...form.worker_shifts?.[workerId], start: e.target.value } })}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground uppercase tracking-wider">Shift End</label>
                            <Input
                              type="time"
                              value={form.worker_shifts?.[workerId]?.end || '17:00'}
                              onChange={(e) => update("worker_shifts", { ...form.worker_shifts, [workerId]: { ...form.worker_shifts?.[workerId], end: e.target.value } })}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        {/* Recurring days */}
                        <div className="pt-1 border-t border-border">
                          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">Work Days</label>
                          <div className="flex gap-1 flex-wrap">
                            {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d, i) => {
                              const shiftDays = form.worker_shifts?.[workerId]?.days || [1,2,3,4,5];
                              const active = shiftDays.includes(i);
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => {
                                    const cur = form.worker_shifts?.[workerId]?.days || [1,2,3,4,5];
                                    const newDays = active ? cur.filter(x => x !== i) : [...cur, i].sort();
                                    update("worker_shifts", { ...form.worker_shifts, [workerId]: { ...form.worker_shifts?.[workerId], days: newDays } });
                                  }}
                                  className={`w-7 h-7 rounded-full text-[10px] font-medium border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:border-primary/40'}`}
                                >{d}</button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No workers added yet.</p>
            )}
          </div>

          {/* Add worker selector — active characters + NPCs */}
          <div className="space-y-1 max-h-56 overflow-y-auto rounded-xl border border-border bg-card p-1">
            {characters.length > 0 && (
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-1 pb-0.5">Active Characters</p>
            )}
            {characters.map(char => {
               const alreadyWorker = form.worker_character_ids?.includes(char.id);
               const tooYoung = isWorkerTooYoung(char.id, form.category);
               const avail = getWorkerAvailability(char.id, allLocations, editingLocation?.id);
               return (
                 <button
                   key={char.id}
                   onClick={() => {
                     if (!alreadyWorker && !tooYoung) {
                       update("worker_character_ids", [...(form.worker_character_ids || []), char.id]);
                     }
                   }}
                   disabled={alreadyWorker || tooYoung}
                   className={`w-full flex items-start gap-3 p-2.5 text-left transition-colors rounded-lg ${alreadyWorker ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : tooYoung ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary"}`}
                 >
                   <CharacterAvatar character={char} size="sm" />
                   <div className="flex-1 min-w-0">
                     <p className="text-sm text-foreground font-medium">{char.name}</p>
                     {tooYoung && <p className="text-xs text-destructive">Too young</p>}
                     {!tooYoung && avail.jobs.length > 0 && avail.jobs.map((job, i) => (
                       <p key={i} className={`text-xs ${avail.status === 'overbooked' ? 'text-destructive' : 'text-amber-400'}`}>
                         {job.title ? `${job.title} @ ` : ''}{job.name}{job.shift ? ` · ${job.shift}` : ''}
                       </p>
                     ))}
                     {!tooYoung && avail.jobs.length === 0 && <p className="text-xs text-green-400">Available</p>}
                   </div>
                   {alreadyWorker && <span className="text-xs text-primary font-medium shrink-0">✓ Added</span>}
                   {avail.status === 'overbooked' && !alreadyWorker && !tooYoung && <span className="text-xs text-destructive shrink-0">Overbooked</span>}
                 </button>
               );
             })}
            {/* Family members as hireable workers */}
            {(() => {
              const familyWorkers = [];
              const seenFam = new Set();
              characters.forEach(char => {
                (char.family_members || []).filter(fm => !fm._is_user).forEach(fm => {
                  if (!fm.name || seenFam.has(fm.name.toLowerCase())) return;
                  if (allNPCs.some(n => n.name.toLowerCase() === fm.name.toLowerCase())) return;
                  seenFam.add(fm.name.toLowerCase());
                  familyWorkers.push({ id: `npc__${fm.name}`, name: fm.name, relationship_type: fm.relationship_type, sourceChar: char.name });
                });
              });
              if (familyWorkers.length === 0) return null;
              return (
                <>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-2 pb-0.5">Family Members</p>
                  {familyWorkers.map(fm => {
                    const alreadyWorker = form.worker_character_ids?.includes(fm.id);
                    const fmAge = getNPCAge(fm.name);
                    let tooYoung = false;
                    if (fmAge !== null) {
                      if (fmAge < 16) tooYoung = true;
                      if ((form.category === 'social' || form.category === 'food_drink') && fmAge < 21) tooYoung = true;
                    }
                    const avail = getWorkerAvailability(fm.id, allLocations, editingLocation?.id);
                    return (
                      <button
                        key={fm.id}
                        onClick={() => { if (!alreadyWorker && !tooYoung) update("worker_character_ids", [...(form.worker_character_ids || []), fm.id]); }}
                        disabled={alreadyWorker || tooYoung}
                        className={`w-full flex items-start gap-3 p-2.5 text-left transition-colors rounded-lg ${alreadyWorker ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : tooYoung ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary"}`}
                      >
                        <div className="w-8 h-8 rounded-full bg-secondary/60 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-muted-foreground">
                          {fm.name[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-foreground font-medium">{fm.name}</span>
                            <span className="text-[10px] text-muted-foreground/50 bg-secondary px-1 rounded capitalize">{fm.relationship_type}</span>
                          </div>
                          <p className="text-xs text-muted-foreground/60">of {fm.sourceChar}</p>
                          {tooYoung && <p className="text-xs text-destructive">Too young</p>}
                          {!tooYoung && avail.jobs.length > 0 && avail.jobs.map((job, i) => (
                            <p key={i} className={`text-xs ${avail.status === 'overbooked' ? 'text-destructive' : 'text-amber-400'}`}>
                              {job.title ? `${job.title} @ ` : ''}{job.name}{job.shift ? ` · ${job.shift}` : ''}
                            </p>
                          ))}
                          {!tooYoung && avail.jobs.length === 0 && <p className="text-xs text-green-400">Available</p>}
                        </div>
                        {alreadyWorker && <span className="text-xs text-primary font-medium shrink-0">✓ Added</span>}
                      </button>
                    );
                  })}
                </>
              );
            })()}
            {allNPCs.length > 0 && (
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-2 pb-0.5">NPCs & Fictional Characters</p>
            )}
            {allNPCs.map(npc => {
               const alreadyWorker = form.worker_character_ids?.includes(npc.id);
               const npcAge = getNPCAge(npc.name);
               let tooYoung = false;
               if (npcAge !== null) {
                 if (npcAge < 16) tooYoung = true;
                 if ((form.category === 'social' || form.category === 'food_drink') && npcAge < 21) tooYoung = true;
               }
               const avail = getWorkerAvailability(npc.id, allLocations, editingLocation?.id);
               return (
                 <button
                   key={npc.id}
                   onClick={() => {
                     if (!alreadyWorker && !tooYoung) {
                       update("worker_character_ids", [...(form.worker_character_ids || []), npc.id]);
                     }
                   }}
                   disabled={alreadyWorker || tooYoung}
                   className={`w-full flex items-start gap-3 p-2.5 text-left transition-colors rounded-lg ${alreadyWorker ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : tooYoung ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary"}`}
                 >
                   <div className="w-8 h-8 rounded-full bg-secondary/60 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-muted-foreground">
                     {npc.name[0]?.toUpperCase()}
                   </div>
                   <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-1.5">
                       <span className="text-sm text-foreground font-medium">{npc.name}</span>
                       <span className="text-[10px] text-muted-foreground/50 bg-secondary px-1 rounded">NPC</span>
                     </div>
                     {npc.relationship_type && <p className="text-xs text-muted-foreground/70 capitalize">{npc.relationship_type}</p>}
                     {tooYoung && <p className="text-xs text-destructive">Too young</p>}
                     {!tooYoung && avail.jobs.length > 0 && avail.jobs.map((job, i) => (
                       <p key={i} className={`text-xs ${avail.status === 'overbooked' ? 'text-destructive' : 'text-amber-400'}`}>
                         {job.title ? `${job.title} @ ` : ''}{job.name}{job.shift ? ` · ${job.shift}` : ''}
                       </p>
                     ))}
                     {!tooYoung && avail.jobs.length === 0 && <p className="text-xs text-green-400">Available</p>}
                   </div>
                   {alreadyWorker && <span className="text-xs text-primary font-medium shrink-0">✓ Added</span>}
                   {avail.status === 'overbooked' && !alreadyWorker && !tooYoung && <span className="text-xs text-destructive shrink-0">Overbooked</span>}
                 </button>
               );
             })}
            {characters.length === 0 && allNPCs.length === 0 && (
              <p className="text-xs text-muted-foreground italic p-3">No characters available.</p>
            )}
          </div>
        </div>
      )}

      {/* ── OWNER / LANDLORD ───────────────────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Owner / Landlord (optional)</label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {form.location_type === "global"
              ? "Assign a character or NPC who owns or earns revenue from this space. Can be reassigned if the owner leaves."
              : "Assign the landlord or owner of this character-specific space."}
          </p>
        </div>

        {/* Owner type toggle */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => update("owner_is_npc", false)}
            className={`py-2 px-3 rounded-xl text-sm border transition-colors ${!form.owner_is_npc ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}
          >
            👤 Active Character
          </button>
          <button
            onClick={() => update("owner_is_npc", true)}
            className={`py-2 px-3 rounded-xl text-sm border transition-colors ${form.owner_is_npc ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}
          >
            🧑‍🤝‍🧑 NPC
          </button>
        </div>

        {!form.owner_is_npc ? (
          <div className="space-y-2 max-h-44 overflow-y-auto">
            <button
              onClick={() => update("owner_character_id", "")}
              className={`w-full flex items-center gap-2 p-2 rounded-xl border text-sm transition-colors ${!form.owner_character_id ? "bg-primary/10 border-primary/40 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
            >
              <span className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs">—</span>
              No owner assigned
            </button>
            {characters.map(c => (
              <button key={c.id} onClick={() => update("owner_character_id", c.id)}
                className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.owner_character_id === c.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
                <CharacterAvatar character={c} size="sm" />
                <span className="text-sm text-foreground">{c.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <Input
            value={form.owner_npc_name}
            onChange={e => update("owner_npc_name", e.target.value)}
            placeholder="NPC name (e.g. Mr. Hassan, The Landlord)"
            className="h-10 rounded-xl text-sm"
          />
        )}

        {/* Owner role */}
        {(form.owner_character_id || (form.owner_is_npc && form.owner_npc_name.trim())) && (
          <div className="flex flex-wrap gap-2">
            {["owner", "landlord", "manager", "operator"].map(role => (
              <button
                key={role}
                onClick={() => update("owner_role", role)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors capitalize ${form.owner_role === role ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
              >
                {role}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      <Textarea
        value={form.description}
        onChange={e => update("description", e.target.value)}
        placeholder="Overall location description: style, atmosphere... (optional)"
        className="rounded-xl min-h-[60px] text-sm resize-none"
      />

      {/* ── RESIDENTIAL / GYM / BUSINESS COSTS ─────────────────────── */}
      {(form.category === 'home' || form.category === 'generic') && (
        <div className="space-y-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
          <div>
            <label className="text-xs font-semibold text-foreground uppercase mb-2 block">Monthly Rent</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                value={form.rent_or_housing_cost}
                onChange={e => update("rent_or_housing_cost", parseFloat(e.target.value))}
                placeholder="1200"
                className="h-10 rounded-xl flex-1"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Base rent. Updates automatically with bedrooms unless manually adjusted.</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground uppercase mb-2 block">Bedrooms</label>
            <Input
              type="number"
              min="1"
              value={form.bedroom_count}
              onChange={e => {
                const count = parseInt(e.target.value) || 1;
                const newRent = 1200 + ((count - 1) * 300);
                update("bedroom_count", count);
                // Auto-update rent if not manually edited
                if (form.rent_or_housing_cost === 1200 || form.rent_or_housing_cost === 1200 + ((form.bedroom_count - 1) * 300)) {
                  update("rent_or_housing_cost", newRent);
                }
              }}
              className="h-10 rounded-xl"
            />
            <p className="text-xs text-muted-foreground mt-1">Each bedroom adds ~$300 to base rent.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground uppercase">Monthly Utilities</label>
            {Object.entries(form.utility_costs).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground capitalize w-20">{key}:</label>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm">$</span>
                  <Input
                    type="number"
                    value={val || 0}
                    onChange={e => update("utility_costs", { ...form.utility_costs, [key]: parseFloat(e.target.value) || 0 })}
                    className="h-8 rounded-lg flex-1 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {form.category === 'gym' && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
          <label className="text-xs font-semibold text-foreground uppercase mb-2 block">Monthly Membership Fee</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              value={form.gym_membership_fee}
              onChange={e => update("gym_membership_fee", parseFloat(e.target.value))}
              placeholder="50"
              className="h-10 rounded-xl flex-1"
            />
          </div>
        </div>
      )}

      {/* Keywords */}
      <Input
        value={form.keywords}
        onChange={e => update("keywords", e.target.value)}
        placeholder="Keywords for matching: my place, the gym... (comma-separated)"
        className="h-11 rounded-xl text-sm"
      />

      {/* ── HOURS OF OPERATION ────────────────────────────────────── */}
      <div className="space-y-3">
        <LocationHoursEditor
          hours={form.operating_hours}
          onChange={(hours) => update("operating_hours", hours)}
        />
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button onClick={handleSave} disabled={!canSave} className="flex-1 rounded-xl">
          {editingLocation ? "Save Changes" : "Add Location"}
        </Button>
      </div>

      {!canSave && form.name.trim() && form.zones.length === 0 && !isGenericHome && (
        <p className="text-xs text-destructive text-center">Add at least one zone before saving.</p>
      )}
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Locations() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [inlineEditId, setInlineEditId] = useState(null); // ID of location being edited inline
  const [filter, setFilter] = useState("all");
  const [newlyCreatedLocation, setNewlyCreatedLocation] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locationReferences", currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ created_by: currentUser.email, status: "active" }),
    enabled: !!currentUser?.email,
  });

  // Helper: calculate NPC/family member age
  const getNPCAge = (name) => {
    for (const char of characters) {
      const familyMember = (char.family_members || []).find(fm => fm.name?.toLowerCase() === name.toLowerCase());
      if (familyMember && familyMember.age_at_creation != null) {
        const savedDate = familyMember.age_set_date || char.created_date;
        const base = new Date(savedDate);
        const birthdayMonth = (base.getMonth() + 0) % 12; // simplified: assume index 0
        const birthdayDay = base.getDate();
        const today = new Date();
        const thisYear = today.getFullYear();
        const baseYear = base.getFullYear();
        let birthday = new Date(thisYear, birthdayMonth, birthdayDay);
        if (birthday > today) birthday.setFullYear(thisYear - 1);
        const yearsPassed = birthday.getFullYear() - baseYear;
        return familyMember.age_at_creation + yearsPassed;
      }
    }
    return null;
  };

  // Helper: check if worker is too young (only check if age is defined)
  const isWorkerTooYoung = (workerId, category) => {
    const char = characters.find(c => c.id === workerId);
    // Only apply age restrictions if the character has a defined birthday
    if (char && char.birthday) {
      const age = new Date().getFullYear() - new Date(char.birthday).getFullYear();
      if (age < 16) return true; // too young for any work
      if ((category === 'social' || category === 'food_drink') && age < 21) return true; // bars/nightclubs
    }
    // No birthday = no age restrictions (generic/fictional NPC)
    return false;
  };

  const handleSave = async (formData, editingLocationId = null) => {
    let locationId;
    if (editingLocationId) {
      await base44.entities.LocationReference.update(editingLocationId, formData);
      locationId = editingLocationId;
      setNewlyCreatedLocation(null);
    } else {
      const created = await base44.entities.LocationReference.create(formData);
      locationId = created.id;
      setNewlyCreatedLocation({ id: created.id, name: formData.name, category: formData.category });
    }

    // Auto-sync job titles and education links from location → character profiles
    const workerIds = formData.worker_character_ids || [];
    const isEducation = formData.category === 'school' || formData.category === 'education';
    for (const charId of workerIds) {
      if (charId.startsWith('npc__')) continue;
      base44.functions.invoke('syncLocationJobToCharacter', {
        locationId,
        characterId: charId,
        syncType: isEducation ? 'education' : 'work',
      }).catch(() => {});
    }

    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
    setShowAddForm(false);
    setInlineEditId(null);
  };



  const handleDelete = async (id) => {
    const loc = locations.find(l => l.id === id);
    if (!loc) return;
    
    // Allow deletion if: user created it OR it's a global location
    const canDelete = loc.created_by === currentUser?.email || loc.location_type === 'global';
    
    if (!canDelete) {
      alert(`You can only delete locations you created.`);
      return;
    }
    
    if (!confirm(`Delete "${loc.name}"? This cannot be undone.`)) return;
    
    await base44.entities.LocationReference.delete(id);
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
  };

  const handleEdit = (location) => {
    setInlineEditId(location.id);
    setShowAddForm(false); // close add form if open
  };

  const characterIds = new Set(characters.map(c => c.id));
  const isCharacterHome = (l) => 
    l.location_type === "character_specific" || 
    characterIds.has(l.character_id) ||
    characterIds.has(l.owner_character_id) ||
    (l.resident_character_ids || []).some(id => characterIds.has(id));
  
  const filtered = (filter === "all" 
    ? locations 
    : filter === "character_specific"
    ? locations.filter(isCharacterHome)
    : locations.filter(l => l.location_type === filter && !isCharacterHome(l))
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-bold text-foreground">Location References</h1>
          <p className="text-xs text-muted-foreground">Zone-accurate visual references for generated images</p>
        </div>
        <Button onClick={() => { setInlineEditId(null); setShowAddForm(v => !v); }} size="sm" className="rounded-xl gap-1.5">
          <Plus className="w-4 h-4" /> Add
        </Button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Filter tabs */}
        <div className="flex gap-2 flex-1">
          {["all", "global", "character_specific"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
              {f === "all" ? "All" : f === "global" ? "🌐 Global" : "👤 Character"}
            </button>
          ))}
        </div>

        {/* Empty state */}
        {locations.length === 0 && !showAddForm && (
          <div className="text-center py-10 space-y-3">
            <MapPin className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <div>
              <p className="text-sm font-medium text-foreground">No locations yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Add locations and assign reference images to specific rooms or zones. The AI will use them for visual accuracy in generated images.
              </p>
            </div>
            <Button onClick={() => setShowAddForm(true)} className="rounded-xl gap-2">
              <Plus className="w-4 h-4" /> Add your first location
            </Button>
          </div>
        )}

        {/* Add new location form — only shows at top when adding */}
        <AnimatePresence>
          {showAddForm && (
            <LocationForm
              key="add-form"
              editingLocation={null}
              characters={characters}
              allLocations={locations}
              onSave={(data) => handleSave(data, null)}
              onCancel={() => setShowAddForm(false)}
              isWorkerTooYoung={isWorkerTooYoung}
              getNPCAge={getNPCAge}
            />
          )}
        </AnimatePresence>

        {/* Location list — each card may have inline edit form below it */}
        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map(loc => (
              <React.Fragment key={loc.id}>
                <LocationCard
                  location={loc}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  characters={characters}
                  currentUser={currentUser}
                />
                {/* Inline edit form — appears directly below the card being edited */}
                <AnimatePresence>
                  {inlineEditId === loc.id && (
                    <LocationForm
                      key={`edit-${loc.id}`}
                      editingLocation={loc}
                      characters={characters}
                      allLocations={locations}
                      onSave={(data) => handleSave(data, loc.id)}
                      onCancel={() => setInlineEditId(null)}
                      isWorkerTooYoung={isWorkerTooYoung}
                      getNPCAge={getNPCAge}
                    />
                  )}
                </AnimatePresence>
              </React.Fragment>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <BottomNav />

      {/* Location match suggestions after new location creation */}
      {newlyCreatedLocation && (
        <LocationMatchSuggestion
          locationId={newlyCreatedLocation.id}
          locationName={newlyCreatedLocation.name}
          locationCategory={newlyCreatedLocation.category}
          characters={characters}
          onClose={() => setNewlyCreatedLocation(null)}
          onLinked={() => queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] })}
        />
      )}
    </div>
  );
}