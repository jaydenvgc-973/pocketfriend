import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Shirt, Plus, X, Star, Loader2, Wand2, Camera, ChevronDown, ChevronUp,
  Package, Upload, Check, Archive, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const ACTIVE_OUTFIT_CAP = 25;

const OUTFIT_CATEGORIES = [
  { value: "daily_casual", label: "Daily Casual", emoji: "👕" },
  { value: "work", label: "Work", emoji: "👔" },
  { value: "gym", label: "Gym", emoji: "🏋️" },
  { value: "church", label: "Church", emoji: "🛐" },
  { value: "nightlife", label: "Nightlife", emoji: "🌃" },
  { value: "formal", label: "Formal", emoji: "🎩" },
  { value: "sleepwear", label: "Sleepwear", emoji: "😴" },
  { value: "lounge", label: "Lounge / Home", emoji: "🛋️" },
  { value: "outdoor", label: "Outdoor / Errands", emoji: "🌳" },
  { value: "date_night", label: "Date Night", emoji: "💘" },
  { value: "special", label: "Special / Statement", emoji: "✨" },
];

const ITEM_CATEGORIES = [
  { value: "shoes", label: "Shoes / Sneakers", emoji: "👟" },
  { value: "tops", label: "Tops", emoji: "👕" },
  { value: "bottoms", label: "Bottoms", emoji: "👖" },
  { value: "outerwear", label: "Outerwear", emoji: "🧥" },
  { value: "accessories", label: "Accessories", emoji: "💍" },
  { value: "jewelry", label: "Jewelry", emoji: "⛓️" },
  { value: "bags", label: "Bags", emoji: "👜" },
  { value: "hats", label: "Hats / Headwear", emoji: "🧢" },
  { value: "activewear", label: "Activewear", emoji: "🏃" },
  { value: "sleepwear", label: "Sleepwear", emoji: "😴" },
  { value: "specialty", label: "Specialty", emoji: "✨" },
];

function generateId() {
  return `outfit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function CapWarning({ active, cap }) {
  const pct = active / cap;
  if (pct < 0.75) return null;
  const atCap = active >= cap;
  const near = pct >= 0.9;
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${atCap ? 'bg-destructive/10 text-destructive border border-destructive/20' : near ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-secondary text-muted-foreground border border-border'}`}>
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <span>
        {atCap
          ? `Outfit limit reached (${active}/${cap}). Archive or replace an outfit to save a new one.`
          : near
          ? `Almost full — ${active}/${cap} active outfits. Consider archiving older looks.`
          : `${active}/${cap} active outfits saved.`}
      </span>
    </div>
  );
}

