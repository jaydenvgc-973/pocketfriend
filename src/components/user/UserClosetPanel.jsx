import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Shirt, Plus, X, Star, Loader2, Wand2, Camera, ChevronDown, ChevronUp, Pencil, ZoomIn, Hash, AlertTriangle } from "lucide-react";
import OutfitEditModal from "@/components/character/OutfitEditModal";
import ClosetImagePreviewModal from "@/components/character/ClosetImagePreviewModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Canonical approved categories — mirrors CharacterClosetPanel and outfitRotationEngine
const OUTFIT_CATEGORIES = [
  { value: "lounge",        label: "Lounge / Home",       emoji: "🛋️" },
  { value: "sleepwear",     label: "Sleepwear",           emoji: "😴" },
  { value: "bath",          label: "Bath / Robe",         emoji: "🛁" },
  { value: "daily_casual",  label: "Daily Casual",        emoji: "👕" },
  { value: "work",          label: "Work",                emoji: "👔" },
  { value: "school",        label: "School",              emoji: "🎒" },
  { value: "outdoor",       label: "Outdoor / Errands",   emoji: "🌳" },
  { value: "nightlife",     label: "Nightlife / Party",   emoji: "🌃" },
  { value: "formal",        label: "Formal",              emoji: "🎩" },
  { value: "date_night",    label: "Date Night",          emoji: "💘" },
  { value: "church",        label: "Church / Religious",  emoji: "🛐" },
  { value: "special",       label: "Special / Statement", emoji: "✨" },
  { value: "gym",           label: "Gym / Workout",       emoji: "🏋️" },
  { value: "swimwear",      label: "Swimwear",            emoji: "🏊" },
];

