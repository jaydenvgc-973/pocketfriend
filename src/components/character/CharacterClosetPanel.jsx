import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Shirt, Plus, X, Star, Loader2, Wand2, Upload, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ─── Constants ────────────────────────────────────────────────────────────────

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
  { value: "special", label: "Special / Statement", emoji: "✨" },
  { value: "seasonal", label: "Seasonal", emoji: "🍂" },
];

const PIECE_TYPES = [
  { value: "top", label: "Top", emoji: "👕" },
  { value: "bottom", label: "Bottom / Pants", emoji: "👖" },
  { value: "shoes", label: "Shoes / Sneakers", emoji: "👟" },
  { value: "outerwear", label: "Outerwear", emoji: "🧥" },
  { value: "dress", label: "Dress / Jumpsuit", emoji: "👗" },
  { value: "hat", label: "Hat / Headwear", emoji: "🧢" },
  { value: "jewelry", label: "Jewelry", emoji: "💍" },
  { value: "bag", label: "Bag / Purse", emoji: "👜" },
  { value: "accessory", label: "Accessory", emoji: "🕶️" },
];

function uid() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Outfit Card ──────────────────────────────────────────────────────────────

function OutfitCard({ outfit, isActive, onSetActive, onDelete, onToggleFavorite }) {
  const catDef = OUTFIT_CATEGORIES.find(c => c.value === outfit.category) || OUTFIT_CATEGORIES[0];
  return (
    <div className={`relative rounded-xl border p-3 space-y-2 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      {isActive && (
        <span className="absolute top-2 right-2 text-[9px] text-primary font-bold uppercase tracking-wider bg-primary/10 px-1.5 py-0.5 rounded-full">
          Wearing
        </span>
      )}
      <div className="flex items-start justify-between gap-2 pr-14">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base flex-shrink-0">{catDef.emoji}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{outfit.label}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{catDef.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 absolute top-2 right-8">
          <button onClick={() => onToggleFavorite(outfit.outfit_id)} className={`p-1 rounded transition-colors ${outfit.is_favorite ? "text-amber-400" : "text-muted-foreground hover:text-amber-400"}`}>
            <Star className="w-3.5 h-3.5" fill={outfit.is_favorite ? "currentColor" : "none"} />
          </button>
          <button onClick={() => onDelete(outfit.outfit_id)} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {outfit.image_url && (
        <img src={outfit.image_url} alt={outfit.label} className="w-full h-36 object-cover rounded-lg" />
      )}

      <div className="text-xs space-y-0.5">
        {outfit.top && <p className="text-muted-foreground">👕 {outfit.top}</p>}
        {outfit.bottom && <p className="text-muted-foreground">👖 {outfit.bottom}</p>}
        {outfit.shoes && <p className="text-muted-foreground">👟 {outfit.shoes}</p>}
        {outfit.outerwear && <p className="text-muted-foreground">🧥 {outfit.outerwear}</p>}
        {outfit.accessories && <p className="text-muted-foreground">💍 {outfit.accessories}</p>}
        {!outfit.top && !outfit.bottom && !outfit.shoes && outfit.full_description && (
          <p className="text-muted-foreground leading-relaxed">{outfit.full_description}</p>
        )}
      </div>

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

// ─── Piece Card ───────────────────────────────────────────────────────────────

function PieceCard({ piece, onDelete }) {
  const typeDef = PIECE_TYPES.find(t => t.value === piece.piece_type) || { emoji: "👚", label: "Item" };
  return (
    <div className="flex items-start gap-2 p-2.5 rounded-xl border border-border bg-card">
      {piece.image_url ? (
        <img src={piece.image_url} alt={piece.label} className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 text-lg">
          {typeDef.emoji}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{piece.label}</p>
        <p className="text-[10px] text-muted-foreground capitalize">{typeDef.label}</p>
        {piece.description && <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed line-clamp-2">{piece.description}</p>}
      </div>
      <button onClick={() => onDelete(piece.piece_id)} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors flex-shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Add Outfit Form ──────────────────────────────────────────────────────────

function AddOutfitForm({ character, closet, onSave, onCancel }) {
  const [form, setForm] = useState({
    label: "", category: "daily_casual", top: "", bottom: "", shoes: "",
    outerwear: "", accessories: "", full_description: "", is_favorite: false,
  });
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const update = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a detailed outfit for a character named ${character.name}.
Style identity: ${character.style_identity || character.appearance_lock?.clothing_style || character.appearance_lock?.overall_aesthetic || "casual"}.
Gender: ${character.gender || "unspecified"}.
Request: "${genPrompt}"

Return JSON:
{
  "label": "2-4 word outfit name",
  "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|special|seasonal",
  "top": "specific top",
  "bottom": "specific bottom",
  "shoes": "specific shoes",
  "outerwear": "outerwear or empty string",
  "accessories": "accessories or empty string",
  "full_description": "vivid 50-80 word outfit description for image generation"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            label: { type: "string" }, category: { type: "string" },
            top: { type: "string" }, bottom: { type: "string" },
            shoes: { type: "string" }, outerwear: { type: "string" },
            accessories: { type: "string" }, full_description: { type: "string" },
          }
        }
      });
      if (res) { setForm(p => ({ ...p, ...res })); setGenPrompt(""); }
    } catch (e) { console.error(e); }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    await onSave({ outfit_id: uid(), created_at: new Date().toISOString(), ...form });
    setSaving(false);
  };

  return (
    <div className="border border-border rounded-xl bg-secondary/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">New Outfit</p>
      <div className="flex gap-2">
        <Input value={genPrompt} onChange={e => setGenPrompt(e.target.value)}
          placeholder="Describe the vibe (e.g. 'sneaker fit for the mall')..."
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
          <select value={form.category} onChange={e => update("category", e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-input border border-border text-foreground text-sm">
            {OUTFIT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
          </select>
        </div>
        <Input value={form.top} onChange={e => update("top", e.target.value)} placeholder="Top" className="h-9 text-sm rounded-xl" />
        <Input value={form.bottom} onChange={e => update("bottom", e.target.value)} placeholder="Bottom" className="h-9 text-sm rounded-xl" />
        <Input value={form.shoes} onChange={e => update("shoes", e.target.value)} placeholder="Shoes" className="h-9 text-sm rounded-xl" />
        <Input value={form.outerwear} onChange={e => update("outerwear", e.target.value)} placeholder="Outerwear" className="h-9 text-sm rounded-xl" />
        <div className="col-span-2">
          <Input value={form.accessories} onChange={e => update("accessories", e.target.value)} placeholder="Accessories" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <Textarea value={form.full_description} onChange={e => update("full_description", e.target.value)}
            placeholder="Full outfit description for image generation..." className="text-sm rounded-xl min-h-[60px] resize-none" rows={2} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.label.trim() || saving} className="flex-1 rounded-xl">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />} Save Outfit
        </Button>
      </div>
    </div>
  );
}

// ─── Add Piece Form ───────────────────────────────────────────────────────────

function AddPieceForm({ character, onSave, onCancel }) {
  const [form, setForm] = useState({ label: "", piece_type: "top", description: "", image_url: "" });
  const [genPrompt, setGenPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (f, v) => setForm(p => ({ ...p, [f]: v }));

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      if (res?.file_url) {
        setForm(p => ({ ...p, image_url: res.file_url }));
        setPreviewImageUrl(res.file_url);
      }
    } catch (err) { console.error(err); }
    setUploading(false);
  };

  const handleGenerateImage = async () => {
    const desc = genPrompt.trim() || form.description.trim();
    if (!desc) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.GenerateImage({
        prompt: `Product photo of a single clothing item on a clean white background. Item: ${desc}. No person shown. Fashion catalog style, high detail.`,
      });
      if (res?.url) {
        setForm(p => ({ ...p, image_url: res.url, description: desc }));
        setPreviewImageUrl(res.url);
        if (!form.label) {
          const words = desc.split(" ").slice(0, 4).join(" ");
          setForm(p => ({ ...p, label: words, description: desc, image_url: res.url }));
        }
        setGenPrompt("");
      }
    } catch (e) { console.error(e); }
    setGenerating(false);
  };

  const handleSave = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    await onSave({ piece_id: uid(), created_at: new Date().toISOString(), ...form });
    setSaving(false);
  };

  return (
    <div className="border border-border rounded-xl bg-secondary/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Add Clothing Item</p>

      {/* Image upload OR description-to-image */}
      <div className="grid grid-cols-2 gap-2">
        <label className="cursor-pointer flex flex-col items-center justify-center gap-1.5 h-24 rounded-xl border-2 border-dashed border-border hover:border-primary/40 transition-colors text-muted-foreground hover:text-foreground">
          <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
          <span className="text-[10px] font-medium text-center">Upload Photo</span>
        </label>

        <div className="flex flex-col gap-1.5">
          <Input value={genPrompt} onChange={e => setGenPrompt(e.target.value)}
            placeholder="Describe item to visualize..." className="h-9 text-xs rounded-xl flex-1" />
          <Button size="sm" onClick={handleGenerateImage} disabled={generating || (!genPrompt.trim() && !form.description.trim())} className="rounded-xl gap-1 h-9 w-full">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            Visualize
          </Button>
        </div>
      </div>

      {/* Preview */}
      {previewImageUrl && (
        <div className="relative">
          <img src={previewImageUrl} alt="preview" className="w-full h-40 object-cover rounded-xl border border-border" />
          <button onClick={() => { setPreviewImageUrl(""); setForm(p => ({ ...p, image_url: "" })); }}
            className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Input value={form.label} onChange={e => update("label", e.target.value)} placeholder="Item name * (e.g. White Air Force 1s)" className="h-9 text-sm rounded-xl" />
        </div>
        <div className="col-span-2">
          <select value={form.piece_type} onChange={e => update("piece_type", e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-input border border-border text-foreground text-sm">
            {PIECE_TYPES.map(t => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <Input value={form.description} onChange={e => update("description", e.target.value)}
            placeholder="Description (used in image generation)" className="h-9 text-sm rounded-xl" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 rounded-xl">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={!form.label.trim() || saving} className="flex-1 rounded-xl">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />} Save Item
        </Button>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function CharacterClosetPanel({ character }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("outfits"); // "outfits" | "pieces"
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const closet = character?.character_closet || [];
  const pieces = character?.closet_pieces || [];
  const currentOutfit = character?.current_outfit || null;

  const saveCloset = async (updates) => {
    setSaving(true);
    await base44.entities.Character.update(character.id, updates);
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
  };

  // Outfit handlers
  const handleAddOutfit = async (outfit) => {
    await saveCloset({ character_closet: [...closet, outfit] });
    setShowAdd(false);
  };

  const handleDeleteOutfit = async (outfit_id) => {
    const newCloset = closet.filter(o => o.outfit_id !== outfit_id);
    const updates = { character_closet: newCloset };
    if (currentOutfit?.outfit_id === outfit_id) updates.current_outfit = {};
    await saveCloset(updates);
  };

  const handleSetActive = async (outfit) => {
    await saveCloset({ current_outfit: { ...outfit, last_changed_at: new Date().toISOString(), change_reason: "manual_selection" } });
  };

  const handleToggleFavorite = async (outfit_id) => {
    await saveCloset({ character_closet: closet.map(o => o.outfit_id === outfit_id ? { ...o, is_favorite: !o.is_favorite } : o) });
  };

  // Piece handlers
  const handleAddPiece = async (piece) => {
    await saveCloset({ closet_pieces: [...pieces, piece] });
    setShowAdd(false);
  };

  const handleDeletePiece = async (piece_id) => {
    await saveCloset({ closet_pieces: pieces.filter(p => p.piece_id !== piece_id) });
  };

  const groupedOutfits = OUTFIT_CATEGORIES.reduce((acc, cat) => {
    const items = closet.filter(o => o.category === cat.value);
    if (items.length > 0) acc[cat.value] = items;
    return acc;
  }, {});

  const groupedPieces = PIECE_TYPES.reduce((acc, t) => {
    const items = pieces.filter(p => p.piece_type === t.value);
    if (items.length > 0) acc[t.value] = items;
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
        <button onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity">
          <Plus className="w-3.5 h-3.5" />
          {tab === "outfits" ? "Add Outfit" : "Add Item"}
        </button>
      </div>

      {/* Currently Wearing */}
      {currentOutfit?.label && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
          <p className="text-[10px] text-primary font-semibold uppercase tracking-wider mb-1">Currently Wearing</p>
          <p className="text-sm font-medium text-foreground">{currentOutfit.label}</p>
          {currentOutfit.full_description && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{currentOutfit.full_description}</p>
          )}
          {currentOutfit.last_changed_at && (
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Changed {new Date(currentOutfit.last_changed_at).toLocaleDateString()}
              {currentOutfit.change_reason ? ` · ${currentOutfit.change_reason.replace(/_/g, " ")}` : ""}
            </p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button onClick={() => { setTab("outfits"); setShowAdd(false); }}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${tab === "outfits" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          🧥 Outfits ({closet.length})
        </button>
        <button onClick={() => { setTab("pieces"); setShowAdd(false); }}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${tab === "pieces" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <span className="flex items-center gap-1"><Package className="w-3 h-3" /> Items ({pieces.length})</span>
        </button>
      </div>

      {/* Add form */}
      {showAdd && tab === "outfits" && (
        <AddOutfitForm character={character} closet={closet} onSave={handleAddOutfit} onCancel={() => setShowAdd(false)} />
      )}
      {showAdd && tab === "pieces" && (
        <AddPieceForm character={character} onSave={handleAddPiece} onCancel={() => setShowAdd(false)} />
      )}

      {/* Outfits tab */}
      {tab === "outfits" && (
        closet.length === 0 && !showAdd ? (
          <p className="text-sm text-muted-foreground italic">No outfits yet. Add outfits or describe a vibe to generate one.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedOutfits).map(([cat, outfits]) => {
              const catDef = OUTFIT_CATEGORIES.find(c => c.value === cat);
              return (
                <div key={cat}>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                    {catDef?.emoji} {catDef?.label}
                  </p>
                  <div className="grid gap-2">
                    {outfits.map(outfit => (
                      <OutfitCard key={outfit.outfit_id} outfit={outfit}
                        isActive={currentOutfit?.outfit_id === outfit.outfit_id}
                        onSetActive={handleSetActive} onDelete={handleDeleteOutfit} onToggleFavorite={handleToggleFavorite} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Pieces tab */}
      {tab === "pieces" && (
        pieces.length === 0 && !showAdd ? (
          <p className="text-sm text-muted-foreground italic">No clothing items yet. Upload a photo or describe a piece to add it.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedPieces).map(([type, items]) => {
              const typeDef = PIECE_TYPES.find(t => t.value === type);
              return (
                <div key={type}>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                    {typeDef?.emoji} {typeDef?.label}
                  </p>
                  <div className="space-y-2">
                    {items.map(piece => (
                      <PieceCard key={piece.piece_id} piece={piece} onDelete={handleDeletePiece} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}