function ItemCard({ item, onDelete, onToggleFavorite }) {
  const catDef = ITEM_CATEGORIES.find(c => c.value === item.item_category) || ITEM_CATEGORIES[0];
  return (
    <div className="relative rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{catDef.emoji}</span>
          <div>
            <p className="text-sm font-medium text-foreground">{item.item_name}</p>
            <p className="text-[10px] text-muted-foreground capitalize">
              {catDef.label}{item.subcategory ? ` · ${item.subcategory}` : ''}{item.brand ? ` · ${item.brand}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onToggleFavorite(item.id)} className={`p-1 rounded transition-colors ${item.is_favorite ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}>
            <Star className="w-3.5 h-3.5" fill={item.is_favorite ? "currentColor" : "none"} />
          </button>
          <button onClick={() => onDelete(item.id)} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {item.image_url && <img src={item.image_url} alt={item.item_name} className="w-full h-28 object-cover rounded-lg" />}
      {item.description && <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>}
      {item.purchase_price > 0 && (
        <p className="text-[10px] text-muted-foreground">💰 ${item.purchase_price}{item.purchased_from ? ` · ${item.purchased_from}` : ''}</p>
      )}
    </div>
  );
}

function OutfitCard({ outfit, isActive, onSetActive, onDelete, onToggleFavorite, onToggleArchive }) {
  const [expanded, setExpanded] = useState(false);
  const catDef = OUTFIT_CATEGORIES.find(c => c.value === outfit.category) || OUTFIT_CATEGORIES[0];
  const isArchived = !!outfit.is_archived;

  return (
    <div className={`relative rounded-xl border p-3 space-y-2 transition-colors ${isArchived ? 'border-border bg-secondary/30 opacity-70' : isActive ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
      {isActive && <div className="absolute top-2 right-8 text-[9px] text-primary font-bold uppercase tracking-wider bg-primary/10 px-1.5 py-0.5 rounded-full">Wearing</div>}
      {isArchived && <div className="absolute top-2 right-8 text-[9px] text-muted-foreground font-bold uppercase tracking-wider bg-secondary px-1.5 py-0.5 rounded-full">Archived</div>}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{catDef.emoji}</span>
          <div>
            <p className="text-sm font-medium text-foreground">{outfit.label}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{catDef.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onToggleFavorite(outfit.outfit_id)} className={`p-1 rounded transition-colors ${outfit.is_favorite ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}>
            <Star className="w-3.5 h-3.5" fill={outfit.is_favorite ? "currentColor" : "none"} />
          </button>
          <button onClick={() => onToggleArchive(outfit.outfit_id)} title={isArchived ? "Unarchive" : "Archive"} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
            <Archive className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(v => !v)} className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => onDelete(outfit.outfit_id)} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {outfit.image_url && <img src={outfit.image_url} alt={outfit.label} className="w-full h-32 object-cover rounded-lg" />}
      {expanded && (
        <div className="text-xs space-y-0.5 pt-1 border-t border-border">
          {outfit.top && <p className="text-muted-foreground">👕 {outfit.top}</p>}
          {outfit.bottom && <p className="text-muted-foreground">👖 {outfit.bottom}</p>}
          {outfit.shoes && <p className="text-muted-foreground">👟 {outfit.shoes}</p>}
          {outfit.outerwear && <p className="text-muted-foreground">🧥 {outfit.outerwear}</p>}
          {outfit.accessories && <p className="text-muted-foreground">💍 {outfit.accessories}</p>}
          {outfit.hair_state && <p className="text-muted-foreground">💇 {outfit.hair_state}</p>}
          {outfit.full_description && <p className="text-muted-foreground leading-relaxed mt-1 pt-1 border-t border-border">{outfit.full_description}</p>}
        </div>
      )}
      {!isActive && !isArchived && (
        <button onClick={() => onSetActive(outfit)} className="w-full text-xs text-primary border border-primary/30 hover:bg-primary/10 rounded-lg py-1.5 transition-colors font-medium">
          Set as Current Outfit
        </button>
      )}
    </div>
  );
}

