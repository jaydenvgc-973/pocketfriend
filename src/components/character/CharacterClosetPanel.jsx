import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import {
  Shirt, Plus, X, Star, Loader2, Wand2, Upload, Package,
  Camera, ChevronDown, ChevronUp, Check, Pencil, ZoomIn, RefreshCw, Lock
} from "lucide-react";
import OutfitEditModal from "@/components/character/OutfitEditModal";
import ClosetImagePreviewModal from "@/components/character/ClosetImagePreviewModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const OUTFIT_CATEGORIES = [
  { value: "daily_casual",  label: "Daily Casual",       emoji: "👕" },
  { value: "work",          label: "Work",                emoji: "👔" },
  { value: "gym",           label: "Gym / Workout",       emoji: "🏋️" },
  { value: "church",        label: "Church / Religious",  emoji: "🛐" },
  { value: "nightlife",     label: "Nightlife / Party",   emoji: "🌃" },
  { value: "formal",        label: "Formal",              emoji: "🎩" },
  { value: "sleepwear",     label: "Sleepwear",           emoji: "😴" },
  { value: "lounge",        label: "Lounge / Home",       emoji: "🛋️" },
  { value: "outdoor",       label: "Outdoor / Errands",   emoji: "🌳" },
  { value: "swimwear",      label: "Swimwear",            emoji: "🏊" },
  { value: "bath",          label: "Bath / Robe",         emoji: "🛁" },
  { value: "school",        label: "School",              emoji: "🎒" },
  { value: "date_night",    label: "Date Night",          emoji: "💘" },
  { value: "travel",        label: "Travel",              emoji: "✈️" },
  { value: "cold_weather",  label: "Cold Weather",        emoji: "🧣" },
  { value: "hot_weather",   label: "Hot Weather",         emoji: "☀️" },
  { value: "special",       label: "Special / Statement", emoji: "✨" },
  { value: "medical",       label: "Medical",             emoji: "🏥" },
];

