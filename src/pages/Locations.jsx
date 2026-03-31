import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, MapPin, Globe, User, Trash2, Upload, X, Pencil, ChevronDown, ChevronUp, Home, Briefcase, Coffee, Trees, Wine, GraduationCap, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

const CATEGORIES = [
  { value: "home", label: "Home", icon: Home },
  { value: "workplace", label: "Workplace", icon: Briefcase },
  { value: "food_drink", label: "Food & Drink", icon: Coffee },
  { value: "outdoor", label: "Outdoors", icon: Trees },
  { value: "social", label: "Social / Nightlife", icon: Wine },
  { value: "education", label: "Education", icon: GraduationCap },
  { value: "medical", label: "Medical", icon: Heart },
  { value: "other", label: "Other", icon: MapPin },
];

const HOME_ROOMS = ["exterior", "living room", "kitchen", "bedroom", "bathroom", "backyard"];

function LocationCard({ location, onDelete, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const catDef = CATEGORIES.find(c => c.value === location.category) || CATEGORIES[CATEGORIES.length - 1];
  const CatIcon = catDef.icon;

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
          <div className="flex items-center gap-2 mt-0.5">
            {location.location_type === "global" ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="w-3 h-3" /> Global
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="w-3 h-3" /> {location.character_name || "Character"}
              </span>
            )}
            {location.room_label && (
              <span className="text-xs text-muted-foreground">· {location.room_label}</span>
            )}
            <span className="text-xs text-muted-foreground">· {location.image_urls?.length || 0} images</span>
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
            <div className="p-4 space-y-3">
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
              {location.image_urls?.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {location.image_urls.map((url, i) => (
                    <img key={i} src={url} alt={`ref ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
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

function LocationForm({ editingLocation, characters, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: editingLocation?.name || "",
    location_type: editingLocation?.location_type || "global",
    character_id: editingLocation?.character_id || "",
    category: editingLocation?.category || "other",
    room_label: editingLocation?.room_label || "",
    description: editingLocation?.description || "",
    keywords: editingLocation?.keywords?.join(", ") || "",
    image_urls: editingLocation?.image_urls || [],
  });
  const [uploading, setUploading] = useState(false);

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 5 - form.image_urls.length;
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    const uploaded = [];
    for (const file of toUpload) {
      const res = await base44.integrations.Core.UploadFile({ file });
      if (res?.file_url) uploaded.push(res.file_url);
    }
    update("image_urls", [...form.image_urls, ...uploaded]);
    setUploading(false);
  };

  const removeImage = (i) => update("image_urls", form.image_urls.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (!form.name.trim()) return;
    const charObj = form.location_type === "character_specific"
      ? characters.find(c => c.id === form.character_id)
      : null;
    onSave({
      ...form,
      keywords: form.keywords.split(",").map(k => k.trim()).filter(Boolean),
      character_name: charObj?.name || "",
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="bg-card border border-border rounded-2xl p-5 space-y-4"
    >
      <h3 className="text-sm font-semibold text-foreground">{editingLocation ? "Edit Location" : "Add Location"}</h3>

      <Input
        value={form.name}
        onChange={e => update("name", e.target.value)}
        placeholder="e.g. Jayden's Apartment, Downtown Coffee Shop"
        className="h-11 rounded-xl"
      />

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Type</label>
        <div className="grid grid-cols-2 gap-2">
          {["global", "character_specific"].map(t => (
            <button key={t} onClick={() => update("location_type", t)}
              className={`py-2 px-3 rounded-xl text-sm border transition-colors ${form.location_type === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
              {t === "global" ? "🌐 Global (all characters)" : "👤 Character-specific"}
            </button>
          ))}
        </div>
      </div>

      {form.location_type === "character_specific" && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Character</label>
          <div className="space-y-2">
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

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Category</label>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            return (
              <button key={cat.value} onClick={() => update("category", cat.value)}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl border text-xs transition-colors ${form.category === cat.value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40"}`}>
                <Icon className="w-4 h-4" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {form.category === "home" && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Room (optional)</label>
          <div className="grid grid-cols-3 gap-2">
            {HOME_ROOMS.map(room => (
              <button key={room} onClick={() => update("room_label", form.room_label === room ? "" : room)}
                className={`py-1.5 px-2 rounded-xl text-xs border transition-colors capitalize ${form.room_label === room ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:border-primary/40"}`}>
                {room}
              </button>
            ))}
          </div>
        </div>
      )}

      <Textarea
        value={form.description}
        onChange={e => update("description", e.target.value)}
        placeholder="Describe the style, layout, atmosphere... (optional)"
        className="rounded-xl min-h-[70px] text-sm resize-none"
      />

      <Input
        value={form.keywords}
        onChange={e => update("keywords", e.target.value)}
        placeholder="Keywords for matching: gym, my place, the coffee spot... (comma-separated)"
        className="h-11 rounded-xl text-sm"
      />

      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
          Reference Images ({form.image_urls.length}/5)
        </label>
        {form.image_urls.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {form.image_urls.map((url, i) => (
              <div key={i} className="relative group">
                <img src={url} alt={`ref ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
                <button onClick={() => removeImage(i)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
        {form.image_urls.length < 5 && (
          <label className="block cursor-pointer">
            <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
            <div className="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors text-sm">
              <Upload className="w-4 h-4" />
              {uploading ? "Uploading..." : `Upload images (${5 - form.image_urls.length} more)`}
            </div>
          </label>
        )}
        <p className="text-xs text-muted-foreground mt-1.5">Upload 4–5 reference images for visual consistency in generated scenes.</p>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button onClick={handleSave} disabled={!form.name.trim()} className="flex-1 rounded-xl">
          {editingLocation ? "Save Changes" : "Add Location"}
        </Button>
      </div>
    </motion.div>
  );
}

export default function Locations() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [filter, setFilter] = useState("all"); // "all" | "global" | "character_specific"

  const { data: currentUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locationReferences", currentUser?.email],
    queryFn: () => base44.entities.LocationReference.filter({ created_by: currentUser.email }, "-created_date"),
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
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-foreground">Location References</h1>
          <p className="text-xs text-muted-foreground">Consistent visual environments for generated images</p>
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

        {/* Explainer */}
        {locations.length === 0 && !showForm && (
          <div className="text-center py-10 space-y-3">
            <MapPin className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <div>
              <p className="text-sm font-medium text-foreground">No locations yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">Upload reference images for places like a character's apartment, a local coffee shop, or the gym. The AI will use them for visual consistency in generated images.</p>
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