function AddItemForm({ ownerEmail, onSave, onCancel, displayName, gender }) {
  const [form, setForm] = useState({
    item_name: "", item_category: "shoes", subcategory: "", brand: "",
    color: "", description: "", purchase_price: "", purchased_from: "", style_tags: "",
  });
  const [imageUrl, setImageUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const update = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await base44.integrations.Core.UploadFile({ file });
    if (res?.file_url) setImageUrl(res.file_url);
    setUploading(false);
  };

  const handleAiFill = async () => {
    if (!imageUrl) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this clothing/accessory item and extract details. Return JSON:
{ "item_name": "...", "item_category": "shoes|tops|bottoms|outerwear|accessories|jewelry|bags|hats|activewear|sleepwear|specialty", "subcategory": "...", "brand": "...", "color": "...", "description": "50-80 words", "style_tags": ["tag1","tag2"] }`,
        file_urls: [imageUrl],
        response_json_schema: {
          type: "object",
          properties: {
            item_name: { type: "string" }, item_category: { type: "string" },
            subcategory: { type: "string" }, brand: { type: "string" },
            color: { type: "string" }, description: { type: "string" },
            style_tags: { type: "array", items: { type: "string" } },
          }
        }
      });
      if (res) setForm(prev => ({
        ...prev,
        item_name: res.item_name || prev.item_name,
        item_category: res.item_category || prev.item_category,
        subcategory: res.subcategory || prev.subcategory,
        brand: res.brand || prev.brand,
        color: res.color || prev.color,
        description: res.description || prev.description,
        style_tags: Array.isArray(res.style_tags) ? res.style_tags.join(", ") : prev.style_tags,
      }));
    } catch (e) { console.error("AI fill failed:", e); }
    setGenerating(false);
  };

  const handleGenerateVisual = async () => {
    if (!form.item_name.trim() && !form.description.trim()) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.GenerateImage({
        prompt: `Product photo: ${form.description || form.item_name}${form.brand ? `, ${form.brand}` : ''}. Clean white background, studio lighting, fashion photography, no person wearing it.`,
      });
      if (res?.url) setPreviewUrl(res.url);
    } catch (e) { console.error("Visual generation failed:", e); }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!form.item_name.trim()) return;
    setSaving(true);
    try {
      const tags = form.style_tags ? form.style_tags.split(",").map(t => t.trim()).filter(Boolean) : [];
      await onSave({
        owner_type: "user",
        owner_id: ownerEmail,
        ...form,
        purchase_price: parseFloat(form.purchase_price) || 0,
        style_tags: tags,
        image_url: imageUrl || previewUrl || "",
        is_owned: true,
        outfit_ids: [],
        purchase_date: new Date().toISOString(),
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="border border-border rounded-xl bg-secondary/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Add Item to Inventory</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Input value={form.item_name} onChange={e => update("item_name", e.target.value)} placeholder="Item name * (e.g. White Air Force 1s)" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <select value={form.item_category} onChange={e => update("item_category", e.target.value)} className="w-full h-9 px-3 rounded-xl bg-input border border-border text-foreground text-sm">
            {ITEM_CATEGORIES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
          </select>
        </div>
        <Input value={form.subcategory} onChange={e => update("subcategory", e.target.value)} placeholder="Subcategory (e.g. sneakers)" className="h-9 text-sm rounded-xl" />
        <Input value={form.brand} onChange={e => update("brand", e.target.value)} placeholder="Brand (optional)" className="h-9 text-sm rounded-xl" />
        <Input value={form.color} onChange={e => update("color", e.target.value)} placeholder="Color(s)" className="h-9 text-sm rounded-xl" />
        <Input value={form.purchase_price} onChange={e => update("purchase_price", e.target.value)} placeholder="Price ($)" type="number" className="h-9 text-sm rounded-xl" />
        <div className="col-span-2">
          <Input value={form.purchased_from} onChange={e => update("purchased_from", e.target.value)} placeholder="Store / purchased from (optional)" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <Textarea value={form.description} onChange={e => update("description", e.target.value)} placeholder="Item description..." className="text-sm rounded-xl min-h-[60px] resize-none" rows={2} />
        </div>
        <div className="col-span-2">
          <Input value={form.style_tags} onChange={e => update("style_tags", e.target.value)} placeholder="Style tags: streetwear, luxury (comma-separated)" className="h-9 text-sm rounded-xl" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={handleGenerateVisual} disabled={generating || (!form.item_name.trim() && !form.description.trim())} className="flex-1 rounded-xl gap-1">
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Preview
        </Button>
        <label className="flex-1 flex items-center justify-center gap-1 cursor-pointer px-3 py-2 rounded-xl border border-dashed border-border hover:border-primary/40 transition-colors text-xs text-muted-foreground">
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {imageUrl ? "Uploaded ✓" : "Upload photo"}
        </label>
      </div>
      {previewUrl && !imageUrl && (
        <div className="relative">
          <img src={previewUrl} alt="Preview" className="w-full h-32 object-cover rounded-xl" />
          <button onClick={() => setImageUrl(previewUrl)} className="absolute bottom-2 right-2 text-xs px-2 py-1 rounded-lg bg-black/70 text-white hover:bg-primary flex items-center gap-1">
            <Check className="w-3 h-3" /> Use This
          </button>
        </div>
      )}
      {imageUrl && (
        <div className="space-y-2">
          <img src={imageUrl} alt="Item" className="w-full h-28 object-cover rounded-xl" />
          <Button size="sm" onClick={handleAiFill} disabled={generating} className="w-full rounded-xl gap-1.5">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {generating ? "Analyzing..." : "AI Fill from Photo"}
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.item_name.trim() || saving} className="flex-1 rounded-xl">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null} Add to Inventory
        </Button>
      </div>
    </div>
  );
}

function AddOutfitForm({ displayName, gender, onSave, onCancel }) {
  const [form, setForm] = useState({
    label: "", category: "daily_casual", top: "", bottom: "", shoes: "",
    outerwear: "", accessories: "", hair_state: "", full_description: "", is_favorite: false,
  });
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const update = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a detailed outfit for ${displayName || "the user"} (${gender || "unspecified gender"}).
Request: "${genPrompt}"
Return JSON: { "label": "2-4 word name", "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|date_night|special", "top": "...", "bottom": "...", "shoes": "...", "outerwear": "or empty", "accessories": "or empty", "hair_state": "or empty", "full_description": "50-80 words for image gen" }`,
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
    } catch (e) { console.error("Generation failed:", e); }
    setGenerating(false);
  };

  const handleGenerateImage = async () => {
    const description = form.full_description || [form.top, form.bottom, form.shoes, form.outerwear, form.accessories].filter(Boolean).join(", ");
    if (!description) return;
    setGeneratingImage(true);
    try {
      const res = await base44.integrations.Core.GenerateImage({
        prompt: `Full body fashion photo of ${displayName || "a person"}, ${gender || ''} wearing: ${description}. Standing pose, clean background, photorealistic.`,
      });
      if (res?.url) setImageUrl(res.url);
    } catch (e) { console.error("Image gen failed:", e); }
    setGeneratingImage(false);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await base44.integrations.Core.UploadFile({ file });
    if (res?.file_url) setImageUrl(res.file_url);
    setUploading(false);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      await onSave({
        outfit_id: generateId(),
        created_at: new Date().toISOString(),
        is_archived: false,
        times_worn: 0,
        ...form,
        image_url: imageUrl || "",
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="border border-border rounded-xl bg-secondary/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">New Outfit</p>
      <div className="flex gap-2">
        <Input value={genPrompt} onChange={e => setGenPrompt(e.target.value)} placeholder="Describe the vibe (e.g. 'brunch fit', 'night out')..." className="h-9 text-sm rounded-xl flex-1" onKeyDown={e => e.key === "Enter" && handleGenerate()} />
        <Button size="sm" onClick={handleGenerate} disabled={generating || !genPrompt.trim()} className="rounded-xl gap-1 shrink-0">
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} AI
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
        <Input value={form.top} onChange={e => update("top", e.target.value)} placeholder="Top" className="h-9 text-sm rounded-xl" />
        <Input value={form.bottom} onChange={e => update("bottom", e.target.value)} placeholder="Bottom" className="h-9 text-sm rounded-xl" />
        <Input value={form.shoes} onChange={e => update("shoes", e.target.value)} placeholder="Shoes" className="h-9 text-sm rounded-xl" />
        <Input value={form.outerwear} onChange={e => update("outerwear", e.target.value)} placeholder="Outerwear (optional)" className="h-9 text-sm rounded-xl" />
        <div className="col-span-2">
          <Input value={form.accessories} onChange={e => update("accessories", e.target.value)} placeholder="Accessories (optional)" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <Textarea value={form.full_description} onChange={e => update("full_description", e.target.value)} placeholder="Full description for image generation..." className="text-sm rounded-xl min-h-[60px] resize-none" rows={2} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={handleGenerateImage} disabled={generatingImage || (!form.full_description && !form.top)} className="flex-1 rounded-xl gap-1.5">
          {generatingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Preview
        </Button>
        <label className="flex-1 flex items-center justify-center gap-1 cursor-pointer px-3 py-2 rounded-xl border border-dashed border-border hover:border-primary/40 transition-colors text-xs text-muted-foreground">
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          {imageUrl ? "Photo ✓" : "Upload"}
        </label>
      </div>
      {imageUrl && <img src={imageUrl} alt="Outfit preview" className="w-full h-40 object-cover rounded-xl" />}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.label.trim() || saving} className="flex-1 rounded-xl">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null} Save Outfit
        </Button>
      </div>
    </div>
  );
}

