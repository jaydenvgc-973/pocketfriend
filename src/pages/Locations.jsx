import React, { useState, useEffect, useMemo, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, MapPin, Globe, User, Trash2, Upload, X, Pencil,
  ChevronDown, ChevronUp, Home, Briefcase, Coffee, Trees,
  Wine, GraduationCap, Heart, Dumbbell, ArrowLeft, Users,
  Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import LocationHoursEditor from "@/components/location/LocationHoursEditor";
import LocationMatchSuggestion from "@/components/approvals/LocationMatchSuggestion";
import LocationDetailPanel from "@/components/location/LocationDetailPanel";
import SavedPlaces from "@/components/location/SavedPlaces";
import LocationDescriptionGenerator from "@/components/location/LocationDescriptionGenerator";
import ZoneImageGenerator from "@/components/location/ZoneImageGenerator";
import JailInmatePanel from "@/components/location/JailInmatePanel";
import UniformsEditor from "@/components/location/UniformsEditor";
import GroupedCharacterSelector from "@/components/location/GroupedCharacterSelector";
import SchoolEnrollmentSection from "@/components/location/SchoolEnrollmentSection";
import ReligiousMemberSection from "@/components/location/ReligiousMemberSection";
import { Link } from "react-router-dom";
import EnvironmentManager from "@/components/location/EnvironmentManager";
import { getVenuePositions } from "@/lib/venuePositions";
import PositionInput from "@/components/location/PositionInput";
import { getEditableCharactersForModule } from "@/lib/characterEditableListResolver";
import { useStableLocationReferences } from "@/hooks/useStableLocationReferences";
import { calculateCharacterAvailability, getAvailabilityLabel, formatShiftDisplay } from "@/lib/characterAvailabilityEngine";
import { usePageContext } from "@/hooks/usePageContext";

const ZONE_PRESETS = {
  home: ["Living Room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bedroom 4", "Bathroom", "Dining Room", "Hallway", "Backyard", "Basement", "Office"],
  hotel: ["Lobby", "Standard Room", "Suite", "Deluxe Room", "Hallway", "Elevator", "Fitness Center", "Pool Area", "Restaurant", "Parking", "Rooftop"],
  shelter: ["Dormitory", "Common Area", "Intake Desk", "Bathroom", "Dining Hall", "Counseling Room", "Storage", "Entrance"],
  gym: ["Workout Floor", "Front Desk", "Locker Room", "Bathroom", "Stretching Area", "Cardio Zone", "Weight Room", "Pool", "Sauna"],
  workplace: ["Office", "Office 1", "Office 2", "Admin Office", "Manager Office", "Staff Office", "Break Room", "Conference Room", "Reception", "Hallway", "Parking"],
  social: ["Main Floor", "Bar Area", "VIP Section", "Outdoor Patio", "Entrance", "Bathroom"],
  food_drink: ["Dining Area", "Counter / Bar", "Outdoor Seating", "Bathroom", "Entrance"],
  grocery: ["Main Floor", "Produce", "Deli", "Checkout", "Entrance", "Bakery", "Pharmacy"],
  school: ["Classroom", "Classroom 2", "Hallway", "Office", "Admin Office", "Cafeteria", "Gym", "Courtyard", "Library", "Auditorium", "Parking"],
  education: ["Classroom", "Classroom 2", "Hallway", "Office", "Admin Office", "Cafeteria", "Gym", "Courtyard", "Library", "Auditorium", "Parking"],
  community: ["Main Hall", "Activity Room", "Office", "Waiting Area", "Kitchen", "Meeting Room", "Playground", "Parking", "Entrance"],
  religion: ["Main Sanctuary", "Prayer Room", "Chapel", "Office", "Admin Office", "Fellowship Hall", "Study Room", "Entrance", "Parking"],
  outdoor: ["Main Area", "Trail", "Parking", "Entrance", "Shelter / Pavilion", "Picnic Area", "Playground"],
  medical: ["Waiting Area", "Front Desk", "Triage", "Patient Room", "Hallway", "Office", "Admin Office", "Operating Room", "Recovery Room", "Pharmacy"],
  business: ["Office", "Office 1", "Office 2", "Admin Office", "Manager Office", "Staff Office", "Conference Room", "Break Room", "Reception", "Hallway"],
  government: ["Office", "Admin Office", "Reception", "Hallway", "Meeting Room", "Entrance"],
  public: ["Main Area", "Entrance", "Information Desk", "Hallway", "Bathroom"],
  generic: ["Main Area", "Entrance", "Back Area", "Bathroom"],
  other: ["Main Area", "Entrance", "Back Area", "Bathroom"],
  jail_prison: ["Cellblock", "Intake", "Visiting Area", "Exercise Yard", "Cafeteria", "Medical", "Administrative", "Holding Area"],
};

// Allowed character types for assignment in location selectors (workers, residents, inmates)
const ALLOWED_ASSIGNABLE_CHARACTER_TYPES = [
  'active_created_character',
  'npc_fictitious',
  'npc_family_member',
];

const CATEGORIES = [
  { value: "home", label: "Home", icon: Home, emoji: "🏠" },
  { value: "hotel", label: "Hotel (Temp)", icon: Home, emoji: "🏨" },
  { value: "shelter", label: "Shelter (Temp)", icon: Home, emoji: "🛖" },
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
  { value: "community", label: "Community", icon: Users, emoji: "🏘️" },
  { value: "government", label: "Government", icon: MapPin, emoji: "🏛️" },
  { value: "public", label: "Public", icon: MapPin, emoji: "🗺️" },
  { value: "generic", label: "Generic", icon: MapPin, emoji: "📍" },
  { value: "jail_prison", label: "Jail / Prison", icon: MapPin, emoji: "🔒" },
];

function LocationCard({ location, onDelete, onEdit, characters = [], currentUser = {}, onLocationUpdate }) {
  const isShared = location.scope === 'shared' || location.location_type === 'shared';
  const isAdmin = currentUser?.role === 'admin';
  const canEdit = !isShared || isAdmin;
  const [expanded, setExpanded] = useState(false);

  const handleUniformSave = async (updatedLocation) => {
    console.log('[UNIFORM-DETAIL-SAVE-DEBUG] Saving to DB:', { uniforms: updatedLocation.uniforms, correctional_attire: updatedLocation.correctional_attire });
    await base44.entities.LocationReference.update(updatedLocation.id, {
      uniforms: updatedLocation.uniforms || {},
      correctional_attire: updatedLocation.correctional_attire || {},
    });
    console.log('[UNIFORM-DETAIL-SAVE-DEBUG] Saved. Reloading...');
    onLocationUpdate?.();
  };
  const catDef = CATEGORIES.find(c => c.value === location.category) || CATEGORIES[CATEGORIES.length - 1];
  const zones = location.zones || [];
  const totalImages = zones.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0);

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
            {(location.category === 'home' || location.category === 'generic') && (() => {
              // Build name list from what we can resolve, but use the raw counts for the total
              const seenIds = new Set();
              const seenNames = new Set();
              const resolvedNames = [];

              // residents[] has character_name embedded — always use these first
              (location.residents || []).forEach(r => {
                if (r.character_id) {
                  if (seenIds.has(r.character_id)) return;
                  seenIds.add(r.character_id);
                }
                const name = r.character_name;
                if (name && !seenNames.has(name.toLowerCase())) {
                  seenNames.add(name.toLowerCase());
                  resolvedNames.push(name);
                }
              });

              // resident_character_ids[] — resolve name if possible, otherwise still count
              (location.resident_character_ids || []).forEach(id => {
                if (seenIds.has(id)) return;
                seenIds.add(id);
                const found = characters.find(c => c.id === id);
                const name = found?.name;
                if (name && !seenNames.has(name.toLowerCase())) {
                  seenNames.add(name.toLowerCase());
                  resolvedNames.push(name);
                }
              });

              // resident_family_members[] — name embedded
              (location.resident_family_members || []).forEach(f => {
                const name = f.name;
                if (name && !seenNames.has(name.toLowerCase())) {
                  seenNames.add(name.toLowerCase());
                  resolvedNames.push(name);
                }
              });

              // Total count = raw field lengths (authoritative), not just resolved names
              const totalCount = new Set([
                ...(location.resident_character_ids || []),
                ...(location.residents || []).map(r => r.character_id).filter(Boolean),
              ]).size + (location.resident_family_members || []).length;

              if (totalCount === 0) return null;

              const shown = resolvedNames.slice(0, 2);
              const remaining = totalCount - shown.length;
              return (
                <span className="text-xs text-blue-400/80 font-medium truncate">
                  {shown.length > 0 ? shown.join(', ') : `${totalCount} resident${totalCount !== 1 ? 's' : ''}`}
                  {shown.length > 0 && remaining > 0 ? ` +${remaining}` : ''}
                </span>
              );
            })()}
            {location.category !== 'home' && location.category !== 'generic' && location.resident_character_ids?.length > 0 && (
              <span className="text-xs text-blue-400/80 font-medium">
                {location.resident_character_ids.length} resident{location.resident_character_ids.length > 1 ? "s" : ""}
              </span>
            )}
            {(location.environments?.length > 0) && (
              <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                Mixed-Use
              </span>
            )}
            <span className="text-xs text-muted-foreground">· {zones.length} zone{zones.length !== 1 ? "s" : ""}</span>
            <span className="text-xs text-muted-foreground">· {totalImages} img{totalImages !== 1 ? "s" : ""}</span>
            {(location.category === 'home' || location.category === 'generic') && location.rent_or_housing_cost && (
              <span className="text-xs text-green-400/80 font-medium">${location.rent_or_housing_cost}/mo rent</span>
            )}
            {location.category === 'hotel' && (
              <span className="text-xs text-amber-400/80 font-medium">🏨 ${location.nightly_rate ?? 150}/night · Temp</span>
            )}
            {location.category === 'shelter' && (
              <span className="text-xs text-blue-400/80 font-medium">🛖 ${location.nightly_rate ?? 0}/night · Temp</span>
            )}
            {location.category === 'gym' && location.gym_membership_fee && (
              <span className="text-xs text-blue-400/80 font-medium">${location.gym_membership_fee}/mo membership</span>
            )}
            {location.category === 'religion' && location.religion_denomination && (
              <span className="text-xs text-purple-400/80 font-medium">{location.religion_denomination}</span>
            )}
            {(location.owner_character_name || (location.owner_is_npc && location.owner_npc_name)) && (
              <span className="text-xs text-muted-foreground/70">
                · {location.owner_role || "owner"}: {location.owner_is_npc ? location.owner_npc_name : location.owner_character_name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isShared && !isAdmin && (
            <span className="text-[9px] text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded-full font-medium">🔗 Shared</span>
          )}
          {canEdit && (
            <button onClick={() => onEdit(location)} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {canEdit && (
            <button onClick={() => onDelete(location.id)} className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
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
            <LocationDetailPanel location={location} characters={characters} currentUserId={currentUser?.id} currentUserEmail={currentUser?.email} onLocationUpdate={handleUniformSave} />
                    {isShared && !isAdmin && (
                      <div className="mx-4 mb-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <p className="text-xs text-amber-400">🔒 This is a shared location. Only admins can edit it. Your characters can visit but cannot be permanently assigned here.</p>
                      </div>
                    )}
                    <div className="px-4 pb-4 space-y-3">
              {(location.environments?.length > 0) && (
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Environments</p>
                  {location.environments.map(env => (
                    <div key={env.id} className="flex items-start gap-2 rounded-lg bg-secondary/40 border border-border px-3 py-2">
                      <span className="text-sm mt-0.5">{env.type === 'residential' ? '🏠' : '🏢'}</span>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-foreground">{env.name}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{env.type}</p>
                        {env.zone_names?.length > 0 && (
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5">{env.zone_names.join(" · ")}</p>
                        )}
                      </div>
                      {env.type === 'residential' && (
                        <span className="ml-auto text-[10px] text-emerald-400 font-medium flex-shrink-0">Always Open</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
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

const SUBTYPE_OPTIONS = {
  home: ["apartment", "house", "condo", "studio"],
  hotel: ["budget_motel", "standard_hotel", "boutique_hotel", "extended_stay", "hostel"],
  shelter: ["emergency_shelter", "transitional_shelter", "womens_shelter", "family_shelter", "overflow_shelter"],
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
  community: ["community_center", "drop_in_center", "after_school_program", "daycare", "youth_center", "resource_hub"],
  jail_prison: ["jail", "prison", "detention_center", "holding_cell", "correctional_facility", "juvenile_detention", "halfway_house", "confinement_facility", "pretrial_detention", "adult_detention", "immigration_detention"],
};

function ZoneEditor({ zone, onUpdateImages, onDelete, readOnly = false, locationName = "", category = "", subtype = [], locationDescription = "" }) {
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

  const handleGeneratedImage = (imageUrl) => {
    onUpdateImages([...(zone.image_urls || []), imageUrl]);
  };

  const imgCount = zone.image_urls?.length || 0;

  return (
    <div className="border border-border rounded-xl p-3 space-y-3 bg-secondary/30">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{zone.zone_name}</p>
        {!readOnly && <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg">
        <X className="w-3.5 h-3.5" />
        </button>}
      </div>
      {imgCount > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {zone.image_urls.map((url, i) => (
            <div key={i} className="relative group">
              <img src={url} alt={`${zone.zone_name} ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
              {!readOnly && <button
                onClick={() => removeImage(i)}
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>}
            </div>
          ))}
        </div>
      )}
      {!readOnly && imgCount < 5 && (
        <div className="space-y-2">
          <label className="block cursor-pointer">
            <input type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />
            <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-xs">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? "Uploading..." : `Upload images (${5 - imgCount} remaining)`}
            </div>
          </label>
          <ZoneImageGenerator
            zoneName={zone.zone_name}
            locationName={locationName}
            category={category}
            subtype={subtype}
            locationDescription={locationDescription}
            hasExistingImage={imgCount > 0}
            existingZoneImageUrls={zone.image_urls || []}
            onGenerate={handleGeneratedImage}
          />
        </div>
      )}
      {imgCount >= 5 && !readOnly && (
        <p className="text-xs text-muted-foreground text-center">Maximum 5 images per zone reached</p>
      )}
      {imgCount === 0 && !readOnly && (
        <p className="text-xs text-amber-500/80">⚠ No images yet — add reference photos for this zone</p>
      )}
    </div>
  );
}

const WORK_CATEGORIES = ['workplace', 'business', 'food_drink', 'gym', 'social', 'education', 'medical', 'school', 'grocery', 'religion', 'government', 'community', 'jail_prison'];
const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function formatShift(shift) {
  if (!shift) return null;
  const parts = [];
  if (shift.start && shift.end) parts.push(`${shift.start}–${shift.end}`);
  if (shift.days?.length > 0) parts.push(shift.days.map(d => DAY_LABELS[d]).join('/'));
  return parts.join(' ') || null;
}

function isShiftCurrentlyActive(shift) {
  if (!shift?.start || !shift?.end || !shift?.days) return false;
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  if (!shift.days.includes(day)) return false;
  const [startH] = shift.start.split(':').map(Number);
  const [endH] = shift.end.split(':').map(Number);
  return hour >= startH && hour < endH;
}

function getWorkerAvailabilityV2(character, allLocations, currentLocationId = null) {
  if (!character) return { status: 'unavailable', allJobs: [] };

  const seenLocIds = new Set();
  const allJobs = [];

  // ── SOURCE 1: LocationReference.worker_character_ids (ground truth) ──────────
  // Scan ALL locations for any that list this character as a worker.
  // This catches assignments where Character.occupation_location_id hasn't been synced yet.
  allLocations.forEach(loc => {
    if (loc.id === currentLocationId) return; // skip the location being edited
    const workerIds = loc.worker_character_ids || [];
    if (!workerIds.includes(character.id)) return;
    if (seenLocIds.has(loc.id)) return;
    seenLocIds.add(loc.id);
    const shift = loc.worker_shifts?.[character.id];
    const jobTitle = loc.worker_job_titles?.[character.id] || null;
    allJobs.push({
      name: loc.name,
      title: jobTitle,
      shift: formatShiftDisplay(shift),
      locationId: loc.id,
    });
  });

  // ── SOURCE 2: Character.occupation_location_id (may be ahead of LocationReference) ──
  if (character.occupation_location_id && character.occupation_location_id !== currentLocationId && !seenLocIds.has(character.occupation_location_id)) {
    const loc = allLocations.find(l => l.id === character.occupation_location_id);
    if (loc) {
      seenLocIds.add(loc.id);
      const shift = loc.worker_shifts?.[character.id];
      const jobTitle = character.work_details?.job_title || loc.worker_job_titles?.[character.id] || null;
      allJobs.push({ name: loc.name, title: jobTitle, shift: formatShiftDisplay(shift), locationId: loc.id });
    } else {
      // Location not in map yet — use Character-stored name as fallback
      const storedName = character.occupation_location_name;
      if (storedName) {
        seenLocIds.add(character.occupation_location_id);
        const storedTitle = character.work_details?.job_title || null;
        const storedShift = (character.work_start_time && character.work_end_time)
          ? formatShiftDisplay({ start: character.work_start_time, end: character.work_end_time, days: character.work_days })
          : null;
        allJobs.push({ name: storedName, title: storedTitle, shift: storedShift, locationId: character.occupation_location_id });
      }
    }
  }

  // ── SOURCE 3: Character.additional_occupation_locations ───────────────────────
  if (Array.isArray(character.additional_occupation_locations)) {
    character.additional_occupation_locations.forEach(addlOcc => {
      if (!addlOcc.location_id) return;
      if (addlOcc.location_id === currentLocationId) return;
      if (seenLocIds.has(addlOcc.location_id)) return;
      seenLocIds.add(addlOcc.location_id);
      const loc = allLocations.find(l => l.id === addlOcc.location_id);
      if (loc) {
        const shift = loc.worker_shifts?.[character.id];
        const jobTitle = addlOcc.job_title || loc.worker_job_titles?.[character.id] || null;
        allJobs.push({ name: addlOcc.location_name || loc.name, title: jobTitle, shift: formatShiftDisplay(shift), locationId: loc.id });
      } else if (addlOcc.location_name) {
        // Location not loaded — use Character-stored data
        allJobs.push({ name: addlOcc.location_name, title: addlOcc.job_title || null, shift: null, locationId: addlOcc.location_id });
      }
    });
  }

  const availability = calculateCharacterAvailability(character, allLocations, currentLocationId);

  return {
    status: availability.status,
    jobCount: allJobs.length,
    allJobs,
    isOnShiftNow: availability.isOnShiftNow,
  };
}

function LocationForm({ editingLocation, characters, onSave, onCancel, onDuplicate, isWorkerTooYoung, getNPCAge, allLocations = [], currentUser = {}, userSettings = null }) {
  const queryClient = useQueryClient();
  // Active characters via RLS
  // LEGACY COMPATIBILITY: Do NOT filter by character_type here.
  // Legacy characters (created before character_type was added) have no character_type field
  // and would be invisible to the worker/resident selectors if filtered by type.
  // The NPC query below separately fetches NPC types — active chars here includes all non-typed records.
  const { data: rlsActiveChars = [] } = useQuery({
    queryKey: ['locationFormActive', currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ owner_email: currentUser.email, status: "active" })
      : [],
    enabled: !!currentUser?.email,
  });

  // ALL NPCs via direct RLS query (same as main character list to ensure consistency)
  const { data: allNpcsRaw = [] } = useQuery({
    queryKey: ['locationFormNpcs', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const npcChars = await base44.entities.Character.filter({
        owner_email: currentUser.email,
        character_type: { $in: ['npc_fictitious', 'npc_family_member'] },
      });
      return npcChars.filter(c => c.status !== 'deleted' && c.status !== 'moved_away');
    },
    enabled: !!currentUser?.email,
  });

  // Merge and deduplicate into allCharacters (used by workers, owner picker, etc.)
  const allCharacters = React.useMemo(() => {
    const seen = new Set();
    return [...rlsActiveChars, ...allNpcsRaw].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return c.status !== 'deleted' && c.status !== 'moved_away' && c.status !== 'merged';
    });
  }, [rlsActiveChars, allNpcsRaw]);

  // Build lists — all scoped correctly by fetchNPCsForUser (service role)
  const activeChars = rlsActiveChars
    .filter(c => c.status !== 'deleted' && c.status !== 'moved_away')
    .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));
  
  // All assignable NPCs (npc_fictitious + npc_family_member)
  const assignableNpcs = allNpcsRaw
    .filter(c => ALLOWED_ASSIGNABLE_CHARACTER_TYPES.includes(c.character_type) && c.status !== 'deleted' && c.status !== 'moved_away')
    .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));

  // All assignable characters for workers, residents, inmates (no filtering by type)
  const allAssignableCharacters = [...activeChars, ...assignableNpcs]
    .filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i) // deduplicate
    .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''));

  // Compute initialWorkerIds: merge ALL sources — same resolution order as the arrow dropdown.
  // The arrow dropdown (LocationDetailPanel) uses: worker_character_ids || keys(worker_job_titles)
  // The edit form must resolve the same set to stay consistent.
  const computeInitialWorkerIds = () => {
    const ids = new Set();
    
    // SOURCE 1: Explicit worker_character_ids array on the location
    if (editingLocation?.worker_character_ids) {
      editingLocation.worker_character_ids.forEach(id => ids.add(id));
    }

    // SOURCE 2: Keys in worker_job_titles / worker_shifts / worker_pay_rates on the location
    // This is the canonical fallback the arrow dropdown already uses — must stay in sync.
    Object.keys(editingLocation?.worker_job_titles || {}).forEach(id => ids.add(id));
    Object.keys(editingLocation?.worker_shifts || {}).forEach(id => ids.add(id));
    Object.keys(editingLocation?.worker_pay_rates || {}).forEach(id => ids.add(id));

    // SOURCE 3: Characters whose occupation_location_id or additional_occupation_locations point here
    allCharacters.forEach(char => {
      if (!char || !char.id || char.status === 'deleted' || char.status === 'moved_away') return;
      if (char.owner_email !== currentUser?.email) return;
      
      if (char.occupation_location_id === editingLocation?.id) {
        ids.add(char.id);
      }
      
      if (Array.isArray(char.additional_occupation_locations)) {
        char.additional_occupation_locations.forEach(locEntry => {
          if (locEntry?.location_id === editingLocation?.id) {
            ids.add(char.id);
          }
        });
      }
    });
    
    return Array.from(ids);
  };
  
  const initialWorkerIds = editingLocation ? computeInitialWorkerIds() : [];

  const [form, setForm] = useState({
    name: editingLocation?.name || "",
    location_type: editingLocation?.location_type === "shared" ? "global" : (editingLocation?.location_type || "global"),
    is_shared: editingLocation?.location_type === "shared" || editingLocation?.scope === "shared" || false,
    character_id: editingLocation?.character_id || "",
    category: editingLocation?.category || "home",
    subtype: Array.isArray(editingLocation?.subtype) ? editingLocation.subtype : (editingLocation?.subtype ? [editingLocation.subtype] : []),
    description: editingLocation?.description || "",
    keywords: editingLocation?.keywords?.join(", ") || "",
    zones: editingLocation?.zones || [],
    resident_character_ids: editingLocation?.resident_character_ids || [],
    resident_family_members: editingLocation?.resident_family_members || [],
    resident_housing_context: editingLocation?.resident_housing_context || {},
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
    nightly_rate: editingLocation?.nightly_rate ?? (editingLocation?.category === 'shelter' ? 0 : 150),
    bedroom_count: editingLocation?.bedroom_count || 1,
    gym_membership_fee: editingLocation?.gym_membership_fee || 50,
    utility_costs: editingLocation?.utility_costs || { electricity: 80, water: 40, gas: 50, internet: 60, other: 0 },
    operating_hours: editingLocation?.operating_hours || [],
    worker_character_ids: initialWorkerIds,
    worker_pay_rates: editingLocation?.worker_pay_rates || {},
    worker_pay_type: editingLocation?.worker_pay_type || {},
    worker_job_titles: editingLocation?.worker_job_titles || {},
    worker_shifts: editingLocation?.worker_shifts || {},
    inmates: editingLocation?.inmates || [],
    correctional_attire: editingLocation?.correctional_attire || {},
    uniforms: editingLocation?.uniforms || {},
    worker_manual_uniforms: editingLocation?.worker_manual_uniforms || {},
    enrolled_students: editingLocation?.enrolled_students || [],
    residents: editingLocation?.residents || [],
    religious_members: editingLocation?.religious_members || [],
    environments: editingLocation?.environments || [],
  });
  const worldName = userSettings?.fictional_world_name || currentUser?.full_name || "You";
  const userAvatarUrl = currentUser?.selected_avatar_url || currentUser?.user_avatar_url || currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;
  const [newZoneName, setNewZoneName] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [residentSearch, setResidentSearch] = useState("");

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));

  // Update worker_character_ids when allCharacters data loads
  React.useEffect(() => {
    if (editingLocation && allCharacters.length > 0) {
      const updatedWorkerIds = computeInitialWorkerIds();
      setForm(p => ({ ...p, worker_character_ids: updatedWorkerIds }));
    }
  }, [allCharacters, editingLocation?.id]);

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

  const isGenericHome = form.is_default_generic;
  const canSave = form.name.trim() && (isGenericHome || form.zones.length > 0);

  const handleSave = () => {
    if (!canSave) return;
    const effectiveType = (form.location_type === "character_specific" && !form.character_id) ? "global" : form.location_type;
    const charObj = (effectiveType === "character_specific") ? characters.find(c => c.id === form.character_id) : null;
    const ownerChar = !form.owner_is_npc && form.owner_character_id
      ? (form.owner_character_id === currentUser?.id ? { name: worldName } : characters.find(c => c.id === form.owner_character_id))
      : null;
    onSave({
      ...form,
      location_type: effectiveType,
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

      <Input value={form.name} onChange={e => update("name", e.target.value)} placeholder="e.g. Jayden's Apartment, Downtown Gym" className="h-11 rounded-xl" />

      <div className="space-y-3">
        <label className="text-xs text-muted-foreground uppercase tracking-wider block">Type</label>
        <div className="grid grid-cols-2 gap-2">
          {["global", "character_specific"].map(t => (
            <button key={t} onClick={() => update("location_type", t)}
              className={`py-2 px-3 rounded-xl text-sm border transition-colors ${form.location_type === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
              {t === "global" ? "🌐 Global" : "👤 Character-specific"}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-border bg-card">
          <div>
            <p className="text-sm text-foreground font-medium">🔗 Shared</p>
            <p className="text-xs text-muted-foreground">Visible to all users (admin-controlled)</p>
          </div>
          <button
            onClick={() => update("is_shared", !form.is_shared)}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${form.is_shared ? "bg-primary" : "bg-secondary border border-border"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.is_shared ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
        {form.is_shared && currentUser?.role !== 'admin' && (
          <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-xl px-3 py-2">⚠️ Shared locations are admin-controlled. Once created, only admins can edit them.</p>
        )}
      </div>

      {form.location_type === "character_specific" && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Character</label>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            <button onClick={() => update("character_id", "")}
              className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${!form.character_id ? "bg-primary/10 border-primary/40 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
              <span className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs flex-shrink-0">—</span>
              <span className="text-sm">No character</span>
            </button>
            {activeChars.map(c => (
              <button key={c.id} onClick={() => update("character_id", c.id)}
                className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.character_id === c.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
                <CharacterAvatar character={c} size="sm" />
                <span className="text-sm text-foreground">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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

      {SUBTYPE_OPTIONS[form.category] && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Venue Type</label>
          <div className="grid grid-cols-2 gap-2">
            {SUBTYPE_OPTIONS[form.category].map(subtype => (
              <button key={subtype}
                onClick={() => update("subtype", form.subtype.includes(subtype) ? form.subtype.filter(s => s !== subtype) : [...form.subtype, subtype])}
                className={`py-2 px-3 rounded-xl text-xs border transition-colors text-left capitalize ${form.subtype.includes(subtype) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
                {subtype.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {form.category === 'religion' && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Religion / Denomination</label>
          <div className="grid grid-cols-2 gap-2">
            {["Christianity", "Catholicism", "Islam", "Judaism", "Hinduism", "Buddhism", "Sikhism", "Jehovah's Witnesses", "Seventh-day Adventist", "Baptist", "Pentecostal", "Non-denominational", "Other"].map(rel => (
              <button key={rel} onClick={() => update("religion_denomination", form.religion_denomination === rel ? "" : rel)}
                className={`py-2 px-3 rounded-xl text-xs border transition-colors text-left ${form.religion_denomination === rel ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
                {rel}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── ZONE SECTION ── */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
            Rooms / Zones <span className="text-destructive">*</span>
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">Each uploaded set of images must be assigned to a specific room or zone.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map(name => {
            const already = existingZoneNames.includes(name.toLowerCase());
            return (
              <button key={name} onClick={() => addPresetZone(name)} disabled={already}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${already ? "bg-primary/10 border-primary/30 text-primary cursor-default" : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                {already ? "✓ " : "+ "}{name}
              </button>
            );
          })}
          <button onClick={() => setShowCustomInput(v => !v)}
            className="px-3 py-1.5 rounded-full text-xs border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors">
            + Custom zone
          </button>
        </div>
        {showCustomInput && (
          <div className="flex gap-2">
            <Input value={newZoneName} onChange={e => setNewZoneName(e.target.value)} placeholder="e.g. Rooftop, Garage, Studio..." className="h-9 rounded-xl text-sm" onKeyDown={e => e.key === "Enter" && addCustomZone()} />
            <Button size="sm" onClick={addCustomZone} disabled={!newZoneName.trim()} className="rounded-xl px-4">Add</Button>
          </div>
        )}
        {form.zones.length === 0 && !isGenericHome && (
          <div className="py-4 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 text-center">
            <p className="text-xs text-destructive font-medium">At least one zone is required before uploading images.</p>
          </div>
        )}
        <div className="space-y-3">
          {form.zones.map((zone, i) => (
            <ZoneEditor 
              key={i} 
              zone={zone} 
              onUpdateImages={(urls) => updateZoneImages(i, urls)} 
              onDelete={() => removeZone(i)} 
              readOnly={form.location_type === 'shared' && currentUser?.role !== 'admin'}
              locationName={form.name}
              category={form.category}
              subtype={form.subtype}
              locationDescription={form.description}
            />
          ))}
        </div>
      </div>

      {/* ── RESIDENTS ── */}
      {(form.category === 'home' || form.category === 'hotel' || form.category === 'shelter' || form.category === 'generic' || form.category === 'outdoor' || form.category === 'community' || form.category === 'public') && form.location_type !== 'shared' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Who lives/stays here?</label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">
              {form.category === 'hotel' ? 'Add characters staying in this hotel temporarily. Not a permanent home.' : form.category === 'shelter' ? 'Add characters using this shelter. Not a permanent home.' : form.category === 'home' || form.category === 'generic' ? 'Add resident characters. Rent and utilities will be split among them.' : 'Add characters using this location for shelter or as a home base.'}
            </p>
            {(form.category === 'hotel' || form.category === 'shelter') && (
              <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-2">
                ⚠️ {form.category === 'hotel' ? 'Hotel is temporary paid lodging. Min $150/night. Characters assigned here will NOT be treated as permanently housed.' : 'Shelter is temporary low-cost or free lodging ($0–$10/night). Characters assigned here will NOT be treated as permanently housed.'}
              </p>
            )}
          </div>
          <div className="space-y-2">
            {form.resident_character_ids?.length > 0 || form.resident_family_members?.length > 0 ? (
              <>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {form.resident_character_ids.map((resId, idx) => {
                    const isUser = resId === currentUser?.id;
                    const resChar = isUser ? null : (allCharacters.find(c => c.id === resId) || characters.find(c => c.id === resId));
                    const displayName = isUser ? (currentUser?.full_name || "You") : (resChar?.name || resId);
                    const housingContext = (form.resident_housing_context || {})[resId];
                    return (
                      <div key={idx} className="space-y-2 p-3 rounded-lg bg-secondary/50 border border-border">
                        <div className="flex items-center gap-2">
                          {isUser ? (
                            <div className="w-7 h-7 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-primary">U</span>
                            </div>
                          ) : resChar ? <CharacterAvatar character={resChar} size="sm" /> : null}
                          <span className="text-sm text-foreground flex-1">{displayName}</span>
                          {isUser && <span className="text-xs text-primary/60">Player</span>}
                          <button onClick={() => update("resident_character_ids", form.resident_character_ids.filter((_, i) => i !== idx))} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {(form.category === 'outdoor' || form.category === 'community' || form.category === 'public') && (
                          <div className="flex gap-2">
                            {['shelter', 'homeless'].map(status => (
                              <button
                                key={status}
                                onClick={() => update("resident_housing_context", { ...form.resident_housing_context, [resId]: status })}
                                className={`flex-1 px-2 py-1.5 rounded-lg text-xs border transition-colors capitalize ${housingContext === status ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}
                              >
                                {status === 'shelter' ? '🏠 Shelter' : '🌙 Homeless'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {form.resident_family_members?.map((fam, idx) => {
                    // Resolve avatar: match by name against character entities first, then use embedded photo_url
                    const matchedChar = [...activeChars, ...assignableNpcs].find(c =>
                      c.name?.trim().toLowerCase() === fam.name?.trim().toLowerCase()
                    );
                    const resolvedAvatar = matchedChar?.avatar_url || fam.photo_url || fam.avatar_url || null;
                    return (
                    <div key={`fam-${idx}`} className="flex items-center gap-2 p-2 rounded-lg bg-secondary border border-border">
                      {resolvedAvatar ? (
                        <img src={resolvedAvatar} alt={fam.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-primary">{fam.name?.[0]?.toUpperCase() || "?"}</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">{fam.name}</p>
                        <p className="text-xs text-muted-foreground/70 capitalize">{fam.relationship_type}</p>
                      </div>
                      <button onClick={() => update("resident_family_members", form.resident_family_members.filter((_, i) => i !== idx))} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    );
                  })}
                </div>
                {(form.category === 'home' || form.category === 'generic') && (form.resident_character_ids.length + (form.residents?.length || 0) + (form.resident_family_members?.length || 0)) > 1 && (
                  <div className="mt-3 p-3 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
                    <label className="text-xs font-semibold text-foreground uppercase">Split costs</label>
                    <div className="flex gap-2">
                      {["even", "custom"].map(method => (
                        <button key={method} onClick={() => update("cost_split_method", method)}
                          className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors capitalize ${form.cost_split_method === method ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
                          {method === "even" ? "Split evenly" : "Custom split"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">No residents added yet.</p>
            )}
          </div>
          {/* Resident selector with search */}
          {(() => {
            const q = residentSearch.toLowerCase();

            const npcFamilyChars = allNpcsRaw
              .filter(c => c.character_type === 'npc_family_member' && c.status !== 'deleted' && c.status !== 'moved_away')
              .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            const userId = currentUser?.id;
            const playerMatchesSearch = !q || worldName.toLowerCase().includes(q);
            const filteredActive = activeChars.filter(c => !q || (c.display_name || c.name || '').toLowerCase().includes(q));
            const filteredNpcFict = assignableNpcs.filter(c => c.character_type === 'npc_fictitious' && (!q || (c.display_name || c.name || '').toLowerCase().includes(q)));
            const filteredNpcFamily = npcFamilyChars.filter(c => !q || (c.name || '').toLowerCase().includes(q));

            const SectionHeader = ({ label, count }) => (
              <div className="sticky top-0 z-10 flex items-center justify-between px-2 py-1 bg-card border-b border-border/50">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
                <span className="text-[10px] text-muted-foreground/60 bg-secondary px-1.5 py-0.5 rounded-full">{count}</span>
              </div>
            );

            return (
              <div className="space-y-1">
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={residentSearch}
                    onChange={e => setResidentSearch(e.target.value)}
                    placeholder="Search characters..."
                    className="w-full h-8 pl-8 pr-7 rounded-lg bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {residentSearch && (
                    <button onClick={() => setResidentSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Scrollable list */}
                <div className="max-h-96 overflow-y-auto rounded-xl border border-border bg-card">
                  {/* The Player */}
                  {playerMatchesSearch && (
                    <>
                      <SectionHeader label="The Player" count={1} />
                      {(() => {
                        const alreadyResident = userId && form.resident_character_ids?.includes(userId);
                        return (
                          <button onClick={() => { if (!alreadyResident && userId) update("resident_character_ids", [...(form.resident_character_ids || []), userId]); }}
                            disabled={alreadyResident || !userId}
                            className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors ${alreadyResident ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : "hover:bg-secondary"}`}>
                            {userAvatarUrl ? <img src={userAvatarUrl} alt={worldName} className="w-7 h-7 rounded-full object-cover flex-shrink-0" /> : (
                              <div className="w-7 h-7 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-primary">{worldName[0]?.toUpperCase()}</span>
                              </div>
                            )}
                            <span className="text-sm text-foreground font-medium flex-1">{worldName}</span>
                            {alreadyResident && <span className="text-xs text-primary font-medium">✓ Resident</span>}
                          </button>
                        );
                      })()}
                    </>
                  )}

                  {/* Active Characters */}
                  {filteredActive.length > 0 && (
                    <>
                      <SectionHeader label="Active Characters" count={filteredActive.length} />
                      {filteredActive.map(char => {
                        const alreadyResident = form.resident_character_ids?.includes(char.id);
                        return (
                          <button key={char.id} onClick={() => { if (!alreadyResident) update("resident_character_ids", [...(form.resident_character_ids || []), char.id]); }} disabled={alreadyResident}
                            className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors ${alreadyResident ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : "hover:bg-secondary"}`}>
                            <CharacterAvatar character={char} size="sm" />
                            <span className="text-sm text-foreground font-medium flex-1">{char.name}</span>
                            {alreadyResident && <span className="text-xs text-primary font-medium">✓ Resident</span>}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {/* NPC Fictitious */}
                  {filteredNpcFict.filter(c => c.character_type === 'npc_fictitious').length > 0 && (
                    <>
                      <SectionHeader label="NPC Fictitious" count={filteredNpcFict.filter(c => c.character_type === 'npc_fictitious').length} />
                      {filteredNpcFict.filter(c => c.character_type === 'npc_fictitious').map(npc => {
                        const alreadyResident = form.resident_character_ids?.includes(npc.id);
                        return (
                          <button key={npc.id} onClick={() => { if (!alreadyResident) update("resident_character_ids", [...(form.resident_character_ids || []), npc.id]); }} disabled={alreadyResident}
                            className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors ${alreadyResident ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : "hover:bg-secondary"}`}>
                            <CharacterAvatar character={npc} size="sm" />
                            <span className="text-sm text-foreground font-medium flex-1">{npc.name}</span>
                            {alreadyResident && <span className="text-xs text-primary font-medium">✓ Resident</span>}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {/* NPC Family Members */}
                  {filteredNpcFamily.length > 0 && (
                    <>
                      <SectionHeader label="NPC Family Members" count={filteredNpcFamily.length} />
                      {filteredNpcFamily.map(npc => {
                        const alreadyResident = form.resident_character_ids?.includes(npc.id);
                        return (
                          <button key={npc.id} onClick={() => { if (!alreadyResident) update("resident_character_ids", [...(form.resident_character_ids || []), npc.id]); }} disabled={alreadyResident}
                            className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors ${alreadyResident ? "bg-primary/10 border-l-2 border-primary opacity-50 cursor-default" : "hover:bg-secondary"}`}>
                            <CharacterAvatar character={npc} size="sm" />
                            <span className="text-sm text-foreground font-medium flex-1">{npc.name}</span>
                            <span className="text-[10px] text-muted-foreground/60">Family</span>
                            {alreadyResident && <span className="text-xs text-primary font-medium">✓ Resident</span>}
                          </button>
                        );
                      })}
                    </>
                  )}

                  {/* Empty state */}
                  {!playerMatchesSearch && filteredActive.length === 0 && filteredNpcFict.length === 0 && filteredNpcFamily.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No characters match "{residentSearch}"</p>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── WORKERS ── */}
      {form.location_type !== 'shared' && (form.category === 'workplace' || form.category === 'business' || form.category === 'food_drink' || form.category === 'gym' || form.category === 'social' || form.category === 'education' || form.category === 'medical' || form.category === 'school' || form.category === 'grocery' || form.category === 'religion' || form.category === 'government' || form.category === 'community' || form.category === 'jail_prison') && (
        <div className="space-y-3">
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Workers & Employees</label>

          {/* Current workers */}
          {form.worker_character_ids?.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto rounded-xl border border-border bg-card p-2">
              {form.worker_character_ids.map((workerId, idx) => {
                const worker = allCharacters.find(c => c.id === workerId);
                const workerName = worker?.name || workerId;
                return (
                  <div key={idx} className="bg-secondary/50 border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-2">
                        {worker ? <CharacterAvatar character={worker} size="sm" /> : (
                          <div className="w-7 h-7 rounded-full bg-secondary/60 flex items-center justify-center text-xs font-semibold text-muted-foreground flex-shrink-0">{workerName[0]?.toUpperCase()}</div>
                        )}
                        <span className="text-sm font-medium text-foreground">{workerName}</span>
                      </div>
                      <button onClick={() => update("worker_character_ids", form.worker_character_ids.filter((_, i) => i !== idx))} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">Type</label>
                        <select value={form.worker_pay_type[workerId] || 'hourly'} onChange={(e) => update("worker_pay_type", { ...form.worker_pay_type, [workerId]: e.target.value })} className="text-xs px-2 py-1.5 bg-input border border-border rounded text-foreground">
                          <option value="hourly">Hourly</option>
                          <option value="annual">Annual</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">Rate</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs">$</span>
                          <Input type="number" value={form.worker_pay_rates[workerId] || 0} onChange={(e) => update("worker_pay_rates", { ...form.worker_pay_rates, [workerId]: parseFloat(e.target.value) || 0 })} className="h-8 text-xs flex-1" placeholder="15" />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">Position</label>
                        <PositionInput category={form.category} value={form.worker_job_titles[workerId] || ''} onChange={(val) => update("worker_job_titles", { ...form.worker_job_titles, [workerId]: val })} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">Shift Start</label>
                        <Input type="time" value={form.worker_shifts?.[workerId]?.start || '09:00'} onChange={(e) => update("worker_shifts", { ...form.worker_shifts, [workerId]: { ...form.worker_shifts?.[workerId], start: e.target.value } })} className="h-8 text-xs" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-muted-foreground uppercase tracking-wider">Shift End</label>
                        <Input type="time" value={form.worker_shifts?.[workerId]?.end || '17:00'} onChange={(e) => update("worker_shifts", { ...form.worker_shifts, [workerId]: { ...form.worker_shifts?.[workerId], end: e.target.value } })} className="h-8 text-xs" />
                      </div>
                    </div>
                    <div className="pt-1 border-t border-border">
                      <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">Work Days</label>
                      <div className="flex gap-1 flex-wrap">
                        {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d, i) => {
                          const shiftDays = form.worker_shifts?.[workerId]?.days || [1,2,3,4,5];
                          const active = shiftDays.includes(i);
                          return (
                            <button key={i} type="button" onClick={() => {
                              const cur = form.worker_shifts?.[workerId]?.days || [1,2,3,4,5];
                              const newDays = active ? cur.filter(x => x !== i) : [...cur, i].sort();
                              update("worker_shifts", { ...form.worker_shifts, [workerId]: { ...form.worker_shifts?.[workerId], days: newDays } });
                            }}
                              className={`w-7 h-7 rounded-full text-[10px] font-medium border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:border-primary/40'}`}>{d}</button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add workers selector — shows availability, existing jobs and schedule */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Add Workers</label>
            <GroupedCharacterSelector
              allCharacters={allAssignableCharacters.filter(c => !form.worker_character_ids?.includes(c.id))}
              selectedIds={[]}
              onSelect={(charId, isSelected) => {
                if (isSelected) {
                  update("worker_character_ids", [...(form.worker_character_ids || []), charId]);
                }
              }}
              placeholder="Search to add workers..."
              getCharacterAvailability={(char) => getWorkerAvailabilityV2(char, allLocations, editingLocation?.id)}
            />
          </div>
        </div>
      )}

      {/* ── SCHOOL ENROLLMENT ── */}
      {(form.category === 'school' || form.category === 'education') && editingLocation?.id && (
        <SchoolEnrollmentSection
          location={{ ...editingLocation, enrolled_students: form.enrolled_students, residents: form.residents }}
          allCharacters={allAssignableCharacters}
          onUpdate={(updatedStudents, updatedResidents) => {
            if (updatedStudents !== undefined) update('enrolled_students', updatedStudents);
            if (updatedResidents !== undefined) update('residents', updatedResidents);
            queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
            queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
          }}
        />
      )}

      {/* ── RELIGIOUS MEMBERS ── */}
      {form.category === 'religion' && editingLocation?.id && (
        <ReligiousMemberSection
          location={{ ...editingLocation, religious_members: form.religious_members }}
          allCharacters={allAssignableCharacters}
          onUpdate={(updatedMembers) => {
            if (updatedMembers !== undefined) update('religious_members', updatedMembers);
            queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
            queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
          }}
        />
      )}

      {/* ── INMATES (Jail/Prison only) ── */}
      {form.category === 'jail_prison' && (
        <JailInmatePanel
          inmates={form.inmates || []}
          allCharacters={allAssignableCharacters}
          onChange={(inmates) => update('inmates', inmates)}
        />
      )}

      {/* ── UNIFORMS (all location types that can have workers/roles) ── */}
      {(form.category === 'jail_prison' || form.category === 'workplace' || form.category === 'business' || form.category === 'food_drink' || form.category === 'social' || form.category === 'medical' || form.category === 'school' || form.category === 'education' || form.category === 'gym' || form.category === 'religion' || form.category === 'government' || form.category === 'community' || form.category === 'grocery') && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Uniforms & Staff Attire</label>
          <p className="text-xs text-muted-foreground">Optional. Define uniforms for staff roles. Visitors, customers, and patrons are never given uniforms. Changes persist when you save the location.</p>
          <UniformsEditor
            location={{ ...form, uniforms: form.uniforms }}
            onUpdate={(updates) => {
              console.log('[UNIFORM-FORM-UPDATE]', updates);
              if (updates.uniforms !== undefined) update('uniforms', updates.uniforms);
            }}
          />
        </div>
      )}

      {/* ── OWNER ── */}
      <div className="space-y-3">
        <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Owner / Landlord (optional)</label>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => update("owner_is_npc", false)} className={`py-2 px-3 rounded-xl text-sm border transition-colors ${!form.owner_is_npc ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>👤 Active Character</button>
          <button onClick={() => update("owner_is_npc", true)} className={`py-2 px-3 rounded-xl text-sm border transition-colors ${form.owner_is_npc ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>🧑‍🤝‍🧑 NPC</button>
        </div>
        {!form.owner_is_npc ? (
           <div className="space-y-2 max-h-44 overflow-y-auto">
             <button onClick={() => update("owner_character_id", "")} className={`w-full flex items-center gap-2 p-2 rounded-xl border text-sm transition-colors ${!form.owner_character_id ? "bg-primary/10 border-primary/40 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
               <span className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs">—</span>
               No owner assigned
             </button>
             {currentUser?.id && (
               <button onClick={() => update("owner_character_id", currentUser.id)} className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.owner_character_id === currentUser.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
                 {userAvatarUrl ? <img src={userAvatarUrl} alt={worldName} className="w-7 h-7 rounded-full object-cover flex-shrink-0" /> : (
                   <div className="w-7 h-7 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center flex-shrink-0">
                     <span className="text-xs font-bold text-primary">{worldName[0]?.toUpperCase()}</span>
                   </div>
                 )}
                 <span className="text-sm text-foreground">{worldName}</span>
                 <span className="text-xs text-primary/60 ml-auto">Player</span>
               </button>
             )}
             {activeChars.map(c => (
               <button key={c.id} onClick={() => update("owner_character_id", c.id)} className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.owner_character_id === c.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
                 <CharacterAvatar character={c} size="sm" />
                 <span className="text-sm text-foreground">{c.name}</span>
               </button>
             ))}
             {assignableNpcs.filter(c => c.character_type === 'npc_fictitious').length > 0 && <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pt-2 pb-0.5">NPC Fictitious</p>}
             {assignableNpcs.filter(c => c.character_type === 'npc_fictitious').map(npc => (
               <button key={npc.id} onClick={() => update("owner_character_id", npc.id)} className={`w-full flex items-center gap-3 p-2 rounded-xl border transition-colors ${form.owner_character_id === npc.id ? "bg-primary/10 border-primary/40" : "bg-card border-border hover:border-primary/40"}`}>
                 <CharacterAvatar character={npc} size="sm" />
                 <span className="text-sm text-foreground">{npc.name}</span>
               </button>
             ))}

           </div>
         ) : (
          <Input value={form.owner_npc_name} onChange={e => update("owner_npc_name", e.target.value)} placeholder="NPC name (e.g. Mr. Hassan, The Landlord)" className="h-10 rounded-xl text-sm" />
        )}
        {(form.owner_character_id || (form.owner_is_npc && form.owner_npc_name.trim())) && (
          <div className="flex flex-wrap gap-2">
            {["owner", "landlord", "manager", "operator"].map(role => (
              <button key={role} onClick={() => update("owner_role", role)} className={`px-3 py-1.5 rounded-full text-xs border transition-colors capitalize ${form.owner_role === role ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>{role}</button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground uppercase tracking-wider">Description (optional)</label>
          <LocationDescriptionGenerator
            locationName={form.name}
            category={form.category}
            subtype={form.subtype}
            currentDescription={form.description}
            onGenerate={(newDescription) => update("description", newDescription)}
          />
        </div>
        <Textarea 
          value={form.description} 
          onChange={e => update("description", e.target.value)} 
          placeholder="Overall location description: style, atmosphere..." 
          className="rounded-xl min-h-[60px] text-sm resize-none" 
        />
      </div>

      {(form.category === 'home' || form.category === 'generic') && (
        <div className="space-y-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
          <div>
            <label className="text-xs font-semibold text-foreground uppercase mb-2 block">Monthly Rent</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input type="number" value={form.rent_or_housing_cost} onChange={e => update("rent_or_housing_cost", parseFloat(e.target.value))} placeholder="1200" className="h-10 rounded-xl flex-1" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground uppercase mb-2 block">Bedrooms</label>
            <Input type="number" min="1" value={form.bedroom_count} onChange={e => {
              const count = parseInt(e.target.value) || 1;
              update("bedroom_count", count);
              if (form.rent_or_housing_cost === 1200 || form.rent_or_housing_cost === 1200 + ((form.bedroom_count - 1) * 300)) {
                update("rent_or_housing_cost", 1200 + ((count - 1) * 300));
              }
            }} className="h-10 rounded-xl" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground uppercase">Monthly Utilities</label>
            {Object.entries(form.utility_costs).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground capitalize w-20">{key}:</label>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm">$</span>
                  <Input type="number" value={val || 0} onChange={e => update("utility_costs", { ...form.utility_costs, [key]: parseFloat(e.target.value) || 0 })} className="h-8 rounded-lg flex-1 text-sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {form.category === 'hotel' && (
        <div className="space-y-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
          <div>
            <label className="text-xs font-semibold text-foreground uppercase mb-1 block">🏨 Nightly Rate</label>
            <p className="text-xs text-muted-foreground mb-2">Minimum $150/night. If set below $150, it will be enforced to $150 at charge time.</p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input type="number" min="150" value={form.nightly_rate ?? 150} onChange={e => update("nightly_rate", Math.max(150, parseFloat(e.target.value) || 150))} placeholder="150" className="h-10 rounded-xl flex-1" />
              <span className="text-xs text-muted-foreground">/night</span>
            </div>
          </div>
        </div>
      )}

      {form.category === 'shelter' && (
        <div className="space-y-3 bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
          <div>
            <label className="text-xs font-semibold text-foreground uppercase mb-1 block">🛖 Nightly Rate</label>
            <p className="text-xs text-muted-foreground mb-2">$0 (free) to $10/night maximum. Leave at $0 for free shelters.</p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input type="number" min="0" max="10" value={form.nightly_rate ?? 0} onChange={e => {
                const val = parseFloat(e.target.value) || 0;
                if (val > 10) { update("nightly_rate", 10); } else { update("nightly_rate", val); }
              }} placeholder="0" className="h-10 rounded-xl flex-1" />
              <span className="text-xs text-muted-foreground">/night</span>
            </div>
            {(form.nightly_rate ?? 0) > 10 && (
              <p className="text-xs text-destructive mt-1">⚠️ Shelter nightly rate cannot exceed $10. Value capped at $10.</p>
            )}
          </div>
        </div>
      )}

      {form.category === 'gym' && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
          <label className="text-xs font-semibold text-foreground uppercase mb-2 block">Monthly Membership Fee</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input type="number" value={form.gym_membership_fee} onChange={e => update("gym_membership_fee", parseFloat(e.target.value))} placeholder="50" className="h-10 rounded-xl flex-1" />
          </div>
        </div>
      )}

      <Input value={form.keywords} onChange={e => update("keywords", e.target.value)} placeholder="Keywords for matching: my place, the gym... (comma-separated)" className="h-11 rounded-xl text-sm" />

      {/* ── ENVIRONMENTS ── */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">Mixed-Use Environments</label>
        <p className="text-xs text-muted-foreground">Optional. Only needed for locations that have distinct environments (e.g. a business zone AND a residential zone). Leave empty for standard single-use locations.</p>
        <EnvironmentManager
          zones={form.zones}
          environments={form.environments}
          onChange={(envs) => update("environments", envs)}
        />
      </div>

      <div className="space-y-3">
        <LocationHoursEditor hours={form.operating_hours} onChange={(hours) => update("operating_hours", hours)} />
      </div>

      {editingLocation && onDuplicate && (
        <Button variant="outline" onClick={onDuplicate} className="w-full rounded-xl gap-2 border-dashed">📋 Duplicate This Location</Button>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button onClick={handleSave} disabled={!canSave} className="flex-1 rounded-xl">{editingLocation ? "Save Changes" : "Add Location"}</Button>
      </div>
      {!canSave && form.name.trim() && form.zones.length === 0 && !isGenericHome && (
        <p className="text-xs text-destructive text-center">Add at least one zone before saving.</p>
      )}
    </motion.div>
  );
}

export default function Locations() {
  usePageContext({ page: 'locations' });

  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [inlineEditId, setInlineEditId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("locations");
  const [newlyCreatedLocation, setNewlyCreatedLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  // Uses the shared stable hook — same LKG rules as Home and Travel.
  // Prevents an unprotected bare query from returning [] and wiping the shared cache.
  const { locationsData: locations, isLoading: locationsLoading } = useStableLocationReferences(currentUser?.email);

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      // LEGACY COMPATIBILITY: Fetch ALL active characters owned by this user,
      // without filtering by character_type. Legacy characters may have no character_type
      // set (null/undefined) and would be invisible if we filter by character_type.
      // The NPC query filters by type because NPCs are always explicitly typed.
      const [activeChars, npcCharsRaw] = await Promise.all([
        base44.entities.Character.filter({
          owner_email: currentUser.email,
          status: "active",
        }),
        base44.entities.Character.filter({
          owner_email: currentUser.email,
          character_type: { $in: ['npc_fictitious', 'npc_family_member'] },
        }),
      ]);
      const seen = new Set();
      // Merge: active chars first, then NPCs not already in the active list
      return [...activeChars, ...npcCharsRaw].filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return c.status !== 'deleted' && c.status !== 'moved_away' && c.status !== 'merged';
      });
    },
    enabled: !!currentUser?.email,
  });

  const { data: userSettings = null } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return null;
      const s = await base44.entities.UserSettings.filter({ owner_email: currentUser.email });
      return s[0] || null;
    },
    enabled: !!currentUser?.email,
  });

  const getNPCAge = (name) => {
    for (const char of characters) {
      const familyMember = (char.family_members || []).find(fm => fm.name?.toLowerCase() === name.toLowerCase());
      if (familyMember && familyMember.age_at_creation != null) {
        const savedDate = familyMember.age_set_date || char.created_date;
        const base = new Date(savedDate);
        const birthdayMonth = (base.getMonth() + 0) % 12;
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

  const isWorkerTooYoung = (workerId, category) => {
    const char = characters.find(c => c.id === workerId);
    if (char && char.birthday) {
      const age = new Date().getFullYear() - new Date(char.birthday).getFullYear();
      if (age < 16) return true;
      if ((category === 'social' || category === 'food_drink') && age < 21) return true;
    }
    return false;
  };

  const handleSave = async (formData, editingLocationId = null) => {
    let locationId;
    const isAdmin = currentUser?.role === 'admin';
    const scopeValue = formData.is_shared ? 'shared' : 'account_global';
    
    // ── AUTO-SET CONFINEMENT FLAGS ────────────────────────────────────────────
    // If the category is jail_prison, automatically set is_confinement_facility
    // and the corresponding confinement_type from the selected subtype
    let confinementData = {};
    if (formData.category === 'jail_prison' && formData.subtype && formData.subtype.length > 0) {
      confinementData = {
        is_confinement_facility: true,
        confinement_type: formData.subtype[0], // use first selected subtype as confinement_type
      };
    } else if (formData.category === 'jail_prison') {
      // Default to 'jail' if no subtype selected
      confinementData = {
        is_confinement_facility: true,
        confinement_type: 'jail',
      };
    }
    
    const enrichedFields = {
      scope: scopeValue,
      location_type: formData.is_shared ? 'shared' : formData.location_type,
      created_by_role: isAdmin ? 'admin' : (currentUser?.role || 'user'),
      ...confinementData,
    };

    // ── PRESERVE UI SCHEDULE TRUTH ──────────────────────────────────────────
    // The Locations page shows 09:00–17:00 Mon-Fri as the starting defaults for new workers.
    // These are the user-facing values — persist them as the real stored schedule.
    const guaranteedShifts = { ...(formData.worker_shifts || {}) };
    (formData.worker_character_ids || []).forEach(workerId => {
      if (!guaranteedShifts[workerId] || !guaranteedShifts[workerId].start || !guaranteedShifts[workerId].end) {
        guaranteedShifts[workerId] = {
          start: guaranteedShifts[workerId]?.start || '09:00',
          end: guaranteedShifts[workerId]?.end || '17:00',
          days: guaranteedShifts[workerId]?.days || [1, 2, 3, 4, 5],
        };
      }
    });
    const saveData = { ...formData, worker_shifts: guaranteedShifts };
    // ────────────────────────────────────────────────────────────────────────

    if (editingLocationId) {
      await base44.entities.LocationReference.update(editingLocationId, { ...saveData, ...enrichedFields });
      locationId = editingLocationId;
      setNewlyCreatedLocation(null);
    } else {
      const enriched = {
        ...saveData,
        ...enrichedFields,
        owner_email: currentUser?.email,
        owner_user_id: currentUser?.id,
      };
      const created = await base44.entities.LocationReference.create(enriched);
      locationId = created.id;
      setNewlyCreatedLocation({ id: created.id, name: formData.name, category: formData.category });
    }

    // ── HOMELESS / SHELTER PERSISTENCE ─────────────────────────────────────────
    // Write housing context from the location form back to each affected Character record.
    // This ensures the character's own entity reflects their housing truth, not just the location.
    const housingContext = formData.resident_housing_context || {};
    const residentIds = formData.resident_character_ids || [];
    for (const charId of residentIds) {
      if (!charId || charId === currentUser?.id) continue; // skip user player slot
      const ctx = housingContext[charId];
      if (ctx === 'homeless') {
        console.log(`[HOUSING] Writing homeless status to character ${charId} at location ${locationId}`);
        base44.entities.Character.update(charId, {
          is_homeless: true,
          housing_context: 'homeless_unsheltered',
          current_home_location_id: locationId, // still track the base location
        }).catch(err => console.error(`[HOUSING] Failed to update character ${charId}:`, err.message));
      } else if (ctx === 'shelter') {
        console.log(`[HOUSING] Writing shelter status to character ${charId} at location ${locationId}`);
        base44.entities.Character.update(charId, {
          is_homeless: false,
          housing_context: 'temporary_shelter',
          current_home_location_id: locationId,
        }).catch(err => console.error(`[HOUSING] Failed to update character ${charId}:`, err.message));
      } else if (ctx === undefined || ctx === null) {
        // Standard resident — ensure housing flags are cleared if previously homeless/shelter
        const existingChar = characters.find(c => c.id === charId);
        if (existingChar?.is_homeless || existingChar?.housing_context) {
          base44.entities.Character.update(charId, {
            is_homeless: false,
            housing_context: 'stable_home',
          }).catch(() => {});
        }
      }
    }

    // ── HOME ASSIGNMENT: write current_home_location_id back to each resident Character ──
    // This is the authoritative source — if a character is listed as a resident here,
    // their Character record must reflect this location as their home.
    if (formData.category === 'home' || formData.category === 'generic') {
      const residentIds = formData.resident_character_ids || [];
      for (const charId of residentIds) {
        if (!charId || charId === currentUser?.id) continue; // skip user player slot
        base44.entities.Character.update(charId, {
          current_home_location_id: locationId,
        }).catch(() => {});
      }
    }

    // ── HOTEL/SHELTER ASSIGNMENT: set temporary_housing_location_id, NOT permanent home ──
    if (formData.category === 'hotel' || formData.category === 'shelter') {
      const residentIds = formData.resident_character_ids || [];
      for (const charId of residentIds) {
        if (!charId || charId === currentUser?.id) continue;
        const isHotel = formData.category === 'hotel';
        base44.entities.Character.update(charId, {
          temporary_housing_location_id: locationId,
          is_homeless: false,
          housing_context: 'temporary_shelter',
          resolved_current_location_id: locationId,
          resolved_current_location_name: formData.name,
          resolved_location_type: 'temporary_housing',
          resolved_presence_status: 'temporary_housing',
          resolved_source_reason: isHotel ? 'hotel_temporary_lodging' : 'shelter_temporary_lodging',
        }).catch(err => console.error(`[HOUSING] Failed to update temp housing for ${charId}:`, err.message));
      }
    }

    const workerIds = saveData.worker_character_ids || [];
    const isEducation = saveData.category === 'school' || saveData.category === 'education';
    // AWAIT all sync calls — job assignment must be fully written to Character entity
    // before the form closes and queries invalidate. Fire-and-forget is not acceptable here.
    await Promise.all(
      workerIds
        .filter(charId => !charId.startsWith('npc__'))
        .map(charId =>
          base44.functions.invoke('syncLocationJobToCharacter', {
            locationId,
            characterId: charId,
            syncType: isEducation ? 'education' : 'work',
          }).catch(err => console.error('[handleSave] syncLocationJobToCharacter failed for', charId, err?.message))
        )
    );

    // ── IMMEDIATE REACT QUERY CACHE PATCH ─────────────────────────────────────
    // Patch character cache entries with updated work/occupation data so cross-location
    // state is immediately reflected without waiting for a full refetch.
    if (workerIds.length > 0) {
      const cacheKey = ['characters', currentUser?.email];
      const cachedChars = queryClient.getQueryData(cacheKey);
      if (Array.isArray(cachedChars)) {
        const patchedChars = cachedChars.map(c => {
          if (!workerIds.includes(c.id)) return c;
          const shift = saveData.worker_shifts?.[c.id] || null;
          const jobTitle = saveData.worker_job_titles?.[c.id] || '';
          // Only patch primary occupation if character has none yet
          if (!c.occupation_location_id) {
            return {
              ...c,
              occupation_location_id: locationId,
              occupation_location_name: saveData.name,
              current_work_location_id: locationId,
              ...(shift?.start ? { work_start_time: shift.start } : {}),
              ...(shift?.end ? { work_end_time: shift.end } : {}),
              ...(shift?.days?.length > 0 ? { work_days: shift.days } : {}),
              work_details: { ...(c.work_details || {}), job_title: jobTitle, location_name: saveData.name },
            };
          } else if (c.occupation_location_id === locationId) {
            return {
              ...c,
              current_work_location_id: locationId,
              ...(shift?.start ? { work_start_time: shift.start } : {}),
              ...(shift?.end ? { work_end_time: shift.end } : {}),
              ...(shift?.days?.length > 0 ? { work_days: shift.days } : {}),
              work_details: { ...(c.work_details || {}), job_title: jobTitle },
            };
          } else {
            // Add to additional_occupation_locations cache if not already there
            const existing = c.additional_occupation_locations || [];
            const alreadyLinked = existing.some(e => e.location_id === locationId);
            if (!alreadyLinked) {
              return {
                ...c,
                additional_occupation_locations: [
                  ...existing,
                  { location_id: locationId, location_name: saveData.name, job_title: jobTitle },
                ],
              };
            }
          }
          return c;
        });
        queryClient.setQueryData(cacheKey, patchedChars);
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── INMATE CONFINEMENT SYNC ─────────────────────────────────────────────────
    // For jail_prison locations, write confinement state back to each inmate's Character record.
    if (formData.category === 'jail_prison') {
      const inmates = formData.inmates || [];
      for (const inmate of inmates) {
        if (!inmate.character_id) continue;
        const isReleased = inmate.confinement_status === 'released';
        if (isReleased) {
          // Clear confinement on release
          base44.entities.Character.update(inmate.character_id, {
            is_jailed: false,
            incarceration_facility_id: null,
            incarceration_facility_name: null,
            incarceration_status: 'released',
            resolved_current_location_id: null,
            resolved_current_location_name: null,
            resolved_location_type: null,
            resolved_presence_status: null,
            resolved_source_reason: 'released_from_confinement',
          }).catch(() => {});
        } else {
          // Set/enforce confinement
          base44.entities.Character.update(inmate.character_id, {
            is_jailed: true,
            incarceration_facility_id: locationId,
            incarceration_facility_name: formData.name,
            incarceration_status: inmate.confinement_status || 'sentenced',
            jail_sentence_days: inmate.sentence_days || null,
            jail_release_date: inmate.expected_release_date ? new Date(inmate.expected_release_date).toISOString() : null,
            jailed_at: inmate.confined_at || new Date().toISOString(),
            pending_charges: inmate.charges ? [inmate.charges] : [],
            resolved_current_location_id: locationId,
            resolved_current_location_name: formData.name,
            resolved_location_type: 'incarcerated',
            resolved_presence_status: 'incarcerated',
            resolved_source_reason: 'confined_by_user',
          }).catch(() => {});
        }
      }
    }

    // ── PATCH locationReferences cache immediately ────────────────────────────
    // So the next location form opened in this session sees updated worker_character_ids
    // and worker_shifts immediately — without waiting for a refetch.
    const locCacheKey = ["locationReferences", currentUser?.email];
    const cachedLocs = queryClient.getQueryData(locCacheKey);
    if (Array.isArray(cachedLocs) && locationId) {
      const patchedLocs = cachedLocs.map(l => {
        if (l.id !== locationId) return l;
        const mergedWorkerIds = Array.from(new Set([...(l.worker_character_ids || []), ...workerIds]));
        return {
          ...l,
          worker_character_ids: mergedWorkerIds,
          worker_shifts: { ...(l.worker_shifts || {}), ...guaranteedShifts },
          worker_pay_rates: { ...(l.worker_pay_rates || {}), ...saveData.worker_pay_rates },
          worker_pay_type: { ...(l.worker_pay_type || {}), ...saveData.worker_pay_type },
          worker_job_titles: { ...(l.worker_job_titles || {}), ...saveData.worker_job_titles },
        };
      });
      queryClient.setQueryData(locCacheKey, patchedLocs);
    }
    // ──────────────────────────────────────────────────────────────────────────

    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    // Invalidate workLocations for every worker assigned — so CharacterProfile Income Sources
    // reflects the new assignment immediately without waiting for the 2-minute stale window.
    workerIds.forEach(charId => {
      queryClient.invalidateQueries({ queryKey: ['workLocations', charId] });
    });
    setShowAddForm(false);
    setInlineEditId(null);
  };

  const handleDelete = async (id) => {
    const loc = locations.find(l => l.id === id);
    if (!loc) return;
    const isShared = loc.scope === 'shared' || loc.location_type === 'shared';
    if (isShared && currentUser?.role !== 'admin') { alert('Shared locations can only be deleted by admins.'); return; }
    const isOwner = loc.owner_email === currentUser?.email;
    const canDelete = isOwner || loc.location_type === 'global';
    if (!canDelete) { alert(`You can only delete locations you created.`); return; }
    if (!confirm(`Delete "${loc.name}"? This cannot be undone.`)) return;
    await base44.entities.LocationReference.delete(id);
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
  };

  const handleEdit = (location) => { setInlineEditId(location.id); setShowAddForm(false); };

  const handleDuplicate = async (location) => {
    const { id, created_date, updated_date, ...rest } = location;
    const duplicate = { ...rest, name: `${rest.name} (Copy)` };
    const created = await base44.entities.LocationReference.create(duplicate);
    setNewlyCreatedLocation({ id: created.id, name: duplicate.name, category: duplicate.category });
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
    setInlineEditId(null);
  };

  const characterIds = new Set(characters.map(c => c.id));
  const isCharacterHome = (l) =>
    l.location_type === "character_specific" ||
    characterIds.has(l.character_id) ||
    characterIds.has(l.owner_character_id) ||
    l.owner_character_id === currentUser?.id ||
    (l.resident_character_ids || []).some(id => characterIds.has(id) || id === currentUser?.id);

  const getFilteredAndGrouped = () => {
    let allFiltered = [...locations].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      allFiltered = allFiltered.filter(l =>
        l.name?.toLowerCase().includes(q) ||
        l.category?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q)
      );
    }

    if (filter === "global") {
      return { all: allFiltered.filter(l => l.location_type === "global" && !isCharacterHome(l)) };
    } else if (filter === "character_specific") {
      return { all: allFiltered.filter(isCharacterHome) };
    }

    return {
      global: allFiltered.filter(l => !isCharacterHome(l)),
      characterSpecific: allFiltered.filter(isCharacterHome),
    };
  };

  const filtered = getFilteredAndGrouped();

  const renderLocationCard = (loc) => (
    <React.Fragment key={loc.id}>
      <LocationCard location={loc} onDelete={handleDelete} onEdit={handleEdit} characters={characters} currentUser={currentUser} onLocationUpdate={() => queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] })} />
      {inlineEditId === loc.id && (
        <LocationForm
          key={`edit-${loc.id}`}
          editingLocation={loc}
          characters={characters}
          allLocations={locations}
          onSave={(data) => handleSave(data, loc.id)}
          onCancel={() => setInlineEditId(null)}
          onDuplicate={() => handleDuplicate(loc)}
          isWorkerTooYoung={isWorkerTooYoung}
          getNPCAge={getNPCAge}
          currentUser={currentUser}
          userSettings={userSettings}
        />
      )}
    </React.Fragment>
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
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name or category..."
            className="w-full h-10 pl-9 pr-9 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-2 border-b border-border pb-3">
          <button onClick={() => setActiveTab("locations")} className={`px-4 py-1.5 text-xs font-medium border-b-2 transition-colors ${activeTab === "locations" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>All Locations</button>
          <button onClick={() => setActiveTab("saved_places")} className={`px-4 py-1.5 text-xs font-medium border-b-2 transition-colors ${activeTab === "saved_places" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>📍 Saved Places</button>
        </div>

        {activeTab === "locations" && (
          <div className="flex gap-2">
            {["all", "global", "character_specific"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
                {f === "all" ? "All" : f === "global" ? "🌐 Global" : "👤 Character"}
              </button>
            ))}
          </div>
        )}

        {activeTab === "saved_places" ? (
          <SavedPlaces currentUser={currentUser} onLocationSelect={() => {}} />
        ) : (
          <>
            {locationsLoading && (
              <div className="text-center py-10">
                <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
                <p className="text-xs text-muted-foreground mt-2">Loading locations...</p>
              </div>
            )}
            {!locationsLoading && locations.length === 0 && !showAddForm && (
              <div className="text-center py-10 space-y-3">
                <MapPin className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                <div>
                  <p className="text-sm font-medium text-foreground">No locations yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">Add locations and assign reference images to specific rooms or zones.</p>
                </div>
                <Button onClick={() => setShowAddForm(true)} className="rounded-xl gap-2">
                  <Plus className="w-4 h-4" /> Add your first location
                </Button>
              </div>
            )}

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
                  currentUser={currentUser}
                  userSettings={userSettings}
                />
              )}
            </AnimatePresence>

            <div className="space-y-4">
              {filter === "all" && filtered.global && filtered.global.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">🌐 Global Locations</h2>
                  <AnimatePresence>{filtered.global.map(renderLocationCard)}</AnimatePresence>
                </div>
              )}
              {filter === "all" && filtered.characterSpecific && filtered.characterSpecific.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">👤 Character Locations</h2>
                  <AnimatePresence>{filtered.characterSpecific.map(renderLocationCard)}</AnimatePresence>
                </div>
              )}
              {filter !== "all" && filtered.all && (
                <AnimatePresence>{filtered.all.map(renderLocationCard)}</AnimatePresence>
              )}
            </div>
          </>
        )}
      </div>

      <BottomNav />

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