function generateId() {
  return `outfit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function OutfitCard({ outfit, isActive, onSetActive, onDelete, onToggleFavorite, onEdit, hasRotationConflict }) {
  const [expanded, setExpanded] = useState(false);
  const catDef = OUTFIT_CATEGORIES.find(c => c.value === outfit.category) || OUTFIT_CATEGORIES[0];

  return (
    <div className={`relative rounded-xl border p-3 space-y-2 transition-colors ${isActive ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
      {isActive && (
        <div className="absolute top-2 right-8 text-[9px] text-primary font-bold uppercase tracking-wider bg-primary/10 px-1.5 py-0.5 rounded-full">
          Wearing
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{catDef.emoji}</span>
          <div>
            <p className="text-sm font-medium text-foreground">{outfit.label}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-[10px] text-muted-foreground capitalize">{catDef.label}</p>
              {outfit.rotation_number != null && outfit.rotation_number !== "" && (
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${hasRotationConflict ? 'bg-amber-500/20 text-amber-400' : 'bg-primary/15 text-primary'}`}>
                  #{outfit.rotation_number}
                  {hasRotationConflict && <span title="Duplicate rotation number in this category">⚠</span>}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onToggleFavorite(outfit.outfit_id)} className={`p-1 rounded transition-colors ${outfit.is_favorite ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}>
            <Star className="w-3.5 h-3.5" fill={outfit.is_favorite ? "currentColor" : "none"} />
          </button>
          <button onClick={() => onEdit(outfit)} className="p-1 text-muted-foreground hover:text-primary rounded transition-colors" title="Edit outfit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(v => !v)} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => onDelete(outfit.outfit_id)} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {outfit.image_url && (
        <img src={outfit.image_url} alt={outfit.label} className="w-full h-32 object-cover rounded-lg" />
      )}

      {expanded && (
        <div className="text-xs space-y-0.5 pt-1 border-t border-border">
          {outfit.top && <p className="text-muted-foreground">👕 {outfit.top}</p>}
          {outfit.bottom && <p className="text-muted-foreground">👖 {outfit.bottom}</p>}
          {outfit.shoes && <p className="text-muted-foreground">👟 {outfit.shoes}</p>}
          {outfit.outerwear && <p className="text-muted-foreground">🧥 {outfit.outerwear}</p>}
          {outfit.accessories && <p className="text-muted-foreground">💍 {outfit.accessories}</p>}
          {outfit.hair_state && <p className="text-muted-foreground">💇 {outfit.hair_state}</p>}
          {outfit.full_description && (
            <p className="text-muted-foreground leading-relaxed mt-1 pt-1 border-t border-border">{outfit.full_description}</p>
          )}
        </div>
      )}

      {!isActive && (
        <button
          onClick={() => onSetActive(outfit)}
          className="w-full text-xs text-primary border border-primary/30 hover:bg-primary/10 rounded-lg py-1.5 transition-colors font-medium"
        >
          Set as Current Outfit
        </button>
      )}

    </div>
  );
}

function AddOutfitForm({ displayName, gender, onSave, onCancel }) {
  const [form, setForm] = useState({
    label: "", category: "daily_casual", rotation_number: "", top: "", bottom: "", shoes: "",
    outerwear: "", accessories: "", hair_state: "", full_description: "", is_favorite: false,
  });
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [previewModal, setPreviewModal] = useState(null); // { url, type }

  const update = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a detailed outfit for ${displayName || "the user"} (${gender || "unspecified gender"}).
User request: "${genPrompt}"

Return JSON:
{
  "label": "Short outfit name (2-4 words)",
  "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|special",
  "top": "Specific top",
  "bottom": "Specific bottom",
  "shoes": "Specific shoes",
  "outerwear": "Jacket/hoodie or empty string",
  "accessories": "Accessories or empty string",
  "hair_state": "Hair description or empty string",
  "full_description": "Full vivid outfit prompt for image generation (50-80 words, include all pieces)"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            label: { type: "string" }, category: { type: "string" },
            top: { type: "string" }, bottom: { type: "string" }, shoes: { type: "string" },
            outerwear: { type: "string" }, accessories: { type: "string" },
            hair_state: { type: "string" }, full_description: { type: "string" },
          }
        }
      });
      if (res) setForm(prev => ({ ...prev, ...res }));
      setGenPrompt("");
    } catch (e) {
      console.error("Outfit generation failed:", e);
    }
    setGenerating(false);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await base44.integrations.Core.UploadFile({ file });
    if (res?.file_url) setUploadedImageUrl(res.file_url);
    setUploading(false);
  };

  const handleAiFill = async () => {
    if (!uploadedImageUrl) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this outfit image and extract all clothing details. Return JSON:
{
  "label": "Short outfit name (2-4 words)",
  "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|special",
  "top": "Describe the top/shirt/sweater visible",
  "bottom": "Describe the pants/shorts/skirt visible",
  "shoes": "Describe the shoes/sneakers visible",
  "outerwear": "Describe any jacket/coat/hoodie, or empty string if none",
  "accessories": "Describe any accessories (hat, bag, jewelry, etc.), or empty string if none",
  "hair_state": "Describe the hair style/state if visible, or empty string",
  "full_description": "Full vivid outfit description for image generation (50-80 words)"
}`,
        file_urls: [uploadedImageUrl],
        response_json_schema: {
          type: "object",
          properties: {
            label: { type: "string" }, category: { type: "string" },
            top: { type: "string" }, bottom: { type: "string" }, shoes: { type: "string" },
            outerwear: { type: "string" }, accessories: { type: "string" },
            hair_state: { type: "string" }, full_description: { type: "string" },
          }
        }
      });
      if (res) setForm(prev => ({ ...prev, ...res }));
    } catch (e) {
      console.error("AI fill failed:", e);
    }
    setGenerating(false);
  };

  const handleGenerateOutfitImage = async () => {
    const description = form.full_description || [form.top, form.bottom, form.shoes, form.outerwear, form.accessories].filter(Boolean).join(", ");
    if (!description) return;
    setGeneratingImage(true);
    try {
      const res = await base44.integrations.Core.GenerateImage({
        prompt: `Full body fashion photo of ${displayName || "a person"}, ${gender || ''} wearing: ${description}. Standing pose, clean background, lifestyle photography style, photorealistic.`,
      });
      if (res?.url) setGeneratedImageUrl(res.url);
    } catch (e) {
      console.error("Image generation failed:", e);
    }
    setGeneratingImage(false);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      const rotNum = form.rotation_number === "" || form.rotation_number == null
        ? null
        : parseInt(String(form.rotation_number), 10) || null;
      await onSave({
        outfit_id: generateId(),
        created_at: new Date().toISOString(),
        ...form,
        rotation_number: rotNum,
        image_url: uploadedImageUrl || generatedImageUrl || "",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border rounded-xl bg-secondary/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">New Outfit</p>

      <div className="flex gap-2">
        <Input
          value={genPrompt}
          onChange={e => setGenPrompt(e.target.value)}
          placeholder="Describe the vibe (e.g. 'brunch fit', 'night out look')..."
          className="h-9 text-sm rounded-xl flex-1"
          onKeyDown={e => e.key === "Enter" && handleGenerate()}
        />
        <Button size="sm" onClick={handleGenerate} disabled={generating || !genPrompt.trim()} className="rounded-xl gap-1 shrink-0">
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          AI
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Input value={form.label} onChange={e => update("label", e.target.value)} placeholder="Outfit name *" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <select value={form.category} onChange={e => update("category", e.target.value)} className="w-full h-9 px-3 rounded-xl bg-input border border-border text-foreground text-sm">
            {OUTFIT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <Input
            type="number"
            min="1"
            max="99"
            value={form.rotation_number}
            onChange={e => update("rotation_number", e.target.value)}
            placeholder="# Rotation number (optional, e.g. 1, 2, 3)"
            className="h-9 text-sm rounded-xl"
          />
        </div>
        <Input value={form.top} onChange={e => update("top", e.target.value)} placeholder="Top" className="h-9 text-sm rounded-xl" />
        <Input value={form.bottom} onChange={e => update("bottom", e.target.value)} placeholder="Bottom" className="h-9 text-sm rounded-xl" />
        <Input value={form.shoes} onChange={e => update("shoes", e.target.value)} placeholder="Shoes" className="h-9 text-sm rounded-xl" />
        <Input value={form.outerwear} onChange={e => update("outerwear", e.target.value)} placeholder="Outerwear (optional)" className="h-9 text-sm rounded-xl" />
        <div className="col-span-2">
          <Input value={form.accessories} onChange={e => update("accessories", e.target.value)} placeholder="Accessories (optional)" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <Input value={form.hair_state} onChange={e => update("hair_state", e.target.value)} placeholder="Hair (optional)" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <Textarea
            value={form.full_description}
            onChange={e => update("full_description", e.target.value)}
            placeholder="Full outfit description for image generation..."
            className="text-sm rounded-xl min-h-[60px] resize-none"
            rows={2}
          />
        </div>
      </div>

      <Button size="sm" variant="outline" onClick={handleGenerateOutfitImage} disabled={generatingImage || (!form.full_description && !form.top)} className="w-full rounded-xl gap-1.5">
        {generatingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {generatingImage ? "Generating preview..." : "Generate Outfit Preview"}
      </Button>
      {generatedImageUrl && (
        <div className="relative group cursor-pointer" onClick={() => setPreviewModal({ url: generatedImageUrl, type: "generated_preview" })}>
          <img src={generatedImageUrl} alt="Generated outfit" className="w-full h-48 object-cover rounded-xl" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-xl transition-colors flex items-center justify-center">
            <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-1">Tap to preview · will be saved with outfit</p>
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-xl border border-dashed border-border hover:border-primary/40 transition-colors text-xs text-muted-foreground">
        <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
        {uploadedImageUrl ? "Photo uploaded ✓" : "Upload outfit photo (optional)"}
      </label>
      {uploadedImageUrl && (
        <div className="space-y-2">
          <div className="relative group cursor-pointer" onClick={() => setPreviewModal({ url: uploadedImageUrl, type: "uploaded_reference" })}>
            <img src={uploadedImageUrl} alt="Outfit" className="w-full h-28 object-cover rounded-xl" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-xl transition-colors flex items-center justify-center">
              <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          <Button size="sm" onClick={handleAiFill} disabled={generating} className="w-full rounded-xl gap-1.5">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {generating ? "Analyzing outfit..." : "AI Fill from Photo"}
          </Button>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.label.trim() || saving} className="flex-1 rounded-xl">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Save Outfit
        </Button>
      </div>

      {previewModal && (
        <ClosetImagePreviewModal
          imageUrl={previewModal.url}
          imageType={previewModal.type}
          onClose={() => setPreviewModal(null)}
          onDelete={() => {
            console.log(`[UserCloset] DELETE | type: ${previewModal.type} | url: ${previewModal.url}`);
            if (previewModal.type === "generated_preview") {
              setGeneratedImageUrl("");
              console.log("[UserCloset] generatedImageUrl cleared | form preserved");
            } else {
              setUploadedImageUrl("");
              console.log("[UserCloset] uploadedImageUrl cleared | form preserved");
            }
            setPreviewModal(null);
          }}
        />
      )}
    </div>
  );
}

export default function UserClosetPanel({ settings, onUpdate, displayName, gender }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingOutfit, setEditingOutfit] = useState(null);
  const [saving, setSaving] = useState(false);

  const closet = settings?.user_closet || [];
  const currentOutfit = settings?.user_current_outfit || null;

  const saveCloset = async (newCloset, currentOutfitUpdate = null) => {
    setSaving(true);
    try {
      const updates = { user_closet: newCloset };
      if (currentOutfitUpdate !== null) updates.user_current_outfit = currentOutfitUpdate;
      await onUpdate(updates);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOutfit = async (outfit) => {
    await saveCloset([...closet, outfit]);
    setShowAddForm(false);
  };

  // Edit existing outfit in-place — preserves rotation_number and all fields
  const handleEditOutfit = async (updatedOutfit) => {
    // Normalize rotation_number: empty string → null (no number)
    const normalized = {
      ...updatedOutfit,
      rotation_number: updatedOutfit.rotation_number === "" ? null : updatedOutfit.rotation_number,
    };
    const newCloset = closet.map(o => o.outfit_id === normalized.outfit_id ? normalized : o);
    const isCurrentlyWorn = currentOutfit?.outfit_id === normalized.outfit_id;
    const currentOutfitUpdate = isCurrentlyWorn
      ? { ...normalized, last_changed_at: currentOutfit?.last_changed_at }
      : null;
    await saveCloset(newCloset, currentOutfitUpdate);
    setEditingOutfit(null);
  };

  const handleDelete = async (outfit_id) => {
    const newCloset = closet.filter(o => o.outfit_id !== outfit_id);
    const clearCurrent = currentOutfit?.outfit_id === outfit_id ? {} : null;
    await saveCloset(newCloset, clearCurrent);
  };

  const handleSetActive = async (outfit) => {
    await saveCloset(closet, { ...outfit, last_changed_at: new Date().toISOString() });
  };

  const handleToggleFavorite = async (outfit_id) => {
    await saveCloset(closet.map(o => o.outfit_id === outfit_id ? { ...o, is_favorite: !o.is_favorite } : o));
  };

  const groupedOutfits = OUTFIT_CATEGORIES.reduce((acc, cat) => {
    const items = closet.filter(o => o.category === cat.value);
    if (items.length > 0) acc[cat.value] = items;
    return acc;
  }, {});

  // Detect duplicate rotation numbers within the same category
  const rotationConflictIds = new Set();
  for (const items of Object.values(groupedOutfits)) {
    const numCounts = {};
    for (const o of items) {
      const n = o.rotation_number;
      if (n == null || n === "") continue;
      numCounts[n] = (numCounts[n] || 0) + 1;
    }
    for (const o of items) {
      const n = o.rotation_number;
      if (n != null && n !== "" && numCounts[n] > 1) rotationConflictIds.add(o.outfit_id);
    }
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shirt className="w-4 h-4 text-primary" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Your Closet</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> Add Outfit
          </button>
        </div>
      </div>

      {currentOutfit?.label && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
          <p className="text-[10px] text-primary font-semibold uppercase tracking-wider mb-1">Currently Wearing</p>
          <p className="text-sm font-medium text-foreground">{currentOutfit.label}</p>
          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {currentOutfit.top && <p>👕 {currentOutfit.top}</p>}
            {currentOutfit.bottom && <p>👖 {currentOutfit.bottom}</p>}
            {currentOutfit.shoes && <p>👟 {currentOutfit.shoes}</p>}
            {!currentOutfit.top && currentOutfit.full_description && <p>{currentOutfit.full_description}</p>}
          </div>
        </div>
      )}

      {showAddForm && (
        <AddOutfitForm
          displayName={displayName}
          gender={gender}
          onSave={handleSaveOutfit}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {closet.length === 0 && !showAddForm ? (
        <p className="text-sm text-muted-foreground italic">No outfits saved yet. Add outfits to use them in image generation.</p>
      ) : (
        Object.entries(groupedOutfits).map(([cat, items]) => {
          const catDef = OUTFIT_CATEGORIES.find(c => c.value === cat);
          return (
            <div key={cat}>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                {catDef?.emoji} {catDef?.label}
              </p>
              <div className="grid gap-2">
                {items.map(outfit => (
                  <OutfitCard
                    key={outfit.outfit_id}
                    outfit={outfit}
                    isActive={currentOutfit?.outfit_id === outfit.outfit_id}
                    onSetActive={handleSetActive}
                    onDelete={handleDelete}
                    onToggleFavorite={handleToggleFavorite}
                    onEdit={setEditingOutfit}
                    hasRotationConflict={rotationConflictIds.has(outfit.outfit_id)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      {editingOutfit && (
        <OutfitEditModal
          outfit={editingOutfit}
          onSave={handleEditOutfit}
          onCancel={() => setEditingOutfit(null)}
        />
      )}
    </div>
  );
}