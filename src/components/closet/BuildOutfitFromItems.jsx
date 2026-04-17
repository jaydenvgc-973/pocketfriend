import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Check, X, Wand2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const OUTFIT_CATEGORIES = [
  { value: "daily_casual", label: "Daily Casual", emoji: "👕" },
  { value: "work", label: "Work", emoji: "👔" },
  { value: "gym", label: "Gym / Workout", emoji: "🏋️" },
  { value: "church", label: "Church / Religious", emoji: "🛐" },
  { value: "nightlife", label: "Nightlife / Party", emoji: "🌃" },
  { value: "formal", label: "Formal", emoji: "🎩" },
  { value: "sleepwear", label: "Sleepwear", emoji: "😴" },
  { value: "lounge", label: "Lounge / Home", emoji: "🛋️" },
  { value: "outdoor", label: "Outdoor / Errands", emoji: "🌳" },
  { value: "date_night", label: "Date Night", emoji: "💘" },
  { value: "special", label: "Special / Statement", emoji: "✨" },
];

// Which item categories map to which outfit slot
const SLOT_MAP = [
  { slot: "top",         label: "Top",          emoji: "👕", categories: ["tops", "activewear"] },
  { slot: "bottom",      label: "Bottom",        emoji: "👖", categories: ["bottoms"] },
  { slot: "shoes",       label: "Shoes",         emoji: "👟", categories: ["shoes"] },
  { slot: "outerwear",   label: "Outerwear",     emoji: "🧥", categories: ["outerwear"] },
  { slot: "accessories", label: "Accessories",   emoji: "💍", categories: ["accessories", "jewelry", "bags", "hats"] },
];

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * BuildOutfitFromItems
 * 
 * Props:
 *   ownedItems: ClothingItem[]
 *   character: Character (for image gen, name, appearance)
 *   onSave: (outfitData) => void
 *   onCancel: () => void
 */