export default function UserClosetPanel({ settings, onUpdate, displayName, gender, ownerEmail }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("items");
  const [showAddOutfit, setShowAddOutfit] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [saving, setSaving] = useState(false);

  const closet = settings?.user_closet || [];
  const currentOutfit = settings?.user_current_outfit || null;

  const allOutfits = closet;
  const activeOutfits = allOutfits.filter(o => !o.is_archived);
  const archivedOutfits = allOutfits.filter(o => o.is_archived);
  const activeCount = activeOutfits.length;

  // Items from entity
  const { data: ownedItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["clothingItems", "user", ownerEmail],
    queryFn: () => base44.entities.ClothingItem.filter({ owner_type: "user", owner_id: ownerEmail }),
    enabled: !!ownerEmail,
  });

  const saveCloset = async (newCloset, currentOutfitUpdate = null) => {
    setSaving(true);
    try {
      const updates = { user_closet: newCloset };
      if (currentOutfitUpdate !== null) updates.user_current_outfit = currentOutfitUpdate;
      await onUpdate(updates);
    } finally { setSaving(false); }
  };

  const handleSaveOutfit = async (outfit) => {
    await saveCloset([...closet, outfit]);
    setShowAddOutfit(false);
  };

  const handleSaveItem = async (itemData) => {
    await base44.entities.ClothingItem.create(itemData);
    queryClient.invalidateQueries({ queryKey: ["clothingItems", "user", ownerEmail] });
    setShowAddItem(false);
  };

  const handleDeleteOutfit = async (outfit_id) => {
    const newCloset = closet.filter(o => o.outfit_id !== outfit_id);
    const clearCurrent = currentOutfit?.outfit_id === outfit_id ? {} : null;
    await saveCloset(newCloset, clearCurrent);
  };

  const handleDeleteItem = async (itemId) => {
    await base44.entities.ClothingItem.delete(itemId);
    queryClient.invalidateQueries({ queryKey: ["clothingItems", "user", ownerEmail] });
  };

  const handleSetActive = async (outfit) => {
    await saveCloset(closet, { ...outfit, last_changed_at: new Date().toISOString() });
  };

  const handleToggleFavoriteOutfit = async (outfit_id) => {
    await saveCloset(closet.map(o => o.outfit_id === outfit_id ? { ...o, is_favorite: !o.is_favorite } : o));
  };

  const handleToggleArchiveOutfit = async (outfit_id) => {
    await saveCloset(closet.map(o => o.outfit_id === outfit_id ? { ...o, is_archived: !o.is_archived } : o));
  };

  const handleToggleFavoriteItem = async (itemId) => {
    const item = ownedItems.find(i => i.id === itemId);
    if (!item) return;
    await base44.entities.ClothingItem.update(itemId, { is_favorite: !item.is_favorite });
    queryClient.invalidateQueries({ queryKey: ["clothingItems", "user", ownerEmail] });
  };

  const groupedItems = ITEM_CATEGORIES.reduce((acc, cat) => {
    const items = ownedItems.filter(i => i.item_category === cat.value);
    if (items.length > 0) acc[cat.value] = items;
    return acc;
  }, {});

  const groupedActiveOutfits = OUTFIT_CATEGORIES.reduce((acc, cat) => {
    const items = activeOutfits.filter(o => o.category === cat.value);
    if (items.length > 0) acc[cat.value] = items;
    return acc;
  }, {});

  const atCap = activeCount >= ACTIVE_OUTFIT_CAP;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shirt className="w-4 h-4 text-primary" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Your Closet</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          {tab === "outfits" && !atCap && (
            <button onClick={() => { setShowAddOutfit(v => !v); setShowAddItem(false); }} className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity">
              <Plus className="w-3.5 h-3.5" /> Add Outfit
            </button>
          )}
          {tab === "items" && (
            <button onClick={() => { setShowAddItem(v => !v); setShowAddOutfit(false); }} className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity">
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          )}
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

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary/50 rounded-xl p-1">
        <button
          onClick={() => setTab("items")}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${tab === "items" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Package className="w-3 h-3" /> Items ({ownedItems.length})
        </button>
        <button
          onClick={() => setTab("outfits")}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${tab === "outfits" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Shirt className="w-3 h-3" /> Outfits ({activeCount}/{ACTIVE_OUTFIT_CAP})
        </button>
      </div>

      {/* Items Tab */}
      {tab === "items" && (
        <div className="space-y-4">
          {showAddItem && (
            <AddItemForm ownerEmail={ownerEmail} displayName={displayName} gender={gender} onSave={handleSaveItem} onCancel={() => setShowAddItem(false)} />
          )}
          {itemsLoading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : ownedItems.length === 0 && !showAddItem ? (
            <div className="space-y-2 py-2">
              <p className="text-sm text-muted-foreground italic">No items in inventory yet.</p>
              <p className="text-xs text-muted-foreground/70">Add individual pieces — shoes, shirts, jackets, jewelry — then build outfits from them.</p>
            </div>
          ) : (
            Object.entries(groupedItems).map(([cat, items]) => {
              const catDef = ITEM_CATEGORIES.find(c => c.value === cat);
              return (
                <div key={cat}>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">{catDef?.emoji} {catDef?.label} ({items.length})</p>
                  <div className="grid gap-2">
                    {items.map(item => (
                      <ItemCard key={item.id} item={item} onDelete={handleDeleteItem} onToggleFavorite={handleToggleFavoriteItem} />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Outfits Tab */}
      {tab === "outfits" && (
        <div className="space-y-4">
          <CapWarning active={activeCount} cap={ACTIVE_OUTFIT_CAP} />
          {showAddOutfit && !atCap && (
            <AddOutfitForm displayName={displayName} gender={gender} onSave={handleSaveOutfit} onCancel={() => setShowAddOutfit(false)} />
          )}
          {activeOutfits.length === 0 && !showAddOutfit ? (
            <p className="text-sm text-muted-foreground italic">No outfits saved yet. Build looks from your owned items.</p>
          ) : (
            Object.entries(groupedActiveOutfits).map(([cat, items]) => {
              const catDef = OUTFIT_CATEGORIES.find(c => c.value === cat);
              return (
                <div key={cat}>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">{catDef?.emoji} {catDef?.label}</p>
                  <div className="grid gap-2">
                    {items.map(outfit => (
                      <OutfitCard
                        key={outfit.outfit_id}
                        outfit={outfit}
                        isActive={currentOutfit?.outfit_id === outfit.outfit_id}
                        onSetActive={handleSetActive}
                        onDelete={handleDeleteOutfit}
                        onToggleFavorite={handleToggleFavoriteOutfit}
                        onToggleArchive={handleToggleArchiveOutfit}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {/* Archived Section */}
          {archivedOutfits.length > 0 && (
            <div>
              <button onClick={() => setShowArchived(v => !v)} className="flex items-center gap-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider w-full text-left py-1">
                <Archive className="w-3 h-3" /> Archived ({archivedOutfits.length})
                {showArchived ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
              </button>
              {showArchived && (
                <div className="grid gap-2 mt-2">
                  {archivedOutfits.map(outfit => (
                    <OutfitCard
                      key={outfit.outfit_id}
                      outfit={outfit}
                      isActive={false}
                      onSetActive={() => {}}
                      onDelete={handleDeleteOutfit}
                      onToggleFavorite={handleToggleFavoriteOutfit}
                      onToggleArchive={handleToggleArchiveOutfit}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}