const PIECE_TYPES = [
  { value: "top", label: "Top", emoji: "👕" },
  { value: "bottom", label: "Bottom", emoji: "👖" },
  { value: "shoes", label: "Shoes / Sneakers", emoji: "👟" },
  { value: "outerwear", label: "Outerwear", emoji: "🧥" },
  { value: "dress", label: "Dress / Jumpsuit", emoji: "👗" },
  { value: "accessories", label: "Accessories", emoji: "💍" },
  { value: "hat", label: "Hat / Headwear", emoji: "🧢" },
  { value: "bag", label: "Bag / Purse", emoji: "👜" },
];

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Clothing Piece Card ──────────────────────────────────────────────────────
function PieceCard({ piece, onDelete, onToggleFavorite }) {
  const typeDef = PIECE_TYPES.find(t => t.value === piece.piece_type) || PIECE_TYPES[0];
  return (
    <div className="relative rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{typeDef.emoji}</span>
          <div>
            <p className="text-sm font-medium text-foreground">{piece.label}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{typeDef.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onToggleFavorite(piece.piece_id)}
            className={`p-1 rounded transition-colors ${piece.is_favorite ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}
          >
            <Star className="w-3.5 h-3.5" fill={piece.is_favorite ? "currentColor" : "none"} />
          </button>
          <button onClick={() => onDelete(piece.piece_id)} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {piece.image_url && (
        <img src={piece.image_url} alt={piece.label} className="w-full h-28 object-cover rounded-lg" />
      )}
      {piece.description && (
        <p className="text-xs text-muted-foreground leading-relaxed">{piece.description}</p>
      )}
    </div>
  );
}

// ── Outfit Card ───────────────────────────────────────────────────────────────
function OutfitCard({ outfit, isActive, onSetActive, onDelete, onToggleFavorite, onEdit, onFillFromImage }) {
  const [expanded, setExpanded] = useState(false);
  const [fillingFromImage, setFillingFromImage] = useState(false);
  const catDef = OUTFIT_CATEGORIES.find(c => c.value === outfit.category) || OUTFIT_CATEGORIES[0];

  // An outfit is usable for image generation if it has text fields OR an image
  const hasTextData = outfit.top || outfit.bottom || outfit.shoes || outfit.full_description;
  const hasImage = !!outfit.image_url;
  const needsTextFill = hasImage && !hasTextData;

  const handleFillFromImage = async () => {
    if (!outfit.image_url) return;
    setFillingFromImage(true);
    try {
      await onFillFromImage(outfit);
    } finally {
      setFillingFromImage(false);
    }
  };

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
            <p className="text-[10px] text-muted-foreground capitalize">{catDef.label}</p>
            {needsTextFill && (
              <p className="text-[9px] text-amber-400 font-medium">Image only · tap below to fill text</p>
            )}
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
          {!hasTextData && !hasImage && (
            <p className="text-muted-foreground/50 italic">No details yet — edit or add an image to fill.</p>
          )}
        </div>
      )}

      {/* Fill text from image — shown when outfit has an image but no text fields */}
      {needsTextFill && (
        <button
          onClick={handleFillFromImage}
          disabled={fillingFromImage}
          className="w-full text-xs text-amber-400 border border-amber-400/30 hover:bg-amber-400/10 rounded-lg py-1.5 transition-colors font-medium flex items-center justify-center gap-1.5"
        >
          {fillingFromImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
          {fillingFromImage ? "Reading outfit from image…" : "Fill outfit details from image"}
        </button>
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

// ── Add Piece Form ────────────────────────────────────────────────────────────
function AddPieceForm({ character, onSave, onCancel }) {
  const [form, setForm] = useState({ label: "", piece_type: "top", description: "", is_favorite: false });
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");

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
        prompt: `Analyze this clothing item image and extract details. Return JSON:
{
  "label": "Short item name (e.g. White Air Force 1s)",
  "piece_type": "top|bottom|shoes|outerwear|dress|accessories|hat|bag",
  "description": "Detailed description of the item including color, material, style, brand if visible (50-80 words)"
}`,
        file_urls: [imageUrl],
        response_json_schema: {
          type: "object",
          properties: {
            label: { type: "string" },
            piece_type: { type: "string" },
            description: { type: "string" },
          }
        }
      });
      if (res) setForm(prev => ({ ...prev, ...res }));
    } catch (e) {
      console.error("AI fill failed:", e);
    }
    setGenerating(false);
  };

  const handleGenerateVisual = async () => {
    if (!form.description.trim()) return;
    setGenerating(true);
    try {
      const typeDef = PIECE_TYPES.find(t => t.value === form.piece_type);
      const res = await base44.integrations.Core.GenerateImage({
        prompt: `Product photo of a single clothing item: ${form.description}. Clean white background, studio lighting, high quality fashion photography, no person wearing it, just the item itself. ${typeDef?.label} type clothing item.`,
      });
      if (res?.url) setPreviewUrl(res.url);
    } catch (e) {
      console.error("Visual generation failed:", e);
    }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      const finalImageUrl = imageUrl || previewUrl || "";
      await onSave({
        piece_id: generateId("piece"),
        outfit_id: generateId("piece"),
        type: "piece",
        created_at: new Date().toISOString(),
        ...form,
        image_url: finalImageUrl,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border rounded-xl bg-secondary/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Add Clothing Piece</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Input value={form.label} onChange={e => update("label", e.target.value)} placeholder="Item name (e.g. White Air Force 1s) *" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <select value={form.piece_type} onChange={e => update("piece_type", e.target.value)} className="w-full h-9 px-3 rounded-xl bg-input border border-border text-foreground text-sm">
            {PIECE_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Describe the Item</p>
        <div className="flex gap-2">
          <Input
            value={form.description}
            onChange={e => update("description", e.target.value)}
            placeholder="e.g. black leather jacket with silver zippers..."
            className="h-9 text-sm rounded-xl flex-1"
          />
          <Button size="sm" variant="outline" onClick={handleGenerateVisual} disabled={generating || !form.description.trim()} className="rounded-xl gap-1 shrink-0">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            Preview
          </Button>
        </div>
        {previewUrl && (
          <div className="relative">
            <img src={previewUrl} alt="Generated preview" className="w-full h-36 object-cover rounded-xl" />
            <button
              onClick={() => setImageUrl(previewUrl)}
              className={`absolute bottom-2 right-2 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1 ${imageUrl === previewUrl ? 'bg-green-500 text-white' : 'bg-black/70 text-white hover:bg-primary'}`}
            >
              {imageUrl === previewUrl ? <><Check className="w-3 h-3" /> Saved</> : "Use This Image"}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Or Upload a Photo</p>
        <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 rounded-xl border border-dashed border-border hover:border-primary/40 transition-colors text-sm text-muted-foreground">
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {imageUrl && imageUrl !== previewUrl ? "Photo uploaded ✓" : "Upload clothing photo"}
        </label>
        {imageUrl && imageUrl !== previewUrl && (
          <div className="space-y-2">
            <img src={imageUrl} alt="Uploaded" className="w-full h-28 object-cover rounded-xl" />
            <Button size="sm" onClick={handleAiFill} disabled={generating} className="w-full rounded-xl gap-1.5">
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {generating ? "Analyzing image..." : "AI Fill from Photo"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.label.trim() || saving} className="flex-1 rounded-xl">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Save Piece
        </Button>
      </div>
    </div>
  );
}

// ── Add Outfit Form ────────────────────────────────────────────────────────────
function AddOutfitForm({ character, onSave, onCancel }) {
  const [form, setForm] = useState({
    label: "", category: "daily_casual", top: "", bottom: "", shoes: "",
    outerwear: "", accessories: "", hair_state: "", full_description: "", is_favorite: false,
  });
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [generatedImageUrl, setGeneratedImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewModal, setPreviewModal] = useState(null); // { url, type }

  const update = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are generating a detailed outfit for a character named ${character.name}.
Style identity: ${character.style_identity || character.appearance_lock?.clothing_style || character.appearance_lock?.overall_aesthetic || 'casual/streetwear'}.
Gender: ${character.gender || 'unspecified'}.
Quirks that affect style: ${(character.quirks || []).map(q => q.label).join(', ') || 'none'}.
User request: "${genPrompt}"

Return JSON:
{
  "label": "Short outfit name (2-4 words)",
  "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|swimwear|bath|school|date_night|travel|special|medical",
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

  const handleAiFillOutfit = async () => {
    if (!uploadedImageUrl) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this outfit image and extract all clothing details. Return JSON:
{
  "label": "Short outfit name (2-4 words)",
  "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|swimwear|bath|school|date_night|travel|special|medical",
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
      const appearanceBase = character.appearance_lock
        ? `${character.appearance_lock.skin_tone || ''} ${character.appearance_lock.hairstyle || ''} ${character.appearance_lock.overall_aesthetic || ''}`.trim()
        : '';
      const res = await base44.integrations.Core.GenerateImage({
        prompt: `Full body fashion photo of ${character.name}, ${character.gender || 'person'}, ${character.age || ''} years old${appearanceBase ? `, ${appearanceBase}` : ''}. Wearing: ${description}. Standing pose, clean background, lifestyle photography style.`,
        existing_image_urls: character.avatar_url ? [character.avatar_url] : undefined,
      });
      if (res?.url) setGeneratedImageUrl(res.url);
    } catch (e) {
      console.error("Outfit image generation failed:", e);
    }
    setGeneratingImage(false);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      await onSave({
        outfit_id: generateId("outfit"),
        type: "outfit",
        created_at: new Date().toISOString(),
        ...form,
        image_url: uploadedImageUrl || generatedImageUrl || "",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-border rounded-xl bg-secondary/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">New Outfit</p>

      {/* AI generation */}
      <div className="flex gap-2">
        <Input
          value={genPrompt}
          onChange={e => setGenPrompt(e.target.value)}
          placeholder="Describe the vibe (e.g. 'gym day', 'going out Friday night')..."
          className="h-9 text-sm rounded-xl flex-1"
          onKeyDown={e => e.key === "Enter" && handleGenerate()}
        />
        <Button size="sm" onClick={handleGenerate} disabled={generating || !genPrompt.trim()} className="rounded-xl gap-1 shrink-0">
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Generate
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
          <Input value={form.hair_state} onChange={e => update("hair_state", e.target.value)} placeholder="Hair state (optional)" className="h-9 text-sm rounded-xl" />
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

      {/* Generate outfit image */}
      <div className="space-y-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerateOutfitImage}
          disabled={generatingImage || (!form.full_description && !form.top)}
          className="w-full rounded-xl gap-1.5"
        >
          {generatingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          {generatingImage ? "Generating outfit preview..." : "Generate Outfit Image"}
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
      </div>

      {/* Optional outfit photo upload */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-xl border border-dashed border-border hover:border-primary/40 transition-colors text-xs text-muted-foreground">
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          {uploadedImageUrl ? "Photo uploaded ✓" : "Upload outfit reference photo (optional)"}
        </label>
        {uploadedImageUrl && (
          <div className="mt-2 space-y-2">
            <div className="relative group cursor-pointer" onClick={() => setPreviewModal({ url: uploadedImageUrl, type: "uploaded_reference" })}>
              <img src={uploadedImageUrl} alt="Outfit reference" className="w-full h-28 object-cover rounded-xl" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-xl transition-colors flex items-center justify-center">
                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <Button size="sm" onClick={handleAiFillOutfit} disabled={generating} className="w-full rounded-xl gap-1.5">
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {generating ? "Analyzing outfit..." : "AI Fill from Photo"}
            </Button>
          </div>
        )}
      </div>

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
            console.log(`[CharacterCloset] DELETE | type: ${previewModal.type} | url: ${previewModal.url}`);
            if (previewModal.type === "generated_preview") {
              setGeneratedImageUrl("");
              console.log("[CharacterCloset] generatedImageUrl cleared | form preserved");
            } else {
              setUploadedImageUrl("");
              console.log("[CharacterCloset] uploadedImageUrl cleared | form preserved");
            }
            setPreviewModal(null);
          }}
        />
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function CharacterClosetPanel({ character }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("outfits"); // "outfits" | "pieces"
  const [showAddOutfit, setShowAddOutfit] = useState(false);
  const [showAddPiece, setShowAddPiece] = useState(false);
  const [editingOutfit, setEditingOutfit] = useState(null); // outfit being edited
  const [saving, setSaving] = useState(false);

  // outfit_rotation_enabled is stored on the character record.
  // Default: true (rotation on) if never set — preserves existing behavior.
  const rotationEnabled = character?.outfit_rotation_enabled !== false;

  const saveRotationSetting = async (enabled) => {
    await base44.entities.Character.update(character.id, { outfit_rotation_enabled: enabled });
    queryClient.setQueryData(["character", character.id], (prev) =>
      prev ? { ...prev, outfit_rotation_enabled: enabled } : prev
    );
  };

  const closet = character?.character_closet || [];
  const currentOutfit = character?.current_outfit || null;

  // Separate outfits from pieces — prefer explicit type field, fallback to ID-based heuristic for legacy items
  const outfits = closet.filter(item => item.type === "outfit" || (!item.type && item.outfit_id && !item.piece_id?.startsWith("piece_")));
  const pieces = closet.filter(item => item.type === "piece" || (!item.type && item.piece_id?.startsWith("piece_")));

  const saveCloset = async (newCloset, currentOutfitUpdate = null) => {
    setSaving(true);
    try {
      const updates = { character_closet: newCloset };
      if (currentOutfitUpdate !== null) updates.current_outfit = currentOutfitUpdate;
      await base44.entities.Character.update(character.id, updates);
      // Surgical patch — closet/outfit changes don't need a full re-fetch
      queryClient.setQueryData(["character", character.id], (prev) => prev ? { ...prev, ...updates } : prev);
    } catch (error) {
      console.error("Failed to save closet:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOutfit = async (outfit) => {
    await saveCloset([...closet, outfit]);
    setShowAddOutfit(false);
  };

  // Edit existing outfit in-place — never creates a duplicate
  const handleEditOutfit = async (updatedOutfit) => {
    const newCloset = closet.map(o => o.outfit_id === updatedOutfit.outfit_id ? updatedOutfit : o);
    // If this is the current outfit, keep current_outfit in sync
    const isCurrentlyWorn = currentOutfit?.outfit_id === updatedOutfit.outfit_id;
    const currentOutfitUpdate = isCurrentlyWorn
      ? { ...updatedOutfit, last_changed_at: currentOutfit?.last_changed_at, change_reason: currentOutfit?.change_reason }
      : null;
    await saveCloset(newCloset, currentOutfitUpdate);
    setEditingOutfit(null);
  };

  const handleSavePiece = async (piece) => {
    await saveCloset([...closet, piece]);
    setShowAddPiece(false);
  };

  const handleDeleteOutfit = async (outfit_id) => {
    const newCloset = closet.filter(o => o.outfit_id !== outfit_id);
    const clearCurrent = currentOutfit?.outfit_id === outfit_id ? {} : null;
    await saveCloset(newCloset, clearCurrent);
  };

  const handleDeletePiece = async (piece_id) => {
    await saveCloset(closet.filter(p => p.piece_id !== piece_id));
  };

  const handleSetActive = async (outfit) => {
    await saveCloset(closet, {
      ...outfit,
      last_changed_at: new Date().toISOString(),
      change_reason: "manual_selection",
    });
  };

  const handleToggleFavoriteOutfit = async (outfit_id) => {
    await saveCloset(outfits.map(o => o.outfit_id === outfit_id ? { ...o, is_favorite: !o.is_favorite } : o).concat(pieces));
  };

  const handleToggleFavoritePiece = async (piece_id) => {
    await saveCloset(pieces.map(p => p.piece_id === piece_id ? { ...p, is_favorite: !p.is_favorite } : p).concat(outfits));
  };

  // Fill outfit text fields from its image using AI vision analysis.
  // This allows outfits that were created with an image but no text to become
  // fully usable for image generation without losing the existing image.
  const handleFillFromImage = async (outfit) => {
    if (!outfit.image_url) return;
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this outfit image and extract all clothing details for image generation. Return JSON:
{
  "top": "Describe the top/shirt/sweater visible (or empty string if none)",
  "bottom": "Describe the pants/shorts/skirt visible (or empty string if none)",
  "shoes": "Describe the shoes/sneakers visible (or empty string if none)",
  "outerwear": "Describe any jacket/coat/hoodie (or empty string if none)",
  "accessories": "Describe any accessories (hat, bag, jewelry etc.), or empty string",
  "hair_state": "Describe hair if clearly visible, or empty string",
  "full_description": "Vivid complete outfit description for image generation (50-80 words)",
  "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|swimwear|bath|school|date_night|travel|special|medical"
}`,
        file_urls: [outfit.image_url],
        response_json_schema: {
          type: "object",
          properties: {
            top: { type: "string" }, bottom: { type: "string" }, shoes: { type: "string" },
            outerwear: { type: "string" }, accessories: { type: "string" },
            hair_state: { type: "string" }, full_description: { type: "string" },
            category: { type: "string" },
          }
        }
      });
      if (res) {
        const updatedOutfit = { ...outfit, ...res };
        // Only update category if the outfit didn't already have one set by user
        if (!outfit.category || outfit.category === 'daily_casual') {
          updatedOutfit.category = res.category || outfit.category;
        } else {
          updatedOutfit.category = outfit.category; // preserve user's category choice
        }
        const newCloset = closet.map(o => o.outfit_id === outfit.outfit_id ? updatedOutfit : o);
        const isCurrentlyWorn = currentOutfit?.outfit_id === outfit.outfit_id;
        const currentOutfitUpdate = isCurrentlyWorn ? { ...updatedOutfit, last_changed_at: currentOutfit?.last_changed_at, change_reason: currentOutfit?.change_reason } : null;
        await saveCloset(newCloset, currentOutfitUpdate);
      }
    } catch (e) {
      console.error("Fill from image failed:", e);
    }
  };

  const groupedOutfits = OUTFIT_CATEGORIES.reduce((acc, cat) => {
    const items = outfits.filter(o => o.category === cat.value);
    if (items.length > 0) acc[cat.value] = items;
    return acc;
  }, {});

  const groupedPieces = PIECE_TYPES.reduce((acc, type) => {
    const items = pieces.filter(p => p.piece_type === type.value);
    if (items.length > 0) acc[type.value] = items;
    return acc;
  }, {});

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shirt className="w-4 h-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Character Closet</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          {tab === "outfits" && (
            <button onClick={() => { setShowAddOutfit(v => !v); setShowAddPiece(false); }} className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity">
              <Plus className="w-3.5 h-3.5" /> Add Outfit
            </button>
          )}
          {tab === "pieces" && (
            <button onClick={() => { setShowAddPiece(v => !v); setShowAddOutfit(false); }} className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity">
              <Plus className="w-3.5 h-3.5" /> Add Piece
            </button>
          )}
        </div>
      </div>

      {/* Rotation toggle */}
      <div className="flex items-center justify-between bg-secondary/40 rounded-xl px-3 py-2">
        <div className="flex items-center gap-2">
          {rotationEnabled
            ? <RefreshCw className="w-3.5 h-3.5 text-primary" />
            : <Lock className="w-3.5 h-3.5 text-amber-400" />}
          <div>
            <p className="text-xs font-medium text-foreground">
              {rotationEnabled ? "Outfit Rotation: On" : "Outfit Rotation: Off"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {rotationEnabled
                ? "Rotates context-appropriate outfits from closet"
                : "Always wears the currently selected outfit"}
            </p>
          </div>
        </div>
        <button
          onClick={() => saveRotationSetting(!rotationEnabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${rotationEnabled ? 'bg-primary' : 'bg-muted'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${rotationEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Currently Wearing */}
      {currentOutfit && currentOutfit.label && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
          <p className="text-[10px] text-primary font-semibold uppercase tracking-wider mb-1">Currently Wearing</p>
          <p className="text-sm font-medium text-foreground">{currentOutfit.label}</p>
          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {currentOutfit.top && <p>👕 {currentOutfit.top}</p>}
            {currentOutfit.bottom && <p>👖 {currentOutfit.bottom}</p>}
            {currentOutfit.shoes && <p>👟 {currentOutfit.shoes}</p>}
            {currentOutfit.outerwear && <p>🧥 {currentOutfit.outerwear}</p>}
            {currentOutfit.accessories && <p>💍 {currentOutfit.accessories}</p>}
            {!currentOutfit.top && currentOutfit.full_description && (
              <p className="leading-relaxed">{currentOutfit.full_description}</p>
            )}
          </div>
          {currentOutfit.last_changed_at && (
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Changed {new Date(currentOutfit.last_changed_at).toLocaleDateString()}
              {currentOutfit.change_reason ? ` · ${currentOutfit.change_reason.replace(/_/g, ' ')}` : ''}
            </p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary/50 rounded-xl p-1">
        <button
          onClick={() => setTab("outfits")}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${tab === "outfits" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Shirt className="w-3 h-3" /> Outfits ({outfits.length})
        </button>
        <button
          onClick={() => setTab("pieces")}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1 ${tab === "pieces" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Package className="w-3 h-3" /> Pieces ({pieces.length})
        </button>
      </div>

      {/* Outfits Tab */}
      {tab === "outfits" && (
        <div className="space-y-4">
          {showAddOutfit && (
            <AddOutfitForm
              character={character}
              onSave={handleSaveOutfit}
              onCancel={() => setShowAddOutfit(false)}
            />
          )}
          {outfits.length === 0 && !showAddOutfit ? (
            <p className="text-sm text-muted-foreground italic">No outfits saved yet. Add some fits to build this character's closet.</p>
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
                         onDelete={handleDeleteOutfit}
                         onToggleFavorite={handleToggleFavoriteOutfit}
                         onEdit={setEditingOutfit}
                         onFillFromImage={handleFillFromImage}
                       />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Outfit Edit Modal */}
      {editingOutfit && (
        <OutfitEditModal
          outfit={editingOutfit}
          onSave={handleEditOutfit}
          onCancel={() => setEditingOutfit(null)}
        />
      )}

      {/* Pieces Tab */}
      {tab === "pieces" && (
        <div className="space-y-4">
          {showAddPiece && (
            <AddPieceForm
              character={character}
              onSave={handleSavePiece}
              onCancel={() => setShowAddPiece(false)}
            />
          )}
          {pieces.length === 0 && !showAddPiece ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground italic">No clothing pieces saved yet.</p>
              <p className="text-xs text-muted-foreground/70">Upload or describe individual items — shirts, sneakers, jackets, jewelry — to build this character's wardrobe inventory.</p>
            </div>
          ) : (
            Object.entries(groupedPieces).map(([type, items]) => {
              const typeDef = PIECE_TYPES.find(t => t.value === type);
              return (
                <div key={type}>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                    {typeDef?.emoji} {typeDef?.label}
                  </p>
                  <div className="grid gap-2">
                    {items.map(piece => (
                      <PieceCard
                        key={piece.piece_id}
                        piece={piece}
                        onDelete={handleDeletePiece}
                        onToggleFavorite={handleToggleFavoritePiece}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}