export default function BuildOutfitFromItems({ ownedItems, character, onSave, onCancel }) {
  const [outfitName, setOutfitName] = useState("");
  const [category, setCategory] = useState("daily_casual");
  const [selectedItems, setSelectedItems] = useState({}); // { slot: item }
  const [expandedSlot, setExpandedSlot] = useState(null);
  const [saving, setSaving] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState("");

  const getItemsForSlot = (slot) => {
    const slotDef = SLOT_MAP.find(s => s.slot === slot);
    return ownedItems.filter(i => slotDef?.categories.includes(i.item_category));
  };

  const selectItem = (slot, item) => {
    setSelectedItems(prev => {
      if (prev[slot]?.id === item.id) {
        const next = { ...prev };
        delete next[slot];
        return next;
      }
      return { ...prev, [slot]: item };
    });
    setExpandedSlot(null);
  };

  const selectedCount = Object.keys(selectedItems).length;

  const buildDescription = () =>
    SLOT_MAP.map(s => selectedItems[s.slot]?.item_name).filter(Boolean).join(", ");

  const handleGeneratePreview = async () => {
    const description = buildDescription();
    if (!description) return;
    setGeneratingImage(true);
    try {
      const appearanceBase = character?.appearance_lock
        ? `${character.appearance_lock.skin_tone || ''} ${character.appearance_lock.hairstyle || ''} ${character.appearance_lock.overall_aesthetic || ''}`.trim()
        : '';
      const res = await base44.integrations.Core.GenerateImage({
        prompt: `Full body fashion photo of ${character?.name || "a person"}, ${character?.gender || 'person'}${appearanceBase ? `, ${appearanceBase}` : ''}. Wearing: ${description}. Standing pose, clean background, lifestyle photography, photorealistic.`,
        existing_image_urls: character?.avatar_url ? [character.avatar_url] : undefined,
      });
      if (res?.url) setPreviewImage(res.url);
    } catch (e) { console.error("Preview failed:", e); }
    setGeneratingImage(false);
  };

  const handleSave = async () => {
    if (!outfitName.trim() || selectedCount === 0) return;
    setSaving(true);
    try {
      const slots = {};
      SLOT_MAP.forEach(s => {
        if (selectedItems[s.slot]) slots[s.slot] = selectedItems[s.slot].item_name;
      });

      const itemIds = Object.values(selectedItems).map(i => i.id);

      await onSave({
        outfit_id: generateId("outfit"),
        type: "outfit",
        label: outfitName.trim(),
        category,
        created_at: new Date().toISOString(),
        is_archived: false,
        times_worn: 0,
        is_favorite: false,
        image_url: previewImage || "",
        item_ids: itemIds,
        full_description: buildDescription(),
        ...slots,
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="border border-primary/30 rounded-xl bg-primary/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Build Outfit from Items</p>
        <button onClick={onCancel} className="p-1 text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Outfit name + category */}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <Input
            value={outfitName}
            onChange={e => setOutfitName(e.target.value)}
            placeholder="Outfit name * (e.g. Red Sneaker Fit)"
            className="h-9 text-sm rounded-xl"
          />
        </div>
        <div className="col-span-2">
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full h-9 px-3 rounded-xl bg-input border border-border text-foreground text-sm"
          >
            {OUTFIT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>)}
          </select>
        </div>
      </div>

      {/* Slot pickers */}
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Select pieces from your inventory</p>
        {SLOT_MAP.map(slotDef => {
          const slotItems = getItemsForSlot(slotDef.slot);
          const selected = selectedItems[slotDef.slot];
          const isOpen = expandedSlot === slotDef.slot;

          return (
            <div key={slotDef.slot} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                onClick={() => setExpandedSlot(isOpen ? null : slotDef.slot)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm">{slotDef.emoji}</span>
                  <span className="text-xs font-medium text-foreground">{slotDef.label}</span>
                  {selected ? (
                    <span className="text-xs text-primary font-medium truncate">→ {selected.item_name}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      {slotItems.length === 0 ? "No items owned" : "Not selected"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {selected && (
                    <button
                      onClick={e => { e.stopPropagation(); selectItem(slotDef.slot, selected); }}
                      className="p-0.5 rounded text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  {slotItems.length > 0 && (
                    isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </div>
              </button>

              {isOpen && slotItems.length > 0 && (
                <div className="border-t border-border divide-y divide-border max-h-48 overflow-y-auto">
                  {slotItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => selectItem(slotDef.slot, item)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${selected?.id === item.id ? 'bg-primary/10' : 'hover:bg-secondary/60'}`}
                    >
                      {item.image_url && (
                        <img src={item.image_url} alt={item.item_name} className="w-8 h-8 object-cover rounded-lg flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{item.item_name}</p>
                        {item.brand && <p className="text-[10px] text-muted-foreground">{item.brand}{item.color ? ` · ${item.color}` : ''}</p>}
                      </div>
                      {selected?.id === item.id && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary of selected */}
      {selectedCount > 0 && (
        <div className="bg-secondary/50 rounded-xl p-3 space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Selected pieces ({selectedCount})</p>
          {SLOT_MAP.filter(s => selectedItems[s.slot]).map(s => (
            <p key={s.slot} className="text-xs text-foreground">{s.emoji} {selectedItems[s.slot].item_name}</p>
          ))}
        </div>
      )}

      {/* Preview image */}
      {previewImage && (
        <img src={previewImage} alt="Outfit preview" className="w-full h-44 object-cover rounded-xl" />
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {selectedCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleGeneratePreview}
            disabled={generatingImage}
            className="flex-1 rounded-xl gap-1.5"
          >
            {generatingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {generatingImage ? "Generating..." : "Preview Look"}
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!outfitName.trim() || selectedCount === 0 || saving}
          className="flex-1 rounded-xl"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Save as Outfit
        </Button>
      </div>

      {selectedCount === 0 && (
        <p className="text-[10px] text-muted-foreground text-center">Select at least one piece to save this as an outfit.</p>
      )}
    </div>
  );
}