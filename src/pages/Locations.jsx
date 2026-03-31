import { useState } from "react";
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
import { Link } from "react-router-dom";

// ── Zone presets per category ────────────────────────────────────────────────
const ZONE_PRESETS = {
  home: ["Living Room", "Kitchen", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bathroom", "Dining Room", "Hallway", "Backyard", "Basement", "Office"],
  gym: ["Workout Floor", "Front Desk", "Locker Room", "Bathroom", "Stretching Area", "Cardio Zone", "Weight Room", "Pool", "Sauna"],
  workplace: ["Office", "Office 1", "Office 2", "Break Room", "Conference Room", "Reception", "Hallway", "Parking"],
  social: ["Main Floor", "Bar Area", "VIP Section", "Outdoor Patio", "Entrance", "Bathroom"],
  food_drink: ["Dining Area", "Counter / Bar", "Outdoor Seating", "Bathroom", "Entrance"],
  grocery: ["Main Floor", "Produce", "Deli", "Checkout", "Entrance"],
  religion: ["Main Sanctuary", "Prayer Room", "Office", "Fellowship Hall", "Entrance"],
  outdoor: ["Main Area", "Trail", "Parking", "Entrance", "Shelter / Pavilion"],
  education: ["Classroom", "Hallway", "Office", "Cafeteria", "Gym", "Courtyard", "Library", "Auditorium"],
  medical: ["Waiting Area", "Front Desk", "Triage", "Patient Room", "Hallway", "Operating Room", "Recovery Room", "Pharmacy"],
  business: ["Office", "Office 1", "Office 2", "Conference Room", "Break Room", "Reception", "Hallway"],
  government: ["Office", "Reception", "Hallway", "Meeting Room", "Entrance"],
  generic: ["Main Area", "Entrance", "Back Area", "Bathroom"],
  other: ["Main Area", "Entrance", "Back Area", "Bathroom"],
};

const CATEGORIES = [
  { value: "home", label: "Home", icon: Home },
  { value: "workplace", label: "Workplace", icon: Briefcase },
  { value: "gym", label: "Gym", icon: Dumbbell },
  { value: "grocery", label: "Grocery Store", icon: Coffee },
  { value: "religion", label: "Religion / Worship", icon: GraduationCap },
  { value: "food_drink", label: "Food & Drink", icon: Coffee },
  { value: "outdoor", label: "Outdoors", icon: Trees },
  { value: "social", label: "Social / Nightlife", icon: Wine },
  { value: "education", label: "Education", icon: GraduationCap },
  { value: "medical", label: "Medical", icon: Heart },
  { value: "business", label: "Business", icon: Briefcase },
  { value: "school", label: "School", icon: GraduationCap },
  { value: "government", label: "Government", icon: MapPin },
  { value: "public", label: "Public", icon: MapPin },
  { value: "generic", label: "Generic", icon: MapPin },
];

// ── LocationCard ─────────────────────────────────────────────────────────────
function LocationCard({ location, onDelete, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const catDef = CATEGORIES.find(c => c.value === location.category) || CATEGORIES[CATEGORIES.length - 1];
  const CatIcon = catDef.icon;
  const zones = location.zones || [];
  const totalImages = zones.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0);
  const isGenericHome = location.is_default_generic;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-card border border-border rounded-2xl overflow-hidden"
    >
      <div className="flex items-center gap-3 p-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <CatIcon className="w-5 h-5 text-primary" />
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
            {!isGenericHome && (
              <>
                <span className="text-xs text-muted-foreground">· {zones.length} zone{zones.length !== 1 ? "s" : ""}</span>
                <span className="text-xs text-muted-foreground">· {totalImages} img{totalImages !== 1 ? "s" : ""}</span>
              </>
            )}
            {isGenericHome && (
              <span className="text-xs text-amber-500/80 font-medium">Generic Home</span>
            )}
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
            <div className="p-4 space-y-4">
              {location.description && (
                <p className="text-xs text-muted-foreground">{location.description}</p>
              )}
              {location.keywords?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {location.keywords.map(kw => (
                    <span key={kw} className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">{kw}</span>
                  ))}
                </div>
              )}
              {zones.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No zones added yet.</p>
              )}
              {zones.map((zone, zi) => (
                <div key={zi} className="space-y-2">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">{zone.zone_name}</p>
                  {zone.image_urls?.length > 0 ? (
                    <div className="grid grid-cols-4 gap-2">
                      {zone.image_urls.map((url, i) => (
                        <img key={i} src={url} alt={`${zone.zone_name} ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No images for this zone.</p>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

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

// ── LocationForm ─────────────────────────────────────────────────────────────
function LocationForm({ editingLocation, characters, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: editingLocation?.name || "",
    location_type: editingLocation?.location_type || "global",
    character_id: editingLocation?.character_id || "",
    category: editingLocation?.category || "home",
    description: editingLocation?.description || "",
    keywords: editingLocation?.keywords?.join(", ") || "",
    zones: editingLocation?.zones || [],
    owner_character_id: editingLocation?.owner_character_id || "",
    owner_character_name: editingLocation?.owner_character_name || "",
    owner_is_npc: editingLocation?.owner_is_npc || false,
    owner_npc_name: editingLocation?.owner_npc_name || "",
    owner_role: editingLocation?.owner_role || "owner",
    is_default_generic: editingLocation?.is_default_generic || false,
    rent_or_housing_cost: editingLocation?.rent_or_housing_cost || 1200,
    bedroom_count: editingLocation?.bedroom_count || 1,
    gym_membership_fee: editingLocation?.gym_membership_fee || 50,
    utility_costs: editingLocation?.utility_costs || { electricity: 80, water: 40, gas: 50, internet: 60, other: 0 },
    operating_hours: editingLocation?.operating_hours || [],
    worker_character_ids: editingLocation?.worker_character_ids || [],
    worker_pay_rates: editingLocation?.worker_pay_rates || {},
    worker_pay_type: editingLocation?.worker_pay_type || {},
    worker_job_titles: editingLocation?.worker_job_titles || {},
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
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            return (
              <button key={cat.value} onClick={() => update("category", cat.value)}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs transition-colors ${form.category === cat.value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
                <Icon className="w-4 h-4" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

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

      {/* ── WORKER PAY SETTINGS ───────────────────────────────────── */}
      {form.worker_character_ids && form.worker_character_ids.length > 0 && (
        <div className="bg-secondary/30 border border-border rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Worker Pay</h4>
          {form.worker_character_ids.map((workerId) => {
            const worker = characters.find(c => c.id === workerId);
            return (
              <div key={workerId} className="space-y-2 bg-card p-3 rounded-lg">
                <p className="text-xs font-medium text-foreground">{worker?.name || workerId}</p>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={form.worker_pay_type[workerId] || 'hourly'}
                    onChange={(e) => update("worker_pay_type", { ...form.worker_pay_type, [workerId]: e.target.value })}
                    className="text-xs px-2 py-1.5 bg-input border border-border rounded text-foreground"
                  >
                    <option value="hourly">Hourly</option>
                    <option value="annual">Annual</option>
                  </select>
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
                  <Input
                    type="text"
                    value={form.worker_job_titles[workerId] || ''}
                    onChange={(e) => update("worker_job_titles", { ...form.worker_job_titles, [workerId]: e.target.value })}
                    placeholder="Job title"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

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
  const [showForm, setShowForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [filter, setFilter] = useState("all");

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

  const handleSave = async (formData) => {
    if (editingLocation) {
      await base44.entities.LocationReference.update(editingLocation.id, formData);
    } else {
      await base44.entities.LocationReference.create(formData);
    }
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
    setShowForm(false);
    setEditingLocation(null);
  };

  const handleDelete = async (id) => {
    await base44.entities.LocationReference.delete(id);
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
  };

  const handleEdit = (location) => {
    setEditingLocation(location);
    setShowForm(true);
  };

  const filtered = filter === "all" ? locations : locations.filter(l => l.location_type === filter);

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
        <Button onClick={() => { setEditingLocation(null); setShowForm(true); }} size="sm" className="rounded-xl gap-1.5">
          <Plus className="w-4 h-4" /> Add
        </Button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Filter tabs */}
        <div className="flex gap-2">
          {["all", "global", "character_specific"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
              {f === "all" ? "All" : f === "global" ? "🌐 Global" : "👤 Character"}
            </button>
          ))}
        </div>

        {/* Empty state */}
        {locations.length === 0 && !showForm && (
          <div className="text-center py-10 space-y-3">
            <MapPin className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <div>
              <p className="text-sm font-medium text-foreground">No locations yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                Add locations and assign reference images to specific rooms or zones. The AI will use them for visual accuracy in generated images.
              </p>
            </div>
            <Button onClick={() => setShowForm(true)} className="rounded-xl gap-2">
              <Plus className="w-4 h-4" /> Add your first location
            </Button>
          </div>
        )}

        <AnimatePresence>
          {showForm && (
            <LocationForm
              key="form"
              editingLocation={editingLocation}
              characters={characters}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditingLocation(null); }}
            />
          )}
        </AnimatePresence>

        <div className="space-y-3">
          <AnimatePresence>
            {filtered.map(loc => (
              <LocationCard
                key={loc.id}
                location={loc}
                onDelete={handleDelete}
                onEdit={handleEdit}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}