import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Shirt, Plus, X, Star, Edit2, Loader2, Wand2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
];

function generateOutfitId() {
  return `outfit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function OutfitCard({ outfit, isActive, onSetActive, onDelete, onToggleFavorite }) {
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
            <p className="text-[10px] text-muted-foreground capitalize">{catDef.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onToggleFavorite(outfit.outfit_id)} className={`p-1 rounded transition-colors ${outfit.is_favorite ? 'text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`}>
            <Star className="w-3.5 h-3.5" fill={outfit.is_favorite ? "currentColor" : "none"} />
          </button>
          <button onClick={() => onDelete(outfit.outfit_id)} className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {outfit.image_url ? (
        <img src={outfit.image_url} alt={outfit.label} className="w-full h-32 object-cover rounded-lg" />
      ) : null}

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

export default function CharacterClosetPanel({ character }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    label: "",
    category: "daily_casual",
    top: "",
    bottom: "",
    shoes: "",
    outerwear: "",
    accessories: "",
    full_description: "",
    is_favorite: false,
  });
  const [genPrompt, setGenPrompt] = useState("");

  const closet = character?.character_closet || [];
  const currentOutfit = character?.current_outfit || null;

  const saveCloset = async (newCloset, currentOutfitUpdate = null) => {
    setSaving(true);
    const updates = { character_closet: newCloset };
    if (currentOutfitUpdate !== null) updates.current_outfit = currentOutfitUpdate;
    await base44.entities.Character.update(character.id, updates);
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
  };

  const handleAdd = async () => {
    if (!form.label.trim()) return;
    const outfit = {
      outfit_id: generateOutfitId(),
      created_at: new Date().toISOString(),
      ...form,
    };
    await saveCloset([...closet, outfit]);
    setForm({ label: "", category: "daily_casual", top: "", bottom: "", shoes: "", outerwear: "", accessories: "", full_description: "", is_favorite: false });
    setShowAdd(false);
  };

  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are generating a detailed outfit description for a character named ${character.name}. 
Their style identity: ${character.style_identity || character.appearance_lock?.clothing_style || character.appearance_lock?.overall_aesthetic || 'casual/streetwear'}.
Gender: ${character.gender || 'unspecified'}.
User request: "${genPrompt}"

Return a JSON object with these fields:
{
  "label": "Short outfit name (2-4 words)",
  "category": "daily_casual|work|gym|church|nightlife|formal|sleepwear|lounge|outdoor|special",
  "top": "Specific top description",
  "bottom": "Specific bottom description",
  "shoes": "Specific shoe description",
  "outerwear": "Jacket/hoodie/etc or empty string",
  "accessories": "Hat, jewelry, bag, etc or empty string",
  "full_description": "Full vivid outfit prompt for image generation (50-80 words)"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            label: { type: "string" },
            category: { type: "string" },
            top: { type: "string" },
            bottom: { type: "string" },
            shoes: { type: "string" },
            outerwear: { type: "string" },
            accessories: { type: "string" },
            full_description: { type: "string" },
          }
        }
      });
      if (res) {
        setForm(prev => ({ ...prev, ...res }));
        setGenPrompt("");
      }
    } catch (e) {
      console.error("Outfit generation failed:", e);
    }
    setGenerating(false);
  };

  const handleDelete = async (outfit_id) => {
    const newCloset = closet.filter(o => o.outfit_id !== outfit_id);
    const clearCurrent = currentOutfit?.outfit_id === outfit_id ? {} : null;
    await saveCloset(newCloset, clearCurrent);
  };

  const handleSetActive = async (outfit) => {
    await saveCloset(closet, {
      ...outfit,
      last_changed_at: new Date().toISOString(),
      change_reason: "manual_selection",
    });
  };

  const handleToggleFavorite = async (outfit_id) => {
    await saveCloset(closet.map(o => o.outfit_id === outfit_id ? { ...o, is_favorite: !o.is_favorite } : o));
  };

  const update = (field, val) => setForm(p => ({ ...p, [field]: val }));

  const grouped = OUTFIT_CATEGORIES.reduce((acc, cat) => {
    const items = closet.filter(o => o.category === cat.value);
    if (items.length > 0) acc[cat.value] = items;
    return acc;
  }, {});

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shirt className="w-4 h-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Character Closet</p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" /> Add Outfit
        </button>
      </div>

      {currentOutfit && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
          <p className="text-[10px] text-primary font-semibold uppercase tracking-wider mb-1">Currently Wearing</p>
          <p className="text-sm font-medium text-foreground">{currentOutfit.label || "Unnamed outfit"}</p>
          {currentOutfit.full_description && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{currentOutfit.full_description}</p>
          )}
          {currentOutfit.last_changed_at && (
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Changed {new Date(currentOutfit.last_changed_at).toLocaleDateString()}
              {currentOutfit.change_reason ? ` · ${currentOutfit.change_reason.replace(/_/g, ' ')}` : ''}
            </p>
          )}
        </div>
      )}

      {/* Add outfit form */}
      {showAdd && (
        <div className="border border-border rounded-xl bg-secondary/20 p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">New Outfit</p>

          {/* AI generation */}
          <div className="flex gap-2">
            <Input
              value={genPrompt}
              onChange={e => setGenPrompt(e.target.value)}
              placeholder="Describe the vibe (e.g. 'gym day', 'going out Friday night')..."
              className="h-9 text-sm rounded-xl flex-1"
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
              <select
                value={form.category}
                onChange={e => update("category", e.target.value)}
                className="w-full h-9 px-3 rounded-xl bg-input border border-border text-foreground text-sm"
              >
                {OUTFIT_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                ))}
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
              <Textarea
                value={form.full_description}
                onChange={e => update("full_description", e.target.value)}
                placeholder="Full outfit description for image generation..."
                className="text-sm rounded-xl min-h-[60px] resize-none"
                rows={2}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)} className="flex-1 rounded-xl">Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!form.label.trim() || saving} className="flex-1 rounded-xl">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Save Outfit
            </Button>
          </div>
        </div>
      )}

      {/* Closet grouped by category */}
      {closet.length === 0 && !showAdd ? (
        <p className="text-sm text-muted-foreground italic">No outfits saved yet. Add some fits to build this character's closet.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([cat, outfits]) => {
            const catDef = OUTFIT_CATEGORIES.find(c => c.value === cat);
            return (
              <div key={cat}>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                  {catDef?.emoji} {catDef?.label}
                </p>
                <div className="grid gap-2">
                  {outfits.map(outfit => (
                    <OutfitCard
                      key={outfit.outfit_id}
                      outfit={outfit}
                      isActive={currentOutfit?.outfit_id === outfit.outfit_id}
                      onSetActive={handleSetActive}
                      onDelete={handleDelete}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}